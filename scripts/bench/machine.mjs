/**
 * What a run records about the machine it ran on.
 *
 * Lives here rather than in `run.mjs` for the reason `format.mjs` documents: the
 * runner is a CLI that resolves repo paths through `import.meta`, which jest's
 * CommonJS transform cannot represent, and this record decides whether a run may
 * mint a baseline at all - so it has to be testable without a device.
 *
 * The label is the single thing here that is *not* a measurement
 * (`machineLabelFromEnv`), and it is the one that picks the directory the run's
 * baseline is written to. `run.mjs` therefore refuses an unusable label before the
 * run starts, in the same pre-flight as the load check: both are facts about the
 * machine, known at second one, that decide whether the next three hours are worth
 * spending. Recording the label differently from the way that pre-flight judged it
 * - a raw `process.env` read that skips the trim, say - would discover the
 * mismatch at the end of the plan rather than the start, which is what the test for
 * this module guards.
 */

import { execFileSync } from 'node:child_process';
import os from 'node:os';

import { machineLabelFromEnv } from './baseline.mjs';
import { isNumber, loadBlocker } from './lib.mjs';

/** Bounded best-effort command execution: null rather than a throw or a hang. */
export function tryExec(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      timeout: 30_000,
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Who ran this, on what, and how busy they were (T02 review S10, D9, R4).
 *
 * A baseline is only meaningful if it says so: the load average decides whether
 * the run may mint one at all, and the OS runtime is part of the device key
 * because a runtime change breaks comparability sooner than a device change.
 *
 * `load` is the sampler that ran with the run, so the file carries the load of
 * the whole run (`loadSamples`) and not just the instant this function happens to
 * be called in. `loadavg1`/`loadavg5` stay what they always were - the end-of-run
 * instant, which is all a results file from before R4 had, and what
 * `bench/tools/arm-ratios.mjs` and the markdown report already read.
 */
export function collectMachine(platform, device, load) {
  const loadavg = os.loadavg();
  const cpuCount = os.cpus().length;
  const machine = {
    // A label, not os.hostname(): results and baselines are committed to a public repo
    // (D25). It also picks the directory this machine's baselines live in, and it has to
    // be the same value the pre-flight judged - hence the shared helper, not an env read.
    hostname: machineLabelFromEnv(),
    osPlatform: os.platform(),
    osRelease: os.release(),
    osVersion: os.version(),
    arch: os.arch(),
    cpuCount,
    // D15: device keys stay class-level, so the CPU model is what tells two
    // machines claiming the same `android35-emu-pixel9` / `ios27-sim-iphone17`
    // key apart when a baseline is being compared across desks or with CI.
    cpuModel: os.cpus()[0]?.model ?? null,
    loadavg1: loadavg[0] ?? null,
    loadavg5: loadavg[1] ?? null,
    loadSamples: load?.summary({ cpuCount }) ?? null,
    totalMemoryGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    xcode: tryExec('xcodebuild', ['-version'])?.split('\n')[0] ?? null,
  };
  machine.quiet = isNumber(machine.loadavg1) && loadBlocker(machine) === null;
  if (platform === 'ios') {
    machine.simRuntime = device.runtime ?? null;
  } else {
    machine.avd = device.avd ?? null;
    machine.androidApi = device.sdk ?? null;
    machine.androidImage = device.image ?? null;
  }
  return machine;
}
