/**
 * The `json`-gem serialisation difference, proved on real bytes and real hashes.
 *
 * Release run 40789293108 failed because `pod install` on the release runner
 * changed the `SPEC CHECKSUMS` of 87 of the lock's 96 pods, and X9's churn guard
 * refused the release. Nothing about the release had changed. What had changed
 * was which `json` gem the Ruby behind `pod` loaded:
 *
 *   - `Pod::Specification#checksum` is
 *     `Digest::SHA1.hexdigest(File.read(defined_in_file))`
 *     (cocoapods-core-1.17.0 `specification.rb:690`).
 *   - For a pod pulled `from:` a path, `defined_in_file` is
 *     `Pods/Local Podspecs/<Name>.podspec.json`, which CocoaPods writes from the
 *     *evaluated* spec with `to_pretty_json` -> `JSON.pretty_generate(spec.to_hash)`
 *     (cocoapods-core `specification/json.rb:18`, cocoapods `sandbox.rb:299`).
 *   - `json` before 2.8.0 prints an empty collection with a blank line inside it;
 *     2.8.0 onward prints `[]` and `{}` (`ruby/json` CHANGES.md, 2.8.0:
 *     "`JSON.pretty_generate` no longer includes newlines inside empty object and
 *     arrays", with the 2.7.0 entry "Always indent even if empty" being what put
 *     them there in the first place).
 *
 * So `s.dependency 'React-cxxstableapi'` - no version constraint, which is how
 * most of React Native and every third-party pod in this app declares a
 * dependency - serialises as `"React-cxxstableapi": []` on a maintainer Mac and
 * as the same three characters spread over four lines on the runner. Two bytes
 * of whitespace, per dependency, and a release blocked.
 *
 * The fixtures are not authored: they are the stored spec files from a real
 * maintainer install, and the two checksums per pod are the one committed in
 * `example/ios/Podfile.lock` and the one the runner printed in that job's log.
 * This test therefore cannot be satisfied by matching an implementation of
 * itself - the expected values come from a machine that is not this one.
 *
 * See `pod-install-lib.mjs` for what the repo now does about it.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import {
  EMPTY_ARRAY_COMPACT,
  EMPTY_ARRAY_EXPANDED,
  EMPTY_ARRAY_OTHER,
  EXPECTED_EMPTY_ARRAY_STYLE,
  POD_INSTALL_CONTRACT,
  emptyArrayStyleOf,
  podInstallEnvironment,
  podSerialisationProblem,
} from '../pod-install-lib.mjs';
import { lockChurnProblem, lockSyncProblem } from '../example-lock-core.mjs';

// `__dirname`, not `import.meta.url`: jest transforms these to CommonJS, which is
// the same reason the logic under test lives in `pod-install-lib.mjs`.
const FIXTURES = join(__dirname, 'fixtures', 'x13-json-empty-array');
const ROOT = join(__dirname, '..', '..');
const manifest = JSON.parse(
  readFileSync(join(FIXTURES, 'manifest.json'), 'utf8')
);

const sha1 = (text) => createHash('sha1').update(text).digest('hex');

/**
 * `JSON.pretty_generate` as `json` < 2.8.0 wrote it: empty collections get a
 * line to themselves, so an empty array is an array, a blank line and a closer.
 *
 * Written against the real gem's output (checked below by matching a runner
 * checksum byte for byte), not against a guess: the shape is
 * `"deps": [` / blank / `]`, and `{` / `}` for an empty object.
 */
