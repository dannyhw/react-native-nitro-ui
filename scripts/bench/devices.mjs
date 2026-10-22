/**
 * Device plumbing for the bench runner.
 *
 * Every device identity comes from the environment, because several tasks run
 * this repo at once and AGENTS.md forbids touching a device you did not start:
 *
 *   IOS_SIM_UDID      simulator UDID (from the task brief)
 *   ANDROID_SERIAL    adb serial, e.g. emulator-5572
 *   ANDROID_AVD       AVD name (legacy alias: AVD), used for the device key
 *   METRO_PORT        unused here on purpose - release builds embed the bundle
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * A dead device or emulator makes some adb calls block forever, so every call
 * is bounded and fails loudly instead of stalling a run.
 */
const DEFAULT_TIMEOUT_MS = 120_000;

/** Portable blocking sleep (these scripts run under both bun and node). */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const ADB = () => {
  const home =
    process.env.ANDROID_HOME ??
    path.join(process.env.HOME ?? '', 'Library', 'Android', 'sdk');
  return path.join(home, 'platform-tools', 'adb');
};

export function adb(serial, args, options = {}) {
  const prefix = serial == null ? [] : ['-s', serial];
  return execFileSync(ADB(), [...prefix, ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: DEFAULT_TIMEOUT_MS,
    ...options,
  });
}

export function simctl(args, options = {}) {
  return execFileSync('xcrun', ['simctl', ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: DEFAULT_TIMEOUT_MS,
    ...options,
  });
}

export function resolveIosDevice() {
  const udid = process.env.IOS_SIM_UDID;
  if (udid == null || udid.length === 0) {
    throw new Error(
      'No iOS simulator. Set IOS_SIM_UDID to the UDID from your task brief ' +
        '(the runner will boot it if needed).'
    );
  }
  const listing = JSON.parse(simctl(['list', 'devices', '-j']));
  const runtimeId =
    Object.entries(listing.devices).find(([, devices]) =>
      devices.some((entry) => entry.udid === udid)
    )?.[0] ?? '';
  const device = Object.values(listing.devices)
    .flat()
    .find((entry) => entry.udid === udid);
  if (device == null) {
    throw new Error(
      `iOS simulator ${udid} does not exist on this machine (create it first)`
    );
  }
  // `com.apple.CoreSimulator.SimRuntime.iOS-27-0` -> `27.0`
  const runtimeMatch = /iOS-(\d+(?:-\d+)?)/.exec(runtimeId);
  const runtime = runtimeMatch?.[1]?.replace('-', '.') ?? null;
  const booted = device.state === 'Booted';
  if (!booted) {
    process.stderr.write(`Booting ${device.name} (${udid})...\n`);
    simctl(['boot', udid]);
    simctl(['bootstatus', udid, '-d']);
  }
  const major = runtime == null ? 'unknown' : runtime.split('.')[0];
  return {
    platform: 'ios',
    udid,
    name: device.name,
    runtime,
    /** True when this invocation booted it, so `--shutdown` may power it off. */
    bootedByUs: !booted,
    deviceKey: `ios${major}-sim-${deviceClassName(device.name)}`,
  };
}

/**
 * Device class for a key: lowercase alphanumerics only (`iPhone Air` ->
 * `iphoneair`, `Pixel 9` -> `pixel9`), matching D9's examples.
 */
