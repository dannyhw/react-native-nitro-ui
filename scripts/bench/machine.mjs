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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { machineLabelFromEnv } from './baseline.mjs';
import { installedVersion } from './deps.mjs';
import {
  BASELINE_TIMEOUTS_MS,
  baselineTimeoutRecord,
  isNumber,
  loadBlocker,
} from './lib.mjs';

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
 * The two installed packages a run measured, read from `node_modules`.
 *
 * Beside the lock because the measured thing is the install, and the two
 * disagreeing is worth a line — a merged cell has to be comparable with the file
 * it joins, and a stale install would otherwise smuggle an unrecorded app into
 * the comparison. X14's first version of this lived in `machine.mjs` as
 * `collectDependencies()` and also parsed `bun.lock` with strict `JSON.parse`;
 * that half was never read by its one caller (which resolves the lock through
 * `deps.mjs`'s tolerant reader) and carried the exact bug that reader exists to
 * fix, so it is gone and only the install read remains.
 *
 * A package that is not installed is null rather than a guess.
 *
 * @param {{ nodeModulesDir: string, read?: (file: string) => string }} input
 * @returns {{ reactNative: string | null, expoUi: string | null }}
 */
export function installedPackageVersions({
  nodeModulesDir,
  read = (file) => fs.readFileSync(file, 'utf8'),
}) {
  const installed = (name) => {
    try {
      return installedVersion(
        JSON.parse(read(path.join(nodeModulesDir, name, 'package.json')))
      );
    } catch {
      return null;
    }
  };
  return {
    reactNative: installed('react-native'),
    expoUi: installed('@expo/ui'),
  };
}

/**
 * A run-shaped record of everything a *pre-flight* already knows, for the question
 * it can only ask of a run: "may this file take this component's cells?" (X14).
 *
 * The merge guards compare a run's regime with a file's, so answering them before a
 * device is booted needs a stand-in for the run. It carries only what is knowable
 * now - the host (`collectMachine` with no load sampler, so no `loadSamples`), the
 * device from a read-only listing or an AVD's config files, the flags, and the
 * versions in `bun.lock` - and leaves the rest null on purpose: a system-image
 * fingerprint or an ART compile state is a question for the booted device, and
 * `mergeBaselineProblems({ allowDeferred: true })` reports those as deferred rather
 * than refusing on a blank. The authoritative check happens with the measured run,
 * before a byte is written.
 *
 * @param {{
 *   platform: 'ios'|'android',
 *   plan: string,
 *   launches: number,
 *   perfMarks?: boolean,
 *   dirty?: boolean,
 *   sha?: string | null,
 *   deviceKey: string | null,
 *   device?: any,
 *   dependencies?: any,
 *   timeouts?: { mountTimeoutMs?: number|null, presentedTimeoutMs?: number|null } | null,
 *   machine?: any,
 *     the host summary to stand in for `collectMachine()`. Only `--dry-run` passes
 *     one, and for the same reason it injects a device key and a load average: its
 *     rules are unit tests rather than a machine (`bench-dry-run.test.js`). A live
 *     pre-flight passes nothing and gets the real host.
 *   now?: () => string,
 * }} input
 */
export function mergeCandidateRun({
  platform,
  plan,
  launches,
  perfMarks = false,
  dirty = false,
  sha = null,
  deviceKey,
  device = {},
  dependencies = null,
  timeouts = null,
  machine = null,
  now = () => new Date().toISOString(),
}) {
  // No `--timeout-*` flag says the app waits under its platform's default rule,
  // which the command line does know; a *measured* run's record is read back from
  // its launches instead. `timeouts` arrives as `{ mountTimeoutMs: null, ... }` when
  // no flag was passed, so the default has to be reached for field by field - a `??`
  // over the whole object never fires, and a file that predates the field would then
  // look unanswerable at pre-flight time and be refused for the wrong reason.
  const ruleFor = (name) =>
    timeouts?.[name] ?? (BASELINE_TIMEOUTS_MS[platform] ?? {})[name] ?? null;
  return {
    platform,
    plan,
    launches,
    perfMarks,
    dirty,
    sha,
    deviceKey,
    deviceName: device.name ?? device.avd ?? null,
    machine: machine ?? collectMachine(platform, device, null),
    // Null, not 'verify': the state the app is in is decided by the install, which
    // has not happened yet, and inventing one would make the guard pass on it.
    art: null,
    dependencies,
    timeouts: baselineTimeoutRecord({
      timeouts: {
        mountTimeoutMs: ruleFor('mountTimeoutMs'),
        presentedTimeoutMs: ruleFor('presentedTimeoutMs'),
      },
    }),
    createdAt: now(),
  };
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
