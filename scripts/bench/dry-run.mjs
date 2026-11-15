/**
 * `--dry-run`: what a bench run *would* do, without booting, building or measuring.
 *
 * It exists because a bench run is hours of device time and its failures are cheap to
 * predict and expensive to discover late: an unassigned simulator, a device key derived
 * from a simulator's *name* instead of its hardware class, a `--component` that names
 * nothing in the plan. Each is answerable in a second by a command that prints what it
 * resolved. For `--compare-release` it also prints the whole two-sided plan
 * (`scripts/bench/compare.mjs`) - the other thing a long run should not discover about
 * itself halfway through.
 *
 * Two halves, deliberately:
 *
 *   - `dryRunReport` is pure: the device answer, the load average and the flag list all
 *     come in as arguments, so the rules are unit tests rather than a machine
 *     (`scripts/__tests__/bench-dry-run.test.js`).
 *   - `dryRun` is the gatherer: one read-only `simctl list`, one read of the AVD's
 *     own files, `os.loadavg`. It calls nothing that boots, builds or installs -
 *     `resolveIosDevice` boots a stopped simulator and `resolveAndroidDevice`
 *     requires a running emulator, which is exactly what a pre-flight has to survive.
 *
 * The refusals are the runner's own functions called on the runner's own inputs, so a
 * dry run cannot disagree with the run it describes.
 *
 * `--compare-release` brings the two-sided plan along (`prepareComparison`): reading a
 * ref's plan needs its files and nothing else, so the dry run extracts the ref and asks
 * it what it measures - no install, no build, no device.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  deviceClassName,
  iosDeviceClassName,
  iosDeviceKey,
} from './devices.mjs';
import { comparisonPlanLines } from './compare.mjs';
import { buildSchedule, loadOverCeiling, loadCeiling } from './lib.mjs';

/**
 * The iOS device key from a simulator listing alone.
 *
 * The same three fields `resolveIosDevice` uses - the runtime bucket's identifier,
 * the entry's `deviceTypeIdentifier`, and `name` only as the fallback - with no
 * `simctl boot` behind it. A stopped simulator is a normal answer here, not a
 * problem: that is the case where booting would be the mistake.
 *
 * @param {{
 *   udid: string | null,
 *   listing: { devices?: Record<string, Array<Record<string, unknown>>> } | null,
 * }} input
 * @returns {{deviceKey: string | null, detail: string | null, problem: string | null}}
 */
export function iosDryRunDevice({ udid, listing }) {
  if (udid == null || udid === '') {
    return {
      deviceKey: null,
      detail: null,
      problem:
        'IOS_SIM_UDID is not set, so no simulator can be resolved - lease one (node scripts/lease.mjs acquire --task <ID>)',
    };
  }
  if (listing == null) {
    return {
      deviceKey: null,
      detail: null,
      problem:
        '`xcrun simctl list devices -j` did not answer, so no simulator can be resolved',
    };
  }
  const bucket = Object.entries(listing.devices ?? {}).find(([, devices]) =>
    devices.some((entry) => entry.udid === udid)
  );
  if (bucket == null) {
    return {
      deviceKey: null,
      detail: null,
      problem: `iOS simulator ${udid} is not in this machine's listing (create it, or use the UDID your lease hands you)`,
    };
  }
  const [runtimeId, devices] = bucket;
  const device = devices.find((entry) => entry.udid === udid);
  // Same derivation as `resolveIosDevice`: `...SimRuntime.iOS-27-0` -> `27.0`.
  const runtime =
    /iOS-(\d+(?:-\d+)?)/.exec(runtimeId)?.[1]?.replace('-', '.') ?? null;
  return {
    deviceKey: iosDeviceKey(runtime, device),
    detail: `"${device.name}" ${String(device.state ?? 'Unknown')}, iOS ${runtime ?? 'unknown'}, class ${iosDeviceClassName(device)}`,
    problem: null,
  };
}

/**
 * The hardware profile and API level of an AVD that is *not* running, from its files.
 *
 * A dry run cannot ask a device (`adb shell getprop`) because the honest case is a
 * stopped AVD, and starting one is what this command must not do. The AVD directory
 * already holds both answers: `hw.device.name` is the same key `resolveAndroidDevice`
 * reads for a live one, and the system-image path carries the API level, with the
 * sidecar `.ini`'s `target=android-<n>` behind it. Nulls rather than guesses - a
 * fallback that happened to equal the real value would make a failed read invisible.
 *
 * @param {{
 *   avd: string | null,
 *   read: (file: string) => string | null,
 *   avdHome: string,
 * }} input
 * @returns {{apiLevel: string | null, profile: string | null, from: string | null, missing: boolean}}
 */
