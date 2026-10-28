/**
 * `bun bench --dry-run` — what a run would resolve, decided without a device.
 *
 * Minting a machine's baselines burned hours before telling anyone that there was no
 * per-machine baseline directory to write to, or that the iOS device key had been
 * built from the simulator's *name*. A pre-flight is only worth having if its answer
 * is the run's real answer, so the cases below are about the three ways it could lie:
 *
 *   - booting or starting something while "checking" (it must read a listing only);
 *   - disagreeing with the run about a refusal (so it calls the run's own functions);
 *   - treating a flag that was never passed as a reason not to run.
 *
 * Nothing here touches a simulator or an emulator: the device answers come in as
 * fixtures, and the AVD's files are an injected `read`.
 */

import { afterAll, describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { labelPreFlightProblem } from '../bench/baseline.mjs';
import {
  androidDryRunDevice,
  dryRunReport,
  iosDryRunDevice,
  readAvdHardware,
} from '../bench/dry-run.mjs';

/** A `simctl list devices -j` shaped like the real one, with an Air and a 17. */
const LISTING = {
  devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [
      {
        udid: 'UDID-AIR',
        name: 'nitro-ui B',
        state: 'Shutdown',
        deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17',
      },
      {
        udid: 'UDID-AIR-2',
        name: 'Another',
        state: 'Booted',
        deviceTypeIdentifier:
          'com.apple.CoreSimulator.SimDeviceType.iPhone-Air',
      },
    ],
  },
};

describe('the iOS half of a dry run', () => {
  it('builds the key from the runtime and the device type, not the name', () => {
    const out = iosDryRunDevice({ udid: 'UDID-AIR', listing: LISTING });
    // `nitro-ui B` is the simulator's *name* and must not appear in the key: that
    // rename-a-simulator-and-change-your-device-key bug is the reason this exists.
    expect(out.deviceKey).toBe('ios27-sim-iphone17');
    expect(out.detail).toContain('nitro-ui B');
    expect(out.detail).toContain('Shutdown');
    expect(out.problem).toBeNull();
  });

  it('reads a stopped simulator as a valid answer, not a problem', () => {
    // The point of a pre-flight is that the device is usually not booted yet, and a
    // dry run that booted it would break the "never touch a device you did not
    // start" rule on its first use.
    expect(
      iosDryRunDevice({ udid: 'UDID-AIR', listing: LISTING }).problem
    ).toBeNull();
  });

  it('says so when the UDID is missing from the machine, or unset', () => {
    expect(
      iosDryRunDevice({ udid: 'NOPE', listing: LISTING }).problem
    ).toContain('not in this machine');
    expect(iosDryRunDevice({ udid: '', listing: LISTING }).problem).toContain(
      'IOS_SIM_UDID is not set'
    );
    expect(
      iosDryRunDevice({ udid: 'UDID-AIR', listing: null }).problem
    ).toContain('simctl list');
  });
});

