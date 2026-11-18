/**
 * Running `xcodebuild` for the iOS real-input gate: the full log kept for evidence, the
 * lines that say what is happening printed, and a run whose tests never start stopped.
 *
 * Apart from `ios.mjs` so a stand-in command can drive it from a unit test.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';

import { realInputLine } from './ios-log.mjs';

/**
 * How long `test-without-building` may run before its first test case starts, in ms.
 * A healthy run starts one within 30 seconds; one that has not started by now is
 * waiting on a simulator whose test service will not answer.
 */
export const STALL_LIMIT_MS = 5 * 60 * 1000;

/** How long a stopped `xcodebuild` gets to wind down before it is killed, in ms. */
const STOP_GRACE_MS = 30_000;

const TEST_CASE_STARTED = /Test Case '-\[[\w.]+ \w+\]' started/;

const SHOWN =
  /^\s*(Test Case|Test Suite|Testing failed|error:|warning: .*RealInput)|\*\* (TEST|BUILD)/;

/**
 * @typedef {object} StallWatch
 * @property {number} [limitMs] defaults to {@link STALL_LIMIT_MS}
 * @property {() => void} onStall stops what `xcodebuild` launched on the device; called
 *   once, before `xcodebuild` itself is stopped
 */

/**
 * Run `xcodebuild` (or a stand-in for it) and resolve with how it ended.
 *
 * The status comes from the process exiting, not from its pipes closing: xcodebuild
 * leaves helpers (`xcresulttool`, the simulator agent) holding the write end of the
 * pipe after it is itself done, so waiting for `close` would hang a finished run.
 *
 * With `stall`, a run that prints no `Test Case ... started` line within the limit is
 * stopped: `onStall`, then SIGINT to the process this call started (xcodebuild's own
 * cancel), then SIGKILL if it is still running after a grace period. Once a case has
 * started the limit no longer applies.
 *
 * @param {ReadonlyArray<string>} args
 * @param {object} options
 * @param {string} options.logFile
 * @param {string} options.what printed before the run
 * @param {NodeJS.ProcessEnv} options.env
 * @param {string} options.cwd
 * @param {string} [options.command] the binary; `xcodebuild` unless a test stands in
 * @param {StallWatch | null} [options.stall]
 * @returns {Promise<{status: number, stalled: boolean}>}
 */
export function runXcodebuild(
  args,
  { logFile, what, env, cwd, command = 'xcodebuild', stall = null }
) {
  console.log(`  ${what} (log: ${logFile})`);
  const out = fs.createWriteStream(logFile, { flags: 'w' });
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let done = false;
    let stalled = false;
    /** @type {NodeJS.Timeout | null} */
    let stallTimer = null;
    /** @type {NodeJS.Timeout | null} */
    let killTimer = null;

    const disarm = () => {
      if (stallTimer != null) clearTimeout(stallTimer);
      stallTimer = null;
    };

    if (stall != null) {
      const limitMs = stall.limitMs ?? STALL_LIMIT_MS;
      stallTimer = setTimeout(() => {
        stallTimer = null;
        if (done) return;
        stalled = true;
        out.write(
          `\nreal-input: no test case started within ${String(limitMs)} ms; ` +
            `stopping xcodebuild (pid ${String(child.pid)}) and its test runner\n`
        );
        try {
          stall.onStall();
        } catch (error) {
          out.write(
            `real-input: stopping the test runner failed: ${String(error)}\n`
          );
        }
        child.kill('SIGINT');
        killTimer = setTimeout(() => {
          if (!done) child.kill('SIGKILL');
        }, STOP_GRACE_MS);
      }, limitMs);
    }

    /** One reader per stream, so a line split across chunks is read whole. */
    const reader = () => {
      let partial = '';
      return {
        read(chunk) {
          if (done) return;
          out.write(chunk);
          const lines = (partial + String(chunk)).split('\n');
          partial = lines.pop() ?? '';
          for (const line of lines) look(line);
        },
        flush() {
          if (partial !== '') look(partial);
          partial = '';
        },
      };
    };
    const look = (line) => {
      if (stallTimer != null && TEST_CASE_STARTED.test(line)) disarm();
      if (SHOWN.test(line) || realInputLine(line) != null) {
        console.log(`    ${line.trim()}`);
      }
    };
    const stdout = reader();
    const stderr = reader();
    child.stdout.on('data', stdout.read);
    child.stderr.on('data', stderr.read);
    child.on('error', (error) => {
      done = true;
      disarm();
      reject(error);
    });
    child.on('exit', (status) => {
      done = true;
      disarm();
      if (killTimer != null) clearTimeout(killTimer);
      stdout.flush();
      stderr.flush();
      out.end(() => resolve({ status: status ?? 1, stalled }));
    });
  });
}
