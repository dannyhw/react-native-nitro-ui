/**
 * The decisions behind `scripts/doctor.mjs`, with no process or filesystem access.
 *
 * Everything here takes the output of a tool (a version string, `simctl list -j`,
 * `emulator -list-avds`) and answers a question about it, so the rules a new
 * maintainer machine is judged by are unit tests rather than prose
 * (`scripts/__tests__/doctor.test.js`).
 */

import { RESERVED_EMULATOR_PORTS } from './lease-core.mjs';

/** The emulator port every script refuses (the human's own emulator). */
export const RESERVED_EMULATOR_PORT = RESERVED_EMULATOR_PORTS[0];

/** What a gate machine runs, kept in one place so a version bump is one edit. */
export const REQUIREMENTS = {
  xcodeMajor: 27,
  iosRuntimeMajor: 27,
  // The gates and baselines run on 27.0; a later 27.x runtime may not carry the
  // iPhone models the device pairs use (27.1 shipped for one new device only).
  iosRuntime: '27.0',
  jdkMajor: 17,
  androidSystemImage: 'system-images;android-35;google_apis;arm64-v8a',
  androidApiLevel: 35,
  avdProfile: 'pixel_9',
  minFreeDiskGb: 40,
};

/**
 * The two device pairs a fresh machine gets: the same models and ports the
 * gates were written against, under names that cannot collide with a person's
 * own simulators or AVDs.
 */
export const DEFAULT_PAIRS = [
  {
    id: 'pair-a',
    simulatorName: 'nitro-ui A',
    simulatorType: 'iPhone 17',
    avd: 'nitroui_a',
    emulatorPort: 5574,
    adbPort: 5043,
    metroPort: 8295,
  },
  {
    id: 'pair-b',
    simulatorName: 'nitro-ui B',
    simulatorType: 'iPhone Air',
    avd: 'nitroui_b',
    emulatorPort: 5570,
    adbPort: 5041,
    metroPort: 8293,
  },
];

/**
 * AVD settings that matter for comparable numbers, copied from the AVDs the
 * committed Android baselines were measured on. Everything else stays at the
 * `avdmanager` default for the profile.
 */
export const AVD_CONFIG = {
  'hw.cpu.ncore': '4',
  'hw.ramSize': '2G',
  'vm.heapSize': '228M',
  'disk.dataPartition.size': '6G',
  'hw.gpu.enabled': 'no',
  'hw.keyboard': 'no',
  'PlayStore.enabled': 'no',
};

/**
 * @param {string | null | undefined} text
 * @returns {number[] | null} The first dotted version in `text`, as numbers.
 */
