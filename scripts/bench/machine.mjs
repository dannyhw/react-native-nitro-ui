/**
 * What a bench run records about the machine it ran on. Nothing here may identify
 * the machine by name: results are quoted in public reports.
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
 * The two installed packages a run measured, read from `node_modules`. A package
 * that is not installed is null.
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
 * The app versions a run's numbers belong to: the ones `bun.lock` names, with the
 * installed ones beside them because the install is what was measured.
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
 * The hardware, OS and load a run was measured under. `load` is the sampler that
 * ran with the run (`loadSamples`); `loadavg1`/`loadavg5` are the instant this is
 * called, at the end of the run.
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
    // Device keys name a device class, so the CPU model is what tells two
    // machines with the same key apart.
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
