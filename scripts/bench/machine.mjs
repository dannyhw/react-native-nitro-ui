/**
 * What a run records about the machine it ran on.
 *
 * Lives here rather than in `run.mjs` for the reason the header of this directory
 * documents: the runner is a CLI that resolves repo paths through `import.meta`,
 * which jest's CommonJS transform cannot represent, and this record is what a
 * reader of a results file uses to judge the numbers - so it has to be testable
 * without a device.
 *
 * Every field is a measurement, read at the moment the run ended except `loadSamples`,
 * which is the sampler that ran *with* the run. Nothing here identifies the machine by
 * name (D25: results are quoted in public reports): the CPU model, core count, RAM and
 * OS release are what tell two runs' hardware apart, and `deviceKey` above this block
 * says which device produced them. `quiet` is the load answer (`loadOverCeiling`),
 * printed beside the numbers - a busy machine is a noisier machine, not a disqualification.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { installedVersion, resolvedDependencies } from './deps.mjs';
import { loadOverCeiling } from './lib.mjs';

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
 * disagreeing is worth a line: a stale install would otherwise put an unrecorded
 * app's numbers under this commit's versions.
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
 * The app versions a run's numbers belong to. Read from `bun.lock` because that is
 * the version list committed with the run's own commit; the installed packages are
 * recorded beside it because the measured thing is the install
 * (`installedDependenciesProblem()` compares the two).
 *
 * @param {{ lockPath: string, nodeModulesDir: string, read?: (file: string) => string }} input
 */
export function runDependencies({
  lockPath,
  nodeModulesDir,
  read = (file) => fs.readFileSync(file, 'utf8'),
}) {
  const tryRead = (file) => {
    try {
      return read(file);
    } catch {
      return null;
    }
  };
  const resolved = resolvedDependencies({
    lockText: tryRead(lockPath),
    manifestText: tryRead(
      path.join(path.dirname(lockPath), 'bench', 'package.json')
    ),
    source: 'bun.lock in the working tree',
  });
  const installed = installedPackageVersions({ nodeModulesDir, read });
  return {
    reactNative: resolved.reactNative,
    expoUi: resolved.expoUi,
    installedReactNative: installed.reactNative,
    installedExpoUi: installed.expoUi,
    source: resolved.source,
  };
}

/**
 * Who ran this, on what, and how busy they were (T02 review S10, D9, R4).
 *
 * A number is only meaningful if it says so: the load average says how much of the
 * machine was doing something else, and the OS runtime is part of the device key
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
  machine.quiet = loadOverCeiling(machine) === null;
  if (platform === 'ios') {
    machine.simRuntime = device.runtime ?? null;
  } else {
    machine.avd = device.avd ?? null;
    machine.androidApi = device.sdk ?? null;
    machine.androidImage = device.image ?? null;
  }
  return machine;
}
