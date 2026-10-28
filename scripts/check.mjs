#!/usr/bin/env node
/**
 * `bun run check`, run as a dependency graph instead of one `&&` chain.
 *
 *   bun run check               the graph, as many steps at once as the machine fits
 *   bun run check -- --jobs 1   the same steps, one at a time
 *   bun run check:serial        the old `&&` chain, for comparing the two
 *
 * The steps are the same sixteen and no more - `package.json`'s `check:serial` is
 * the reference, and a unit test fails if the two ever disagree
 * (`scripts/__tests__/check-runner.test.js`). What changed is *when* they run:
 * `scripts/check-steps.mjs` says what each step needs and what it writes, so
 * independent work overlaps and the parts that touch the same output do not.
 *
 * Output rules, in the order the brief asked for them:
 *
 *   - a step's log is buffered and printed **whole**, never interleaved with
 *     another's;
 *   - one line per step gives name, status and duration, printed the moment the
 *     step ends, so the run is legible while it is going on;
 *   - the logs themselves go out in *declared step order* as they become
 *     available. That is a deliberate half-step away from "in completion order":
 *     `bun run check` prints several Jest summaries, and the ledger quotes the
 *     first one in the log - the unit-test run, not whichever Jest happened to
 *     finish first (X2 review M3). Ordering the flush by the step list keeps that
 *     deterministic, and the live summary lines above it keep a long first step
 *     from looking like a hang;
 *   - a failing step's full log is printed again at the end, because that is the
 *     one a person scrolls to.
 *
 * Exit code is non-zero if any step failed. On the first failure no new step
 * starts, running ones are allowed to finish (their logs are still evidence), and
 * everything left is reported as skipped rather than silently missing.
 *
 * When `NITRO_UI_CHECK_STEPS_FILE` names a file (the gate ledger does, so
 * `gate.mjs check` can record per-step timings), the per-step results are written
 * there as JSON. The variable is removed from the children's environment: it means
 * "the ledger waiting above me", one level, not something a nested `bun run check`
 * should answer - the same rule `gate.mjs` applies to `NITRO_UI_GATE_LOG`.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

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

/** Step durations are seconds with one decimal: enough to compare, no false precision. */
function seconds(ms) {
  return `${(Number(ms) / 1000).toFixed(1)}s`;
}

/** @returns {number} this machine's core count (availability-aware where Node is new enough). */
function coreCount() {
  return typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : os.cpus().length;
}

/**
 * The one-line summary for a finished step: name, status, duration.
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
 * What `gate.mjs` reads back out of a check run: one entry per step, in declared
 * order, plus the totals. Versioned, because the ledger keeps it verbatim.
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
 *   serialChain?: string, cores?: number, stepsFile?: string | null,
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

  let serialChain = io.serialChain;
  if (serialChain == null) {
    try {
      serialChain = JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')
      ).scripts?.['check:serial'];
    } catch (error) {
      err(
        `check: could not read package.json to compare the step list: ${String(error?.message ?? error)}\n`
      );
      return 2;
    }
  }
  const problems = planProblems(CHECK_STEPS, serialChain);
  if (problems.length > 0) {
    err(
      `check: refusing to run - the graph does not describe the chain:\n` +
        `${problems.map((problem) => `  - ${problem}`).join('\n')}\n` +
        "check: scripts/check-steps.mjs and package.json's `check:serial` are\n" +
        'check: the same sixteen steps and must change together.\n'
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
        // A failing step's log comes last, once; printing it here too would only
        // push the failure further up the page.
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

/** The children this run started, so a signal can reach them (see below). */
const running = new Set();

/**
 * Ctrl-C or a task runner's SIGTERM has to reach the steps, not just this process:
 * children left holding a checkout after the parent exits is how one machine ends
 * up with two checks in it. Forwarding gives each step its own cleanup, and the
 * default behaviour then re-raises on self so the exit status is still the signal.
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
 * Spawn one step, buffering its output so nothing interleaves.
 *
 * Both streams go into one list in arrival order, which is what a person reading a
 * serial run saw. Decoding once at the end is what keeps a multibyte character
 * split across two chunks from becoming mojibake in the log.
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
  import.meta.url === `file://${path.resolve(process.argv[1])}`
) {
  try {
    process.exitCode = await main();
  } catch (error) {
    process.stderr.write(`check: ${String(error?.message ?? error)}\n`);
    process.exitCode = 1;
  }
}
