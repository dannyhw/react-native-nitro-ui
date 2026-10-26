/**
 * The `app.stamp` gate: a device run must not be evidence about code it does not
 * contain.
 *
 * `G2-button.report.md` records the failure this exists for - a harness run that
 * passed against an `.app` from before the change - and the Android variant is
 * worse because gradle can be *right* about being up-to-date while the dex lost
 * a generated hybrid. So the cases here are the ones that would otherwise be a
 * silently green lie:
 *
 *   - the code tree digest covers what the app is built from, and only that
 *     (writing a report must not invalidate a build);
 *   - the component list comes from nitrogen's generated sources, so a new
 *     component joins the gate on its own commit;
 *   - a component really is found in (or found missing from) a dex, including
 *     when the dex is deflate-compressed - a false "missing" would block a
 *     device run over nothing.
 */

import { describe, expect, it } from '@jest/globals';
import { Buffer } from 'node:buffer';
import { existsSync, readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';

import {
  NON_CODE_PREFIXES,
  codeTreeDigest,
  componentNeedle,
  countOccurrences,
  decideFreshness,
  dexBlobs,
  isCodeFile,
  parseAndroidComponentNames,
  parseIosComponentNames,
  platformForArtifact,
  runnerFromArgv,
  zipEntries,
} from '../app-stamp-core.mjs';
import {
  currentCodeTree,
  recordBuild,
  registeredComponents,
  stampPath,
} from '../app-stamp.mjs';

/**
 * Build a ZIP with the given entries, so the dex reader is tested against real
 * container bytes rather than a fixture that could drift from the format.
 * Method 0 is stored (what an APK uses today), 8 is deflated (what it may use).
 */
function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const { name, data, method = 0 } of entries) {
    const stored = method === 0 ? data : deflateRawSync(data);
    const nameBytes = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 14); // crc: not checked by the reader under test
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    chunks.push(local, nameBytes, stored);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(method, 10);
    record.writeUInt32LE(0, 16);
    record.writeUInt32LE(stored.length, 20);
    record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(nameBytes.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, nameBytes);
    offset += local.length + nameBytes.length + stored.length;
  }
  const centralBytes = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBytes, eocd]);
}

const CURRENT = { tree: 'a'.repeat(64), head: 'deadbeef', files: 490 };
const COMPONENTS = ['Switch', 'Slider'];

describe('the code tree digest', () => {
  it('covers the code and not the prose', () => {
    expect(isCodeFile('src/components/NitroUiSwitch.tsx')).toBe(true);
    expect(isCodeFile('example/ios/Podfile.lock')).toBe(true);
    expect(isCodeFile('ios/HybridNitroUiSwitch.swift')).toBe(true);
    expect(isCodeFile('scripts/build-app.mjs')).toBe(true);
    for (const ignored of [
      'docs/tasks/X1-dev-tooling.md',
      'bench/results/abc.json',
      '.github/workflows/ci.yml',
      'README.md',
      'example/app.stamp',
      'example/android/app/build/outputs/a.apk',
    ]) {
      expect(isCodeFile(ignored)).toBe(false);
    }
    // Guard for the list itself: an exclusion has to be a prefix, not a substring
    // a source directory could accidentally contain.
    expect(NON_CODE_PREFIXES.every((prefix) => prefix.endsWith('/'))).toBe(
      true
    );
  });

  it('is the same tree in any key order, and a different tree on one byte', () => {
    const a = codeTreeDigest({ 'src/a.ts': '1', 'src/b.ts': '2' }, 'head');
    const b = codeTreeDigest({ 'src/b.ts': '2', 'src/a.ts': '1' }, 'head');
    expect(a).toBe(b);
    expect(
      codeTreeDigest({ 'src/a.ts': '1', 'src/b.ts': '3' }, 'head')
    ).not.toBe(a);
    // Review M4: HEAD is not in here. The digest is what the compiler read, so
    // a commit that moves no source file must not invalidate a build - writing
    // a report used to cost a rebuild of the example app.
    expect(codeTreeDigest({ 'src/a.ts': '1', 'src/b.ts': '2' })).toBe(a);
  });
});

