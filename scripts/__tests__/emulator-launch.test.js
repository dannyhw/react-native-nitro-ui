import { describe, expect, it } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ACCELERATION_UNUSABLE_PHRASES,
  ACCELERATION_USABLE_PHRASES,
  DISPLAY_SERVER_ENV_VARS,
  EMULATOR_GPU_ENV,
  HARNESS_ACCEL_CALLER_BEFORE,
  HARNESS_GPU_MODE,
  SOFTWARE_GPU_MODE,
  accelerationUsable,
  emulatorGpuModeForHost,
  emulatorLaunchArgs,
  harnessAccelBlock,
  harnessAccelCallerLines,
  harnessLaunchBlock,
} from '../emulator-launch.mjs';

const REPO_ROOT = join(__dirname, '..', '..');
const PATCH_FILE = join(
  REPO_ROOT,
  'patches',
  '@react-native-harness%2Fplatform-android@1.6.0.patch'
);
const INSTALLED = join(
  REPO_ROOT,
  'node_modules',
  '@react-native-harness',
  'platform-android',
  'dist',
  'emulator-startup.js'
);

/** The `+` lines of a patch, re-joined: the text the patched file has now. */
function addedTextFrom(patchText) {
  return patchText
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
    .join('\n');
}

/**
 * The installed module's two functions, evaluated from its source: jest leaves
 * `node_modules` untransformed, so the ESM file cannot be imported.
 *
 * @returns {{getEmulatorStartupArgs: Function, isAccelerationUsable: Function}}
 */
function loadInstalledModule(env = process.env, platform = process.platform) {
  const source = readFileSync(INSTALLED, 'utf8')
    .split('\n')
    .filter((line) => !/^import\s/.test(line))
    .join('\n')
    .replaceAll('export const', 'const')
    .replaceAll('export {', '// export {');
  // `process` is the caller's, so a test can ask what the patch does on another machine.
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'process',
    'getDeviceCoreBudget',
    'logger',
    'spawn',
    'SubprocessError',
    'os',
    'getEmulatorBinaryPath',
    `${source}\nreturn { getEmulatorStartupArgs, isAccelerationUsable };`
  );
  const noop = () => undefined;
  return factory(
    { env, platform },
    () => 4,
    { child: () => ({ debug: noop, warn: noop, info: noop }), warn: noop },
    async () => ({ stdout: '', stderr: '' }),
    class SubprocessError extends Error {},
    { availableParallelism: () => 10 },
    () => '/nonexistent/emulator'
  );
}

/** The emulator's own `emulator -accel-check` output on this machine. */
const ACCEL_USABLE_CAPTURED = `accel:
0
Hypervisor.Framework OS X Version 26.6
accel
`;

/** The form the same check takes when acceleration really is unavailable. */
const ACCEL_UNUSABLE_CAPTURED = `accel:
Some problems occurred. HAXM is not installed and hypervisor.framework is not usable
`;

describe('emulator launch args have one source', () => {
  const patch = readFileSync(PATCH_FILE, 'utf8');
  const added = addedTextFrom(patch);

  it('boots on host GPU rendering where the machine can host-render', () => {
    expect(HARNESS_GPU_MODE).toBe('host');
    expect(SOFTWARE_GPU_MODE).toBe('swiftshader_indirect');
    expect(
      emulatorLaunchArgs({
        avd: 'nitroui_a',
        host: { env: {}, platform: 'darwin' },
      })
    ).toContain(HARNESS_GPU_MODE);
    expect(
      emulatorLaunchArgs({
        avd: 'nitroui_a',
        host: { env: {}, platform: 'linux' },
      })
    ).toContain(SOFTWARE_GPU_MODE);
  });

  it('names the port, snapshot and gpu args in one argv', () => {
    expect(
      emulatorLaunchArgs({
        avd: 'nitroui_a',
        port: 5574,
        host: { env: {}, platform: 'darwin' },
      })
    ).toEqual([
      '@nitroui_a',
      '-port',
      '5574',
      '-no-snapshot-load',
      '-no-snapshot-save',
      '-no-window',
      '-gpu',
      'host',
      '-noaudio',
      '-no-boot-anim',
      '-no-metrics',
    ]);
    expect(
      emulatorLaunchArgs({
        avd: 'nitroui_a',
        port: 5574,
        host: { env: {}, platform: 'linux' },
      })
    ).toEqual([
      '@nitroui_a',
      '-port',
      '5574',
      '-no-snapshot-load',
      '-no-snapshot-save',
      '-no-window',
      '-gpu',
      'swiftshader_indirect',
      '-noaudio',
      '-no-boot-anim',
      '-no-metrics',
    ]);
  });

  it('honours the gpu override an A/B run or a bench host uses', () => {
    expect(
      emulatorLaunchArgs({ avd: 'a', gpuMode: SOFTWARE_GPU_MODE })
    ).toContain(SOFTWARE_GPU_MODE);
    const previous = process.env[EMULATOR_GPU_ENV];
    process.env[EMULATOR_GPU_ENV] = SOFTWARE_GPU_MODE;
    try {
      expect(emulatorLaunchArgs({ avd: 'a' })).toContain(SOFTWARE_GPU_MODE);
    } finally {
      if (previous == null) delete process.env[EMULATOR_GPU_ENV];
      else process.env[EMULATOR_GPU_ENV] = previous;
    }
  });

  it('refuses a port the emulator could not take, rather than booting anywhere', () => {
    for (const port of [5575, '5575', 5000, 6000, '5574x', -5574]) {
      expect(() => emulatorLaunchArgs({ avd: 'a', port })).toThrow(
        /not a console port/
      );
    }
    for (const port of [null, undefined, '']) {
      expect(emulatorLaunchArgs({ avd: 'a', port })).not.toContain('-port');
    }
    expect(emulatorLaunchArgs({ avd: 'a', port: '5574' })).toContain('-port');
  });

  it('puts the rendered launch block in the patch, verbatim', () => {
    expect(added).toContain(harnessLaunchBlock());
  });

  it('puts the rendered accel block and its call-site lines in the patch', () => {
    expect(added).toContain(harnessAccelBlock());
    for (const line of harnessAccelCallerLines()) expect(added).toContain(line);
    expect(added).not.toContain(HARNESS_ACCEL_CALLER_BEFORE);
  });

  it('interpolates the accel phrase lists rather than copying them', () => {
    const block = harnessAccelBlock();
    for (const phrase of [
      ...ACCELERATION_USABLE_PHRASES,
      ...ACCELERATION_UNUSABLE_PHRASES,
    ]) {
      expect(block).toContain(`'${phrase}'`);
    }
  });
});

