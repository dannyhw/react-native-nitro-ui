/**
 * The build-speed decisions (X6) - measured in docs/tasks/X6-build-speed.report.md,
 * decided here.
 *
 * Each of these guards exists because the opposite choice is a real failure
 * someone would have to find the hard way:
 *
 *   - a build that silently takes four times longer because it produced three
 *     ABIs no emulator on this machine can run;
 *   - a `--force`/`--clean` that a "it looks fresh" shortcut overrode, so the
 *     thing the user asked to be rebuilt is the one thing that stayed;
 *   - a ccache keyed on the worktree path, which would make every agent worktree
 *     start from nothing (and a ccache that a machine without it has to notice);
 *   - a gradle.properties edit that `expo prebuild --clean` throws away, which
 *     would make the bench app's speed settings last exactly one prebuild.
 */

import { describe, expect, it } from '@jest/globals';

import {
  ccacheEnv,
  ccacheEffectiveForWorktrees,
  ccacheRequested,
  decideSkipBuild,
  gradleArchArgs,
  gradleCcacheArgs,
  hostAbi,
  resolveAndroidAbis,
  withGradleProperties,
} from '../build-speed-lib.mjs';

describe('resolveAndroidAbis', () => {
  it('builds the ABI this machine runs, not all four', () => {
    expect(hostAbi('arm64')).toBe('arm64-v8a');
    expect(hostAbi('x64')).toBe('x86_64');
    expect(resolveAndroidAbis({ hostArch: 'arm64' })).toEqual({
      abis: 'arm64-v8a',
      source: 'host',
    });
    expect(resolveAndroidAbis({ hostArch: 'x64' }).abis).toBe('x86_64');
  });

  it('lets an environment variable cover a whole shell, and a flag win over it', () => {
    expect(
      resolveAndroidAbis({
        env: { NITRO_UI_ANDROID_ARCH: 'x86_64' },
        hostArch: 'arm64',
      })
    ).toEqual({ abis: 'x86_64', source: 'env' });
    expect(
      resolveAndroidAbis({
        flag: 'arm64-v8a',
        env: { NITRO_UI_ANDROID_ARCH: 'x86_64' },
        hostArch: 'arm64',
      })
    ).toEqual({ abis: 'arm64-v8a', source: 'flag' });
  });

  it('keeps a list when a run really wants two ABIs', () => {
    expect(
      resolveAndroidAbis({ flag: 'arm64-v8a, x86_64', hostArch: 'arm64' }).abis
    ).toBe('arm64-v8a,x86_64');
  });

  it('refuses an ABI that does not exist instead of configuring a broken build', () => {
    expect(() =>
      resolveAndroidAbis({ flag: 'armv6', hostArch: 'arm64' })
    ).toThrow(/not a list of Android ABIs/u);
  });
});

describe('gradleArchArgs', () => {
  it('is the property gradle actually reads', () => {
    expect(gradleArchArgs('arm64-v8a')).toEqual([
      '-PreactNativeArchitectures=arm64-v8a',
    ]);
  });
});

describe('ccache', () => {
  it('says nothing when the machine has no ccache', () => {
    // The no-op CI and other contributors get: no env, no init script, the same
    // build command as before this existed.
    expect(ccacheEnv({ enabled: false, repoRoot: '/r' })).toEqual({});
    expect(
      gradleCcacheArgs({ enabled: false, initScript: '/i.gradle' })
    ).toEqual([]);
    expect(gradleCcacheArgs({ enabled: true, initScript: undefined })).toEqual(
      []
    );
  });

  it('makes the cache belong to the source, not to the worktree', () => {
    expect(ccacheEnv({ enabled: true, repoRoot: '/w/X6' })).toEqual({
      CCACHE_BASEDIR: '/w/X6',
      // No underscore: CCACHE_HASH_DIR is not a variable ccache reads, and the
      // mistake is invisible in the timings it causes.
      CCACHE_NOHASHDIR: '1',
    });
    expect(
      gradleCcacheArgs({ enabled: true, initScript: '/i.gradle' })
    ).toEqual(['--init-script=/i.gradle']);
  });

  it('only believes the two settings ccache agrees to', () => {
    expect(
      ccacheEffectiveForWorktrees(
        [
          '(environment) base_dir = /w/X6',
          '(environment) hash_dir = false',
        ].join('\n')
      )
    ).toBe(true);
    // What the build looked like while CCACHE_HASH_DIR was spelled wrong.
    expect(
      ccacheEffectiveForWorktrees(
        ['(default) base_dir = ', '(default) hash_dir = true'].join('\n')
      )
    ).toBe(false);
    expect(ccacheEffectiveForWorktrees('(environment) hash_dir = false')).toBe(
      false
    );
  });

  it('obeys the documented escape hatch', () => {
    expect(ccacheRequested({})).toBe(true);
    expect(ccacheRequested({ NITRO_UI_CCACHE: '1' })).toBe(true);
    expect(ccacheRequested({ NITRO_UI_CCACHE: '0' })).toBe(false);
  });
});

describe('decideSkipBuild', () => {
  const fresh = { force: false, clean: false, noStamp: false, fresh: true };

  it('skips only the build that is genuinely already done', () => {
    expect(decideSkipBuild(fresh)).toEqual({
      skip: true,
      reason: 'app.stamp matches this tree',
    });
  });

  it('never overrides the caller asking for a build', () => {
    expect(decideSkipBuild({ ...fresh, force: true }).skip).toBe(false);
    expect(decideSkipBuild({ ...fresh, clean: true }).skip).toBe(false);
    expect(decideSkipBuild({ ...fresh, noStamp: true }).skip).toBe(false);
    expect(decideSkipBuild({ ...fresh, force: true }).reason).toBe('--force');
  });

  it('builds on any doubt, and says why', () => {
    expect(
      decideSkipBuild({
        force: false,
        clean: false,
        noStamp: false,
        fresh: false,
        freshReason: 'the app was built from a different code tree',
      })
    ).toEqual({
      skip: false,
      reason: 'the app was built from a different code tree',
    });
    expect(
      decideSkipBuild({
        force: false,
        clean: false,
        noStamp: false,
        fresh: false,
      }).reason
    ).toBe('no matching app.stamp');
  });
});

describe('withGradleProperties', () => {
  const wanted = {
    'org.gradle.caching': 'true',
    'org.gradle.configuration-cache': 'true',
  };

  it('adds what is missing to a generated file', () => {
    const { text, changed } = withGradleProperties(
      'org.gradle.jvmargs=-Xmx2g\nreactNativeArchitectures=arm64-v8a\n',
      wanted
    );
    expect(text).toContain('org.gradle.caching=true');
    expect(text).toContain('org.gradle.configuration-cache=true');
    expect(text).toContain('reactNativeArchitectures=arm64-v8a');
    expect(changed).toEqual(Object.keys(wanted));
  });

  it('sets a value that is there but off, including the commented-out form', () => {
    expect(
      withGradleProperties('org.gradle.caching=false\n', wanted).text
    ).toContain('org.gradle.caching=true');
    expect(
      withGradleProperties('# org.gradle.caching=false\nx=1', wanted).text
    ).toContain('org.gradle.caching=true');
  });

  it('is a no-op the second time, so it can run before every build', () => {
    const once = withGradleProperties('a=b\n', wanted).text;
    const twice = withGradleProperties(once, wanted);
    expect(twice.text).toBe(once);
    expect(twice.changed).toEqual([]);
  });
});