describe('the component list', () => {
  it('reads the iOS registration out of nitrogen’s autolinker', () => {
    const source = [
      'public static func createNitroUiSwitch() -> X {',
      '  let hybridObject = HybridNitroUiSwitch()',
      '}',
      'public static func isNitroUiSwitchRecyclable() -> Bool { return true }',
      'public static func createNitroUiSlider() -> X {}',
    ].join('\n');
    // The `is…Recyclable` neighbour must not become a second component.
    expect(parseIosComponentNames(source)).toEqual(['Slider', 'Switch']);
    expect(parseIosComponentNames('import NitroModules')).toEqual([]);
  });

  it('reads the Android list from the generated specs', () => {
    expect(
      parseAndroidComponentNames([
        'HybridNitroUiSwitchSpec.kt',
        'HybridNitroUiSliderSpec.kt',
        'NitroUiSwitchSize.kt',
        'nitrouiOnLoad.kt',
      ])
    ).toEqual(['Slider', 'Switch']);
  });

  it('finds every component the real generated sources register', () => {
    // Not a fixture: if nitrogen changes how it emits the autolinker, the gate
    // would quietly start checking nothing, and this is what notices.
    for (const platform of ['ios', 'android']) {
      const components = registeredComponents({ platform });
      expect(components.length).toBeGreaterThanOrEqual(8);
      expect(components).toEqual(
        expect.arrayContaining(['Switch', 'Slider', 'Picker'])
      );
      expect(components).not.toContain('');
    }
  });
});

describe('the needle (review S7)', () => {
  it('asks for the class on Android and the length-prefixed name on iOS', () => {
    expect(componentNeedle('android', 'Switch')).toBe(
      'Lcom/margelo/nitro/nitroui/HybridNitroUiSwitch;'
    );
    // 19 is 'HybridNitroUiSwitch'.length - the prefix Swift's metadata writes,
    // which is what separates the class from its generated spec.
    expect(componentNeedle('ios', 'Switch')).toBe('19HybridNitroUiSwitch');
    expect('HybridNitroUiSwitch').toHaveLength(19);
  });

  it('does not match the generated spec it is supposed to be distinct from', () => {
    // Measured on a real Debug .app: the plain name occurs ~2300 times because
    // every HybridNitroUiSwitchSpec mention contains it, the length-prefixed
    // class name occurs 4 times, and the length-prefixed spec name never.
    const spec = 'HybridNitroUiSwitchSpec';
    expect(spec).toContain('HybridNitroUiSwitch');
    expect(spec).not.toContain(componentNeedle('ios', 'Switch'));
    expect(spec).not.toContain(componentNeedle('android', 'Switch'));
    expect(
      countOccurrences(
        Buffer.from('x' + componentNeedle('ios', 'Switch') + 'y'),
        componentNeedle('ios', 'Switch')
      )
    ).toBe(1);
  });
});