describe('the installed harness module agrees with this file', () => {
  const installed = existsSync(INSTALLED);
  const maybe = installed ? it : it.skip;

  if (!installed) {
    it('SKIPPED: node_modules is not installed, so the installed module was not checked', () => {
      expect(installed).toBe(false);
    });
  }

  maybe('contains the same blocks the patch applies', () => {
    const source = readFileSync(INSTALLED, 'utf8');
    expect(source).toContain(harnessLaunchBlock());
    expect(source).toContain(harnessAccelBlock());
    expect(source).not.toContain(HARNESS_ACCEL_CALLER_BEFORE);
  });

  maybe('chooses the GPU mode by what the machine has, on both sides', () => {
    const fixtures = [
      [
        'GitHub hosted Linux runner (headless)',
        { platform: 'linux', env: {} },
        SOFTWARE_GPU_MODE,
      ],
      [
        'hosted Linux runner with the X server xvfb sets up',
        { platform: 'linux', env: { DISPLAY: ':99' } },
        HARNESS_GPU_MODE,
      ],
      [
        'hosted Linux runner on Wayland only',
        { platform: 'linux', env: { WAYLAND_DISPLAY: 'wayland-0' } },
        HARNESS_GPU_MODE,
      ],
      [
        'a Linux workstation with a display',
        {
          platform: 'linux',
          env: { DISPLAY: ':0', ANDROID_ADB_SERVER_PORT: '5043' },
        },
        HARNESS_GPU_MODE,
      ],
      [
        'this repo’s macOS gate host',
        { platform: 'darwin', env: {} },
        HARNESS_GPU_MODE,
      ],
      [
        'a headless macOS box, still host: Hypervisor.Framework and the Metal device are always there',
        { platform: 'darwin', env: { DISPLAY: '' } },
        HARNESS_GPU_MODE,
      ],
      [
        'the override wins on any machine, which is how an A/B run is possible',
        {
          platform: 'linux',
          env: { [EMULATOR_GPU_ENV]: SOFTWARE_GPU_MODE, DISPLAY: ':0' },
        },
        SOFTWARE_GPU_MODE,
      ],
      [
        'and the override can force host on a headless runner, to reproduce what CI saw',
        {
          platform: 'linux',
          env: { [EMULATOR_GPU_ENV]: HARNESS_GPU_MODE },
        },
        HARNESS_GPU_MODE,
      ],
    ];
    for (const [what, host, want] of fixtures) {
      const env = { EMULATOR_PORT: '5574', ...host.env };
      expect({
        machine: what,
        patched: loadInstalledModule(env, host.platform).getEmulatorStartupArgs(
          'nitroui_a',
          'default-boot'
        ),
      }).toEqual({
        machine: what,
        patched: emulatorLaunchArgs({
          avd: 'nitroui_a',
          port: '5574',
          gpuMode: want,
        }),
      });
      expect({
        machine: what,
        pooled: emulatorGpuModeForHost({ env, platform: host.platform }),
      }).toEqual({ machine: what, pooled: want });
    }
  });

  it('renders the GPU rule into the patch as an expression, not a copy', () => {
    const block = harnessLaunchBlock();
    expect(block).toContain(`'${HARNESS_GPU_MODE}'`);
    expect(block).toContain(`'${SOFTWARE_GPU_MODE}'`);
    for (const name of DISPLAY_SERVER_ENV_VARS) {
      expect(block).toContain(`'${name}'`);
    }
    // A constant fallback with no branch would ignore the machine.
    expect(block).not.toMatch(new RegExp(`\\|\\| '${HARNESS_GPU_MODE}'`));
  });

  it('names the headless case in the block that decides it', () => {
    expect(harnessLaunchBlock()).toContain('never finishes booting');
  });

  it('boots a leased AVD on the port and GPU this repo names', () => {
    const harness = loadInstalledModule();
    const previous = {
      port: process.env.EMULATOR_PORT,
      gpu: process.env[EMULATOR_GPU_ENV],
    };
    const modeToSnapshot = {
      'default-boot': 'cold',
      'snapshot-reuse': 'reuse',
      'clean-snapshot-generation': 'generate',
    };
    try {
      for (const [port, mode] of [
        ['5574', 'default-boot'],
        ['5574', 'snapshot-reuse'],
        ['5570', 'clean-snapshot-generation'],
        ['5560', 'default-boot'],
        ['', 'default-boot'],
      ]) {
        process.env.EMULATOR_PORT = port;
        delete process.env[EMULATOR_GPU_ENV];
        expect(harness.getEmulatorStartupArgs('nitroui_a', mode)).toEqual(
          emulatorLaunchArgs({
            avd: 'nitroui_a',
            port: port === '' ? null : port,
            snapshot: modeToSnapshot[mode],
          })
        );
      }
      for (const port of ['5575', '5000']) {
        process.env.EMULATOR_PORT = port;
        expect(() =>
          harness.getEmulatorStartupArgs('nitroui_a', 'default-boot')
        ).toThrow(/not a console port/);
        expect(() => emulatorLaunchArgs({ avd: 'nitroui_a', port })).toThrow(
          /not a console port/
        );
      }
      process.env.EMULATOR_PORT = '5574';
      process.env[EMULATOR_GPU_ENV] = SOFTWARE_GPU_MODE;
      expect(
        harness.getEmulatorStartupArgs('nitroui_a', 'default-boot')
      ).toEqual(
        emulatorLaunchArgs({
          avd: 'nitroui_a',
          port: '5574',
          gpuMode: SOFTWARE_GPU_MODE,
        })
      );
    } finally {
      for (const [name, value] of [
        ['EMULATOR_PORT', previous.port],
        [EMULATOR_GPU_ENV, previous.gpu],
      ]) {
        if (value == null) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  maybe('reads the acceleration check the same way', () => {
    const harness = loadInstalledModule();
    for (const [output, exitCode] of [
      [ACCEL_USABLE_CAPTURED, 0],
      [ACCEL_UNUSABLE_CAPTURED, 1],
      [ACCEL_USABLE_CAPTURED, null],
      [ACCEL_UNUSABLE_CAPTURED, null],
      ['', 0],
      ['', null],
      ['Hardware acceleration is installed and usable', 0],
    ]) {
      expect(harness.isAccelerationUsable(output, exitCode)).toBe(
        accelerationUsable({ output, exitCode })
      );
    }
  });
});

describe('accelerationUsable', () => {
  it('accepts this machine output, which upstream called unusable', () => {
    expect(ACCEL_USABLE_CAPTURED).not.toContain('is installed and usable');
    expect(accelerationUsable({ output: ACCEL_USABLE_CAPTURED })).toBe(true);
    expect(
      accelerationUsable({ output: ACCEL_USABLE_CAPTURED, exitCode: 0 })
    ).toBe(true);
  });

  it('rejects the unusable form, with or without the exit status', () => {
    expect(accelerationUsable({ output: ACCEL_UNUSABLE_CAPTURED })).toBe(false);
    expect(
      accelerationUsable({ output: ACCEL_UNUSABLE_CAPTURED, exitCode: 1 })
    ).toBe(false);
  });

  it('trusts a non-zero exit over confident-sounding output', () => {
    expect(
      accelerationUsable({
        output: 'Hardware acceleration (KVM) is installed and usable',
        exitCode: 1,
      })
    ).toBe(false);
  });

  it('trusts a zero exit over silence', () => {
    expect(accelerationUsable({ output: '', exitCode: 0 })).toBe(true);
  });

  it('needs a phrase when there is no exit status to go on', () => {
    expect(accelerationUsable({ output: 'no information at all' })).toBe(false);
    expect(
      accelerationUsable({ output: 'Hardware acceleration is not installed' })
    ).toBe(false);
    expect(accelerationUsable({ output: 'KVM is available' })).toBe(true);
  });

  it('reads a failure phrase before a success phrase', () => {
    // "not usable" contains "usable", so a success-first match would get this wrong.
    expect(ACCEL_UNUSABLE_CAPTURED.toLowerCase()).toContain('usable');
    expect(accelerationUsable({ output: ACCEL_UNUSABLE_CAPTURED })).toBe(false);
  });
});