export function readAvdHardware({ avd, read, avdHome }) {
  if (avd == null || avd === '') {
    return { apiLevel: null, profile: null, from: null, missing: true };
  }
  const dir = path.join(avdHome, `${avd}.avd`, 'config.ini');
  const sidecar = path.join(avdHome, `${avd}.ini`);
  const config = read(dir);
  const meta = read(sidecar);
  if (config == null && meta == null) {
    return { apiLevel: null, profile: null, from: null, missing: true };
  }
  const key = (text, name) => {
    if (text == null) return null;
    for (const line of text.split('\n')) {
      const [left, ...rest] = line.split('=');
      if (left?.trim() === name && rest.length > 0) {
        return rest.join('=').trim() || null;
      }
    }
    return null;
  };
  const apiLevel =
    /android-(\d+)/.exec(key(config, 'image.sysdir.1') ?? '')?.[1] ??
    /android-(\d+)/.exec(key(meta, 'target') ?? '')?.[1] ??
    null;
  return {
    apiLevel,
    profile: key(config, 'hw.device.name'),
    from: config != null ? dir : sidecar,
    missing: false,
  };
}

/**
 * The Android device key without touching a device.
 *
 * @param {{
 *   avd: string | null,
 *   serial: string | null,
 *   hardware: { apiLevel: string | null, profile: string | null, missing: boolean },
 *   attachedSerials: string[],
 * }} input
 * @returns {{deviceKey: string | null, detail: string, problem: string | null}}
 */
export function androidDryRunDevice({
  avd,
  serial,
  hardware,
  attachedSerials,
}) {
  if (avd == null && serial == null) {
    return {
      deviceKey: null,
      detail: 'nothing assigned',
      problem:
        'ANDROID_AVD (or ANDROID_SERIAL) is not set, so no emulator can be resolved - lease one (node scripts/lease.mjs acquire --task <ID>)',
    };
  }
  const problems = [];
  if (hardware.missing) {
    problems.push(
      `no config.ini for AVD "${avd ?? '?'}" under ~/.android/avd, so its API level and hardware profile are unknown here`
    );
  }
  // Both halves or neither: an API level with no profile would produce
  // `android33-emu-`, a key shaped like a real one that matches no committed
  // baseline - the worst kind of wrong answer, because it reads as resolved.
  if (hardware.apiLevel == null || hardware.profile == null) {
    problems.push(
      `the device key cannot be built from this AVD's files (API level ${hardware.apiLevel ?? 'unknown'}, profile ${hardware.profile ?? 'unknown'})`
    );
  }
  const attached = serial != null && attachedSerials.includes(serial);
  return {
    deviceKey:
      hardware.apiLevel == null || hardware.profile == null
        ? null
        : `android${hardware.apiLevel}-emu-${deviceClassName(hardware.profile)}`,
    detail:
      `AVD ${avd ?? '?'}, API ${hardware.apiLevel ?? 'unknown'}, profile ${hardware.profile ?? 'unknown'}, ` +
      (attached
        ? `attached as ${serial}`
        : `${serial ?? 'no serial'} not attached (a run boots it; this command does not)`),
    problem: problems.length === 0 ? null : problems.join('; '),
  };
}

/**
 * Everything a plain `--dry-run` prints and decides, from injected inputs.
 *
 * Nothing here is refused for being merely busy: the load is a line of the answer, not
 * a veto (X36). What still makes it exit 2 is a run that *cannot* start as asked - no
 * device to measure on, a filter that matches no cell.
 *
 * @param {{
 *   platform: 'ios' | 'android',
 *   plan: string,
 *   launches: number,
 *   component: string | null,
 *   argv: string[],
 *   deviceKey: string | null,
 *   deviceDetail: string | null,
 *   deviceProblem: string | null,
 *   cpuCount: number,
 *   loadavg1: number | null,
 *   comparison?: object | null,
 * }} input
 * @returns {{lines: string[], problems: string[], exitCode: number}}
 */
export function dryRunReport(input) {
  const {
    platform,
    plan,
    launches,
    component,
    argv,
    deviceKey,
    deviceDetail,
    deviceProblem,
    cpuCount,
    loadavg1,
    comparison = null,
  } = input;

  // The run's own schedule builder, so the launch count and the `--component` /
  // `--only` / `--scenario` refusals are the real ones rather than a re-derivation that
  // could drift. It throws for exactly the cases worth naming, so the message is kept.
  let schedule = [];
  let scheduleProblem = null;
  const filters = {
    only: argv.includes('--only')
      ? String(argv[argv.indexOf('--only') + 1])
      : null,
    component,
    scenario: argv.includes('--scenario')
      ? String(argv[argv.indexOf('--scenario') + 1])
      : null,
    n: argv.includes('--n') ? Number(argv[argv.indexOf('--n') + 1]) : null,
  };
  try {
    schedule = buildSchedule({
      plan,
      launches,
      perfMarks: argv.includes('--perf-marks'),
      platform,
      ...filters,
    });
  } catch (error) {
    scheduleProblem = String(error.message ?? error);
  }
  const dimension = (pick) => new Set(schedule.map(pick)).size;
  const ceiling = loadCeiling(cpuCount);
  const blocker = loadOverCeiling({ loadavg1, cpuCount });
  const problems = [];

  const lines = [
    `Platform:  ${platform}`,
    `Plan:      ${plan}${
      scheduleProblem == null
        ? ` (${String(dimension((entry) => `${entry.scenario}:${entry.n}`))} cells x ${String(
            dimension((entry) => entry.implementation)
          )} implementations x ${String(
            dimension((entry) => entry.launch)
          )} launches = ${String(schedule.length)} launches)`
        : ' (no schedule)'
    }`,
    `Device:    ${deviceKey ?? 'UNKNOWN'}${deviceDetail == null ? '' : ` - ${deviceDetail}`}`,
    `Host:      ${String(cpuCount)} cores, load ${loadavg1 == null ? 'unknown' : loadavg1.toFixed(2)} now${
      ceiling == null ? '' : ` (quiet under ${ceiling.toFixed(1)})`
    }${blocker == null ? '' : `\n           note:    ${blocker}`}`,
  ];
  if (scheduleProblem != null) problems.push(scheduleProblem);
  if (deviceProblem != null) problems.push(deviceProblem);
  if (comparison != null) {
    for (const line of comparisonPlanLines({ plan: comparison, deviceKey })) {
      lines.push(line);
    }
    if (comparison.problem != null) problems.push(comparison.problem);
  }

  for (const reason of problems) lines.push(`Reason:    ${reason}`);
  lines.push(
    problems.length === 0
      ? 'Dry run:   OK - a run could start'
      : `Dry run:   ${String(problems.length)} reason(s) not to start it as asked`
  );
  return { lines, problems, exitCode: problems.length === 0 ? 0 : 2 };
}

