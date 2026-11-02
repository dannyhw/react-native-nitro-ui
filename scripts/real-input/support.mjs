/**
 * Shared plumbing for the real-input suite: run selection, evidence files,
 * Metro, and the pass/fail report both platforms print.
 *
 * The suite is deliberately separate from `react-native-harness` and from
 * `bun run check`: it drives the app from *outside* with OS-synthesised input,
 * which no in-app test can prove. See `controls.mjs` for what it covers and
 * CONTRIBUTING.md ("Real-input tests") for how to run it.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { REAL_INPUT_CONTROLS, selectControls } from './controls.mjs';

/**
 * Parse `--control <id>` (repeatable) out of a command line.
 *
 * @param {ReadonlyArray<string>} argv Arguments after the script name.
 * @returns {ReadonlyArray<(typeof REAL_INPUT_CONTROLS)[number]>}
 */
export function chosenControls(argv) {
  /** @type {string[]} */
  const ids = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--control') {
      const value = argv[index + 1];
      if (value == null || value.startsWith('--')) {
        throw new Error('real-input: --control needs a control id.');
      }
      ids.push(value);
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`real-input: unknown argument "${arg}".`);
    }
  }
  return selectControls(ids);
}

function usage() {
  const ids = REAL_INPUT_CONTROLS.map((control) => control.id).join(', ');
  console.log(`Usage: bun run test:real-input:<platform> [--control <id>]

Controls: ${ids}
Omit --control to run every control.`);
}

/**
 * Where evidence for a run goes (gitignored).
 *
 * @param {string} platform
 * @returns {string}
 */
export function artifactsDir(platform) {
  const root = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '../..',
    '.real-input',
    platform
  );
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/**
 * Start Metro unless something is already serving on `port`.
 *
 * The suite runs a Debug build, whose JS comes from Metro, so it needs the same
 * port discipline as the harness (`METRO_PORT`, never the 8081 default). An
 * already-running Metro is reused rather than restarted: on this machine another
 * task may own it, and killing it would be worse than sharing it.
 *
 * Metro's output goes to `logFile` through a descriptor the child writes to
 * directly. Piping stdout and stderr into one write stream was the T15b crash:
 * both pipes end the shared stream as soon as either one closes, and the exit
 * handler then wrote to a finished stream, which killed the runner *after* the
 * suite had passed. A descriptor has no such lifecycle to lose.
 *
 * @param {object} options
 * @param {number} options.port
 * @param {string} options.logFile
 * @returns {Promise<() => void>} stops Metro if this call started it.
 */
export async function ensureMetro({ port, logFile }) {
  if (await metroIsUp(port)) {
    console.log(`metro: reusing the server already listening on ${port}`);
    return () => {};
  }

  const exampleDir = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '../../example'
  );
  const fd = fs.openSync(logFile, 'w');
  let child;
  try {
    child = spawn('bun', ['run', 'start', '--port', String(port)], {
      cwd: exampleDir,
      stdio: ['ignore', fd, fd],
      env: { ...process.env, RCT_METRO_PORT: String(port) },
    });
  } finally {
    // The child took its own reference at spawn, so this side can let go.
    fs.closeSync(fd);
  }
  child.on('exit', (code) => {
    // Append, never a held-open stream: this fires after the suite may be over.
    fs.appendFileSync(logFile, `\nmetro exited with code ${String(code)}\n`);
  });

  let stopped = false;
  const stopMetro = () => {
    if (stopped) return;
    stopped = true;
    child.kill('SIGTERM');
  };

  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (await metroIsUp(port)) {
      console.log(`metro: started on ${port} (log: ${logFile})`);
      return stopMetro;
    }
    await sleep(500);
  }

  stopMetro();
  throw new Error(
    `real-input: Metro did not come up on port ${port}. See ${logFile}.`
  );
}

/**
 * @param {number} port
 * @returns {Promise<boolean>}
 */
async function metroIsUp(port) {
  try {
    const response = await fetch(`http://localhost:${String(port)}/status`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * `sleep` for code that cannot await, used by the polling loops that read the
 * device synchronously. It blocks a short-lived CLI process for a fraction of a
 * second, which is what those loops want; nothing in a library does.
 *
 * @param {number} ms
 */
export function blockMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run a command without throwing, for the shell-outs the suite makes.
 *
 * @param {string} command
 * @param {ReadonlyArray<string>} args
 * @param {object} [options]
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
export function run(command, args, options = {}) {
  const result = spawnSync(command, [...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    cwd: options.cwd,
    env: options.env ?? process.env,
  });
  if (result.error != null) {
    return {
      status: 1,
      stdout: result.stdout ?? '',
      stderr: String(result.error),
    };
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/* The report lives in `report.mjs` so a unit test can import it; re-exported here
 * because every caller has always spelled this module's name. */
export { AbortedCheck, CheckLog, Suite } from './report.mjs';
