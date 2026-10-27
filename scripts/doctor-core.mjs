/**
 * The decisions behind `scripts/doctor.mjs`, with no process or filesystem access.
 *
 * Everything here takes the output of a tool (a version string, `simctl list -j`,
 * `emulator -list-avds`) and answers a question about it, so the rules a new
 * maintainer machine is judged by are unit tests rather than prose
 * (`scripts/__tests__/doctor.test.js`).
 */

import path from 'node:path';

import { RESERVED_EMULATOR_PORTS } from './lease-core.mjs';

/** Local alias so `mainCheckoutPath` stays a pure string function. */
const nodePath = path;

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

/* ----------------------------- unowned devices ---------------------------- */

/**
 * The simulators in a `simctl list devices -j`, keyed by UDID, with their state.
 *
 * `simulatorsByUdid` above drops the state, and the whole point of the unowned
 * check is to know which pool devices are *Booted*, so this keeps it.
 *
 * @param {{ devices?: Record<string, Array<{ udid: string, name: string, state?: string, isAvailable?: boolean }>> }} listing
 * @returns {Map<string, { udid: string, name: string, state: string, runtime: string }>}
 */
export function simulatorsByUdidWithState(listing) {
  const out = new Map();
  for (const [runtime, devices] of Object.entries(listing.devices ?? {})) {
    for (const device of devices) {
      if (device.isAvailable === false) continue;
      out.set(device.udid, {
        udid: device.udid,
        name: device.name,
        state: device.state ?? 'Unknown',
        runtime,
      });
    }
  }
  return out;
}

/**
 * The serials `adb devices` reports as attached, with their state.
 *
 * @param {string} text `adb devices` output
 * @returns {Array<{ serial: string, state: string }>}
 */
export function parseAdbDevices(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    const match = /^(\S+)\t(device|offline|unauthorized)\b/.exec(line);
    if (match == null) continue;
    out.push({ serial: match[1], state: match[2] });
  }
  return out;
}

/**
 * The pair ids every *live* lease holds.
 *
 * A lease records `holds: [pairId]` (`lease.mjs`), and an `--exclusive` lease
 * holds every pair. `lease.mjs list` is the human answer to "who has what", and
 * this is the same question for the script. Expired leases are already gone from
 * the file by the time `pruneExpired` has run, so callers pass what that left.
 *
 * @param {object[]} leases
 * @returns {Set<string>}
 */
export function leasedPairIds(leases) {
  const ids = new Set();
  for (const lease of leases ?? []) {
    for (const hold of lease?.holds ?? []) {
      if (typeof hold === 'string') ids.add(hold);
    }
  }
  return ids;
}

/**
 * Pool devices that are booted while no lease holds them.
 *
 * The failure this reports (X9): a task boots a pool simulator or emulator and
 * dies before releasing its lease, or boots a device by hand instead of leasing
 * it. Either way the next task's `lease.mjs acquire` happily hands out that pair,
 * and two tasks now share one device - which is what the lease system exists to
 * prevent. The lease file says who *owns* a pair; only `simctl` and `adb` say what
 * is *awake*; nobody compared them, so nobody knew.
 *
 * A report, never an action: shutting down a device this script did not start is
 * against the rules this repo runs by (AGENTS.md), and a device that is awake for
 * a good reason - a person's own debugging, a bench that booted it deliberately -
 * is nobody's business to power off.
 *
 * Only devices in the *pool* are considered, and only when something booted them:
 * a machine with an idle pool and an unrelated booted simulator says nothing, and
 * an unleased simulator that is off is the normal state of a fresh machine.
 *
 * @param {object} options
 * @param {{pairs: Array<{id: string, ios?: {udid?: string} | null, android?: {avd?: string, emulatorPort?: number} | null}>}} pool the normalised devices.json
 * @param {Map<string, {name: string, state: string}>} simulators by UDID, from `simulatorsByUdidWithState`
 * @param {Array<{serial: string, avd: string | null}>} emulators attached serials with their AVD name, from `adb emu avd name`
 * @param {object[]} leases the live leases
 * @param {number[]} [reservedPorts] serials nobody may lease
 * @returns {string[]} one warning per unowned booted device
 */
