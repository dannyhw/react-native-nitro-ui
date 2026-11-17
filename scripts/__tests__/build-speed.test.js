import { describe, expect, it } from '@jest/globals';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ccacheEnv,
  ccacheEffectiveForWorktrees,
  ccacheRequested,
  decideSkipBuild,
  iosCleanTargets,
  abisMatch,
  gradleArchArgs,
  gradleCcacheArgs,
  iosModuleCacheArgs,
  iosModuleCacheDir,
  hostAbi,
  PLAIN_MODULE_CACHE_NAME,
  CCACHE_MODULE_CACHE_NAME,
  resolveAndroidAbis,
  withGradleProperties,
} from '../build-speed-lib.mjs';
import { ccacheSetup } from '../ccache-setup.mjs';

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
      // No underscore: CCACHE_HASH_DIR is not a variable ccache reads.
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
    // The misspelled variable has no effect.
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

describe('iosModuleCacheDir', () => {
  const derived = '/w/X6/example/ios/build';

  it('gives the two kinds of build different module caches', () => {
    const plain = iosModuleCacheDir({ derivedData: derived, ccache: false });
    const cached = iosModuleCacheDir({ derivedData: derived, ccache: true });
    // A `.pcm` written under CCACHE_BASEDIR holds worktree-relative paths, and a
    // plain xcodebuild that reads it fails with "module 'Foundation' is defined
    // in both ...". So the two kinds of build get separate module caches.
    expect(cached).not.toBe(plain);
    expect(plain).toBe(path.join(derived, PLAIN_MODULE_CACHE_NAME));
    expect(cached).toBe(path.join(derived, CCACHE_MODULE_CACHE_NAME));
    expect(PLAIN_MODULE_CACHE_NAME).toBe('ModuleCache.noindex');
  });

  it('passes the plain build the name Xcode would have used anyway', () => {
    // Plain builds keep Xcode's default name, so a build by hand in the same
    // derived data reads the same cache.
    expect(iosModuleCacheArgs({ derivedData: derived, ccache: false })).toEqual(
      [`MODULE_CACHE_DIR=${derived}/ModuleCache.noindex`]
    );
    expect(iosModuleCacheArgs({ derivedData: derived, ccache: true })).toEqual([
      `MODULE_CACHE_DIR=${derived}/ModuleCache-ccache.noindex`,
    ]);
  });

  it('is decided by whether the build set the ccache env, at each call site', () => {
    // The call sites are checked too: a builder that forgot the argument would
    // compile into the default cache with CCACHE_BASEDIR set.
    const read = (file) =>
      fs.readFileSync(path.resolve(process.cwd(), 'scripts', file), 'utf8');
    // The real-input build shares `build-app.mjs`'s derived data, so it compiles
    // with the same environment and cache, or each build recompiles the other's.
    const ccacheBuilders = [
      'build-app.mjs',
      'bench/build.mjs',
      'real-input/ios.mjs',
    ];
    for (const file of ccacheBuilders) {
      expect(read(file)).toContain('iosModuleCacheArgs(');
      expect(read(file)).toContain('ccache: ccache.enabled');
    }
    expect(read('real-input/ios.mjs')).toContain('...ccache.env');
    // This compiles without ccache, so it keeps the default name.
    const text = read('smoke/common.sh');
    expect(text).not.toContain(CCACHE_MODULE_CACHE_NAME);
    expect(text).not.toContain('ccache: true');
  });
});

describe('ccacheSetup', () => {
  it('without ccache, every build compiles plainly into the default module cache', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'no-ccache-'));
    const off = ccacheSetup({ repoRoot: '/r', env: { PATH: empty } });
    expect(off).toEqual({
      enabled: false,
      binary: null,
      env: {},
      gradleArgs: [],
    });
    expect(
      iosModuleCacheArgs({ derivedData: '/d', ccache: off.enabled })
    ).toEqual([`MODULE_CACHE_DIR=${path.join('/d', 'ModuleCache.noindex')}`]);
  });

  it('finds ccache on PATH, and stays out when asked to', () => {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'ccache-bin-'));
    const fake = path.join(bin, 'ccache');
    fs.writeFileSync(fake, '#!/bin/sh\nexit 1\n');
    fs.chmodSync(fake, 0o755);
    const on = ccacheSetup({ repoRoot: '/r', env: { PATH: bin } });
    expect(on.enabled).toBe(true);
    expect(on.env).toMatchObject({ CCACHE_BASEDIR: '/r', CCACHE_BINARY: fake });
    expect(
      ccacheSetup({ repoRoot: '/r', env: { PATH: bin, NITRO_UI_CCACHE: '0' } })
        .enabled
    ).toBe(false);
  });
});

describe('iosCleanTargets', () => {
  // `build-app` detects a stale Pods project through the record of what the last
  // `pod install` was shown, so `--clean` has to remove that record too.
  const targets = iosCleanTargets({ iosDir: '/repo/example/ios' });

  it('deletes the DerivedData this build owns', () => {
    expect(targets).toContain(path.join('/repo/example/ios', 'build'));
  });

  it('also drops the record of what the last pod install saw', () => {
    expect(targets).toContain(
      path.join('/repo/example/ios', 'Pods', '.nitro-ui-pod-inputs')
    );
  });
});

describe('decideSkipBuild', () => {
  // A stamp that answers every question the skip asks, including which ABIs are
  // in the artifact.
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

  // The artifact path is fixed per worktree and the code tree does not move when
  // only `--arch` does, so the stamp's ABIs are compared as well.
  it('will not serve an artifact built for different ABIs', () => {
    const asksFor = (abis, stampedAbis) =>
      decideSkipBuild({ ...fresh, abis, stampedAbis });

    const wrong = asksFor('x86_64', 'arm64-v8a');
    expect(wrong.skip).toBe(false);
    expect(wrong.reason).toContain('built for arm64-v8a');
    expect(wrong.reason).toContain('asks for x86_64');

    // Asking for more than the stamp has: a partial artifact is not a full one.
    expect(asksFor('arm64-v8a,x86_64', 'arm64-v8a').skip).toBe(false);
  });

  it('builds rather than guess at a stamp that does not record its ABIs', () => {
    // A stamp written before the ABI was recorded still matches the tree and
    // the binary.
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
