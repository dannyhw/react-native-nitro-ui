/**
 * The emulator launch configuration has one source, and the accel check tells
 * the truth. Both are claims about a file in `node_modules`, which is exactly the
 * kind of claim that rots.
 *
 * Two things are tested, because they fail differently:
 *
 *   1. **The patch contains what this module renders.** The patch embeds the
 *      launch-args block and the accel parser verbatim, so the drift test reads
 *      the patch and requires each rendered block inside it, plus the three
 *      call-site lines, plus that upstream's old call is gone. Hand-edit the
 *      patch, or edit `scripts/emulator-launch.mjs` without regenerating it, and
 *      this goes red.
 *   2. **The installed module agrees with it.** Reading the patch alone would
 *      still pass when `bun install` has not run since it changed - which is the
 *      state a task actually works in - so the same blocks are required inside
 *      `node_modules/@react-native-harness/platform-android/dist/emulator-startup.js`,
 *      and that file's two functions are *executed* and compared against
 *      `emulatorLaunchArgs` / `accelerationUsable` over the same fixtures.
 *      Skipped, loudly, when the package is not installed.
 *
 * The accel fixtures are captured real outputs, including the "unusable" form
 * this machine cannot produce on its own, so the false-warning fix is proved
 * against both answers rather than the one the maintainer happens to have.
 */

import { describe, expect, it } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ACCELERATION_UNUSABLE_PHRASES,
  ACCELERATION_USABLE_PHRASES,
  EMULATOR_GPU_ENV,
  HARNESS_ACCEL_CALLER_BEFORE,
  HARNESS_GPU_MODE,
  SOFTWARE_GPU_MODE,
  accelerationUsable,
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

/**
 * The `+` lines of a patch, re-joined: the text the patched file has now.
 *
 * Compared against the rendered blocks rather than the whole patch, because the
 * patch's own `+`/`-` prefixes and hunk headers are patch-package's business and
 * re-flow when an unrelated line moves.
 */
function addedTextFrom(patchText) {
  return patchText
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
    .join('\n');
}

/**
 * The installed module's two functions, executable.
 *
 * Not `import()`: jest leaves `node_modules` untransformed (that is what
 * `transformIgnorePatterns` is for), and this file is ESM with bare-specifier
 * imports, so a dynamic import would fail for reasons that have nothing to do
 * with what is being tested. Dropping the three `import` lines and the `export`
 * keywords leaves a body that only *uses* those imports inside functions this
 * test never calls, so the two functions under test can be evaluated directly -
 * and they are the real installed code, not a copy of it.
 *
 * @returns {{getEmulatorStartupArgs: Function, isAccelerationUsable: Function}}
 */
function loadInstalledModule() {
  const source = readFileSync(INSTALLED, 'utf8')
    .split('\n')
    .filter((line) => !/^import\s/.test(line))
    .join('\n')
    .replaceAll('export const', 'const')
    .replaceAll('export {', '// export {');
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
    process,
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

  it('boots on host GPU rendering, not the software default', () => {
    expect(HARNESS_GPU_MODE).toBe('host');
    expect(SOFTWARE_GPU_MODE).toBe('swiftshader_indirect');
    expect(emulatorLaunchArgs({ avd: 'nitroui_a' })).toContain('host');
  });

  it('names the port, snapshot and gpu args in one argv', () => {
    expect(emulatorLaunchArgs({ avd: 'nitroui_a', port: 5574 })).toEqual([
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

  it('drops a port the emulator could not take rather than booting anywhere', () => {
    // An odd port is not a console port, and both arrive as strings from a shell.
    // Booting on "whatever is free" is the failure `-port` exists to prevent.
    for (const port of [5575, '5575', 5000, 6000, '', null, undefined]) {
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
    // Upstream's one-argument call is the bug: it cannot see the exit status.
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
    // Loud in the test name rather than a silent pass: a skip nobody notices is
    // how a guard becomes decoration.
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

  maybe('boots a leased AVD on the port and GPU this repo names', () => {
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
        ['5575', 'default-boot'],
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
      // And the override reaches it - the one axis the A/B measurement moves.
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
    // The regression: upstream's phrase test returned false for exactly this, so
    // every run warned about software emulation while using Hypervisor.Framework.
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
    // A check that exits 1 has said no; the text is only its reason.
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
    // The captured unusable output contains "usable" inside "not usable"; a
    // success-first match would call it accelerated - the bug's exact shape.
    expect(ACCEL_UNUSABLE_CAPTURED.toLowerCase()).toContain('usable');
    expect(accelerationUsable({ output: ACCEL_UNUSABLE_CAPTURED })).toBe(false);
  });
});