export function unownedBootedDevices({
  pool,
  simulators,
  emulators,
  leases,
  reservedPorts = RESERVED_EMULATOR_PORTS,
}) {
  const held = leasedPairIds(leases);
  const warnings = [];
  for (const pair of pool?.pairs ?? []) {
    if (held.has(pair.id)) continue;
    const udid = pair.ios?.udid;
    if (udid != null) {
      const sim = simulators?.get?.(udid);
      if (sim?.state === 'Booted') {
        warnings.push(
          `${pair.id}: simulator "${sim.name}" (${udid}) is Booted and no lease holds it`
        );
      }
    }
    const avd = pair.android?.avd;
    if (avd != null) {
      for (const entry of emulators ?? []) {
        if (entry.avd !== avd) continue;
        const port = Number(/^emulator-(\d+)$/.exec(entry.serial)?.[1] ?? NaN);
        // The human's own emulator is never this script's to comment on, let
        // alone touch (AGENTS.md): it is not unowned, it is someone's.
        if (reservedPorts.includes(port)) continue;
        warnings.push(
          `${pair.id}: emulator ${entry.serial} (AVD ${avd}) is running and no lease holds it`
        );
      }
    }
  }
  return warnings;
}

/**
 * The attached emulators, with the AVD each serial belongs to.
 *
 * `adb devices` reports serials and states but never the AVD name, and asking the
 * device (`adb -s <serial> emu avd name`) costs a server round-trip per device and
 * fails on an offline one. The pool already assigns one port per AVD, so that
 * mapping is the answer, and it works for an offline device too — which is exactly
 * the state a leaked emulator is usually in. A serial outside the pool's ports is
 * somebody else's emulator and gets `null`, so no warning can blame it on a pair.
 *
 * @param {string} text `adb devices` output
 * @param {Array<{android?: {avd?: string, emulatorPort?: number} | null}>} pairs the normalised pool
 * @returns {Array<{serial: string, state: string, avd: string | null}>}
 */
export function emulatorsFromAdbDevices(text, pairs) {
  const avdBySerial = new Map(
    (pairs ?? [])
      .filter(
        (pair) =>
          pair?.android?.avd != null && pair.android.emulatorPort != null
      )
      .map((pair) => [
        `emulator-${pair.android.emulatorPort}`,
        /** @type {string} */ (pair.android.avd),
      ])
  );
  return parseAdbDevices(text).map((entry) => ({
    ...entry,
    avd: avdBySerial.get(entry.serial) ?? null,
  }));
}

/**
 * Whether an unowned-device check can say anything at all.
 *
 * A silently-skipped check is the worst version of this feature: it reads as "all
 * clear" when the truth is "no adb on this machine". So the caller states which
 * tool is missing instead of printing a clean bill of health.
 *
 * @param {{ xcrunOk: boolean, adbOk: boolean }} tools
 * @returns {string | null}
 */
export function unownedCheckProblem(tools) {
  const missing = [
    tools.xcrunOk ? null : 'xcrun simctl',
    tools.adbOk ? null : 'adb',
  ].filter(Boolean);
  if (missing.length === 0) return null;
  return `cannot check for unowned devices without ${missing.join(' and ')}`;
}

/* ------------------------------- cold caches ------------------------------ */