describe('the binary scan', () => {
  it('counts occurrences of a class name', () => {
    const buffer = Buffer.from('x HybridNitroUiSwitch y HybridNitroUiSwitch z');
    expect(countOccurrences(buffer, 'HybridNitroUiSwitch')).toBe(2);
    expect(countOccurrences(buffer, 'HybridNitroUiNope')).toBe(0);
    expect(countOccurrences(buffer, '')).toBe(0);
  });

  it('finds a class through a stored or a deflated dex', () => {
    const dexA = Buffer.from(
      `Lcom/margelo/nitro/nitroui/HybridNitroUiSwitch;${'pad'.repeat(64)}`
    );
    const dexB = Buffer.from('unrelated class list');
    const apk = buildZip([
      { name: 'AndroidManifest.xml', data: Buffer.from('not a dex') },
      { name: 'classes.dex', data: dexA, method: 0 },
      { name: 'classes2.dex', data: dexB, method: 8 },
    ]);

    const names = zipEntries(apk).map((entry) => entry.name);
    expect(names).toEqual([
      'AndroidManifest.xml',
      'classes.dex',
      'classes2.dex',
    ]);

    const { blobs, source } = dexBlobs(apk);
    expect(source).toBe('zip');
    expect(blobs).toHaveLength(2);
    const total = blobs.reduce(
      (sum, blob) => sum + countOccurrences(blob, 'HybridNitroUiSwitch'),
      0
    );
    expect(total).toBe(1);
  });

  it('falls back to the raw APK bytes rather than reporting a false miss', () => {
    const warnings = [];
    // Not a ZIP at all (a truncated or unusual container): scanning the bytes is
    // still the honest answer, and it has to say it did so.
    const fake = Buffer.concat([
      Buffer.from('PK\x03\x04garbage'),
      Buffer.from('HybridNitroUiSwitch'),
    ]);
    const { blobs, source } = dexBlobs(fake, (message) =>
      warnings.push(message)
    );
    expect(source).toBe('apk-bytes');
    expect(blobs).toHaveLength(1);
    expect(countOccurrences(blobs[0], 'HybridNitroUiSwitch')).toBe(1);
    expect(warnings.join('\n')).toMatch(/scanning the APK bytes instead/);
  });

  it('reads the runner a harness process was started with', () => {
    const prefix = ['/node', '/react-native-harness'];
    expect(runnerFromArgv([...prefix, '--harnessRunner', 'android'])).toBe(
      'android'
    );
    expect(runnerFromArgv([...prefix, '--harnessRunner=ios'])).toBe('ios');
    expect(runnerFromArgv([...prefix, 'Switch.harness.tsx'])).toBeNull();
    expect(runnerFromArgv([...prefix, '--harnessRunner', 'wat'])).toBeNull();
    expect(platformForArtifact('/a/NitroUiExample.app')).toBe('ios');
    expect(platformForArtifact('/a/app-debug.apk')).toBe('android');
    expect(platformForArtifact('/a/app-release')).toBeNull();
  });
});

describe('the refusal', () => {
  // A v2 stamp: the tree, and the file the tree was built into. Both halves are
  // needed - see the two worktrees below.
  const APK = '/repo/example/android/app/build/outputs/apk/debug/app-debug.apk';
  const decide = (override) =>
    decideFreshness({
      stamp: {
        version: 2,
        tree: CURRENT.tree,
        head: CURRENT.head,
        artifact: APK,
        artifactPath: APK,
        fingerprint: 'f'.repeat(64),
        counts: {},
      },
      current: CURRENT,
      platform: 'android',
      artifact: APK,
      artifactPath: APK,
      fingerprint: 'f'.repeat(64),
      components: COMPONENTS,
      counts: { Switch: 671, Slider: 690 },
      ...override,
    });

  it('passes a build of this tree that contains everything', () => {
    expect(decide({})).toEqual({ ok: true });
  });

  it('refuses an unstamped artifact', () => {
    const decision = decide({ stamp: null });
    expect(decision.ok).toBe(false);
    if (decision.ok) throw new Error('expected a refusal');
    expect(decision.problems.join('\n')).toMatch(/no app\.stamp for android/);
    expect(decision.fix).toMatch(/scripts\/build-app\.mjs --platform android/);
  });

  it('refuses a stamp written for another checkout', () => {
    // The M2 case, and the one this repo makes easy: every worktree has the same
    // relative path for the APK, so a stamp from a sibling worktree reads green
    // for a binary that was built elsewhere.
    const decision = decide({
      artifactPath:
        '/other-worktree/X1/example/android/app/build/outputs/apk/debug/app-debug.apk',
    });
    expect(decision.ok).toBe(false);
    if (decision.ok) throw new Error('expected a refusal');
    expect(decision.problems.join(' ')).toMatch(/different file than the one/);
  });

  it('refuses an app whose bytes changed under the stamp', () => {
    // Same path, different file: an APK dropped in by hand, or a build that ran
    // without writing its stamp.
    const decision = decide({ fingerprint: 'a'.repeat(64) });
    expect(decision.ok).toBe(false);
    if (decision.ok) throw new Error('expected a refusal');
    expect(decision.problems.join(' ')).toMatch(/changed since app.stamp/);
  });

  it('refuses a stamp that cannot name the file it was written for', () => {
    const stamp = { tree: CURRENT.tree, head: CURRENT.head, counts: {} };
    const decision = decide({ stamp });
    expect(decision.ok).toBe(false);
    if (decision.ok) throw new Error('expected a refusal');
    expect(decision.problems.join(' ')).toMatch(
      /predates the artifact binding/
    );
  });

  it('does not care which commit produced the tree', () => {
    // M4, the other direction: a docs-only commit moved HEAD and left every
    // source byte alone. The stamp stays green - the live proof of this is in
    // docs/tasks/X1-dev-tooling.report.md.
    expect(
      decide({
        stamp: {
          version: 2,
          tree: CURRENT.tree,
          head: 'deadbeef'.repeat(8),
          artifact: APK,
          artifactPath: APK,
          fingerprint: 'f'.repeat(64),
          counts: {},
        },
      })
    ).toEqual({ ok: true });
  });

  it('refuses a tree that moved after the build, and names both', () => {
    const decision = decide({ current: { ...CURRENT, tree: 'b'.repeat(64) } });
    expect(decision.ok).toBe(false);
    if (decision.ok) throw new Error('expected a refusal');
    expect(decision.problems.join('\n')).toMatch(/different code tree/);
    expect(decision.problems.join('\n')).toContain(CURRENT.head);
  });

  it('refuses a dex that lost a component, and says which', () => {
    // The gradle case: `assembleDebug` was up-to-date, the dex is not this tree.
    const decision = decide({ counts: { Switch: 671, Slider: 0 } });
    expect(decision.ok).toBe(false);
    if (decision.ok) throw new Error('expected a refusal');
    expect(decision.problems.join('\n')).toMatch(/not in the binary: Slider/);
    expect(decision.problems.join('\n')).toMatch(/packageDebug/);
  });

  it('says both when both are true', () => {
    const decision = decide({
      stamp: null,
      counts: { Switch: 0, Slider: 0 },
      current: { ...CURRENT, tree: 'c'.repeat(64) },
    });
    if (decision.ok) throw new Error('expected a refusal');
    expect(decision.problems).toHaveLength(2);
  });
});

