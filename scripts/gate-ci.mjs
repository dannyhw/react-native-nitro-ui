#!/usr/bin/env node
/**
 * The Android real-input suite inside the CI job, run the way `gate.mjs` runs it
 * locally and recorded so `gate.mjs ci-import` can judge it from the artifact.
 *
 *   node scripts/gate-ci.mjs run --dir <dir>
 *   node scripts/gate-ci.mjs rerun --dir <dir>
 *   node scripts/gate-ci.mjs verdict --dir <dir>
 *
 * `run` runs the full suite and writes `<dir>/full/`: `run.json`, `units.json` and
 * e2e's output in `e2e/`. `rerun` re-runs into `<dir>/rerun/`, once, only the units a
 * completion of that red run would (`gate.mjs <gate> --rerun-failed`), and nothing
 * when no filter names the failure. `verdict` judges `<dir>` the way `ci-import` will
 * and exits 1 when it is red.
 *
 * Every file it writes is outside the checkout, so the tree the run is of never moves.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  CI_E2E_DIR,
  CI_FULL_DIR,
  CI_GATE,
  CI_REPORT_FILE,
  CI_RERUN_DIR,
  CI_RUN_RECORD,
  CI_UNITS_FILE,
  ciLedgerLine,
  commitAsDigests,
  hostedRunRelaxed,
} from './gate-ci-core.mjs';
import { rerunOfUnits } from './gate-core.mjs';
import { FOLLOWUPS_FILE } from './real-input/android-results.mjs';
import { REAL_INPUT_UNITS_ENV } from './real-input/report.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');

/** Where `scripts/real-input/android.mjs` leaves e2e's report and screenshots. */
const E2E_OUTPUT = path.join(repoRoot, 'example/e2e/.e2e/android');

function readOrNull(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function readJsonOrNull(file) {
  const text = readOrNull(file);
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** One run folder of the artifact, parsed; `null` when the suite never started there. */
export function readUploadedRun(dir) {
  const record = readJsonOrNull(path.join(dir, CI_RUN_RECORD));
  if (record == null) return null;
  return {
    record,
    results: readJsonOrNull(path.join(dir, CI_UNITS_FILE)),
    report: readJsonOrNull(path.join(dir, CI_REPORT_FILE)),
  };
}

/** The files quarantines are read from, in this checkout. */
export function checkoutSources(root) {
  return {
    followups: readOrNull(path.join(root, FOLLOWUPS_FILE)),
    readTestFile: (file) => readOrNull(path.join(root, 'example/e2e', file)),
  };
}

function headOf(root) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function option(argv, name) {
  const index = argv.indexOf(name);
  const value = index === -1 ? null : argv[index + 1];
  if (value == null || value.startsWith('--')) {
    throw new Error(`gate-ci: ${name} <dir> is required`);
  }
  return path.resolve(value);
}

/** Runs the suite with `args`, and records it in `out`. Returns its exit code. */
function runSuite(out, args) {
  fs.mkdirSync(out, { recursive: true });
  const startedAt = new Date().toISOString();
  const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, 'scripts/real-input/android.mjs'), ...args],
    {
      cwd: repoRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        [REAL_INPUT_UNITS_ENV]: path.join(out, CI_UNITS_FILE),
      },
    }
  );
  const finishedAt = new Date().toISOString();
  if (fs.existsSync(E2E_OUTPUT)) {
    fs.cpSync(E2E_OUTPUT, path.join(out, CI_E2E_DIR), { recursive: true });
  }
  const exitCode = result.error != null ? null : result.status;
  fs.writeFileSync(
    path.join(out, CI_RUN_RECORD),
    `${JSON.stringify(
      {
        version: 1,
        sha: headOf(repoRoot),
        args,
        startedAt,
        finishedAt,
        exitCode,
        signal: result.signal ?? null,
        device: process.env.ANDROID_SERIAL ?? process.env.ANDROID_AVD ?? null,
        relaxed: hostedRunRelaxed(process.env),
      },
      null,
      2
    )}\n`
  );
  return exitCode ?? 1;
}

/** The line `ci-import` would write for `dir`, judged inside the job. */
function judgeFolder(dir) {
  const head = headOf(repoRoot);
  const full = readUploadedRun(path.join(dir, CI_FULL_DIR));
  if (head == null || full == null) return null;
  const digests = commitAsDigests(head);
  return ciLedgerLine({
    source: null,
    head,
    branch: null,
    before: digests,
    after: digests,
    full,
    rerun: readUploadedRun(path.join(dir, CI_RERUN_DIR)),
    sources: checkoutSources(repoRoot),
  });
}

function main(argv) {
  const [command, ...rest] = argv;
  if (command === 'run') {
    return runSuite(path.join(option(rest, '--dir'), CI_FULL_DIR), []);
  }
  if (command === 'rerun') {
    const dir = option(rest, '--dir');
    const out = path.join(dir, CI_RERUN_DIR);
    if (fs.existsSync(path.join(out, CI_RUN_RECORD))) {
      console.log(
        `gate-ci: ${out} already holds a re-run; a red run is re-run once`
      );
      return 1;
    }
    const judged = judgeFolder(dir);
    if (judged == null) {
      console.log(
        'gate-ci: the full run left no run record: it never started the suite, ' +
          'so there is nothing to re-run'
      );
      return 0;
    }
    if (judged.line.result === 'pass') {
      console.log('gate-ci: the full run is green: nothing to re-run');
      return 0;
    }
    const named = rerunOfUnits({
      gate: CI_GATE,
      units: judged.line.units,
      exitCode: judged.line.exitCode,
    });
    if (named.refusal != null) {
      console.log(`gate-ci: not re-run - ${named.refusal}`);
      return 0;
    }
    console.log(
      `gate-ci: re-running ${String(named.rerun.length)} unit(s) once - ` +
        `${named.rerun.join(', ')} (${named.filterArgs.join(' ')})`
    );
    return runSuite(out, named.filterArgs);
  }
  if (command === 'verdict') {
    const judged = judgeFolder(option(rest, '--dir'));
    if (judged == null) {
      console.log(
        'gate-ci: red - the suite never started, so there is no run record'
      );
      return 1;
    }
    for (const line of [
      ...judged.full.quarantined,
      ...(judged.rerun?.quarantined ?? []),
    ]) {
      console.log(`QUARANTINED ${line}`);
    }
    for (const note of judged.notes) console.log(`gate-ci: ${note}`);
    const why =
      judged.line.completion != null
        ? judged.line.completion.why
        : judged.full.why;
    for (const reason of why) console.log(`gate-ci: ${reason}`);
    const how =
      judged.line.completion == null
        ? 'full run'
        : `completed: ${String(judged.line.completion.rerun.length)} unit(s) re-run`;
    console.log(
      `gate-ci: ${CI_GATE} ${judged.line.result === 'pass' ? 'PASS' : 'FAIL'} (${how})`
    );
    return judged.line.result === 'pass' ? 0 : 1;
  }
  console.error(
    'usage: node scripts/gate-ci.mjs run --dir <dir>\n' +
      '       node scripts/gate-ci.mjs rerun --dir <dir>\n' +
      '       node scripts/gate-ci.mjs verdict --dir <dir>'
  );
  return 2;
}

if (
  process.argv[1] != null &&
  fs.realpathSync(path.resolve(process.argv[1])) ===
    fs.realpathSync(import.meta.filename)
) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(String(error?.message ?? error));
    process.exitCode = 1;
  }
}
