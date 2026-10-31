/**
 * What `example/rn-harness.config.mjs` decides before it touches a device.
 *
 * The config file is where the `app.stamp` gate lives, and it is also a file with
 * a simulator, an emulator and a Metro port behind it - so the decisions are
 * `selectHarnessApp` in `scripts/app-stamp-core.mjs`, and this is where they are
 * exercised. All three came out of a red CI job or a lost afternoon:
 *
 *   - `Harness (Android)` refused with a *iOS* message (run 40382254368), because
 *     the action's `load-config` step imports the config with no runner on its
 *     command line and the config guessed iOS;
 *   - a relative `HARNESS_APP_PATH` named a file that does not exist from
 *     `example/`, and the run died as an opaque `AbortError` (A2, three runs);
 *   - a refusal in a config read by a *cache-planning* step would replace the
 *     harness's own test report with a config error.
 *
 * The cases hand the function a fake `existsSync` and a fake command line, so a
 * run needs no device, no app and no `.harness` directory.
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';

import {
  HARNESS_CI_SUBCOMMANDS,
  selectHarnessApp,
} from '../app-stamp-core.mjs';

const IOS_APP =
  '/repo/example/ios/build/Build/Products/Debug-iphonesimulator/NitroUiExample.app';
const APK = '/repo/example/android/app/build/outputs/apk/debug/app-debug.apk';

/** The fixed products, keyed the way the config asks for them. */
const ARTIFACTS = { ios: IOS_APP, android: APK };

/**
 * The files a case pretends exist, plus an absolute-path lookup helper.
 *
 * @param {string[]} existing
 * @returns {(file: string) => boolean}
 */
function fakeFs(existing) {
  const set = new Set(existing);
  return (file) => set.has(file);
}

/** `bun run harness:<platform>`, as `example/package.json` spells it. */
const CLI = '/repo/node_modules/react-native-harness/bin.js';
const localRun = (platform) => [
  process.execPath,
  CLI,
  '--harnessRunner',
  platform,
];

describe('which platform a harness config read is for', () => {
  it('takes it from the command line for a local run', () => {
    for (const platform of ['ios', 'android']) {
      expect(
        selectHarnessApp({
          argv: localRun(platform),
          env: {},
          existsSync: fakeFs([]),
          cwd: '/repo/example',
          parentDir: '/repo',
          artifactFor: (p) => ARTIFACTS[p],
        }).runner
      ).toBe(platform);
    }
  });

  it.each(['INPUT_RUNNER', 'HARNESS_RUNNER'])(
    'reads %s when argv does not name a runner',
    (key) => {
      // `harness ci load-config` names no runner, so the action hands the answer
      // over as INPUT_RUNNER; `Run E2E tests` exports the same fact as
      // HARNESS_RUNNER. Both are step environment of the pinned action, and
      // reading them is what stopped `Harness (Android)` from refusing over a
      // missing iOS .app.
      expect(
        selectHarnessApp({
          argv: [process.execPath, CLI, 'ci', 'load-config'],
          env: { [key]: 'android' },
          existsSync: fakeFs([APK]),
          cwd: '/repo/example',
          parentDir: '/repo',
          artifactFor: (p) => ARTIFACTS[p],
        })
      ).toEqual({ runner: 'android', artifact: APK, ciStep: true });
    }
  );

  it('does not let the environment override what was typed', () => {
    // A leftover HARNESS_RUNNER=ios in a shell must not send an explicitly-Android
    // run looking for the iOS app.
    const decided = selectHarnessApp({
      argv: localRun('android'),
      env: { HARNESS_RUNNER: 'ios' },
      existsSync: fakeFs([APK]),
      cwd: '/repo/example',
      parentDir: '/repo',
      artifactFor: (p) => ARTIFACTS[p],
    });
    expect(decided.runner).toBe('android');
    expect(decided.artifact).toBe(APK);
  });

  it('falls back to ios with nothing to go on, as it always has', () => {
    expect(
      selectHarnessApp({
        argv: [process.execPath, CLI],
        env: {},
        existsSync: fakeFs([]),
        cwd: '/repo/example',
        parentDir: '/repo',
        artifactFor: (p) => ARTIFACTS[p],
      })
    ).toEqual({ runner: 'ios', artifact: null, ciStep: false });
  });

  it('an environment value that is not a platform is not a runner', () => {
    // `INPUT_RUNNER` is also set by other actions' inputs; a stray value has to
    // fall through rather than become a platform.
    const decided = selectHarnessApp({
      argv: [process.execPath, CLI],
      env: { INPUT_RUNNER: 'windows', HARNESS_RUNNER: '' },
      existsSync: fakeFs([]),
      cwd: '/repo/example',
      parentDir: '/repo',
      artifactFor: (p) => ARTIFACTS[p],
    });
    expect(decided.runner).toBe('ios');
  });
});