/**
 * Whether a machine's build caches look cold, from `ccache -s` (X9).
 *
 * The signal, and why this one: the first native build on a fresh machine took
 * 9.5 min on iOS and 4 m 43 s on Android against 138 s and 17 s warm (X6), so
 * "is this machine warm?" is really "has a native compile ever run here that this
 * one can reuse?". Gradle's caches and Xcode's module cache grow only as a
 * by-product of the same compiles, so they cannot say anything ccache's hit rate
 * does not also say - and unlike a build-directory existence check, ccache
 * distinguishes "this machine has built *this kind* of code" from "this machine
 * has a stale build directory from another branch". An empty Gradle cache with a
 * full ccache is a machine that will still build fast, which a directory check
 * would report backwards.
 *
 * A machine with no ccache at all is `unknown`, not cold: nothing here can judge
 * it, and saying "cold" would be a guess about a tool that is not installed.
 *
 * The threshold is a hit *count*, not a hit rate: a machine with two calls and no
 * misses is not warm, it is untouched, and 100 hits is below what one real build
 * of this repo produces. The rate is still printed, because it is the readable part.
 *
 * @param {string | null} statsText `ccache --show-stats` output, or null when ccache is missing
 * @param {{ minHits?: number }} [thresholds]
 * @returns {{status: 'ok' | 'warn' | 'unknown', detail: string, fix?: string}}
 */
export function coldCacheWarning(statsText, thresholds = {}) {
  const { minHits = 100 } = thresholds;
  if (statsText == null || statsText.trim() === '') {
    return {
      status: 'unknown',
      detail: 'no ccache to judge (its hit rate is the signal used here)',
    };
  }
  const number = (label) => {
    const match = new RegExp(`${label}:[^\\d]*(\\d+)`).exec(statsText);
    return match == null ? null : Number(match[1]);
  };
  const hits = number('Hits');
  const misses = number('Misses');
  if (hits == null || misses == null) {
    return {
      status: 'unknown',
      detail: 'ccache stats did not report Hits/Misses',
    };
  }
  const calls = hits + misses;
  const rate = calls === 0 ? 0 : hits / calls;
  const detail = `ccache ${String(hits)} hits / ${String(misses)} misses (${(rate * 100).toFixed(0)}%)`;
  if (hits >= minHits) return { status: 'ok', detail };
  return {
    status: 'warn',
    detail: `${detail} - the first native build here will be cold`,
    fix: `node scripts/doctor.mjs --prime (builds both platforms once, warming ccache, Gradle and the module caches)`,
  };
}

/**
 * The commands `--prime` runs, in order, for a given checkout.
 *
 * Pulled out of `doctor.mjs` (which cannot be imported by jest) because the whole
 * point of `--prime` is that it does *not* invent its own build command: it calls
 * `build-app.mjs`, which is where the stamp, the ccache launcher, the arch default
 * and the machine-wide build slot live. A prime that re-implemented the build would
 * skip the slot and be the exact load-13 situation it exists to prevent, and that
 * claim is only a claim until something checks the argv.
 *
 * @param {string} checkout the main checkout's path
 * @returns {{platform: 'ios'|'android', file: string, args: string[], cwd: string}[]}
 */
export function primeCommands(checkout) {
  return ['ios', 'android'].map((platform) => ({
    platform: /** @type {'ios' | 'android'} */ (platform),
    // The checkout's *own* script: it may be on a different branch than the worktree
    // `--prime` was called from, and the caches worth warming are that tree's.
    file: 'scripts/build-app.mjs',
    args: ['--platform', platform],
    cwd: checkout,
  }));
}

/**
 * Where the shared caches of this repo actually live, given git's own answers.
 *
 * `--prime` must build in the *main* checkout, not the worktree it happens to be
 * called from: ccache and Gradle's cache are shared anyway, but Xcode's derived
 * data and the pod install are per directory, and a task's throwaway worktree
 * would throw that build away. `git rev-parse` says which is which: a linked
 * worktree reports an absolute `--git-common-dir` inside the main checkout, the
 * main checkout reports a relative `.git`.
 *
 * @param {{ toplevel: string | null, commonDir: string | null }} git
 * @returns {string | null} absolute path to the main checkout, or null when git did not answer
 */
export function mainCheckoutPath({ toplevel, commonDir }) {
  if (toplevel == null || toplevel === '') return null;
  // A relative common dir means "this very checkout is the main one".
  if (commonDir == null || !nodePath.isAbsolute(commonDir)) return toplevel;
  return nodePath.basename(commonDir) === '.git'
    ? nodePath.dirname(commonDir)
    : toplevel;
}