/** Where AVDs live, honouring `ANDROID_AVD_HOME` the way the emulator does. */
export function avdHomeFrom(env = process.env) {
  if (env.ANDROID_AVD_HOME != null && env.ANDROID_AVD_HOME !== '') {
    return env.ANDROID_AVD_HOME;
  }
  return path.join(env.HOME ?? env.USERPROFILE ?? '', '.android', 'avd');
}

/** `xcrun simctl list devices -j`, or null when the tool is not there. Read-only. */
export function simctlListing(env = process.env) {
  try {
    return JSON.parse(
      execFileSync('xcrun', ['simctl', 'list', 'devices', '-j'], {
        encoding: 'utf8',
        timeout: 60_000,
        env,
      })
    );
  } catch {
    return null;
  }
}

/**
 * The emulators adb sees, or an empty list.
 *
 * A convenience line ("is my AVD up?"), so a machine with no Android SDK still gets
 * a dry run rather than a stack trace.
 */
export function attachedEmulatorSerials(env = process.env) {
  const home = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
  const adb = home != null ? path.join(home, 'platform-tools', 'adb') : 'adb';
  try {
    return execFileSync(adb, ['devices'], {
      encoding: 'utf8',
      timeout: 30_000,
      env,
    })
      .split('\n')
      .filter((line) => line.endsWith('\tdevice'))
      .map((line) => String(line.split('\t')[0]));
  } catch {
    return [];
  }
}

/**
 * The gatherer: read-only tool output, then `dryRunReport`.
 *
 * @param {{
 *   argv: string[],
 *   platform: 'ios' | 'android',
 *   plan: string,
 *   launches: number,
 *   component: string | null,
 *   env?: NodeJS.ProcessEnv,
 *   prepareComparison?: (() => object) | null,
 *   write?: (line: string) => void,
 * }} options
 * @returns {number} 0 when the run as asked could start, 2 with reasons when not
 */
export function dryRun({
  argv,
  platform,
  plan,
  launches,
  component,
  env = process.env,
  prepareComparison = null,
  write = (line) => process.stdout.write(`${line}\n`),
}) {
  let device;
  if (platform === 'ios') {
    const udid = env.IOS_SIM_UDID ?? null;
    // Only asks Xcode when there is a UDID to look for: nothing is assigned, the
    // answer is already known, and a pre-flight should not pay for a tool call it
    // cannot use the result of.
    device = iosDryRunDevice({
      udid,
      listing: udid == null || udid === '' ? null : simctlListing(env),
    });
  } else {
    device = androidDryRunDevice({
      avd: env.ANDROID_AVD ?? env.AVD ?? null,
      serial: env.ANDROID_SERIAL ?? null,
      hardware: readAvdHardware({
        avd: env.ANDROID_AVD ?? env.AVD ?? null,
        avdHome: avdHomeFrom(env),
        read: (file) => {
          try {
            return fs.readFileSync(file, 'utf8');
          } catch {
            return null;
          }
        },
      }),
      attachedSerials: attachedEmulatorSerials(env),
    });
  }

  // Only after the device question is answered: the comparison plan prints the device
  // both sides will share, and preparing it must not be the thing that fails first.
  const comparison = prepareComparison == null ? null : prepareComparison();

  const report = dryRunReport({
    platform,
    plan,
    launches,
    component,
    argv,
    comparison,
    deviceKey: device.deviceKey,
    deviceDetail: device.detail,
    deviceProblem: device.problem,
    cpuCount: os.cpus().length,
    loadavg1: os.loadavg()[0] ?? null,
  });
  for (const line of report.lines) write(line);
  return report.exitCode;
}
