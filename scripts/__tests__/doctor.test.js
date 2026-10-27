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

  it('picks the newest available iOS runtime of the major', () => {
    expect(pickIosRuntime(runtimes, 27)?.identifier).toBe(
      'com.apple.CoreSimulator.SimRuntime.iOS-27-0'
    );
    expect(pickIosRuntime(runtimes, 28)).toBeNull();
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
