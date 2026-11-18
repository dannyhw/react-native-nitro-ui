import { afterAll, describe, expect, it } from 'vitest';
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
    expect(out.deviceKey).toBe('ios27-sim-iphone17');
    expect(out.detail).toContain('nitro-ui B');
    expect(out.detail).toContain('Shutdown');
    expect(out.problem).toBeNull();
  });

  it('reads a stopped simulator as a valid answer, not a problem', () => {
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
  // API 33 and `pixel_7`, not the API 35 / pixel_9 this repo requires: a reader that
  // answered from the requirement instead of the file must not pass.
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
    // `image.sysdir.1` names the system image the AVD boots; the sidecar `.ini`'s
    // `target` is the fallback for a config that lacks it.
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
      deviceKey: null,
      detail: expect.stringContaining('profile unknown'),
      problem: expect.stringContaining('cannot be built from this AVD'),
    });
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
 * The numbers are not round multiples of anything the plan uses, so a comparison
 * that counted the wrong thing shows up.
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
    // The quiet threshold is half the core count.
    expect(text).toContain('quiet under 5.0');
    expect(text).toContain('cells x');
    expect(text).toContain('could start');
    expect(dryRunReport(base).exitCode).toBe(0);
  });

  it('reports a busy machine as a note, and still says a run could start', () => {
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
    // The cell the base ref cannot measure is named, not dropped.
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
    // The rows under `Compare:` are indented one level and share a column of their
    // own, so they are measured separately.
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
        // Continuation rows (`note:` under `Host:`) are indented.
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

// The CLI, run in a copy of `scripts/` with every device variable blanked. Device
// resolution throws "No iOS simulator" on an empty `IOS_SIM_UDID`, so that
// message's absence shows the flag never reached it.
describe('bench --dry-run (the CLI)', () => {
  const cleanup = [];

  /**
   * A git command inside a throwaway repository, isolated from the machine's git
   * config: a global commit-signing setting must not fail the fixture.
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
      // `tag` is older than HEAD (the extra commit below is the candidate), while
      // `tagAtHead` leaves the tag on the only commit: a comparison against itself.
      fixtureGit(root, 'init', '--quiet');
      fixtureGit(root, 'add', '-A');
      fixtureGit(root, 'commit', '--quiet', '-m', 'bench fixture');
      // Git's default abbreviation is 7 characters, which a hand-written slice
      // would also pick; 12 is a length neither picks by accident.
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
        // `childEnv` drops a lease inherited from the shell, so the blanks below are
        // the only device identity the child sees.
        env: childEnv({
          // Inherited from a leased shell, an `IOS_SIM_UDID` would name a real
          // simulator, and a dry run that wrongly resolved it would boot it.
          IOS_SIM_UDID: '',
          ANDROID_SERIAL: '',
          ANDROID_AVD: '',
          AVD: '',
          // The base checkout is a cache: keep it inside the throwaway tree so a
          // test never writes into the developer's real one.
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
    // The only reason left not to start is the missing simulator.
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
    // Shims on PATH record every `xcrun` and `adb` call the CLI makes.
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
        // The listing names the simulator, so a successful resolve is possible.
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
    // The simulator is Shutdown, so a dry run that resolved it as a run does would
    // have recorded a `boot`.
    const recorded = readFileSync(calls, 'utf8').trim().split('\n');
    expect(recorded).toEqual(['xcrun simctl list devices -j']);
    expect(out.all).toContain('Shutdown');

    // The AVD home is an empty directory, so the answer cannot depend on which AVDs
    // exist on the machine running the test.
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
