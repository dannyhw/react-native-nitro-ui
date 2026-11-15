import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';

import {
  installedDependenciesProblem,
  installedVersion,
  lockedVersion,
  parseLockFile,
  requestedVersion,
  resolvedDependencies,
} from '../bench/deps.mjs';

// The shape bun writes, which is not strict JSON: a trailing comma before every
// closer, and `//` comments.
const LOCK = [
  '{',
  '  "lockfileVersion": 1,',
  '  // what bun install resolved',
  '  "workspaces": { "": ["bench"], },',
  '  "packages": {',
  '    "react-native": ["react-native@0.80.0", {},],',
  '    "@expo/ui": ["@expo/ui@54.1.2(peer@1.2.3)", {},],',
  '    "react-is": ["react-is@workspace:.", {},],',
  '    "zod": ["zod@3.23.8", {},],',
  '  },',
  '}',
  '',
].join('\n');

const MANIFEST = JSON.stringify({
  name: 'bench',
  dependencies: { 'react-native': '0.80.0', '@expo/ui': '^54.0.0' },
});

describe('the lock file parser', () => {
  it('reads bun’s own file, which is not strict JSON', () => {
    expect(() => JSON.parse(LOCK)).toThrow();
    const { value, error } = parseLockFile(LOCK);
    expect(error).toBeNull();
    expect(Object.keys(value.packages)).toEqual([
      'react-native',
      '@expo/ui',
      'react-is',
      'zod',
    ]);
  });

  it('accepts strict JSON too, and does not touch what is inside a string', () => {
    expect(parseLockFile('{"a":1}').value).toEqual({ a: 1 });
    const inside = parseLockFile('{"a":"x,}","b":"// not a comment,},"}');
    expect(inside.error).toBeNull();
    expect(inside.value).toEqual({
      a: 'x,}',
      b: '// not a comment,},',
    });
    // An escaped quote does not end the string, and bun writes `\u0022`-style
    // escapes in integrity fields. The trailing comma is what sends this text
    // through the tolerant pass: without it the strict parser succeeds.
    const escaped = parseLockFile('{"a":"q\\"q,}","b":1,}');
    expect(() => JSON.parse('{"a":"q\\"q,}","b":1,}')).toThrow();
    expect(escaped.error).toBeNull();
    expect(escaped.value).toEqual({ a: 'q"q,}', b: 1 });
  });

  it('reports the real text when neither pass reads it', () => {
    const out = parseLockFile('{this is not json');
    expect(out.value).toBeNull();
    // The strict parser's message: its position is one in the text as written.
    expect(out.error).toContain('JSON');
  });

  it('reads this repo’s own bun.lock', () => {
    const text = readFileSync('bun.lock', 'utf8');
    const atHead = resolvedDependencies({
      lockText: text,
      manifestText: readFileSync('bench/package.json', 'utf8'),
      source: 'bun.lock',
    });
    expect([atHead.problems, atHead.reactNative, atHead.expoUi]).toEqual([
      [],
      expect.stringMatching(/^\d/),
      expect.stringMatching(/^\d/),
    ]);
  });
});

describe('the lock file reader', () => {
  const lock = () => parseLockFile(LOCK).value;

  it('reads a plain name@version, including a scoped name', () => {
    expect(lockedVersion(lock(), 'react-native')).toBe('0.80.0');
    expect(lockedVersion(lock(), 'zod')).toBe('3.23.8');
  });

  it('drops a peer suffix rather than returning it as the version', () => {
    expect(lockedVersion(lock(), '@expo/ui')).toBe('54.1.2');
  });

  it('returns null for a workspace entry, a missing name, or no lock', () => {
    expect(lockedVersion(lock(), 'react-is')).toBeNull();
    expect(lockedVersion(lock(), 'not-here')).toBeNull();
    expect(lockedVersion(null, 'react-native')).toBeNull();
    expect(lockedVersion({ packages: {} }, 'react-native')).toBeNull();
  });
});

