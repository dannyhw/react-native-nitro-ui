#!/usr/bin/env node
/**
 * `bun run check`, run as a dependency graph (`scripts/check-steps.mjs`).
 *
 *   bun run check               the graph, as many steps at once as the machine fits
 *   bun run check -- --jobs 1   the same steps, one at a time
 *
 * Each step's log is buffered and printed whole, in declared step order; a
 * one-line summary is printed the moment a step ends, and a failing step's log
 * is printed again at the end.
 *
 * Exit code is non-zero if any step failed. On the first failure no new step
 * starts, running ones finish, and the rest are reported as skipped.
 *
 * When `NITRO_UI_CHECK_STEPS_FILE` names a file, the per-step results are
 * written there as JSON. The variable is removed from the children's
 * environment so a nested `bun run check` does not answer it.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  CHECK_STEPS,
  commandForStep,
  defaultJobsFrom,
  parseJobsArgument,
  planProblems,
  runCheckPlan,
  unknownCheckArguments,
} from './check-steps.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

function seconds(ms) {
  return `${(Number(ms) / 1000).toFixed(1)}s`;
}

function coreCount() {
  return typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : os.cpus().length;
}

/**
 * @param {{name: string, status: string, durationMs: number, reason: string | null}} result
 */
function summaryLine(result) {
  const mark =
    result.status === 'pass' ? '✓' : result.status === 'fail' ? '✗' : '·';
  const why =
    result.status === 'pass' || result.reason == null
      ? ''
      : ` - ${result.reason}`;
  return `check: ${mark} ${result.name.padEnd(19)} ${result.status.padEnd(7)} ${seconds(result.durationMs).padStart(8)}${why}\n`;
}

function rule(text) {
  const line = '─'.repeat(Math.max(0, 72 - [...text].length));
  return `──────── ${text} ${line}\n`;
}

/**
 * One entry per step, in declared order, plus the totals. Versioned, because
 * the gate ledger keeps it verbatim.
 *
 * @param {object} summary the result of `runCheckPlan`
 * @returns {{version: number, jobs: number, wallMs: number, steps: object[]}}
 */
export function stepTimingPayload(summary) {
  return {
    version: 1,
    jobs: summary.jobs,
    wallMs: Math.round(summary.wallMs),
    steps: summary.results.map((result) => ({
      name: result.name,
      status: result.status,
      durationMs: Math.round(result.durationMs),
      exitCode: result.exitCode,
      signal: result.signal,
      reason: result.reason,
    })),
  };
}

/**
 * @param {string[]} argv `process.argv.slice(2)`
 * @param {{env?: NodeJS.ProcessEnv, out?: (text: string) => void, err?: (text: string) => void,
 *   cores?: number, stepsFile?: string | null,
 *   run?: (step: object) => Promise<object>}} [io] every outside world a test can swap
 * @returns {Promise<number>} the exit code
 */