export function deviceClassName(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Serials adb currently sees, in `adb devices` order. */
function attachedSerials() {
  return adb(null, ['devices'])
    .split('\n')
    .filter((line) => line.endsWith('\tdevice'))
    .map((line) => line.split('\t')[0]);
}

/** The AVD name an emulator serial is running, or null for a physical device. */
function avdNameFor(serial) {
  try {
    return adb(serial, ['emu', 'avd', 'name'], { timeout: 15_000 })
      .split('\n')[0]
      .trim();
  } catch {
    return null;
  }
}

/**
 * Resolve the device to measure on.
 *
 * `ANDROID_AVD` wins when it is set, because console ports are handed out in
 * order of availability: a task that was told to use `emulator-5572` gets a
 * different serial as soon as something else boots or dies. Matching on the AVD
 * name is what keeps a run on the device its brief assigned and off every other
 * task's (AGENTS.md: never touch a device you did not start).
 */
export function resolveAndroidDevice() {
  const serial = process.env.ANDROID_SERIAL;
  const avd = process.env.ANDROID_AVD ?? process.env.AVD ?? null;
  if (serial == null && avd == null) {
    throw new Error(
      'No Android device. Set ANDROID_AVD (the AVD name from your brief) or ' +
        'ANDROID_SERIAL (e.g. emulator-5572).'
    );
  }

  const attached = attachedSerials();
  if (avd != null) {
    const match = attached.find((entry) => avdNameFor(entry) === avd);
    if (match == null) {
      throw new Error(
        `No attached emulator is running AVD "${avd}" (attached: ${attached.join(', ') || 'none'})`
      );
    }
    if (serial != null && serial !== match) {
      process.stderr.write(
        `ANDROID_SERIAL=${serial} is not the emulator running AVD "${avd}"; using ${match}.\n`
      );
    }
    return describeAndroidDevice(match, avd);
  }

  if (!attached.includes(serial)) {
    throw new Error(
      `${serial} is not attached (adb devices output: ${attached.join(', ') || 'none'})`
    );
  }
  return describeAndroidDevice(serial, serial);
}

function describeAndroidDevice(serial, avd) {
  const sdk = adb(serial, ['shell', 'getprop', 'ro.build.version.sdk']).trim();
  const release = adb(serial, [
    'shell',
    'getprop',
    'ro.build.version.release_or_codename',
  ]).trim();
  const model = adb(serial, ['shell', 'getprop', 'ro.product.model']).trim();
  const fingerprint = adb(serial, [
    'shell',
    'getprop',
    'ro.build.fingerprint',
  ]).trim();
  // `pixel_9` from the AVD's own config beats `sdk_gphone64_arm64` from the
  // system image: the hardware profile is the device class D9 means.
  const profile = avdHardwareProfile(avd);
  const className = deviceClassName(profile ?? model);
  return {
    platform: 'android',
    serial,
    name: avd,
    avd,
    sdk,
    release,
    model,
    image: fingerprint,
    bootedByUs: false,
    deviceKey: `android${sdk}-emu-${className}`,
  };
}

/** `hw.device.name` of an AVD, or null when the AVD dir is not on this machine. */
function avdHardwareProfile(avd) {
  if (avd == null) {
    return null;
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  for (const dir of [
    path.join(home, '.android', 'avd', `${avd}.avd`, 'config.ini'),
    path.join(home, '.android', 'avd', `${avd}.ini`),
  ]) {
    if (!fs.existsSync(dir)) {
      continue;
    }
    for (const line of fs.readFileSync(dir, 'utf8').split('\n')) {
      const [key, value] = line.split('=');
      if (key?.trim() === 'hw.device.name' && value != null) {
        return value.trim();
      }
    }
  }
  return null;
}

/**
 * Power off a device this process booted, and nothing else (AGENTS.md).
 */
export function shutdownDevice(device) {
  if (device.bootedByUs !== true) {
    process.stderr.write(
      `Not shutting down ${device.name}: this run did not boot it.\n`
    );
    return;
  }
  if (device.platform === 'ios') {
    simctl(['shutdown', device.udid]);
  } else if (device.serial != null) {
    try {
      adb(device.serial, ['emu', 'kill'], { timeout: 20_000 });
    } catch {
      // already gone
    }
  }
  process.stderr.write(`Shut down ${device.name}.\n`);
}

/**
 * Restore the animation scales `prepareAndroid` zeroed. They are global device
 * state, so leaving them at 0 is a side effect on whoever uses the AVD next.
 */
export function restoreAndroidAnimations(device, previous) {
  for (const [setting, value] of Object.entries(previous ?? {})) {
    if (value == null) {
      continue;
    }
    try {
      adb(device.serial, [
        'shell',
        'settings',
        'put',
        'global',
        setting,
        value,
      ]);
    } catch {
      // best effort - never fail a run over restoring someone else's setting
    }
  }
}

/**
 * Android animations must be off, or every latency number includes a fade.
 *
 * Just after a cold boot `settings` is not registered yet and the command
 * fails with "Can't find service: settings", so this retries for a while
 * instead of aborting a run that otherwise measures fine.
 */
export function prepareAndroid(device, { attempts = 10, delayMs = 3000 } = {}) {
  const previous = {};
  for (const setting of [
    'window_animation_scale',
    'transition_animation_scale',
    'animator_duration_scale',
  ]) {
    try {
      previous[setting] = adb(device.serial, [
        'shell',
        'settings',
        'get',
        'global',
        setting,
      ]).trim();
    } catch {
      previous[setting] = null;
    }
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        adb(device.serial, [
          'shell',
          'settings',
          'put',
          'global',
          setting,
          '0',
        ]);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        sleepSync(delayMs);
      }
    }
    if (lastError != null) {
      throw new Error(
        `Cannot disable ${setting} on ${device.serial} after ${String(attempts)} attempts: ${String(lastError.message)}`
      );
    }
  }
  return previous;
}

export function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