describe('a config read by a cache-planning step is not a device run', () => {
  const decidedFor = (subcommand) =>
    selectHarnessApp({
      argv: [process.execPath, CLI, 'ci', subcommand],
      // An artifact that exists and would be refused if this were a test run.
      env: { HARNESS_APP_PATH: '/tmp/someone-elses.app' },
      existsSync: fakeFs(['/tmp/someone-elses.app']),
      cwd: '/repo/example',
      parentDir: '/repo',
      artifactFor: (p) => ARTIFACTS[p],
    });

  it.each(HARNESS_CI_SUBCOMMANDS)(
    'harness ci %s gates nothing',
    (subcommand) => {
      expect(decidedFor(subcommand).ciStep).toBe(true);
    }
  );

  it('a test run with no runner flag still gates', () => {
    // The other direction: `bun run harness` with no `--harnessRunner` is a
    // device run, and must not be excused by the ci-step rule.
    expect(
      selectHarnessApp({
        argv: [process.execPath, CLI, 'Switch.harness.tsx'],
        env: {},
        existsSync: fakeFs([IOS_APP]),
        cwd: '/repo/example',
        parentDir: '/repo',
        artifactFor: (p) => ARTIFACTS[p],
      })
    ).toEqual({ runner: 'ios', artifact: IOS_APP, ciStep: false });
  });

  it('the list of ci subcommands still matches the installed CLI', () => {
    // This list is the only reason a `ci` read is excused. If the CLI grows a
    // fifth one, or renames the array, an excused step could be a real device run
    // - so the copy is compared with the file the action actually execs.
    const cliIndex = path.join(
      process.cwd(),
      'node_modules',
      '@react-native-harness',
      'cli',
      'dist',
      'index.js'
    );
    const source = fs.readFileSync(cliIndex, 'utf8');
    const declared = /const CI_SUBCOMMANDS = \[([\s\S]*?)\];/.exec(source);
    expect(declared).not.toBeNull();
    const upstream = declared[1]
      .split(',')
      .map((entry) => entry.trim().replace(/^'|'$/g, ''))
      .filter((entry) => entry !== '');
    expect([...HARNESS_CI_SUBCOMMANDS].sort()).toEqual(upstream.sort());
  });
});

describe('an explicit HARNESS_APP_PATH becomes a path the CLI can use', () => {
  const withPath = (explicit, existing, options = {}) =>
    selectHarnessApp({
      argv: localRun(options.platform ?? 'android'),
      env: { HARNESS_APP_PATH: explicit },
      existsSync: fakeFs(existing),
      cwd: '/repo/example',
      parentDir: '/repo',
      artifactFor: (p) => ARTIFACTS[p],
    });

  it('resolves a path relative to the project root, which is where the CLI looks', () => {
    // `react-native-harness` never rebases HARNESS_APP_PATH: platform-android and
    // platform-apple both do `fs.existsSync(process.env.HARNESS_APP_PATH)`, from
    // `projectRoot`. So this is the only place a relative path can be fixed.
    expect(
      withPath('android/app/build/outputs/apk/debug/app-debug.apk', [APK])
        .artifact
    ).toBe(APK);
  });

  it('understands a path written from the repository root, as CI and the reports write it', () => {
    expect(
      withPath(
        'example/ios/build/Build/Products/Debug-iphonesimulator/NitroUiExample.app',
        [IOS_APP],
        { platform: 'ios' }
      ).artifact
    ).toBe(IOS_APP);
  });

  it('keeps an absolute path exactly as given', () => {
    expect(
      withPath('/somewhere/app-debug.apk', ['/somewhere/app-debug.apk'])
    ).toEqual({
      runner: 'android',
      artifact: '/somewhere/app-debug.apk',
      ciStep: false,
    });
  });

  it('leaves an unresolvable path pointing at the project root, so the CLI names it', () => {
    // The point is that the refusal is the harness's own "missing APK" message
    // with a path in it, not a config error and not a silent success against
    // whatever the device already has.
    expect(withPath('build/whatever.apk', []).artifact).toBe(
      '/repo/example/build/whatever.apk'
    );
  });

  it('a path with a trailing slash still names the same artifact', () => {
    expect(withPath(`${APK}/`, [APK]).artifact).toBe(APK);
  });

  it('an explicit path is preferred over the one this worktree built', () => {
    const explicit = '/other/worktree/app-debug.apk';
    expect(withPath(explicit, [APK, explicit]).artifact).toBe(explicit);
  });

  it('with no explicit path, the fixed product of this worktree is used when it exists', () => {
    expect(withPath('', [APK]).artifact).toBe(APK);
    expect(withPath('', []).artifact).toBe(null);
  });
});