export function parseVersion(text) {
  if (text == null) return null;
  const match = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(text);
  if (match == null) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

/**
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} Negative, zero or positive, like a sort comparator.
 */
export function compareVersions(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * CocoaPods as `example/Gemfile` allows it: at least 1.13, never 1.15.0/1.15.1.
 *
 * @param {string | null} text `pod --version` output.
 * @returns {string | null} Why it is unusable, or `null` when it is fine.
 */
export function cocoapodsProblem(text) {
  const version = parseVersion(text);
  if (version == null) return 'not installed';
  if (compareVersions(version, [1, 13, 0]) < 0)
    return `${version.join('.')} is older than 1.13`;
  if (version[0] === 1 && version[1] === 15 && version[2] < 2) {
    return `${version.join('.')} is excluded by example/Gemfile (1.15.0/1.15.1 break the build)`;
  }
  return null;
}

/**
 * @param {string | null} wanted `packageManager`'s version, e.g. `1.4.0`.
 * @param {string | null} actual `bun --version` output.
 * @returns {'ok' | 'warn' | 'fail'} A different patch is fine; a different minor
 *   warns (the lockfile format can change); none at all fails.
 */
export function bunStatus(wanted, actual) {
  const have = parseVersion(actual);
  if (have == null) return 'fail';
  const want = parseVersion(wanted);
  if (want == null) return 'ok';
  return have[0] === want[0] && have[1] === want[1] ? 'ok' : 'warn';
}

/**
 * @param {{ runtimes?: Array<{ identifier: string, version: string, isAvailable?: boolean }> }} listing
 *   `xcrun simctl list runtimes -j`.
 * @param {string} version e.g. `27.0`: the runtime the gates run on, matched on
 *   major and minor, never "the newest" - a newer point runtime can lack the
 *   device types the pairs need.
 * @returns {{ identifier: string, version: string } | null}
 */
export function pickIosRuntime(listing, version) {
  const wanted = parseVersion(version) ?? [];
  return (
    (listing.runtimes ?? [])
      .filter((runtime) => runtime.isAvailable !== false)
      .filter((runtime) => runtime.identifier.includes('iOS'))
      .find((runtime) => {
        const have = parseVersion(runtime.version);
        return have != null && have[0] === wanted[0] && have[1] === wanted[1];
      }) ?? null
  );
}

/**
 * The device type to create a simulator with, taken from the runtime's own
 * `supportedDeviceTypes` when it lists them: `simctl list devicetypes` spans every
 * installed Xcode and runtime, and a type from there that this runtime does not
 * support fails `simctl create` with "Incompatible device" (code 403).
 *
 * @param {{ devicetypes?: Array<{ identifier: string, name: string }> }} listing
 *   `xcrun simctl list devicetypes -j`, the fallback for a runtime without the list.
 * @param {string} name e.g. `iPhone 17`.
 * @param {{ supportedDeviceTypes?: Array<{ identifier: string, name: string }> }} [runtime]
 * @returns {string | null}
 */
export function deviceTypeId(listing, name, runtime) {
  const types = runtime?.supportedDeviceTypes ?? listing.devicetypes ?? [];
  return types.find((type) => type.name === name)?.identifier ?? null;
}

/**
 * @param {{ supportedDeviceTypes?: Array<{ name: string }> }} runtime
 * @returns {string[]} The iPhone models the runtime supports, for an error message.
 */
export function supportedIphones(runtime) {
  return (runtime.supportedDeviceTypes ?? [])
    .map((type) => type.name)
    .filter((name) => name.startsWith('iPhone'));
}

/**
 * @param {{ devices?: Record<string, Array<{ udid: string, name: string, isAvailable?: boolean }>> }} listing
 *   `xcrun simctl list devices -j`.
 * @returns {Map<string, { udid: string, name: string, runtime: string }>} By UDID.
 */
export function simulatorsByUdid(listing) {
  const out = new Map();
  for (const [runtime, devices] of Object.entries(listing.devices ?? {})) {
    for (const device of devices) {
      if (device.isAvailable === false) continue;
      out.set(device.udid, { udid: device.udid, name: device.name, runtime });
    }
  }
  return out;
}

/**
 * @param {string} text `emulator -list-avds` output.
 * @returns {Set<string>}
 */
export function parseAvdList(text) {
  return new Set(
    text
      .split('\n')
      .map((line) => line.trim())
      // The emulator prints INFO/WARNING lines on some versions.
      .filter((line) => line !== '' && !/^(INFO|WARNING|ERROR)\b/.test(line))
  );
}

/**
 * Whether `~/.nitro-ui/devices.json` describes devices that exist on this machine.
 *
 * @param {any} config Parsed `devices.json`.
 * @param {{ simulators: Map<string, { runtime: string }>, avds: Set<string>, iosRuntimeMajor: number }} machine
 * @returns {string[]} Problems; empty when the file is usable.
 */
export function devicesConfigProblems(config, machine) {
  const problems = [];
  if (config == null || typeof config !== 'object')
    return ['not a JSON object'];
  const pairs = Array.isArray(config.pairs) ? config.pairs : [];
  if (pairs.length === 0) problems.push('no `pairs`');
  const ports = new Map();
  const claim = (port, what) => {
    if (port == null) return;
    if (ports.has(port))
      problems.push(`port ${port} used by both ${ports.get(port)} and ${what}`);
    ports.set(port, what);
  };
  for (const pair of pairs) {
    const id = pair.id ?? '(no id)';
    const ios = pair.ios;
    if (ios != null) {
      const sim = machine.simulators.get(ios.udid);
      if (sim == null) {
        problems.push(`${id}: simulator ${ios.udid} does not exist`);
      } else if (
        !new RegExp(`iOS-${machine.iosRuntimeMajor}-`).test(sim.runtime)
      ) {
        problems.push(
          `${id}: simulator ${ios.udid} is not on iOS ${machine.iosRuntimeMajor}`
        );
      }
    }
    const android = pair.android;
    if (android != null) {
      if (!machine.avds.has(android.avd))
        problems.push(`${id}: AVD ${android.avd} does not exist`);
      if (android.emulatorPort === RESERVED_EMULATOR_PORT) {
        problems.push(
          `${id}: emulator port ${RESERVED_EMULATOR_PORT} is reserved`
        );
      }
      if (android.emulatorPort % 2 !== 0) {
        problems.push(
          `${id}: emulator port ${android.emulatorPort} must be even`
        );
      }
      claim(android.emulatorPort, `${id} emulator`);
      claim(android.emulatorPort + 1, `${id} emulator adb`);
      claim(android.adbPort, `${id} adb server`);
    }
    claim(pair.metroPort, `${id} Metro`);
  }
  return problems;
}

/**
 * The `devices.json` a fresh machine gets once its devices exist.
 *
 * @param {Array<{ id: string, udid: string, simulatorType: string, avd: string, emulatorPort: number, adbPort: number, metroPort: number }>} created
 * @param {string} iosSystem e.g. `27.0`.
 */
export function renderDevicesConfig(created, iosSystem) {
  return {
    maxDeviceLeases: 2,
    reservedEmulatorPorts: [RESERVED_EMULATOR_PORT],
    reservedIdentifiers: [],
    pairs: created.map((pair) => ({
      id: pair.id,
      ios: { name: pair.simulatorType, udid: pair.udid, system: iosSystem },
      android: {
        avd: pair.avd,
        emulatorPort: pair.emulatorPort,
        adbPort: pair.adbPort,
        apiLevel: REQUIREMENTS.androidApiLevel,
        profile: REQUIREMENTS.avdProfile,
      },
      metroPort: pair.metroPort,
    })),
  };
}

/**
 * Rewrites the keys of an AVD `config.ini` that [AVD_CONFIG] pins, appending
 * the ones it lacks, and leaves every other line alone.
 *
 * @param {string} ini
 * @returns {string}
 */
export function applyAvdConfig(ini) {
  const pending = new Map(Object.entries(AVD_CONFIG));
  const lines = ini.split('\n').map((line) => {
    const key = line.split('=')[0];
    if (!pending.has(key)) return line;
    const value = pending.get(key);
    pending.delete(key);
    return `${key}=${value}`;
  });
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  for (const [key, value] of pending) lines.push(`${key}=${value}`);
  return `${lines.join('\n')}\n`;
}

/**
 * @param {Array<{ status: 'ok' | 'warn' | 'fail' }>} results
 * @returns {number} The process exit code: 1 when anything required failed.
 */
export function exitCode(results) {
  return results.some((result) => result.status === 'fail') ? 1 : 0;
}
