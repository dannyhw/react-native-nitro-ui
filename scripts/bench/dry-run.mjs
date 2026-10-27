/**
 * `--dry-run`: what a bench run *would* do, without booting, building or measuring.
 *
 * Minting this machine's baselines (RECOVERY's first step) failed twice on things
 * only reading the code revealed: there was no per-machine baseline to write to, and
 * the iOS device key came from the simulator's *name*. Both are answerable in a
 * second by a command that prints what it resolved, so a three-hour plan is not the
 * first thing to tell you.
 *
 * Two halves, deliberately:
 *
 *   - `dryRunReport` is pure: the device answer, the load average, the flag list and
 *     whether a file exists all come in as arguments, so the rules are unit tests
 *     rather than a machine (`scripts/__tests__/bench-dry-run.test.js`).
 *   - `dryRun` is the gatherer: one read-only `simctl list`, one read of the AVD's
 *     own files, `os.loadavg`. It calls nothing that boots, builds or installs -
 *     `resolveIosDevice` boots a stopped simulator and `resolveAndroidDevice`
 *     requires a running emulator, which is exactly what a pre-flight has to survive.
 *
 * The refusals are the runner's own functions called on the runner's own inputs
 * (`machineLabelProblem`, `baselineFileFor`, `loadBlocker`), so a dry run cannot
 * disagree with the run it describes.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  baselineFileFor,
  machineLabelFromEnv,
  machineLabelProblem,
} from './baseline.mjs';
import {
  deviceClassName,
  iosDeviceClassName,
  iosDeviceKey,
} from './devices.mjs';
import { buildSchedule, loadBlocker, loadCeiling } from './lib.mjs';

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
 * Everything `--dry-run` prints and decides, from injected inputs.
 *
 * A flag that was not passed is never a reason not to run: an unlabelled machine is
 * information for a plain run and a refusal for `--check`. The distinction is the
 * whole shape of the exit code, so it is asserted on directly.
 *
 * @param {{
 *   platform: 'ios' | 'android',
 *   plan: string,
 *   launches: number,
 *   component: string | null,
 *   argv: string[],
 *   env?: Record<string, string | undefined>,
 *   deviceKey: string | null,
 *   deviceDetail: string | null,
 *   deviceProblem: string | null,
 *   cpuCount: number,
 *   loadavg1: number | null,
 *   baselinesDir: string,
 *   existsSync?: (file: string) => boolean,
 *   relative?: (file: string) => string,
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
    env = process.env,
    deviceKey,
    deviceDetail,
    deviceProblem,
    cpuCount,
    loadavg1,
    baselinesDir,
    existsSync = (file) => fs.existsSync(file),
    relative = (file) => path.relative(process.cwd(), file),
  } = input;

  const minting = argv.includes('--update-baseline');
  const checking = argv.includes('--check');
  const forced = argv.includes('--force');
  // The run's own schedule builder, so the launch count and the `--component` /
  // `--only` refusals are the real ones rather than a re-derivation that could
  // drift. It throws for exactly the cases worth naming, so the message is kept.
  let schedule = [];
  let scheduleProblem = null;
  try {
    schedule = buildSchedule({
      plan,
      launches,
      only: argv.includes('--only')
        ? String(argv[argv.indexOf('--only') + 1])
        : null,
      perfMarks: argv.includes('--perf-marks'),
      component,
      platform,
    });
  } catch (error) {
    scheduleProblem = String(error.message ?? error);
  }
  const dimension = (pick) => new Set(schedule.map(pick)).size;
  const label = machineLabelFromEnv(env);
  const ceiling = loadCeiling(cpuCount);
  const blocker = loadBlocker({ loadavg1, cpuCount });
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
    `Machine:   ${label}`,
    `Load:      ${loadavg1 == null ? 'unknown' : loadavg1.toFixed(2)} now, ceiling ${
      ceiling == null ? 'unknown' : ceiling.toFixed(1)
    } for ${String(cpuCount)} cores`,
  ];
  if (scheduleProblem != null) problems.push(scheduleProblem);
  if (deviceProblem != null) problems.push(deviceProblem);
  if (blocker != null) lines.push(`           busy: ${blocker}`);

  // The baseline path, through the same resolver the runner uses: it is the one
  // place that refuses a bad label by throwing, and a dry run that rebuilt the path
  // itself would print a file the run would never open.
  let baselinePath = null;
  const labelProblem = machineLabelProblem(label, {
    flag: minting ? '--update-baseline' : '--check',
  });
  if (labelProblem == null && deviceKey != null) {
    baselinePath = baselineFileFor({
      baselinesDir,
      deviceKey,
      machineLabel: label,
    });
  }
  const exists = baselinePath == null ? null : existsSync(baselinePath);
  lines.push(
    `Baseline:  ${
      baselinePath == null
        ? 'unknown - needs a machine label and a resolved device key'
        : `${relative(baselinePath)} ${exists ? 'exists' : 'does not exist'}`
    }`
  );

  if (minting || checking) {
    const flag = minting ? '--update-baseline' : '--check';
    if (labelProblem != null) {
      problems.push(`${flag}: ${labelProblem.split('\n')[0]}`);
    }
    if (deviceKey == null) {
      problems.push(
        `${flag}: the device key is unknown, so there is no baseline file to ${minting ? 'write' : 'gate against'}`
      );
    }
    if (minting && blocker != null && !forced) {
      problems.push(`--update-baseline: ${blocker} (pass --force to override)`);
    }
    if (checking && exists === false) {
      problems.push(
        `--check: no baseline at ${relative(String(baselinePath))} - create it with --update-baseline`
      );
    }
    lines.push(
      `${(minting ? 'Mint:' : 'Check:').padEnd(11)}${
        problems.length === 0 ? 'would start' : 'would refuse'
      }`
    );
  } else if (labelProblem != null) {
    lines.push(
      'Note:      no machine label - fine for a plain run, needed by --check and --update-baseline'
    );
  }

  for (const reason of problems) lines.push(`Reason:    ${reason}`);
  lines.push(
    problems.length === 0
      ? `Dry run:   OK - ${minting ? 'a mint' : checking ? 'a check' : 'a run'} could start`
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
 *   baselinesDir: string,
 *   env?: NodeJS.ProcessEnv,
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
  baselinesDir,
  env = process.env,
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

  const report = dryRunReport({
    platform,
    plan,
    launches,
    component,
    argv,
    env,
    deviceKey: device.deviceKey,
    deviceDetail: device.detail,
    deviceProblem: device.problem,
    cpuCount: os.cpus().length,
    loadavg1: os.loadavg()[0] ?? null,
    baselinesDir,
  });
  for (const line of report.lines) write(line);
  return report.exitCode;
}
