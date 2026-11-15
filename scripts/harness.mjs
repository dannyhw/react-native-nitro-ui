#!/usr/bin/env node
/**
 * Entry point behind the `harness:*` scripts: checks the Node version, then spawns the
 * `react-native-harness` CLI, which parses `process.argv` and installs its own signal handlers.
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
 * The `bun run` script name these arguments came from, so a refusal names its own gate.
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
 * One `react-native-harness` run. Resolves with its exit code; a signal is passed on rather
 * than turned into exit 1, so Ctrl-C still looks like Ctrl-C to the caller.
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

// The isolated suites run in a second app instance after the shared run, on a full run only.
const isolatedDir = join(repoRoot, 'example', ISOLATED_DIR);
// Recursive, to match the isolated run's `testMatch`.
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
