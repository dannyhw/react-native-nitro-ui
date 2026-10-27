/**
 * What `scripts/doctor.mjs` judges a machine by, without a machine.
 *
 * The CLI only gathers tool output; these are the rules applied to it: which
 * tool versions are usable, which simulator runtime is picked, whether a
 * `devices.json` points at devices that exist, and that `--setup` writes a pool
 * `scripts/lease.mjs` accepts.
 */

import { describe, expect, it } from '@jest/globals';

import {
  DEFAULT_PAIRS,
  applyAvdConfig,
  bunStatus,
  cocoapodsProblem,
  compareVersions,
  deviceTypeId,
  supportedIphones,
  devicesConfigProblems,
  exitCode,
  parseAvdList,
  parseVersion,
  pickIosRuntime,
  renderDevicesConfig,
  simulatorsByUdid,
  simulatorsByUdidWithState,
  emulatorsFromAdbDevices,
  unownedBootedDevices,
  unownedCheckProblem,
  coldCacheWarning,
  mainCheckoutPath,
  primeCommands,
} from '../doctor-core.mjs';
import { normalizeDevices } from '../lease-core.mjs';

describe('versions', () => {
  it('reads the first dotted version in tool output', () => {
    expect(parseVersion('Xcode 27.0\nBuild version 27A266a')).toEqual([
      27, 0, 0,
    ]);
    expect(parseVersion('opencode v2.1.4')).toEqual([2, 1, 4]);
    expect(parseVersion('')).toBeNull();
    expect(parseVersion(null)).toBeNull();
  });

  it('compares like a sort comparator', () => {
    expect(compareVersions([1, 15, 2], [1, 15, 0])).toBeGreaterThan(0);
    expect(compareVersions([1, 13], [1, 13, 0])).toBe(0);
    expect(compareVersions([1, 9, 9], [1, 13, 0])).toBeLessThan(0);
  });

  it('applies example/Gemfile to CocoaPods', () => {
    expect(cocoapodsProblem('1.17.0')).toBeNull();
    expect(cocoapodsProblem('1.15.2')).toBeNull();
    expect(cocoapodsProblem('1.15.1')).toMatch(/excluded/);
    expect(cocoapodsProblem('1.15.0')).toMatch(/excluded/);
    expect(cocoapodsProblem('1.12.1')).toMatch(/older/);
    expect(cocoapodsProblem(null)).toBe('not installed');
  });

  it('accepts another bun patch, warns on another minor, fails on none', () => {
    expect(bunStatus('1.4.0', '1.4.2')).toBe('ok');
    expect(bunStatus('1.4.0', '1.5.0')).toBe('warn');
    expect(bunStatus('1.4.0', null)).toBe('fail');
  });
});

describe('simulators', () => {
  const runtimes = {
    runtimes: [
      {
        identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-4',
        version: '26.4',
        isAvailable: true,
      },
      {
        identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-27-0',
        version: '27.0',
        isAvailable: true,
      },
      {
        identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-27-1',
        version: '27.1',
        isAvailable: false,
      },
      {
        identifier: 'com.apple.CoreSimulator.SimRuntime.watchOS-27-0',
        version: '27.0',
        isAvailable: true,
      },
    ],
  };

  it('picks the pinned runtime, not the newest one', () => {
    expect(pickIosRuntime(runtimes, '27.0')?.identifier).toBe(
      'com.apple.CoreSimulator.SimRuntime.iOS-27-0'
    );
    // 27.1 is installed but unavailable here; it is never picked for 27.0 anyway.
    expect(pickIosRuntime(runtimes, '27.1')).toBeNull();
    expect(pickIosRuntime(runtimes, '28.0')).toBeNull();
  });

  it('finds device types by exact name', () => {
    const types = {
      devicetypes: [
        {
          name: 'iPhone 17',
          identifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17',
        },
        {
          name: 'iPhone 17 Pro',
          identifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro',
        },
      ],
    };
    expect(deviceTypeId(types, 'iPhone 17')).toBe(
      'com.apple.CoreSimulator.SimDeviceType.iPhone-17'
    );
    expect(deviceTypeId(types, 'iPhone Air')).toBeNull();
  });

  it("prefers the runtime's own supported types over the global list", () => {
    const types = {
      devicetypes: [{ name: 'iPhone 17', identifier: 'from-another-xcode' }],
    };
    const runtime = {
      supportedDeviceTypes: [
        {
          name: 'iPhone 17',
          identifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17',
        },
        { name: 'iPad Pro', identifier: 'ipad' },
      ],
    };
    expect(deviceTypeId(types, 'iPhone 17', runtime)).toBe(
      'com.apple.CoreSimulator.SimDeviceType.iPhone-17'
    );
    expect(deviceTypeId(types, 'iPhone Air', runtime)).toBeNull();
    expect(supportedIphones(runtime)).toEqual(['iPhone 17']);
  });

  it('indexes available simulators by UDID with their runtime', () => {
    const map = simulatorsByUdid({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [
          { udid: 'A', name: 'nitro-ui A', isAvailable: true },
          { udid: 'GONE', name: 'old', isAvailable: false },
        ],
      },
    });
    expect([...map.keys()]).toEqual(['A']);
    expect(map.get('A')?.runtime).toMatch(/iOS-27-0/);
  });

  it('ignores emulator log lines in the AVD list', () => {
    expect([
      ...parseAvdList('INFO    | Storing crashdata\nnitroui_a\n\nnitroui_b\n'),
    ]).toEqual(['nitroui_a', 'nitroui_b']);
  });
});