describe('the manifest and install readers', () => {
  it('reports the requested range, which is not the resolved version', () => {
    expect(requestedVersion(JSON.parse(MANIFEST), '@expo/ui')).toBe('^54.0.0');
    expect(requestedVersion(JSON.parse(MANIFEST), 'react-native')).toBe(
      '0.80.0'
    );
    expect(requestedVersion({}, '@expo/ui')).toBeNull();
    expect(requestedVersion(JSON.parse(MANIFEST), 'absent')).toBeNull();
  });

  it('reads an installed package version, or null', () => {
    expect(installedVersion({ name: 'react-native', version: '0.80.0' })).toBe(
      '0.80.0'
    );
    expect(installedVersion({ name: 'react-native' })).toBeNull();
    expect(installedVersion(null)).toBeNull();
  });
});

describe('resolvedDependencies', () => {
  it('pairs what the lock resolved with what the manifest asked for', () => {
    expect(
      resolvedDependencies({
        lockText: LOCK,
        manifestText: MANIFEST,
        source: 'bun.lock in the working tree',
      })
    ).toEqual({
      reactNative: '0.80.0',
      expoUi: '54.1.2',
      requestedReactNative: '0.80.0',
      requestedExpoUi: '^54.0.0',
      source: 'bun.lock in the working tree',
      problems: [],
    });
  });

  it('says so when the lock could not be read or parsed', () => {
    expect(
      resolvedDependencies({ lockText: null, source: 'bun.lock' }).problems[0]
    ).toContain('could not be read');
    const broken = resolvedDependencies({
      lockText: '{not json',
      source: 'bun.lock',
    });
    expect(broken.reactNative).toBeNull();
    expect(broken.problems).toEqual([expect.stringContaining('is not JSON')]);
  });

  it('names a tracked package the lock does not resolve', () => {
    const out = resolvedDependencies({
      lockText: JSON.stringify({ packages: { zod: ['zod@3.0.0', {}] } }),
      source: 'bun.lock',
    });
    expect(out.problems.join('\n')).toContain('react-native');
    expect(out.problems.join('\n')).toContain('@expo/ui');
  });

  it('still answers from the lock when the manifest is unreadable', () => {
    const out = resolvedDependencies({
      lockText: LOCK,
      manifestText: '{broken',
      source: 'bun.lock',
    });
    expect(out.reactNative).toBe('0.80.0');
    expect(out.requestedExpoUi).toBeNull();
    expect(out.problems).toEqual([]);
  });
});

describe('the install check', () => {
  it('is silent when nothing contradicts the lock', () => {
    expect(
      installedDependenciesProblem({
        resolved: { reactNative: '0.80.0', expoUi: '54.1.2' },
        installed: { reactNative: '0.80.0', expoUi: '54.1.2' },
      })
    ).toBeNull();
    // Not installed at all is not a contradiction.
    expect(
      installedDependenciesProblem({
        resolved: { reactNative: '0.80.0', expoUi: '54.1.2' },
        installed: { reactNative: null, expoUi: null },
      })
    ).toBeNull();
    expect(
      installedDependenciesProblem({ resolved: null, installed: null })
    ).toBeNull();
  });

  it('refuses a stale install, naming both versions', () => {
    const out = installedDependenciesProblem({
      resolved: { reactNative: '0.80.0', expoUi: '54.1.2' },
      installed: { reactNative: '0.79.5', expoUi: '54.1.2' },
    });
    expect(out).toContain('react-native: installed 0.79.5, lock 0.80.0');
    expect(out).toContain('bun install');
  });

  it('catches the comparison arm drifting on its own', () => {
    const out = installedDependenciesProblem({
      resolved: { reactNative: '0.80.0', expoUi: '54.1.2' },
      installed: { reactNative: '0.80.0', expoUi: '54.0.9' },
    });
    expect(out).toContain('@expo/ui: installed 54.0.9');
  });
});