describe('the Android half of a dry run', () => {
  // API 33 and `pixel_7` rather than this repo's own API 35 / pixel_9 requirement: a
  // reader that answered from the requirement constant instead of the file would pass
  // a fixture that happened to match it, which is the coincidence these avoid.
  const CONFIG = [
    'avd.ini.encoding=UTF-8',
    'image.sysdir.1=system-images/android-33/google_apis/arm64-v8a/',
    'hw.device.name=pixel_7',
    'hw.ramSize=2G',
  ].join('\n');

  const files = (map) => (file) => map[path.basename(file)] ?? null;

  it('reads API level and profile from a stopped AVD', () => {
    const hardware = readAvdHardware({
      avd: 'nitroui_b',
      avdHome: '/home/me/.android/avd',
      read: files({ 'config.ini': CONFIG }),
    });
    expect(hardware).toEqual({
      apiLevel: '33',
      profile: 'pixel_7',
      from: '/home/me/.android/avd/nitroui_b.avd/config.ini',
      missing: false,
    });
    expect(
      androidDryRunDevice({
        avd: 'nitroui_b',
        serial: 'emulator-5570',
        hardware,
        attachedSerials: [],
      })
    ).toEqual({
      deviceKey: 'android33-emu-pixel7',
      detail: expect.stringContaining('not attached'),
      problem: null,
    });
  });

  it('takes the API level from the system image, and the sidecar target behind it', () => {
    // Two sources, in that order: `image.sysdir.1` is the system image the AVD
    // actually boots, and the sidecar `.ini`'s `target` is the fallback for a config
    // that lacks it. API 33 and 30 - neither is a value the code could default to, so
    // a fallback that invented a level could not pass by coincidence with either.
    expect(
      readAvdHardware({
        avd: 'nitroui_b',
        avdHome: '/avd',
        read: files({
          'config.ini': CONFIG,
          'nitroui_b.ini': 'target=android-30\n',
        }),
      }).apiLevel
    ).toBe('33');
    expect(
      readAvdHardware({
        avd: 'nitroui_b',
        avdHome: '/avd',
        read: files({
          'config.ini': 'hw.device.name=pixel_7\n',
          'nitroui_b.ini': 'target=android-30\n',
        }),
      }).apiLevel
    ).toBe('30');
    expect(
      readAvdHardware({
        avd: 'nitroui_b',
        avdHome: '/avd',
        read: files({ 'config.ini': 'hw.device.name=pixel_7\n' }),
      }).apiLevel
    ).toBeNull();
  });

  it('refuses to build a key from half a read, rather than truncating it', () => {
    const hardware = readAvdHardware({
      avd: 'nitroui_a',
      avdHome: '/avd',
      read: files({
        'nitroui_a.ini': 'target=android-30\npath.rel=avd/nitroui_a.avd',
      }),
    });
    expect(hardware.apiLevel).toBe('30');
    // No config.ini means no profile either.
    expect(hardware.profile).toBeNull();
    expect(
      androidDryRunDevice({
        avd: 'nitroui_a',
        serial: null,
        hardware,
        attachedSerials: [],
      })
    ).toEqual({
      // `android30-emu-` would be shaped like a real key and match no committed
      // baseline, which reads as resolved. Null is the honest answer.
      deviceKey: null,
      detail: expect.stringContaining('profile unknown'),
      problem: expect.stringContaining('cannot be built from this AVD'),
    });
    // The same for the other half: a profile with no API level.
    expect(
      androidDryRunDevice({
        avd: 'nitroui_a',
        serial: null,
        hardware: { apiLevel: null, profile: 'pixel_7', missing: false },
        attachedSerials: [],
      }).deviceKey
    ).toBeNull();
  });

  it('reports nothing at all when no emulator was assigned', () => {
    expect(
      androidDryRunDevice({
        avd: null,
        serial: null,
        hardware: { apiLevel: null, profile: null, missing: true },
        attachedSerials: [],
      }).problem
    ).toContain('ANDROID_AVD');
  });
});