describe('devices.json', () => {
  const created = DEFAULT_PAIRS.map((pair, index) => ({
    ...pair,
    udid: `UDID-${index}`,
  }));
  const config = renderDevicesConfig(created, '27.0');
  const machine = {
    simulators: new Map(
      created.map((pair) => [
        pair.udid,
        {
          udid: pair.udid,
          name: pair.simulatorName,
          runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-27-0',
        },
      ])
    ),
    avds: new Set(created.map((pair) => pair.avd)),
    iosRuntimeMajor: 27,
  };

  it('writes a pool the lease script accepts', () => {
    expect(() => normalizeDevices(config)).not.toThrow();
    expect(config.reservedEmulatorPorts).toEqual([5560]);
    expect(devicesConfigProblems(config, machine)).toEqual([]);
  });

  it('names devices that do not exist on this machine', () => {
    const problems = devicesConfigProblems(config, {
      ...machine,
      avds: new Set(['nitroui_a']),
    });
    expect(problems).toEqual(['pair-b: AVD nitroui_b does not exist']);
    const noSims = devicesConfigProblems(config, {
      ...machine,
      simulators: new Map(),
    });
    expect(noSims).toHaveLength(2);
  });

  it('flags a simulator on the wrong iOS', () => {
    const old = new Map(machine.simulators);
    old.set('UDID-0', {
      udid: 'UDID-0',
      name: 'x',
      runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-26-4',
    });
    expect(
      devicesConfigProblems(config, { ...machine, simulators: old })
    ).toEqual(['pair-a: simulator UDID-0 is not on iOS 27']);
  });

  it('refuses the reserved port, odd ports and collisions', () => {
    const bad = JSON.parse(JSON.stringify(config));
    bad.pairs[0].android.emulatorPort = 5560;
    bad.pairs[1].android.emulatorPort = 5575;
    bad.pairs[1].metroPort = bad.pairs[0].metroPort;
    const problems = devicesConfigProblems(bad, machine);
    expect(problems).toEqual(
      expect.arrayContaining([
        'pair-a: emulator port 5560 is reserved',
        'pair-b: emulator port 5575 must be even',
        expect.stringMatching(
          /port 8295 used by both pair-a Metro and pair-b Metro/
        ),
      ])
    );
  });
});

describe('AVD config', () => {
  it('pins the benchmarked hardware and keeps everything else', () => {
    const out = applyAvdConfig(
      'hw.ramSize=1536M\nhw.lcd.density=420\nhw.cpu.ncore=2\n'
    );
    expect(out).toContain('hw.ramSize=2G\n');
    expect(out).toContain('hw.cpu.ncore=4\n');
    expect(out).toContain('hw.lcd.density=420\n');
    expect(out).toContain('vm.heapSize=228M\n');
    expect(out.match(/hw\.ramSize=/g)).toHaveLength(1);
  });
});

