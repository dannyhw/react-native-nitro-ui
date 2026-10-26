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
  abisMatch,
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
    // iOS: React Native's wrapper execs `$CCACHE_BINARY clang`, and Xcode does
    // not put that build setting in the compiler's environment - unset, it
    // silently compiles with plain clang.
    expect(
      ccacheEnv({
        enabled: true,
        repoRoot: '/w/X6',
        binary: '/opt/homebrew/bin/ccache',
      })
    ).toEqual({
      CCACHE_BASEDIR: '/w/X6',
      CCACHE_NOHASHDIR: '1',
      CCACHE_BINARY: '/opt/homebrew/bin/ccache',
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
  // A stamp that answers every question the skip asks, including which ABIs are
  // in the artifact. The shape is deliberate: the Android case has to state the
  // ABIs, because that is the one place a tree match alone can lie (review M1).
  const fresh = {
    force: false,
    clean: false,
    noStamp: false,
    fresh: true,
    platform: 'android',
    abis: 'arm64-v8a',
    stampedAbis: 'arm64-v8a',
  };

  it('skips only the build that is genuinely already done', () => {
    expect(decideSkipBuild(fresh)).toEqual({
      skip: true,
      reason: 'app.stamp matches this tree',
    });
    // iOS has no ABIs to agree on; the tree and the binary are the whole claim.
    expect(
      decideSkipBuild({
        ...fresh,
        platform: 'ios',
        abis: null,
        stampedAbis: null,
      }).skip
    ).toBe(true);
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

  // The artifact path is fixed per worktree, so an arm64-v8a APK and an x86_64
  // one are the same file, and the code tree does not move when only `--arch`
  // does. Without this check the run that asks for an x86_64 emulator build is
  // told "fresh, not rebuilt" over an arm64-only APK, and the AVD answers with
  // INSTALL_FAILED_NO_MATCHING_ABIS (or a two-ABI request gets a one-ABI app).
  it('will not serve an artifact built for different ABIs', () => {
    const asksFor = (abis, stampedAbis) =>
      decideSkipBuild({ ...fresh, abis, stampedAbis });

    const wrong = asksFor('x86_64', 'arm64-v8a');
    expect(wrong.skip).toBe(false);
    expect(wrong.reason).toContain('built for arm64-v8a');
    expect(wrong.reason).toContain('asks for x86_64');

    // Asking for more than the stamp has is the same mistake, in the other
    // direction: a partial artifact is not a full one.
    expect(asksFor('arm64-v8a,x86_64', 'arm64-v8a').skip).toBe(false);
  });

  it('builds rather than guess at a stamp that does not record its ABIs', () => {
    // Stamps written before the ABI was recorded still match the tree and the
    // binary. Saying "fresh" about one would be exactly the M1 bug, so an
    // unknown is a build, and the reason names the unknown.
    for (const stampedAbis of [null, undefined, '']) {
      const decision = decideSkipBuild({
        ...fresh,
        abis: 'arm64-v8a',
        stampedAbis,
      });
      expect(decision.skip).toBe(false);
      expect(decision.reason).toContain('does not say which ABIs');
    }
  });
});

describe('abisMatch', () => {
  it('compares the set, not the string', () => {
    expect(abisMatch('arm64-v8a,x86_64', 'x86_64,arm64-v8a')).toBe(true);
    expect(abisMatch(' arm64-v8a ', 'arm64-v8a')).toBe(true);
    expect(abisMatch('arm64-v8a,arm64-v8a', 'arm64-v8a')).toBe(true);
  });

  it('never matches an unknown against anything', () => {
    expect(abisMatch(null, 'arm64-v8a')).toBe(false);
    expect(abisMatch('arm64-v8a', null)).toBe(false);
    expect(abisMatch(null, null)).toBe(false);
    expect(abisMatch('', '')).toBe(false);
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