describe('a build that ran while the tree moved (review M3)', () => {
  const stampFile = stampPath({ platform: 'android' });
  const contentsNow = () =>
    existsSync(stampFile) ? readFileSync(stampFile, 'utf8') : null;

  it('writes no stamp when the tree at the end is not the tree at the start', () => {
    // The shape that bites: an agent backgrounds a build, edits a component (or
    // merges) while xcodebuild is reading the tree, and the stamp would then
    // describe the edited tree over a binary compiled before the edit. The
    // artifact here does not even exist - the check has to come first, because
    // a tree that moved makes the artifact irrelevant.
    const before = contentsNow();
    const moved = { tree: 'c'.repeat(64), head: 'no-such-commit', files: 1 };
    /** @type {string} */
    let message = '';
    try {
      recordBuild({
        platform: 'android',
        artifact: '/nonexistent/app-debug.apk',
        treeBefore: moved,
        log: () => {},
      });
    } catch (error) {
      message = String(error?.message ?? error);
    }
    expect(message).toMatch(/changed during the build/);
    // Both digests, so whoever sees it can tell which run was which.
    expect(message).toMatch(/before c{12}/);
    expect(message).toMatch(/after [0-9a-f]{12}/);
    expect(message).toMatch(/No stamp was written/);
    expect(contentsNow()).toBe(before);
  });

  it('gets past the check when the tree stood still', () => {
    // The same call with a tree that did not move: the refusal must be about the
    // missing artifact, which is the next check - not about the tree.
    const still = currentCodeTree();
    /** @type {string} */
    let message = '';
    try {
      recordBuild({
        platform: 'android',
        artifact: '/nonexistent/app-debug.apk',
        treeBefore: still,
        log: () => {},
      });
    } catch (error) {
      message = String(error?.message ?? error);
    }
    expect(message).not.toMatch(/changed during the build/);
    expect(message).not.toBe('');
  });
});
