/**
 * `bun bench --dry-run` — what a run would resolve, decided without a device.
 *
 * A bench session burns hours before anyone learns that its device key was built from
 * the simulator's *name*, or that the ref it is comparing against is the commit under
 * review. A pre-flight is only worth having if its answer
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
import { execFileSync, spawnSync } from 'node:child_process';
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

import { childEnv } from './helpers/scrubbed-env.js';
import {
  androidDryRunDevice,
  dryRunReport,
  iosDryRunDevice,
  readAvdHardware,
} from '../bench/dry-run.mjs';
import { planComparison } from '../bench/compare.mjs';

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
      // release ref, which reads as resolved. Null is the honest answer.
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

/**
 * A schedule shaped like the real builder's output: one cell, two arms, N launches.
 * The numbers are deliberately not round multiples of anything the plan uses, so a
 * comparison that counted the wrong thing shows up (AGENTS.md: no fixture may coincide
 * with the right answer by accident).
 */
function comparisonFixtureSchedule(launches) {
  const entries = [];
  for (let launch = 0; launch < launches; launch += 1) {
    for (const implementation of ['nitro-ui', 'rn-core']) {
      entries.push({
        scenario: 'mount.slider',
        implementation,
        n: 37,
        launch,
      });
    }
  }
  return entries;
}

