/**
 * The quiet-machine tag for the harness's wall-clock gates (D21).
 *
 * Structural counters (corrections, immediate pushes, flushes, stale frames,
 * event counts) are asserted on every harness run. A threshold on a *duration*
 * is not: several tasks share this machine, and a busy host turns a correct
 * implementation red. So a duration gate runs only when the harness was started
 * with `HARNESS_TIMING=1`, and it refuses to judge anything while the 1-minute
 * load average is at or above {@link BUSY_LOAD1}.
 *
 * The assertions run inside the app, which cannot see this machine's load
 * average, so the harness runner publishes it where the app can read it: a
 * small JSON file under `example/`, which Metro serves live over its dev server
 * (`GET /harness-timing/state.json`). Metro reads that file from disk per
 * request, so an assertion reads a current value, not the value from bundle
 * time - a bundling-time constant would be wrong for any run that outlived the
 * machine's quiet moment.
 *
 * The path is deliberately not a dotfile or a dot-directory: the first run of
 * this gate had `GET /.harness/timing-gate.json` answered 404 by the dev server
 * (and `<project>/.harness/` is `react-native-harness`'s own cache directory
 * besides). Android reaches the host only through the Metro port, so this has to
 * be a route Metro serves - there is no second port the app can fall back to.
 *
 * The file is gitignored and owned by the running harness. The refresh timer is
 * `unref()`'d so it can never keep the CLI alive, and an old file says nothing
 * about a run: every reader checks `metroPort` and the age of `updatedAt`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

/** Path of the gate file, relative to `example/` (Metro's dev-server root). */
export const TIMING_GATE_FILE = path.join('harness-timing', 'state.json');

/** Same path as the URL Metro serves it under. */
export const TIMING_GATE_URL = '/harness-timing/state.json';

/** At or above this 1-minute load average, a duration gate refuses to judge. */
export const BUSY_LOAD1 = 10;

/** How often the published load average is refreshed while the harness runs. */
const REFRESH_MS = 2000;

/**
 * @returns {boolean} whether this run was asked to gate on wall-clock.
 */
export function timingGatesRequested() {
  return process.env.HARNESS_TIMING === '1';
}

/**
 * The published state of the machine, as an assertion reads it.
 *
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {{ harnessTiming: boolean, load1: number, load5: number, cores: number }}
 */
export function timingGateState({ env = process.env } = {}) {
  const [load1 = 0, load5 = 0] = os.loadavg();
  return {
    harnessTiming: env.HARNESS_TIMING === '1',
    load1,
    load5,
    cores: os.cpus().length,
  };
}

/**
 * Publish the machine state for the duration of the run.
 *
 * @param {object} options
 * @param {string} options.exampleDir `example/` - the Metro project root.
 * @param {number} options.port The Metro port this run serves, so a reader can
 *   tell its own run's file from one an earlier run left behind.
 * @param {(message: string) => void} [options.log]
 * @returns {() => void} stops publishing and removes the file.
 */
export function publishTimingGate({ exampleDir, port, log = () => {} }) {
  const file = path.join(exampleDir, TIMING_GATE_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const write = () => {
    const state = timingGateState();
    // `busyLoad1` travels with it so the app asserts the threshold this run
    // decided on; a reader that has to restate it can drift from it silently.
    const body = {
      ...state,
      busyLoad1: BUSY_LOAD1,
      metroPort: port,
      updatedAt: Date.now(),
    };
    // Write-then-rename: a reader must never see a half-written file.
    const tmp = `${file}.${String(process.pid)}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`);
    fs.renameSync(tmp, file);
  };

  write();
  const timer = setInterval(() => {
    try {
      write();
    } catch (error) {
      log(`harness: could not refresh the timing gate: ${String(error)}`);
    }
  }, REFRESH_MS);
  timer.unref?.();

  const first = timingGateState();
  log(
    `harness: wall-clock gates ${first.harnessTiming ? 'ON' : 'off'} ` +
      `(HARNESS_TIMING=${first.harnessTiming ? '1' : 'unset'}) · load average ` +
      `${first.load1.toFixed(2)}/${first.load5.toFixed(2)} over ${String(first.cores)} cores · ` +
      `a gate refuses at load1 >= ${String(BUSY_LOAD1)} · ` +
      `published to ${path.relative(process.cwd(), file)}`
  );
  if (first.harnessTiming && first.load1 >= BUSY_LOAD1) {
    log(
      `harness: HARNESS_TIMING=1 but this machine is busy (load1 ` +
        `${first.load1.toFixed(2)} >= ${String(BUSY_LOAD1)}) - every duration ` +
        'gate will refuse to judge. Re-run on a quiet machine for a verdict.'
    );
  }

  let cleared = false;
  return () => {
    if (cleared) return;
    cleared = true;
    clearInterval(timer);
    try {
      fs.rmSync(file, { force: true });
    } catch {
      // Evidence, not a failure: the run is over either way.
    }
  };
}
