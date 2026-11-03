#!/usr/bin/env node
/**
 * The entry point behind `bun run harness:android` and friends.
 *
 * It exists for one reason: `react-native-harness` is a third-party CLI, so the
 * one gate that touches a device was the one gate nothing could pin. The report
 * for round 1 claimed the harness "refuses a different Node version and re-runs
 * itself under .nvmrc's", and that was not true (review S9) - `build-app.mjs`
 * and the real-input gates call the guard, the harness did not, and a suite run
 * on a stray Node 22 was a suite run on a runtime nothing else in this repo
 * promises.
 *
 * So: check the runtime first, then hand over. The hand-over is a `spawn` of the
 * real CLI's own `bin.js` rather than an `import` of it, because the CLI parses
 * `process.argv` and installs its own signal handlers; the exact command is
 * printed first so a run can be reproduced without this file.
 *
 * When the runtime is wrong and `fnm` can provide the right one,
 * `assertSupportedNodeOrReexec` replaces this process - including this file, so
 * the check happens once and the CLI still sees the original arguments.
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  ISOLATED_DIR,
  ISOLATED_ENV,
  combinedExitCode,
  wantsIsolatedRun,
} from './harness-isolated.mjs';
import { SUITE_TIMING_ENV } from './harness-suite-timing.mjs';
import { assertSupportedNodeOrReexec } from './node-version.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

/**
 * Where the hoisted install puts the CLI. The root first: `example/` does not
 * carry its own copy today, and looking there anyway means this keeps working
 * if the hoist ever changes.
 */
const CANDIDATES = [
  join(repoRoot, 'node_modules', 'react-native-harness', 'bin.js'),
  join(repoRoot, 'example', 'node_modules', 'react-native-harness', 'bin.js'),
];

const cli = CANDIDATES.find((candidate) => existsSync(candidate));
if (cli == null) {
  process.stderr.write(
    `harness: react-native-harness is not installed - looked in\n` +
      `  ${CANDIDATES.join('\n  ')}\n` +
      '  install with: bun install (from the repository root)\n'
  );
  process.exit(1);
}

const args = process.argv.slice(2);

/**
 * The `bun run` name these arguments came from, so the refusal names the gate it
 * is refusing. This file is the entry point behind `harness:ios`,
 * `harness:android` and the two cold variants (see `example/package.json`), and
 * the label used to be hardcoded to Android - so an iOS run told the reader to
 * re-run the other platform (X1 re-review F5).
 *
 * @param {string[]} argv Arguments after the script name.
 * @returns {string}
 */
function bunScriptName(argv) {
  const at = argv.indexOf('--harnessRunner');
  const runner = at === -1 ? null : argv[at + 1];
  if (runner !== 'ios' && runner !== 'android') return 'bun run harness';
  return `bun run harness${argv.includes('ColdSizing') ? ':cold' : ''}:${runner}`;
}

assertSupportedNodeOrReexec({
  command: bunScriptName(args),
  entryUrl: import.meta.url,
});

const command = [process.execPath, cli, ...args];

/**
 * One `react-native-harness` run - one app launch. Resolves with its exit code; a
 * signal is passed on rather than masked with exit 1: Ctrl-C has to look like Ctrl-C
 * to whatever is driving a suite.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {Promise<number>}
 */
function runHarness(env) {
  process.stderr.write(`harness: ${command.join(' ')}\n`);
  return new Promise((resolveRun) => {
    const child = spawn(command[0], command.slice(1), {
      stdio: 'inherit',
      env,
    });
    child.on('error', (error) => {
      process.stderr.write(
        `harness: could not start ${cli}: ${error.message}\n`
      );
      process.exit(1);
    });
    child.on('close', (code, signal) => {
      if (signal != null) process.kill(process.pid, signal);
      else resolveRun(code ?? 1);
    });
  });
}

const sharedCode = await runHarness(process.env);

// The isolated suites (`scripts/harness-isolated.mjs`): a second app instance, after
// the shared run, for a full platform run only. Its Jest summary lands in the same log,
// which is how the gate's ledger line records it beside the shared run's.
const isolatedDir = join(repoRoot, 'example', ISOLATED_DIR);
// Recursive, as `testMatch` is (`__tests__/isolated/**`): a file in a subdirectory
// there runs in the isolated run, so it has to count towards having one.
const isolatedFiles = existsSync(isolatedDir)
  ? readdirSync(isolatedDir, { recursive: true })
      .map(String)
      .filter((name) => /\.harness\.[jt]sx?$/.test(name))
  : [];
let isolatedCode = null;
if (wantsIsolatedRun({ args, env: process.env, isolatedFiles })) {
  process.stderr.write(
    `harness: isolated suites, in an app instance of their own: ${isolatedFiles.join(', ')}\n`
  );
  const env = { ...process.env, [ISOLATED_ENV]: '1' };
  // Its own suite-timing file: the shared run's is the one the gate reads.
  if (env[SUITE_TIMING_ENV] != null) {
    env[SUITE_TIMING_ENV] = `${env[SUITE_TIMING_ENV]}.isolated.json`;
  }
  isolatedCode = await runHarness(env);
  process.stderr.write(
    `harness: isolated run ${isolatedCode === 0 ? 'passed' : `failed (exit ${String(isolatedCode)})`}\n`
  );
}
process.exit(combinedExitCode(sharedCode, isolatedCode));