describe('the dry-run report and its exit code', () => {
  const base = {
    platform: 'ios',
    plan: 'quick',
    launches: 4,
    component: null,
    argv: ['--platform', 'ios'],
    deviceKey: 'ios27-sim-iphone17',
    deviceDetail: '"nitro-ui B" Shutdown',
    deviceProblem: null,
    cpuCount: 10,
    loadavg1: 2,
  };

  it('reports the device key, host and schedule it resolved', () => {
    const text = dryRunReport(base).lines.join('\n');
    expect(text).toContain('ios27-sim-iphone17');
    // 0.5 x cores (D9), and the load it is reported beside.
    expect(text).toContain('quiet under 5.0');
    expect(text).toContain('cells x');
    expect(text).toContain('could start');
    expect(dryRunReport(base).exitCode).toBe(0);
  });

  it('reports a busy machine as a note, and still says a run could start', () => {
    // X36: nothing refuses a run for being busy. The load is printed with the numbers -
    // a comparison made inside one session cancels that drift the same way the ratio to
    // `rn-core` cancels drift between launches, so "busy" is a reason to read the noise
    // column, not a reason the command exits non-zero.
    const out = dryRunReport({ ...base, loadavg1: 9 });
    expect(out.exitCode).toBe(0);
    expect(out.lines.join('\n')).toContain('the machine was busy');
    expect(out.problems).toEqual([]);
    expect(out.lines.join('\n')).toContain('could start');
  });

  it('carries an unresolvable device into the answer', () => {
    const out = dryRunReport({
      ...base,
      deviceKey: null,
      deviceDetail: null,
      deviceProblem: 'IOS_SIM_UDID is not set',
    });
    expect(out.exitCode).toBe(2);
    expect(out.lines.join('\n')).toContain('UNKNOWN');
    expect(out.problems).toContain('IOS_SIM_UDID is not set');
  });

  it('refuses a component the plan has no cell for, with the run’s own message', () => {
    const out = dryRunReport({ ...base, component: 'not-a-component' });
    expect(out.exitCode).toBe(2);
    // The runner's builder is what says no, so a component added to the plan later
    // cannot make this test's expectation stale in the other direction.
    expect(out.problems.join('\n')).toContain('not-a-component');
  });

  it('prints the two-sided plan of a comparison, device included', () => {
    const out = dryRunReport({
      ...base,
      argv: ['--platform', 'ios', '--compare-release', '--dry-run'],
      comparison: planComparison({
        platform: 'ios',
        plan: 'quick',
        launches: 2,
        ref: 'v0.9.0',
        baseSha: 'aaaaaaa',
        headSha: 'bbbbbbb',
        repoRoot: '/repo',
        baseDir: '/base/v0.9.0',
        headSchedule: comparisonFixtureSchedule(2),
        baseSchedule: comparisonFixtureSchedule(2).slice(0, -4),
      }),
    });
    const text = out.lines.join('\n');
    expect(text).toContain('Compare:   v0.9.0 (aaaaaaa) vs HEAD (bbbbbbb)');
    expect(text).toContain('ios27-sim-iphone17 - both sides, one session');
    expect(text).toContain('base/head');
    expect(text).toContain('compared');
    // The cell the base ref cannot measure is named, not silently dropped.
    expect(text).toContain('head-only');
    expect(out.exitCode).toBe(0);
  });

  it('turns a comparison that cannot be planned into a refusal', () => {
    const out = dryRunReport({
      ...base,
      argv: ['--platform', 'ios', '--compare-release', '--dry-run'],
      comparison: planComparison({
        platform: 'ios',
        plan: 'quick',
        launches: 2,
        ref: 'v0.9.0',
        // One commit under two labels of different length: only its whole id says so.
        baseSha: 'b7e98c6',
        headSha: 'b7e98c6e',
        baseCommit: 'b7e98c6e2f4a6c8e0b1d3f5a7c9e1b3d5f7a9c1e',
        headCommit: 'b7e98c6e2f4a6c8e0b1d3f5a7c9e1b3d5f7a9c1e',
        repoRoot: '/repo',
        baseDir: '/base/v0.9.0',
        headSchedule: comparisonFixtureSchedule(2),
        baseSchedule: comparisonFixtureSchedule(2),
      }),
    });
    expect(out.exitCode).toBe(2);
    expect(out.problems.join('\n')).toContain('measures nothing');
  });

  it('lists no reasons when everything resolves', () => {
    expect(dryRunReport(base).problems).toEqual([]);
  });

  it('puts every answer in the same column', () => {
    // A reader scans one column to compare plan to plan, so a row is only as good as
    // its padding: a longer label (`Compare:`, `Dry run:`) that slips past the column
    // is the bug. The rows under `Compare:` are indented one level and share their own
    // column, which is why they are measured separately.
    const comparison = dryRunReport({
      ...base,
      argv: ['--platform', 'ios', '--compare-release', 'v0.9.0', '--dry-run'],
      comparison: planComparison({
        platform: 'ios',
        plan: 'quick',
        launches: 2,
        ref: 'v0.9.0',
        baseSha: 'aaaaaaa',
        headSha: 'bbbbbbb',
        repoRoot: '/repo',
        baseDir: '/base/v0.9.0',
        headSchedule: comparisonFixtureSchedule(2),
        baseSchedule: comparisonFixtureSchedule(2),
      }),
    });

    for (const { lines } of [dryRunReport(base), comparison]) {
      for (const line of lines) {
        // Continuation rows (`note:` under `Host:`) are deliberately indented.
        if (/^\s/.test(line)) continue;
        const colon = line.indexOf(':');
        expect(colon).toBeGreaterThan(0);
        // Label within 9 columns, then at least two spaces out to the shared column.
        expect(colon + 1).toBeLessThanOrEqual(9);
        expect(/^ {2}/.test(line.slice(colon + 1))).toBe(true);
      }

      const at = lines.findIndex((line) => line.startsWith('Compare:'));
      if (at === -1) continue;
      for (const line of lines.slice(at + 1)) {
        if (!line.startsWith('  ')) continue;
        expect(line[2]).not.toBe(' '); // a label starts one level in,
        expect(line[10]).toBe(' '); // and its value starts
        expect(line[11]).not.toBe(' '); // in the column, at one width.
      }
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

  /**
   * A git command inside a throwaway fixture repository, isolated from the machine's
   * git config the same way `gate-logs.test.js` isolates its repositories: someone who
   * signs commits globally must not make this fixture fail for an unrelated reason.
   */
  function fixtureGit(root, ...args) {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_SYSTEM: '/dev/null',
        GIT_AUTHOR_NAME: 'nitro-ui',
        GIT_AUTHOR_EMAIL: 'bench@example.invalid',
        GIT_COMMITTER_NAME: 'nitro-ui',
        GIT_COMMITTER_EMAIL: 'bench@example.invalid',
        GIT_AUTHOR_DATE: '2026-11-15T12:00:00Z',
        GIT_COMMITTER_DATE: '2026-11-15T12:00:00Z',
      },
    });
  }

  /** `scripts/` on its own, so the child's repo root is the throwaway tree. */
  function workspace(options = {}) {
    const root = mkdtempSync(path.join(realpathSync(tmpdir()), 'bench-dry-'));
    copyScripts(
      path.join(process.cwd(), 'scripts'),
      path.join(root, 'scripts')
    );
    const tag = options.tag ?? options.tagAtHead;
    if (tag != null) {
      // A git repository with a release tag, so `--compare-release` has something real
      // to resolve and extract: the plan it prints is read out of that tag's own
      // `lib.mjs`, which is the whole design of the comparison. `tag` is *older* than
      // HEAD — the extra commit is the candidate — while `tagAtHead` leaves the tag on
      // the only commit, which is the shape of a comparison against itself.
      fixtureGit(root, 'init', '--quiet');
      fixtureGit(root, 'add', '-A');
      fixtureGit(root, 'commit', '--quiet', '-m', 'bench fixture');
      // A fresh repository abbreviates to 7 characters, which is also the length a
      // hand-written slice would pick; 12 is what neither picks by accident.
      fixtureGit(root, 'config', 'core.abbrev', '12');
      if (options.annotated === true) {
        fixtureGit(root, 'tag', '-a', tag, '-m', `release ${tag}`);
      } else {
        fixtureGit(root, 'tag', tag);
      }
      if (options.tag != null) {
        writeFileSync(path.join(root, 'candidate.txt'), 'under review\n');
        fixtureGit(root, 'add', '-A');
        fixtureGit(root, 'commit', '--quiet', '-m', 'candidate');
      }
    }
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
        timeout: 180_000,
        // `childEnv` (X34 item 1): the blanks below are the suite's answer to "which device", and
        // they only mean that if no lease arrives underneath them. `bench/run.mjs` reads a device
        // identity out of the environment, so a *half*-blanked lease — the shell's
        // `EMULATOR_PORT` under a blanked `ANDROID_SERIAL` — is the X32/X33 refusal again.
        env: childEnv({
          // Blank every device variable: inherited from a leased shell, an
          // `IOS_SIM_UDID` here would name a real simulator, and a dry run that
          // wrongly resolved one would boot it.
          IOS_SIM_UDID: '',
          ANDROID_SERIAL: '',
          ANDROID_AVD: '',
          AVD: '',
          // The base checkout is a cache: point it at the throwaway tree so a test
          // can never write into the developer's real one.
          NITRO_UI_BENCH_BASE_DIR: path.join(root, 'bench-base'),
          ...env,
        }),
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
      expect(out.all).toContain('quiet under');
      expect(out.all).toContain('reason(s) not to start');
    }
  });

  it('prints the whole comparison for --compare-release, from the tag itself', () => {
    const root = workspace({ tag: 'v9.9.0' });
    const out = cli(root, [
      '--platform',
      'ios',
      '--plan',
      'quick',
      '--launches',
      '2',
      '--compare-release',
      '--dry-run',
    ]);
    // The ref is resolved and its plan read (no device, no install, no build), and the
    // only reason left is the one this environment cannot answer: no simulator.
    expect(out.all).toContain('Compare:   v9.9.0');
    expect(out.all).toContain('vs HEAD');
    expect(out.all).toContain('rounds:  2, order base/head head/base');
    expect(out.all).toContain('compared,');
    expect(out.all).toContain('IOS_SIM_UDID is not set');
    expect(out.all).not.toContain('No iOS simulator');
    expect(out.all).not.toContain('bun install');
    expect(out.status).toBe(2);
  });

  it('says which release tag it picked, and refuses when there is none', () => {
    const tagged = workspace({ tag: 'v9.9.0' });
    const bare = cli(tagged, [
      '--platform',
      'ios',
      '--plan',
      'quick',
      '--launches',
      '1',
      '--compare-release',
      '--dry-run',
    ]);
    expect(bare.all).toContain('Compare:   v9.9.0');

    const untagged = workspace();
    const none = cli(untagged, [
      '--platform',
      'ios',
      '--plan',
      'quick',
      '--launches',
      '1',
      '--compare-release',
      '--dry-run',
    ]);
    expect(none.status).toBe(2);
    expect(none.all).toContain('no release tag');
    expect(none.all).toContain('--compare-release <ref>');
  });

  it('refuses a comparison that would measure a tree against itself', () => {
    // The tag is the commit we are standing on: every ratio would be 1.00, and a gate
    // that cannot fail is worse than no gate (T02 review B1).
    // Twice: a plain tag, and an annotated one, which is an object of its own with an
    // id that is not the commit's.
    for (const annotated of [false, true]) {
      const root = workspace({ tagAtHead: 'v9.9.1', annotated });
      const out = cli(root, [
        '--platform',
        'ios',
        '--plan',
        'quick',
        '--launches',
        '1',
        '--compare-release',
        'v9.9.1',
        '--dry-run',
      ]);
      expect(out.status).toBe(2);
      expect(out.all).toContain('measures nothing');
      expect(out.all).not.toContain('rounds:');
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

  it('refuses a flag the bench no longer has, and names its replacement', () => {
    // An unknown flag is otherwise ignored, and these three were ignored into a green:
    // `bun bench --check` would run a plain bench, print a plain report, and exit 0 on
    // someone believing a committed baseline had been consulted.
    const root = workspace();
    for (const [flag, replacement] of [
      ['--check', '--compare-release'],
      ['--update-baseline', 'bench/results'],
      ['--force', 'reported'],
    ]) {
      const out = cli(root, ['--platform', 'ios', flag, '--dry-run']);
      expect(out.status).toBe(2);
      expect(out.all).toContain(`${flag} no longer exists`);
      expect(out.all).toContain(replacement);
      expect(out.all).not.toContain('Platform:  ios');
    }
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
