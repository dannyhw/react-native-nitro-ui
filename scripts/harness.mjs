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
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

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

assertSupportedNodeOrReexec({
  command: 'bun run harness:android',
  entryUrl: import.meta.url,
});

const args = process.argv.slice(2);
const command = [process.execPath, cli, ...args];
process.stderr.write(`harness: ${command.join(' ')}\n`);

const child = spawn(command[0], command.slice(1), {
  stdio: 'inherit',
  env: process.env,
});

child.on('error', (error) => {
  process.stderr.write(`harness: could not start ${cli}: ${error.message}\n`);
  process.exit(1);
});

child.on('close', (code, signal) => {
  // Pass a signal on rather than masking it with exit 1: Ctrl-C has to look
  // like Ctrl-C to whatever is driving a suite.
  if (signal != null) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