it('fails the run only on a failing result', () => {
  expect(exitCode([{ status: 'ok' }, { status: 'warn' }])).toBe(0);
  expect(exitCode([{ status: 'ok' }, { status: 'fail' }])).toBe(1);
});

/**
 * Who owns what is booted, and how warm the machine is (X9 items 6 and 3).
 *
 * Both features exist because a symptom was read as something else for days: harness
 * numbers moved and nobody could say why (an unleased simulator eating cores), and a
 * first build took 9.5 min because nothing on that machine had ever compiled this
 * code. A check that stays quiet in those states is worse than no check, so each
 * rule below has a case that says "and it must still say something".
 */
describe('unowned devices', () => {
  const pool = normalizeDevices(
    renderDevicesConfig(
      DEFAULT_PAIRS.map((pair, index) => ({ ...pair, udid: `UDID-${index}` })),
      '27.0'
    )
  );

  const sims = (states) =>
    new Map(
      Object.entries(states).map(([udid, state]) => [
        udid,
        { udid, name: `Sim ${udid}`, state },
      ])
    );

  const listing = (states) => ({
    devices: {
      'com.apple.CoreSimulator.SimRuntime.iOS-27-0': Object.entries(states).map(
        ([udid, state]) => ({ udid, name: `Sim ${udid}`, state })
      ),
    },
  });

  it('reads simulator state as well as identity', () => {
    const byUdid = simulatorsByUdidWithState(
      listing({ UDID_1: 'Booted', UDID_2: 'Shutdown' })
    );
    expect(byUdid.get('UDID_1').state).toBe('Booted');
    expect(byUdid.get('UDID_2').state).toBe('Shutdown');
    // An unavailable device is not one anybody can lease or leave running.
    const withGone = simulatorsByUdidWithState({
      devices: {
        runtime: [
          { udid: 'GONE', name: 'x', state: 'Booted', isAvailable: false },
          { udid: 'HERE', name: 'y', state: 'Shutdown' },
        ],
      },
    });
    expect([...withGone.keys()]).toEqual(['HERE']);
  });

  it('reports a booted pool simulator that no lease holds, and only that one', () => {
    const warnings = unownedBootedDevices({
      pool,
      simulators: sims({ 'UDID-0': 'Booted', 'UDID-1': 'Shutdown' }),
      emulators: [],
      leases: [],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('pair-a');
    expect(warnings[0]).toContain('UDID-0');
    expect(warnings[0]).toContain('no lease holds it');
  });

  it('stays quiet when a live lease holds it - a leased device is not a leak', () => {
    expect(
      unownedBootedDevices({
        pool,
        simulators: sims({ 'UDID-0': 'Booted', 'UDID-1': 'Booted' }),
        emulators: [],
        leases: [{ task: 'X9', holds: ['pair-a', 'pair-b'] }],
      })
    ).toEqual([]);
  });

  it('counts an exclusive lease as holding every pair', () => {
    expect(
      unownedBootedDevices({
        pool,
        simulators: sims({ 'UDID-0': 'Booted', 'UDID-1': 'Booted' }),
        emulators: [],
        leases: [
          { task: 'BENCH', holds: ['pair-a', 'pair-b'], exclusive: true },
        ],
      })
    ).toEqual([]);
  });

  it('names a running pool emulator, and ignores one that is not the pool', () => {
    const attached = [
      { serial: 'emulator-5574', state: 'device', avd: 'nitroui_a' },
      { serial: 'emulator-5588', state: 'device', avd: 'someone_elses_avd' },
    ];
    const warnings = unownedBootedDevices({
      pool,
      simulators: sims({}),
      emulators: attached,
      leases: [],
    });
    expect(warnings).toEqual([
      'pair-a: emulator emulator-5574 (AVD nitroui_a) is running and no lease holds it',
    ]);
  });

  it('never reports the reserved emulator, whoever booted it', () => {
    // The reserved serial has the *pool's* AVD behind it in a misconfigured file;
    // the port rule still has to win, because that device belongs to the human.
    const warnings = unownedBootedDevices({
      pool: {
        pairs: [{ id: 'pair-x', android: { avd: 'mine', emulatorPort: 5560 } }],
      },
      simulators: new Map(),
      emulators: [{ serial: 'emulator-5560', avd: 'mine' }],
      leases: [],
    });
    expect(warnings).toEqual([]);
  });

  it('maps an adb serial to its AVD through the pool, and leaves strangers unnamed', () => {
    const attached = emulatorsFromAdbDevices(
      [
        'List of devices attached',
        'emulator-5574\tdevice',
        'emulator-5570\toffline',
        'R5CT123ABC\tdevice',
        '',
      ].join('\n'),
      pool.pairs
    );
    expect(attached).toEqual([
      { serial: 'emulator-5574', state: 'device', avd: 'nitroui_a' },
      { serial: 'emulator-5570', state: 'offline', avd: 'nitroui_b' },
      { serial: 'R5CT123ABC', state: 'device', avd: null },
    ]);
  });

  it('says which tool is missing instead of a clean bill of health', () => {
    expect(unownedCheckProblem({ xcrunOk: true, adbOk: true })).toBeNull();
    expect(unownedCheckProblem({ xcrunOk: true, adbOk: false })).toBe(
      'cannot check for unowned devices without adb'
    );
    expect(unownedCheckProblem({ xcrunOk: false, adbOk: false })).toContain(
      'xcrun simctl and adb'
    );
  });
});

describe('cold build caches', () => {
  const stats = (hits, misses) =>
    `Cacheable calls:    ${hits + misses} / ${hits + misses} (100.0%)\n` +
    `  Hits:             ${hits} / ${hits + misses} (${(100 * hits) / (hits + misses)}.00%)\n` +
    `  Misses:           ${misses} / ${hits + misses} (100.0%)\n`;

  it('warns on a machine that has never compiled this code', () => {
    const cold = coldCacheWarning(stats(0, 1030));
    expect(cold.status).toBe('warn');
    expect(cold.detail).toContain('0 hits / 1030 misses');
    expect(cold.detail).toContain('cold');
    expect(cold.fix).toContain('doctor.mjs --prime');
  });

  it('accepts a warm machine, and does not need a perfect hit rate', () => {
    const warm = coldCacheWarning(stats(4200, 1800));
    expect(warm.status).toBe('ok');
    expect(warm.detail).toContain('4200 hits / 1800 misses');
    expect(warm.fix).toBeUndefined();
  });

  it('says "unknown" rather than guessing when ccache is not installed', () => {
    expect(coldCacheWarning(null).status).toBe('unknown');
    expect(coldCacheWarning('').status).toBe('unknown');
    expect(coldCacheWarning('ccache: unrecognized option').status).toBe(
      'unknown'
    );
  });
});

describe('where --prime must build', () => {
  it('is the worktree itself in the main checkout', () => {
    expect(
      mainCheckoutPath({
        toplevel: '/repos/nitro-ui',
        commonDir: '.git',
      })
    ).toBe('/repos/nitro-ui');
  });

  it('is the main checkout when called from a linked worktree', () => {
    // ccache and Gradle's cache are shared anyway; Xcode's derived data and the
    // pod install are not, so priming a throwaway worktree warms nothing durable.
    expect(
      mainCheckoutPath({
        toplevel: '/oss/nitro-ui-worktrees/X9',
        commonDir: '/oss/react-native-nitro-ui/.git',
      })
    ).toBe('/oss/react-native-nitro-ui');
  });

  it('gives up when git cannot answer, rather than building in the wrong place', () => {
    expect(mainCheckoutPath({ toplevel: null, commonDir: '.git' })).toBeNull();
  });

  it('lists the two builds a prime runs, through the build script', () => {
    // The claim under test is that `--prime` delegates: `build-app.mjs` is where the
    // stamp, the ccache launcher, the arch default and the machine-wide build slot
    // live, so a prime that invented its own command line would warm the caches while
    // skipping the slot the feature exists to protect.
    const commands = primeCommands('/Users/me/nitro-ui');
    expect(commands.map((command) => command.platform)).toEqual([
      'ios',
      'android',
    ]);
    for (const command of commands) {
      expect(command.file).toBe('scripts/build-app.mjs');
      expect(command.args).toEqual(['--platform', command.platform]);
      // The main checkout's own tree, not the worktree `--prime` was called from.
      expect(command.cwd).toBe('/Users/me/nitro-ui');
    }
  });
});
