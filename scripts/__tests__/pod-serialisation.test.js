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

const FIXTURES = join(__dirname, 'fixtures', 'x13-json-empty-array');
const ROOT = join(__dirname, '..', '..');
const manifest = JSON.parse(
  readFileSync(join(FIXTURES, 'manifest.json'), 'utf8')
);

const sha1 = (text) => createHash('sha1').update(text).digest('hex');

/**
 * `JSON.pretty_generate` as `json` < 2.8.0 wrote it: an empty collection gets a
 * blank line inside it.
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
      expect(entry.runnerChecksum).not.toBe(entry.committedChecksum);
      expect(entry.emptyArrays).toBeGreaterThan(0);
    }
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
      expect(emptyArrayStyleOf(text)).not.toBe(EMPTY_ARRAY_COMPACT);
      expect(emptyArrayStyleOf(text)).toBe(EMPTY_ARRAY_OTHER);
      expect(
        podSerialisationProblem({ style: emptyArrayStyleOf(text) })
      ).toContain('some other way');
      expect(text).toMatch(/\[[^\]]*\]/);
      expect(what).toBeTruthy();
    }
  });

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

  it('says, for every variable, whether an empty value counts as set', () => {
    const marked = POD_INSTALL_CONTRACT.filter(
      (e) => e.emptyCountsAsSet === true
    );
    const unmarked = POD_INSTALL_CONTRACT.filter(
      (e) => e.emptyCountsAsSet !== true
    );
    expect(marked.length).toBeGreaterThan(0);
    expect(unmarked.length).toBeGreaterThan(0);
    for (const entry of POD_INSTALL_CONTRACT) {
      if (entry.emptyCountsAsSet === true) {
        expect(entry.value).toBeNull();
      }
    }
  });

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
    const names = POD_INSTALL_CONTRACT.map((entry) => entry.name);
    expect(names).not.toContain('CI');
    expect(names).not.toContain('NODE_BINARY');
    expect(names).not.toContain('USE_FRAMEWORKS_INTEGRATION_TARGETS');
  });

  it('names the line that reads every pinned variable', () => {
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

  it('checks what json actually loads, not what is installed', () => {
    const workflow = readFileSync(
      join(ROOT, '.github/workflows/release.yml'),
      'utf8'
    );
    expect(workflow).toMatch(/ruby -rjson -e/);
    expect(workflow).toMatch(/JSON::VERSION/);
    expect(workflow).toMatch(/2\.8\.0/);
    expect(workflow).not.toMatch(/^\s*gem list json\s*$/m);
  });

  it('keeps `lock:check` a version comparison, so Linux can still run `check`', () => {
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