export async function main(argv = process.argv.slice(2), io = {}) {
  const env = io.env ?? process.env;
  const out = io.out ?? ((text) => process.stdout.write(text));
  const err = io.err ?? ((text) => process.stderr.write(text));

  const { jobs: requestedJobs, problems: jobProblems } =
    parseJobsArgument(argv);
  if (jobProblems.length > 0) {
    for (const problem of jobProblems) err(`check: ${problem}\n`);
    return 2;
  }
  const unknown = unknownCheckArguments(argv);
  if (unknown.length > 0) {
    err(
      `check: unknown argument(s): ${unknown.join(' ')}\n` +
        'check: takes no argument but --jobs N. The steps are not filterable: a\n' +
        '         filtered check is not the gate that name means. To run one step,\n' +
        '         name it - `bun run <step>`.\n'
    );
    return 2;
  }

  const problems = planProblems(CHECK_STEPS);
  if (problems.length > 0) {
    err(
      `check: refusing to run - the step list in scripts/check-steps.mjs is not runnable:\n` +
        `${problems.map((problem) => `  - ${problem}`).join('\n')}\n`
    );
    return 2;
  }

  const cores = io.cores ?? coreCount();
  const jobs = requestedJobs ?? defaultJobsFrom(cores);
  const stepsFile =
    io.stepsFile !== undefined
      ? io.stepsFile
      : (env.NITRO_UI_CHECK_STEPS_FILE ?? null);

  out(
    `check: ${String(CHECK_STEPS.length)} steps, ${String(jobs)} job(s) of ${String(cores)} cores` +
      `${requestedJobs == null ? '' : ' (--jobs)'}\n`
  );

  /** Buffered logs, kept so a failing step's can be repeated at the end. */
  const logs = new Map();
  const failures = [];

  const summary = await runCheckPlan({
    steps: CHECK_STEPS,
    jobs,
    onEvent: (event) => {
      if (event.type === 'done' || event.type === 'skip') {
        out(summaryLine({ ...event.result, name: event.step.name }));
      }
      if (event.type === 'flush') {
        const result = event.result;
        logs.set(event.step.name, result.log ?? '');
        if (result.status === 'fail') failures.push(event.step.name);
        out(
          rule(
            `${event.step.name} — ${result.status}, ${seconds(result.durationMs)}`
          )
        );
        if (result.status !== 'fail') out(result.log ?? '');
      }
    },
    run: io.run ?? ((step) => runStep(step, env)),
  });

  if (stepsFile != null && stepsFile !== '') {
    try {
      fs.mkdirSync(path.dirname(stepsFile), { recursive: true });
      fs.writeFileSync(
        stepsFile,
        `${JSON.stringify(stepTimingPayload(summary))}\n`
      );
    } catch (error) {
      // Losing the timing breakdown must never turn a green check red.
      err(
        `check: could not write step timings to ${stepsFile}: ${String(error?.message ?? error)}\n`
      );
    }
  }

  const passed = summary.results.filter((r) => r.status === 'pass').length;
  const skipped = summary.results.filter((r) => r.status === 'skipped').length;
  out(
    `check: ${String(passed)} passed, ${String(summary.failures.length)} failed` +
      (skipped > 0 ? `, ${String(skipped)} skipped` : '') +
      ` in ${seconds(summary.wallMs)}\n`
  );
  if (summary.failures.length > 0) {
    out(`check: failed step(s): ${summary.failures.join(', ')}\n`);
    if (skipped > 0) {
      out(
        `check: not started after the first failure: ${summary.results
          .filter((r) => r.status === 'skipped')
          .map((r) => r.name)
          .join(', ')}\n`
      );
    }
    for (const name of summary.failures) {
      out(rule(`full log: ${name}`));
      out(logs.get(name) ?? '(no output captured)\n');
    }
    return 1;
  }
  return 0;
}

/** The children this run started, so a signal can reach them. */
const running = new Set();

/**
 * Forwards Ctrl-C and SIGTERM to the steps so none is orphaned. Installing a
 * listener replaces Node's "die from this signal" default, so this process then
 * exits with status 0 or 1, never 130.
 */
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const child of running) {
      try {
        child.kill(signal);
      } catch {
        /* already gone */
      }
    }
  });
}

/**
 * Spawn one step, buffering its output so nothing interleaves. Both streams go
 * into one list in arrival order and are decoded once at the end, so a
 * multibyte character split across two chunks survives.
 *
 * @param {object} step
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<{ok: boolean, log: string, exitCode: number | null, signal: string | null, error?: string}>}
 */
export function runStep(step, env = process.env) {
  const argv = commandForStep(step);
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(argv[0], argv.slice(1), {
        cwd: REPO_ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: (() => {
          const childEnv = { ...env };
          delete childEnv.NITRO_UI_CHECK_STEPS_FILE;
          return childEnv;
        })(),
      });
    } catch (error) {
      resolve({
        ok: false,
        log: '',
        exitCode: null,
        signal: null,
        error: `could not start ${argv.join(' ')}: ${String(error?.message ?? error)}`,
      });
      return;
    }
    running.add(child);
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => chunks.push(chunk));
    child.on('error', (error) => {
      running.delete(child);
      resolve({
        ok: false,
        log: Buffer.concat(chunks).toString('utf8'),
        exitCode: null,
        signal: null,
        error: `could not run ${argv.join(' ')}: ${error.message}`,
      });
    });
    child.on('close', (code, signal) => {
      running.delete(child);
      resolve({
        ok: code === 0 && signal == null,
        log: Buffer.concat(chunks).toString('utf8'),
        exitCode: code,
        signal,
      });
    });
  });
}

if (
  process.argv[1] != null &&
  // Compared as a real path turned into a URL: ESM URLs are percent-encoded and
  // symlink-resolved, so a `file://${path}` string misses a path with a space or
  // one reached through a symlink. `existsSync` because `realpathSync` throws.
  import.meta.url ===
    pathToFileURL(
      fs.existsSync(path.resolve(process.argv[1]))
        ? fs.realpathSync(path.resolve(process.argv[1]))
        : path.resolve(process.argv[1])
    ).href
) {
  try {
    process.exitCode = await main();
  } catch (error) {
    process.stderr.write(`check: ${String(error?.message ?? error)}\n`);
    process.exitCode = 1;
  }
}
