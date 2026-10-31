/**
 * Which app versions a measurement belongs to.
 *
 * A baseline's ratios divide by `rn-core`, so an `@expo/ui` bump moves the two
 * reference arms and a React Native bump moves every row in the file: both are
 * comparability regimes, and a merged cell can only be checked against a file if
 * the file says which versions its cells were measured with (X14). Three places
 * can answer - `bun.lock`, the workspace manifest's requested range, and the
 * installed package - and this module reads all three without inventing a fourth.
 *
 * Every version here is one a fixture hands it: no lock file, no repo and no
 * install directory is touched, so a wrong answer cannot hide behind a real
 * `node_modules` on the machine running the test.
 */

import { describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import {
  dependenciesSourceAt,
  installedDependenciesProblem,
  installedVersion,
  lockedVersion,
  parseLockFile,
  requestedVersion,
  resolvedDependencies,
} from '../bench/deps.mjs';

/**
 * A lock in the shape bun writes: JSON5-ish, with a trailing comma before every
 * closer and `//` comments. Hand-writing this as strict JSON is the mistake this
 * fixture exists to prevent — the first version of these tests did exactly that,
 * the reader passed every one of them, and it resolved nothing on the real
 * `bun.lock`, which made every merge refuse. `bench-deps.test.js` also reads the
 * repo's own lock below, so the two can never drift apart again.
 */
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
    // The whole reason this parser exists: bun writes trailing commas, and a
    // strict `JSON.parse` of the shipped lock throws. Asserting the strict
    // failure first is what makes the tolerant pass's success mean something.
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
    // A trailing comma *inside* a string value is part of the value, and a `//`
    // inside one is not a comment. A rewrite that did not track string state
    // would corrupt both.
    const inside = parseLockFile('{"a":"x,}","b":"// not a comment,},"}');
    expect(inside.error).toBeNull();
    expect(inside.value).toEqual({
      a: 'x,}',
      b: '// not a comment,},',
    });
    // And an escaped quote does not end the string. A tolerant pass that consumes
    // the `\` and then treats the `"` as a closer would resume *outside* the string
    // and strip commas it has no business touching; bun writes `\u0022`-style
    // escapes in integrity fields, so this is not hypothetical.
    // The trailing comma is what puts this text through the tolerant walk at all:
    // without it the strict parser reads the file and the string-state code below
    // is never reached, which is the first version of this assertion and why it
    // passed for no reason.
    const escaped = parseLockFile('{"a":"q\\"q,}","b":1,}');
    expect(() => JSON.parse('{"a":"q\\"q,}","b":1,}')).toThrow();
    expect(escaped.error).toBeNull();
    expect(escaped.value).toEqual({ a: 'q"q,}', b: 1 });
  });

  it('reports the real text when neither pass reads it', () => {
    const out = parseLockFile('{this is not json');
    expect(out.value).toBeNull();
    // The strict parser's message, because it points at a position in the text
    // the reader can look at; the tolerant pass's would describe characters that
    // were rewritten away.
    expect(out.error).toContain('JSON');
  });

  it('reads this repo’s own bun.lock, at HEAD and at another commit', () => {
    // The fixture can be wrong about what bun writes; the shipped file cannot. A
    // reader that fails here resolves nothing, and every merge in the world
    // refuses with "could not be read to recover it".
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

    // And the same read at the founding commit of a committed baseline, which is
    // the path a pre-X14 merge takes.
    const sha = execFileSync('git', ['rev-parse', 'HEAD~5'], {
      encoding: 'utf8',
    }).trim();
    const at = dependenciesSourceAt({
      git: (args) => {
        try {
          return execFileSync('git', args, { encoding: 'utf8' });
        } catch {
          return null;
        }
      },
      rev: sha,
    });
    const older = resolvedDependencies({
      lockText: at.lockText,
      manifestText: at.manifestText,
      source: `bun.lock at ${sha}`,
    });
    expect(older.problems).toEqual([]);
    expect(older.reactNative).toEqual(expect.stringMatching(/^\d/));
    expect(older.expoUi).toEqual(expect.stringMatching(/^\d/));
  });
});

describe('the lock file reader', () => {
  /** Read through the parser above, so these tests see the same lock shape. */
  const lock = () => parseLockFile(LOCK).value;

  it('reads a plain name@version, including a scoped name', () => {
    expect(lockedVersion(lock(), 'react-native')).toBe('0.80.0');
    expect(lockedVersion(lock(), 'zod')).toBe('3.23.8');
  });

  it('drops a peer suffix rather than returning it as the version', () => {
    // `@expo/ui@54.1.2(peer@1.2.3)` - a reader that took everything after the last
    // `@` would return `54.1.2(peer@1.2.3)`, which would then never match the
    // installed package's `54.1.2` and refuse every merge on a false difference.
    expect(lockedVersion(lock(), '@expo/ui')).toBe('54.1.2');
  });

  it('returns null for a workspace entry, a missing name, or no lock', () => {
    // A workspace package has no version at all; inventing one would be a
    // comparison the guard then passes for no reason.
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
    // One problem, not three: the parse failure already explains every null in
    // the file, and repeating it as "no resolved version for react-native" reads
    // as two further defects the reader would go looking for.
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
    // The manifest is the weaker half: a caret range adds nothing the resolved
    // version does not already say, so it is not worth refusing over.
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

describe('reading a lock at another revision', () => {
  it('asks for the two files at that revision, and nothing else', () => {
    const calls = [];
    const git = (args) => {
      calls.push(args.join(' '));
      // The path is the part after `rev:`, so the reader has to split on the
      // colon rather than compare the whole argument to a bare file name.
      return args[1]?.endsWith('bun.lock') ? LOCK : MANIFEST;
    };
    const at = dependenciesSourceAt({ git, rev: '9cf95f3' });
    expect(calls).toEqual([
      'show 9cf95f3:bun.lock',
      'show 9cf95f3:bench/package.json',
    ]);
    const resolved = resolvedDependencies({
      lockText: at.lockText,
      manifestText: at.manifestText,
      source: 'bun.lock at 9cf95f3',
    });
    expect(resolved.reactNative).toBe('0.80.0');
    expect(resolved.expoUi).toBe('54.1.2');
  });

  it('comes back null when the revision cannot be read, rather than using the working tree', () => {
    // The tempting shortcut - fall back to the lock in front of us - would put
    // today's versions on a file that never measured them, which is the exact
    // false claim the `source` field exists to make impossible.
    const git = () => {
      throw new Error('bad revision');
    };
    expect(dependenciesSourceAt({ git, rev: 'nope' })).toEqual({
      lockText: null,
      manifestText: null,
    });
    expect(dependenciesSourceAt({ git: null, rev: '9cf95f3' })).toEqual({
      lockText: null,
      manifestText: null,
    });
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
    // Not installed at all is not a contradiction: a checkout that never ran
    // `bun install` has nothing to disagree with the lock.
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
