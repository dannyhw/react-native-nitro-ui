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
  const out = fs.createWriteStream(logFile, { flags: 'w' });
  const child = spawn('bun', ['run', 'start', '--port', String(port)], {
    cwd: exampleDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, RCT_METRO_PORT: String(port) },
  });
  child.stdout.pipe(out);
  child.stderr.pipe(out);
  child.on('exit', (code) => {
    out.write(`\nmetro exited with code ${String(code)}\n`);
    out.end();
  });

  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (await metroIsUp(port)) {
      console.log(`metro: started on ${port} (log: ${logFile})`);
      return () => {
        child.kill('SIGTERM');
      };
    }
    await sleep(500);
  }

  child.kill('SIGTERM');
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

/**
 * One control's run: the assertions it made, and whether any failed.
 *
 * Checks report every assertion rather than throwing on the first one, because
 * the useful output of a failing real-input run is "the drag moved the thumb and
 * JS counted it, but `complete` never fired", not just "red".
 */
export class CheckLog {
  /** @param {string} title */
  constructor(title) {
    this.title = title;
    /** @type {string[]} */
    this.notes = [];
    /** @type {string[]} */
    this.failures = [];
  }

  /**
   * @param {string} message
   */
  note(message) {
    this.notes.push(message);
    console.log(`    · ${message}`);
  }

  /**
   * @param {string} description
   * @param {boolean} condition
   */
  check(description, condition) {
    if (condition) {
      this.notes.push(`ok: ${description}`);
      console.log(`    ✓ ${description}`);
      return true;
    }
    this.failures.push(description);
    console.log(`    ✗ ${description}`);
    return false;
  }

  /**
   * @param {string} description
   * @param {string | number} actual
   * @param {string | number} expected
   */
  checkEquals(description, actual, expected) {
    return this.check(
      `${description} — expected ${String(expected)}, saw ${String(actual)}`,
      String(actual) === String(expected)
    );
  }

  /**
   * Record something that should not have happened at all (a missing element, an
   * unusable device). It is a failure, and it stops the check.
   *
   * @param {string} message
   * @returns {never}
   */
  abort(message) {
    this.failures.push(message);
    console.log(`    ✗ ${message}`);
    throw new AbortedCheck(message);
  }

  get passed() {
    return this.failures.length === 0;
  }
}

/**
 * A check stopped because something it needs is not there at all (an element
 * that never appeared, a gesture that timed out). The reason is already on the
 * report, so the run moves on to the next control instead of losing it too.
 */
export class AbortedCheck extends Error {}

/**
 * The run's report, shared by both platforms so the two print the same shape.
 */
export class Suite {
  /**
   * @param {string} platform
   * @param {ReadonlyArray<(typeof REAL_INPUT_CONTROLS)[number]>} controls
   */
  constructor(platform, controls) {
    this.platform = platform;
    this.controls = controls;
    /** @type {Array<{ control: (typeof REAL_INPUT_CONTROLS)[number], log: CheckLog | null, missing: boolean }>} */
    this.results = [];
  }

  /**
   * A control that is in the shared table but has no check on this platform.
   * That is a failure, never a skip.
   *
   * @param {string} id
   */
  markMissing(id) {
    const control = this.controls.find((entry) => entry.id === id);
    if (control != null) {
      this.results.push({ control, log: null, missing: true });
    }
  }

  /**
   * @param {(typeof REAL_INPUT_CONTROLS)[number]} control
   */
  begin(control) {
    const log = new CheckLog(control.title);
    console.log(`\n  ${control.id}: ${control.title}`);
    this.results.push({ control, log, missing: false });
    return log;
  }

  /**
   * Print the summary and return the process exit code.
   *
   * @returns {number}
   */
  finish() {
    const expected = this.controls.length;
    const done = this.results.filter((entry) => !entry.missing);
    const passed = done.filter((entry) => entry.log?.passed);
    console.log('');
    for (const entry of this.results) {
      if (entry.missing) {
        console.log(
          `${entry.control.id}: NO CHECK on ${this.platform} — the control is listed in scripts/real-input/controls.mjs but this platform does not implement one`
        );
        continue;
      }
      const label = entry.log?.passed ? 'PASS' : 'FAIL';
      console.log(`${entry.control.id}: ${label}`);
      for (const failure of entry.log?.failures ?? []) {
        console.log(`    failed: ${failure}`);
      }
    }
    console.log(
      `\nreal-input (${this.platform}): ${String(passed.length)}/${String(expected)} controls passed`
    );
    return passed.length === expected && this.results.length === expected
      ? 0
      : 1;
  }
}