function prettyGenerateOld(value, indent = '') {
  const pad = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return `[\n\n${indent}]`;
    return `[\n${value
      .map((item) => `${pad}${prettyGenerateOld(item, pad)}`)
      .join(',\n')}\n${indent}]`;
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return `{\n${indent}}`;
    return `{\n${keys
      .map(
        (key) =>
          `${pad}${JSON.stringify(key)}: ${prettyGenerateOld(value[key], pad)}`
      )
      .join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
}

describe('the json gem decides every SPEC CHECKSUMS entry (X13)', () => {
  const pods = Object.keys(manifest.pods);

  it('has real fixtures from the failing run, not authored ones', () => {
    expect(pods.length).toBeGreaterThan(0);
    for (const pod of pods) {
      const entry = manifest.pods[pod];
      // The two checksums must differ, or the fixture proves nothing.
      expect(entry.runnerChecksum).not.toBe(entry.committedChecksum);
      expect(entry.emptyArrays).toBeGreaterThan(0);
    }
    // The three the brief names, so a fixture set cannot quietly shrink to one.
    for (const required of ['React-Core', 'RCT-Folly', 'NitroModules']) {
      expect(pods).toContain(required);
    }
  });

  it('reproduces the committed checksum from the stored spec, byte for byte', () => {
    for (const pod of pods) {
      const stored = readFileSync(
        join(FIXTURES, `${pod}.podspec.json`),
        'utf8'
      );
      expect(sha1(stored)).toBe(manifest.pods[pod].committedChecksum);
    }
  });

  it('reproduces the runner checksum from the same spec, re-serialised the old way', () => {
    for (const pod of pods) {
      const stored = JSON.parse(
        readFileSync(join(FIXTURES, `${pod}.podspec.json`), 'utf8')
      );
      // CocoaPods appends the newline `to_pretty_json` adds.
      const expanded = `${prettyGenerateOld(stored)}\n`;
      expect(sha1(expanded)).toBe(manifest.pods[pod].runnerChecksum);
    }
  });

  it('changes nothing but whitespace, and that is enough to move a release', () => {
    const strip = (text) => text.replace(/\s+/g, '');
    for (const pod of pods) {
      const compact = readFileSync(
        join(FIXTURES, `${pod}.podspec.json`),
        'utf8'
      );
      const expanded = `${prettyGenerateOld(JSON.parse(compact))}\n`;
      // Same data, different bytes: so no diff tool worth its name would call
      // this a content change, and the churn guard is the only thing in the
      // pipeline that can see it coming.
      expect(strip(expanded)).toBe(strip(compact));
      expect(expanded).not.toBe(compact);
    }
  });
});

describe('emptyArrayStyleOf', () => {
  const compact = readFileSync(
    join(FIXTURES, 'NitroModules.podspec.json'),
    'utf8'
  );
  const expanded = `${prettyGenerateOld(JSON.parse(compact))}\n`;

  it('reads the compact form the committed lock was written with', () => {
    expect(emptyArrayStyleOf(compact)).toBe(EMPTY_ARRAY_COMPACT);
  });

  it('reads the expanded form the runner wrote', () => {
    expect(emptyArrayStyleOf(expanded)).toBe(EMPTY_ARRAY_EXPANDED);
  });

  it('reads a minimal canary in both styles', () => {
    expect(
      emptyArrayStyleOf(
        '{\n  "dependencies": {\n    "react-native-nitro-ui": []\n  }\n}\n'
      )
    ).toBe(EMPTY_ARRAY_COMPACT);
    expect(
      emptyArrayStyleOf(
        '{\n  "dependencies": {\n    "react-native-nitro-ui": [\n\n    ]\n  }\n}\n'
      )
    ).toBe(EMPTY_ARRAY_EXPANDED);
  });

  /**
   * M1, and the case the review found: the compact pattern used to be
   * `/:\s*\[\s*\]/`, and `\s` matches newlines - so `[ ]`, `[\n]` and
   * `[\n    ]` all read as "compact", i.e. as agreement with the committed
   * lock. Agreement has to mean the same *bytes*, because bytes are what the
   * checksum hashes. Anything that is neither of the two known shapes is
   * `other`, which refuses; only "there was nothing to read" is null.
   */
  it('calls an empty array with any other spacing "other", never compact', () => {
    const variants = {
      'spaces inside': '{\n  "dependencies": {\n    "x": [ ]\n  }\n}\n',
      'a bare newline inside':
        '{\n  "dependencies": {\n    "x": [\n]\n  }\n}\n',
      'indented onto its own line':
        '{\n  "dependencies": {\n    "x": [\n    ]\n  }\n}\n',
      'a tab inside': '{\n  "dependencies": {\n    "x": [\t]\n  }\n}\n',
    };
    for (const [what, text] of Object.entries(variants)) {
      // The assertion that matters is the negative one: not compact. Whatever
      // this shape turns out to be, it must never be the answer that lets a
      // version bump through.
      expect(emptyArrayStyleOf(text)).not.toBe(EMPTY_ARRAY_COMPACT);
      expect(emptyArrayStyleOf(text)).toBe(EMPTY_ARRAY_OTHER);
      expect(
        podSerialisationProblem({ style: emptyArrayStyleOf(text) })
      ).toContain('some other way');
      // Guard against a fixture that proves nothing: each variant must really
      // contain an empty array written the unusual way.
      expect(text).toMatch(/\[[^\]]*\]/);
      expect(what).toBeTruthy();
    }
  });

  /**
   * The failure that would silently re-open this bug: a probe that could not run
   * must never be mistaken for a machine that agrees.
   */
  it('says unknown rather than guessing when the answer is not one of the two', () => {
    expect(emptyArrayStyleOf('')).toBeNull();
    expect(emptyArrayStyleOf('not json at all')).toBeNull();
    expect(emptyArrayStyleOf('{"dependencies":{}}')).toBeNull();
    expect(emptyArrayStyleOf(null)).toBeNull();
  });
});

describe('podSerialisationProblem', () => {
  it('is silent about the style the lock has', () => {
    expect(
      podSerialisationProblem({ style: EXPECTED_EMPTY_ARRAY_STYLE })
    ).toBeNull();
  });

  it('refuses the style that churns, and names the mechanism', () => {
    const problem = podSerialisationProblem({ style: EMPTY_ARRAY_EXPANDED });
    expect(problem).toContain('SPEC CHECKSUMS');
    expect(problem).toContain('87 of 96');
    expect(problem).toContain('2.18.0');
  });

  it('refuses an unreadable probe too - unknown is not agreement', () => {
    const problem = podSerialisationProblem({ style: null });
    expect(problem).not.toBeNull();
    expect(problem).toContain('could not be read');
  });
});

describe('podInstallEnvironment', () => {
  it('states the prebuilt-RN defaults the lock resolves with', () => {
    const { env, pinned } = podInstallEnvironment({ PATH: '/bin' });
    expect(env.RCT_USE_PREBUILT_RNCORE).toBe('1');
    expect(env.RCT_USE_RN_DEP).toBe('1');
    expect(pinned).toContain('RCT_USE_PREBUILT_RNCORE=1');
  });

  it('does not carry a source-build or a codegen skip in from the shell', () => {
    // The shape of the X13 failure from a different variable: `RCT_USE_PREBUILT_RNCORE=0`
    // is a source build, which swaps every React pod's source_files and stops
    // installing the facades, and near-total checksum churn is what that looks
    // like in a lock.
    const { env, deviations } = podInstallEnvironment({
      RCT_USE_PREBUILT_RNCORE: '0',
      RCT_SKIP_CODEGEN: '1',
    });
    expect(env.RCT_USE_PREBUILT_RNCORE).toBe('0');
    expect(env.RCT_SKIP_CODEGEN).toBe('1');
    expect(deviations.map((d) => d.name)).toEqual([
      'RCT_USE_PREBUILT_RNCORE',
      'RCT_SKIP_CODEGEN',
    ]);
    // A person set these, so they are kept and reported, never overridden: the
    // alternative is `pod install` quietly ignoring what it was asked to do.
    expect(deviations[0].why).toContain('react_native_pods.rb');
    expect(deviations[1].expected).toBeNull();
  });

  it('leaves the variables that already match the contract alone and unreported', () => {
    const { env, pinned, deviations } = podInstallEnvironment({
      RCT_USE_PREBUILT_RNCORE: '1',
      RCT_USE_RN_DEP: '1',
    });
    expect(pinned).toEqual([]);
    expect(deviations).toEqual([]);
    expect(env.RCT_USE_PREBUILT_RNCORE).toBe('1');
  });

  it('keeps the profiling and local-artifact switches, and reports each one', () => {
    const { env, deviations } = podInstallEnvironment({
      IS_REANIMATED_PROFILING: '1',
      RCT_USE_LOCAL_RN_DEP: '/somewhere/React.xcframework',
    });
    expect(env.IS_REANIMATED_PROFILING).toBe('1');
    expect(env.RCT_USE_LOCAL_RN_DEP).toBe('/somewhere/React.xcframework');
    expect(deviations.map((d) => d.name)).toEqual([
      'IS_REANIMATED_PROFILING',
      'RCT_USE_LOCAL_RN_DEP',
    ]);
  });

  /**
   * N4. `NAME=` used to be treated as unset, and Ruby does not agree: `ENV['X']`
   * is truthy for an empty string, and `ENV['X'] != nil` is true for it too. So
   * `IS_REANIMATED_PROFILING=` really does add `-DREANIMATED_PROFILING` and move
   * RNReanimated's checksum, and passing it silently would be this contract
   * telling the truth about an environment it is reading wrongly.
   *
   * The exceptions are the variables React Native compares with `== '1'`, where
   * an empty string behaves exactly like unset; those stay quiet on purpose, and
   * both halves are asserted so a future "just make them all strict" edit has to
   * answer for it.
   */
  it('treats NAME= as set when Ruby reads it as set, and says so', () => {
    const truthy = podInstallEnvironment({
      IS_REANIMATED_PROFILING: '',
      RCT_USE_LOCAL_RN_DEP: '',
      USE_FRAMEWORKS: '',
    });
    expect(truthy.deviations.map((d) => d.name)).toEqual([
      'USE_FRAMEWORKS',
      'IS_REANIMATED_PROFILING',
      'RCT_USE_LOCAL_RN_DEP',
    ]);
    // Reported, and never cleared: the value is passed through as the shell set it.
    expect(truthy.env.IS_REANIMATED_PROFILING).toBe('');
    expect(truthy.deviations[0].value).toBe('');
    expect(truthy.deviations[0].expected).toBeNull();

    // The `== '1'` comparisons: empty is the same as unset, so nothing to report.
    const compared = podInstallEnvironment({
      RCT_USE_PREBUILT_RNCORE: '',
      RCT_USE_RN_DEP: '',
      RCT_IGNORE_PODS_DEPRECATION: '',
    });
    expect(compared.deviations).toEqual([]);
    // The two prebuild switches have a documented default, so empty is filled in.
    expect(compared.env.RCT_USE_PREBUILT_RNCORE).toBe('1');
    expect(compared.env.RCT_USE_RN_DEP).toBe('1');
  });

  /**
   * The `why` of every entry is a citation, so a reader can check it. This one
   * checks the citations *are* citations, and that the two empty-string
   * behaviours are each marked, rather than the contract implying one rule for
   * all eleven variables when Ruby has two.
   */
  it('says, for every variable, whether an empty value counts as set', () => {
    const marked = POD_INSTALL_CONTRACT.filter(
      (e) => e.emptyCountsAsSet === true
    );
    const unmarked = POD_INSTALL_CONTRACT.filter(
      (e) => e.emptyCountsAsSet !== true
    );
    expect(marked.length).toBeGreaterThan(0);
    expect(unmarked.length).toBeGreaterThan(0);
    // An entry with a pinned default is one React Native fills in itself when
    // unset, so it cannot also be "empty counts as set" - that would be a
    // contract that overrides a value it just said it would keep.
    for (const entry of POD_INSTALL_CONTRACT) {
      if (entry.emptyCountsAsSet === true) {
        expect(entry.value).toBeNull();
      }
    }
  });

  /**
   * RCT_IGNORE_PODS_DEPRECATION is in the contract because react_native_pods.rb
   * folds it into RCT_SKIP_CODEGEN, so it changes codegen - and therefore the
   * ReactCodegen pods - while looking like nothing but a warning switch.
   */
  it('checks RCT_IGNORE_PODS_DEPRECATION, because it skips codegen too', () => {
    const names = POD_INSTALL_CONTRACT.map((entry) => entry.name);
    expect(names).toContain('RCT_IGNORE_PODS_DEPRECATION');
    const { deviations } = podInstallEnvironment({
      RCT_IGNORE_PODS_DEPRECATION: '1',
    });
    expect(deviations.map((d) => d.name)).toContain(
      'RCT_IGNORE_PODS_DEPRECATION'
    );
    expect(deviations[0].why).toContain('RCT_SKIP_CODEGEN');
  });

  it('does not pretend CI or NODE_BINARY decide anything', () => {
    // Both were candidates for this bug. CI only gates CocoaPods interactivity,
    // and NODE_BINARY reaches a podspec as the literal text `$NODE_BINARY` inside
    // a script phase - never expanded - so pinning either would be decoration.
    const names = POD_INSTALL_CONTRACT.map((entry) => entry.name);
    expect(names).not.toContain('CI');
    expect(names).not.toContain('NODE_BINARY');
    expect(names).not.toContain('USE_FRAMEWORKS_INTEGRATION_TARGETS');
  });

  it('names the line that reads every pinned variable', () => {
    // A pin nobody can trace is a pin nobody can remove. Each entry has to say
    // where the value is consumed, or the list rots.
    for (const entry of POD_INSTALL_CONTRACT) {
      expect(entry.why).toMatch(/\.(rb|podspec):\d+/);
    }
  });

  it('never mutates the caller environment object', () => {
    const env = { RCT_SKIP_CODEGEN: '1' };
    podInstallEnvironment(env);
    expect(env).toEqual({ RCT_SKIP_CODEGEN: '1' });
  });
});

describe('what this task must not have weakened', () => {
  it('still allows only NitroUi version and checksum lines through the churn guard', () => {
    // X13 had a tempting shortcut: let the other checksums through and splice
    // just NitroUi's two lines. The guard is what makes that visible instead of
    // quiet, so its allow-list is asserted here rather than trusted.
    const churn = lockChurnProblem({
      beforeText: [
        'PODS:',
        '  - NitroUi (0.3.1):',
        'SPEC CHECKSUMS:',
        '  NitroUi: aaaa',
        '  React-Core: bbbb',
      ].join('\n'),
      afterText: [
        'PODS:',
        '  - NitroUi (0.3.2):',
        'SPEC CHECKSUMS:',
        '  NitroUi: cccc',
        '  React-Core: dddd',
      ].join('\n'),
    });
    expect(churn).toContain('changed beyond NitroUi');
    expect(churn).toContain('+ React-Core: dddd');

    // ...and the two lines a release does change are still allowed.
    expect(
      lockChurnProblem({
        beforeText:
          'PODS:\n  - NitroUi (0.3.1):\nSPEC CHECKSUMS:\n  NitroUi: aaaa\n',
        afterText:
          'PODS:\n  - NitroUi (0.3.2):\nSPEC CHECKSUMS:\n  NitroUi: cccc\n',
      })
    ).toBeNull();
  });

  it('pins the json gem in the job that writes the lock', () => {
    const workflow = readFileSync(
      join(ROOT, '.github/workflows/release.yml'),
      'utf8'
    );
    expect(workflow).toMatch(/gem install json -v\s+2\.18\.0/);
  });

  /**
   * N1. Installing the pin is not the same as it taking effect, and `gem list`
   * cannot tell them apart: it prints every version on the gem path at once. So
   * the job has to ask Ruby what it loads - the same default-gem activation path
   * `pod` takes - and fail there rather than at the probe.
   */
  it('checks what json actually loads, not what is installed', () => {
    const workflow = readFileSync(
      join(ROOT, '.github/workflows/release.yml'),
      'utf8'
    );
    expect(workflow).toMatch(/ruby -rjson -e/);
    expect(workflow).toMatch(/JSON::VERSION/);
    expect(workflow).toMatch(/2\.8\.0/);
    // The old, uninformative check must not come back alongside it.
    expect(workflow).not.toMatch(/^\s*gem list json\s*$/m);
  });

  it('keeps `lock:check` a version comparison, so Linux can still run `check`', () => {
    // The split this task had to preserve: `check` compares a version on any
    // platform, and only the refresh can compare serialisation. Asserted by
    // behaviour rather than by grepping prose - two locks differing only in
    // their checksums must both pass, because that is exactly the difference
    // `check` cannot see and must not try to.
    const lockAt = (checksum) =>
      `PODS:\n  - NitroUi (0.3.2):\nSPEC CHECKSUMS:\n  NitroUi: ${checksum}\n`;
    expect(
      lockSyncProblem({
        manifestVersion: '0.3.2',
        lockText: lockAt('a'.repeat(40)),
      })
    ).toBeNull();
    expect(
      lockSyncProblem({
        manifestVersion: '0.3.2',
        lockText: lockAt('b'.repeat(40)),
      })
    ).toBeNull();
    // And the version is still what it checks.
    expect(
      lockSyncProblem({
        manifestVersion: '0.3.2',
        lockText: lockAt('a'.repeat(40)).replace(
          'NitroUi (0.3.2)',
          'NitroUi (0.3.1)'
        ),
      })
    ).toContain('while package.json is at 0.3.2');
  });
});