describe('the dry-run report and its exit code', () => {
  const baselinesDir = '/repo/bench/baselines';
  const base = {
    platform: 'ios',
    plan: 'quick',
    launches: 4,
    component: null,
    argv: ['--platform', 'ios'],
    env: { NITRO_UI_MACHINE_LABEL: 'maintainer-mac-2' },
    deviceKey: 'ios27-sim-iphone17',
    deviceDetail: '"nitro-ui B" Shutdown',
    deviceProblem: null,
    cpuCount: 10,
    loadavg1: 2,
    baselinesDir,
    existsSync: () => true,
    relative: (file) => file.replace('/repo/', ''),
  };

  it('reports the key, label, baseline path and load ceiling it resolved', () => {
    const out = dryRunReport(base);
    const text = out.lines.join('\n');
    expect(text).toContain('ios27-sim-iphone17');
    expect(text).toContain('maintainer-mac-2');
    expect(text).toContain(
      'bench/baselines/maintainer-mac-2/ios27-sim-iphone17.json exists'
    );
    // 0.5 x cores (D9), and the load it would be judged against.
    expect(text).toContain('2.00 now, ceiling 5.0 for 10 cores');
    expect(text).toContain('cells x');
    expect(text).toContain('could start');
    expect(out.exitCode).toBe(0);
  });

  it('refuses a mint on a busy machine, and accepts it under --force', () => {
    const busy = { ...base, argv: ['--update-baseline'], loadavg1: 9 };
    expect(busy.argv.join(' ')).toContain('--update-baseline');
    const out = dryRunReport(busy);
    expect(out.exitCode).toBe(2);
    expect(out.lines.join('\n')).toContain('would refuse');
    expect(out.problems.join('\n')).toContain('busy');

    const forced = dryRunReport({
      ...busy,
      argv: ['--update-baseline', '--force'],
    });
    expect(forced.exitCode).toBe(0);
    expect(forced.lines.join('\n')).toContain('would start');
  });

  it('treats a missing baseline as a reason only when --check asked for it', () => {
    const missing = { ...base, existsSync: () => false };
    // A plain run gates nothing, so an absent baseline is not a reason to stop.
    expect(dryRunReport(missing).exitCode).toBe(0);
    const check = dryRunReport({ ...missing, argv: ['--check'] });
    expect(check.exitCode).toBe(2);
    expect(check.problems.join('\n')).toContain('no baseline at');
  });

  it('reports an unlabelled machine as a note for a run and a refusal for a check', () => {
    const unlabelled = { ...base, env: {} };
    const plain = dryRunReport(unlabelled);
    expect(plain.exitCode).toBe(0);
    expect(plain.lines.join('\n')).toContain('no machine label');
    expect(plain.lines.join('\n')).toContain('Baseline:  unknown');

    const argv = ['--check'];
    const check = dryRunReport({ ...unlabelled, argv });
    expect(check.exitCode).toBe(2);
    // The refusal is X8's own string, whole (N7). Comparing against the function
    // rather than against a copy of its text is the point: a dry run that rebuilt
    // the message - or prefixed the flag a second time, which it used to print as
    // `--check: --check:` - goes red here even if its own text still reads well.
    expect(check.problems).toContain(labelPreFlightProblem(argv, {}));
    // And the reader gets the fix, which is on the message's second line: dropping
    // to the first line left "no machine label" with nothing to do about it.
    const reason = check.lines.filter((line) => line.startsWith('Reason:'))[0];
    expect(reason).toContain('NITRO_UI_MACHINE_LABEL');
    expect(reason.match(/--check:/g)).toHaveLength(1);
  });

  it('carries an unresolvable device into the answer', () => {
    const out = dryRunReport({
      ...base,
      deviceKey: null,
      deviceDetail: null,
      deviceProblem: 'IOS_SIM_UDID is not set',
    });
    expect(out.exitCode).toBe(2);
    expect(out.lines.join('\n')).toContain('Device:    UNKNOWN');
    expect(out.problems).toContain('IOS_SIM_UDID is not set');
  });

  it("carries X8's refusal by calling it, not by copying its dispatch (N7)", () => {
    // Behaviour cannot prove this: a copy of `labelPreFlightProblem`'s dispatch is
    // byte-identical until X8 changes, which is exactly why the review called it a
    // drift risk rather than a bug. So the assertion is on the source, as
    // `bench-baseline-machine.test.js` does for baseline paths: dry-run may ask X8's
    // predicate for a *literal* flag (the plain-run note, and the "can this label
    // name a directory" gate), but it must not build the minting/checking choice
    // itself — that decision belongs to `labelPreFlightProblem`.
    const code = readFileSync(
      path.join(process.cwd(), 'scripts', 'bench', 'dry-run.mjs'),
      'utf8'
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).toContain('labelPreFlightProblem(argv');
    expect(code).not.toMatch(
      /machineLabelProblem\([\s\S]{0,80}flag:\s*minting\s*\?/
    );
  });

  it('refuses to mint or check against a device key it could not resolve', () => {
    // The key is the *filename*, so an unknown key means the run would write or read
    // a file named after nothing. Both flags have to say so, in their own words: a
    // mint is about a file to write and a check about one to gate against, and a
    // caller reading the reason needs to know which one it failed.
    const unresolved = {
      ...base,
      deviceKey: null,
      deviceDetail: null,
      deviceProblem: null,
    };
    const mint = dryRunReport({ ...unresolved, argv: ['--update-baseline'] });
    expect(mint.exitCode).toBe(2);
    expect(mint.problems.join('\n')).toContain('no baseline file to write');

    const check = dryRunReport({ ...unresolved, argv: ['--check'] });
    expect(check.exitCode).toBe(2);
    expect(check.problems.join('\n')).toContain(
      'no baseline file to gate against'
    );
  });

  it('refuses a component the plan has no cell for, with the run’s own message', () => {
    // `buildSchedule` is the runner's schedule builder, so this is the same refusal
    // the run would print rather than a paraphrase of it.
    const out = dryRunReport({ ...base, component: 'nonexistent-widget' });
    expect(out.exitCode).toBe(2);
    expect(out.problems.join('\n')).toContain(
      '--component nonexistent-widget matched no cell'
    );
  });

  it('refuses to mint from a narrowed schedule, and says a plain run is fine', () => {
    // The A4 diagnostic shape: one cell, so the mint must be refused *here* rather
    // than three hours later, and the same command without `--update-baseline` is
    // exactly what a diagnostic run should do.
    const argv = ['--scenario', 'mount.date-picker', '--n', '200'];
    const mint = dryRunReport({
      ...base,
      plan: 'full',
      launches: 8,
      argv: [...argv, '--update-baseline'],
    });
    expect(mint.exitCode).toBe(2);
    expect(mint.problems.join('\n')).toContain('--update-baseline');
    expect(mint.problems.join('\n')).toContain('narrowed to');
    expect(mint.lines.join('\n')).toContain('Mint:      would refuse');

    // Forced, it is a local experiment again and the guard steps aside like `--force`
    // does for the load rule.
    const forced = dryRunReport({
      ...base,
      plan: 'full',
      launches: 8,
      argv: [...argv, '--update-baseline', '--force'],
    });
    expect(forced.problems.join('\n')).not.toContain('narrowed to');

    // Without the mint flag the same narrow run is legitimate: a diagnostic that gates
    // nothing needs one cell, not the whole plan.
    const plain = dryRunReport({ ...base, plan: 'full', launches: 8, argv });
    expect(plain.exitCode).toBe(0);
  });

  it('lists no reasons when everything resolves', () => {
    expect(dryRunReport(base).problems).toEqual([]);
  });

  it('puts every answer in the same column, including the verdict rows', () => {
    // A reader scans one column to compare machine to machine, so the verdict rows
    // (`Mint:` / `Check:`) are the ones short enough to slip out of it.
    const out = dryRunReport({ ...base, argv: ['--update-baseline'] });
    expect(out.lines.join('\n')).toContain('Mint:      would start');
    const check = dryRunReport({ ...base, argv: ['--check'] });
    expect(check.lines.join('\n')).toContain('Check:     would start');
    for (const line of out.lines) {
      // The `busy:` row is a continuation of `Load:` and is deliberately indented.
      if (/^\s/.test(line)) continue;
      const value = line.indexOf(':');
      expect(value).toBeGreaterThan(0);
      // Label, then at least two spaces of padding, out to the shared column.
      expect(line.slice(0, value + 1).length).toBeLessThanOrEqual(9);
      expect(/^ {2}/.test(line.slice(value + 1))).toBe(true);
    }
  });
});

/**
 * The CLI, in a copy of `scripts/` with every device variable blanked.
 *
 * The point being proven is the one a unit test cannot: that the flag never reaches
 * device resolution. `resolveIosDevice` throws "No iOS simulator" on an empty
 * `IOS_SIM_UDID`, so its absence in the output is the evidence that nothing booted.
 */
describe('bench --dry-run (the CLI)', () => {
  const cleanup = [];

  /** `scripts/` on its own, so the child's repo root is the throwaway tree. */
  function workspace() {
    const root = mkdtempSync(path.join(realpathSync(tmpdir()), 'bench-dry-'));
    copyScripts(
      path.join(process.cwd(), 'scripts'),
      path.join(root, 'scripts')
    );
    cleanup.push(root);
    return root;
  }

  function copyScripts(from, to) {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name === '__tests__') continue;
      const src = path.join(from, entry.name);
      const dest = path.join(to, entry.name);
      if (entry.isDirectory()) copyScripts(src, dest);
      else copyFileSync(src, dest);
    }
  }

  function cli(root, args, env = {}) {
    const child = spawnSync(
      process.execPath,
      [path.join(root, 'scripts', 'bench', 'run.mjs'), ...args],
      {
        encoding: 'utf8',
        cwd: root,
        timeout: 120_000,
        env: {
          ...process.env,
          // Blank every device variable: inherited from a leased shell, an
          // `IOS_SIM_UDID` here would name a real simulator, and a dry run that
          // wrongly resolved one would boot it.
          IOS_SIM_UDID: '',
          ANDROID_SERIAL: '',
          ANDROID_AVD: '',
          AVD: '',
          NITRO_UI_MACHINE_LABEL: 'maintainer-mac-9',
          ...env,
        },
      }
    );
    return {
      status: child.status,
      all: `${child.stdout ?? ''}${child.stderr ?? ''}`,
    };
  }

  afterAll(() => {
    for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
  });

  it('answers on both platforms without reaching a device', () => {
    const root = workspace();
    for (const platform of ['ios', 'android']) {
      const out = cli(root, [
        '--platform',
        platform,
        '--plan',
        'quick',
        '--dry-run',
      ]);
      expect(out.status).toBe(2);
      // The runner's own device errors, absent: resolution was never attempted.
      expect(out.all).not.toContain('No iOS simulator');
      expect(out.all).not.toContain('No Android device');
      expect(out.all).not.toContain('is not attached');
      expect(out.all).toContain(`Platform:  ${platform}`);
      expect(out.all).toContain('maintainer-mac-9');
      expect(out.all).toContain('ceiling');
      expect(out.all).toContain('reason(s) not to start');
    }
  });

  it('still refuses a bad flag before printing anything, and keeps the usage line', () => {
    const root = workspace();
    const bad = cli(root, ['--platform', 'spectrum', '--dry-run']);
    expect(bad.status).toBe(2);
    expect(bad.all).toContain('--dry-run');
    expect(bad.all).not.toContain('Platform:');
    expect(
      cli(root, ['--platform', 'ios', '--plan', 'nope', '--dry-run']).all
    ).toContain('--plan must be');
  });

  it('asks the tools read-only questions, and never a booting one', () => {
    // The brief's hard rule, checked at the only layer where it can be: the child
    // processes. Every tool call is recorded, so `simctl boot` showing up - or an
    // `adb emu` command - is visible even though the answer still looks correct.
    const root = workspace();
    const calls = path.join(root, 'tool-calls.log');
    const bin = path.join(root, 'bin');
    const platformTools = path.join(root, 'sdk', 'platform-tools');
    mkdirSync(bin, { recursive: true });
    mkdirSync(platformTools, { recursive: true });
    const shim = (target) =>
      [
        '#!/bin/sh',
        `echo "$(basename "$0") $*" >> "${calls}"`,
        // A listing that names the simulator, so a *successful* resolve is possible
        // and a refusal-to-boot cannot be explained by "it bailed out early".
        target === 'xcrun'
          ? `printf '{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-27-0":[{"udid":"UDID-AIR","name":"nitro-ui B","state":"Shutdown","deviceTypeIdentifier":"com.apple.CoreSimulator.SimDeviceType.iPhone-17"}]}}\\n'\n`
          : 'printf "List of devices attached\\nemulator-5570\\tdevice\\n\\n"\n',
      ].join('\n');
    for (const [name, target] of [
      ['xcrun', 'xcrun'],
      ['adb', 'adb'],
    ]) {
      const file =
        target === 'xcrun'
          ? path.join(bin, name)
          : path.join(platformTools, 'adb');
      writeFileSync(file, shim(target));
      chmodSync(file, 0o755);
    }

    const out = cli(
      root,
      ['--platform', 'ios', '--plan', 'quick', '--dry-run'],
      { PATH: `${bin}:${process.env.PATH}`, IOS_SIM_UDID: 'UDID-AIR' }
    );
    expect(out.all).toContain('ios27-sim-iphone17');
    // One call, exactly: not `boot`, not `bootstatus`, not a second listing. The
    // simulator here is *Shutdown*, so a resolve-style dry run would have booted it
    // and recorded that boot - which is the failure this assertion is for.
    const recorded = readFileSync(calls, 'utf8').trim().split('\n');
    expect(recorded).toEqual(['xcrun simctl list devices -j']);
    expect(out.all).toContain('Shutdown');

    // Android: the AVD's files answer the question, so adb is asked only whether the
    // emulator happens to be up - and an emulator boot is never on that list. The
    // AVD home is pointed at a directory with nothing in it, so the answer cannot
    // depend on which AVDs happen to exist on the machine running the test.
    rmSync(calls);
    const android = cli(
      root,
      ['--platform', 'android', '--plan', 'quick', '--dry-run'],
      {
        PATH: `${bin}:${process.env.PATH}`,
        ANDROID_HOME: path.join(root, 'sdk'),
        ANDROID_AVD_HOME: path.join(root, 'avds-here-none'),
        ANDROID_AVD: 'nitroui_b',
        ANDROID_SERIAL: 'emulator-5570',
      }
    );
    expect(android.all).toContain('attached as emulator-5570');
    expect(android.all).toContain('no config.ini for AVD "nitroui_b"');
    expect(readFileSync(calls, 'utf8').trim()).toBe('adb devices');
  });
});
