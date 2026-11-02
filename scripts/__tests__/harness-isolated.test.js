// The isolated harness suites' run (G14): when a `harness:<platform>` gate adds a second
// app instance for `example/__tests__/isolated/`, and how its exit code joins the
// shared run's.
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  ISOLATED_ENV,
  combinedExitCode,
  isFullPlatformRun,
  wantsIsolatedRun,
} from '../harness-isolated.mjs';

const repoRoot = resolve(process.cwd());
const files = ['BottomSheetModalHazard.harness.tsx'];

describe('the isolated harness run', () => {
  it('follows a full platform run, and only that', () => {
    expect(isFullPlatformRun(['--harnessRunner', 'ios'])).toBe(true);
    expect(isFullPlatformRun(['--harnessRunner', 'android'])).toBe(true);
    expect(isFullPlatformRun(['--harnessRunner', 'ios', 'Switch'])).toBe(false);
    expect(
      isFullPlatformRun(['--harnessRunner', 'android', 'ColdSizing'])
    ).toBe(false);
    expect(isFullPlatformRun([])).toBe(false);
    expect(
      wantsIsolatedRun({
        args: ['--harnessRunner', 'ios'],
        env: {},
        isolatedFiles: files,
      })
    ).toBe(true);
    expect(
      wantsIsolatedRun({
        args: ['--harnessRunner', 'ios', 'Dialog'],
        env: {},
        isolatedFiles: files,
      })
    ).toBe(false);
  });

  it('is not added when there is nothing isolated, or when this already is the isolated run', () => {
    expect(
      wantsIsolatedRun({
        args: ['--harnessRunner', 'ios'],
        env: {},
        isolatedFiles: [],
      })
    ).toBe(false);
    expect(
      wantsIsolatedRun({
        args: ['--harnessRunner', 'ios'],
        env: { [ISOLATED_ENV]: '1' },
        isolatedFiles: files,
      })
    ).toBe(false);
  });

  it('turns a green shared run red when an isolated file fails, and never hides a shared failure', () => {
    expect(combinedExitCode(0, null)).toBe(0);
    expect(combinedExitCode(0, 0)).toBe(0);
    expect(combinedExitCode(0, 1)).toBe(1);
    expect(combinedExitCode(1, 0)).toBe(1);
    expect(combinedExitCode(2, 1)).toBe(2);
  });

  it('agrees with the Jest config on the variable and the directory', () => {
    const config = readFileSync(
      join(repoRoot, 'example/jest.harness.config.mjs'),
      'utf8'
    );
    expect(config).toContain(`process.env.${ISOLATED_ENV} === '1'`);
    expect(config).toContain('/__tests__/isolated/');
  });
});
