import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it, jest } from '@jest/globals';
import picomatch from 'picomatch';

import {
  DEVICE_GATES,
  GATE_DIGEST_EXCLUSIONS,
  codeTreeDigest,
  contentHash,
  decideNeed,
  gateDigestOwnsFile,
  gateRowFor,
  gateTreesFromEntries,
  gatesTouchedByPaths,
  isHarnessTestFile,
  ledgerLineFromRun,
  platformTreesFromEntries,
  platformsOwningFile,
  requiredGatesFor,
} from '../gate-core.mjs';
import { chainTo, reachableFiles } from './helpers/import-graph.mjs';

const REPO = process.cwd();

/** A tree with one file in every place a digest decision turns on. */
const FILES = {
  'src/components/Switch/Switch.tsx': 'switch',
  'ios/components/Switch.swift': 'swift',
  'android/src/main/java/Switch.kt': 'kotlin',
  'example/src/App.tsx': 'app',
  'example/src/SwitchScreen.tsx': 'screen',
  'example/src/assets/icons/star_24px.xml': 'icon',
  'example/__tests__/Switch.harness.tsx': 'harness test',
  'example/src/pickers/__tests__/Picker.harness.tsx':
    'harness test by a screen',
  'example/e2e/real-input/switch.e2e.ts': 'e2e test',
  'example/e2e/e2e.config.ts': 'e2e config',
  'example/metro.config.js': 'metro',
  'example/rn-harness.config.mjs': 'harness config',
  'scripts/harness.mjs': 'harness entry',
  'scripts/harness-run-state.js': 'run state',
  'scripts/real-input/android-tree-checks.mjs': 'android tree',
  'scripts/real-input/ios.mjs': 'ios runner',
  'scripts/real-input/support.mjs': 'shared runner',
  'scripts/real-input/uiautomator.mjs': 'uiautomator',
  'example/ios/NitroUiExampleUITests/RealInputTests.swift': 'xcuitest',
};

const hashed = (files) =>
  Object.fromEntries(
    Object.entries(files)
      .filter(([file]) => platformsOwningFile(file).length > 0)
      .map(([file, body]) => [file, contentHash(body)])
  );

/** Which gate digests one edit moves. */
function movedBy(file) {
  const before = gateTreesFromEntries(hashed(FILES));
  const after = gateTreesFromEntries(
    hashed({ ...FILES, [file]: `${FILES[file] ?? ''} edited` })
  );
  return DEVICE_GATES.filter((gate) => before[gate] !== after[gate]);
}

describe('each device gate is keyed to the files its own run reads', () => {
  it('an e2e test file moves real-input:android and nothing else', () => {
    expect(movedBy('example/e2e/real-input/switch.e2e.ts')).toEqual([
      'real-input:android',
    ]);
    expect(movedBy('example/e2e/e2e.config.ts')).toEqual([
      'real-input:android',
    ]);
  });

  it('a harness test file moves the harness gates and no real-input gate', () => {
    expect(movedBy('example/__tests__/Switch.harness.tsx')).toEqual([
      'harness:ios',
      'harness:android',
    ]);
    expect(movedBy('scripts/harness.mjs')).toEqual([
      'harness:ios',
      'harness:android',
    ]);
  });

  it('a harness test the testMatch finds under example/src/ moves the harness gates too', () => {
    expect(movedBy('example/src/pickers/__tests__/Picker.harness.tsx')).toEqual(
      DEVICE_GATES
    );
  });

  it('an example screen moves the real-input gates and no harness gate', () => {
    expect(movedBy('example/src/SwitchScreen.tsx')).toEqual([
      'real-input:ios',
      'real-input:android',
    ]);
    expect(movedBy('example/src/App.tsx')).toEqual([
      'real-input:ios',
      'real-input:android',
    ]);
  });

  it('an icon a harness test requires stays in every digest', () => {
    expect(movedBy('example/src/assets/icons/star_24px.xml')).toEqual(
      DEVICE_GATES
    );
  });

  it('src/ and the Metro config move all four', () => {
    expect(movedBy('src/components/Switch/Switch.tsx')).toEqual(DEVICE_GATES);
    expect(movedBy('example/metro.config.js')).toEqual(DEVICE_GATES);
    expect(movedBy('scripts/harness-run-state.js')).toEqual(DEVICE_GATES);
  });

  it('a platform-only real-input file moves only that platform real-input gate', () => {
    expect(movedBy('scripts/real-input/android-tree-checks.mjs')).toEqual([
      'real-input:android',
    ]);
    expect(movedBy('scripts/real-input/ios.mjs')).toEqual(['real-input:ios']);
    expect(movedBy('scripts/real-input/support.mjs')).toEqual([
      'real-input:ios',
      'real-input:android',
    ]);
    // Read by the iOS a11y rule as well as the Android sweep.
    expect(movedBy('scripts/real-input/uiautomator.mjs')).toEqual([
      'real-input:ios',
      'real-input:android',
    ]);
  });

  it('native code moves only its own platform, as the halves do', () => {
    expect(movedBy('ios/components/Switch.swift')).toEqual([
      'harness:ios',
      'real-input:ios',
    ]);
    expect(movedBy('android/src/main/java/Switch.kt')).toEqual([
      'harness:android',
      'real-input:android',
    ]);
    // The UI-test target is not proved out of the harness build, so it stays in.
    expect(
      movedBy('example/ios/NitroUiExampleUITests/RealInputTests.swift')
    ).toEqual(['harness:ios', 'real-input:ios']);
  });

  it('every gate digest is a subset of its platform half', () => {
    for (const gate of DEVICE_GATES) {
      const platform = gate.split(':')[1];
      for (const file of Object.keys(FILES)) {
        if (gateDigestOwnsFile(gate, file)) {
          expect(platformsOwningFile(file)).toContain(platform);
        }
      }
    }
  });

  it('leaves the platform halves as they were', () => {
    const halves = platformTreesFromEntries(hashed(FILES));
    const ios = Object.fromEntries(
      Object.entries(hashed(FILES)).filter(([file]) =>
        platformsOwningFile(file).includes('ios')
      )
    );
    expect(halves.ios).toBe(codeTreeDigest(ios));
    expect(platformsOwningFile('example/e2e/e2e.config.ts')).toEqual([
      'ios',
      'android',
    ]);
  });
});

describe('need --for review asks for a harness gate only when the diff touches it', () => {
  it('an e2e-only diff touches real-input:android and asks for check alone', () => {
    const touched = gatesTouchedByPaths(['example/e2e/real-input/form.e2e.ts']);
    expect(touched).toEqual(['real-input:android']);
    expect(
      requiredGatesFor({
        stage: 'review',
        touchedPlatforms: ['ios', 'android'],
        touchedGates: touched,
      })
    ).toEqual(['check']);
  });

  it('a harness test asks for both harness gates; a Swift file for harness:ios', () => {
    expect(
      requiredGatesFor({
        stage: 'review',
        touchedGates: gatesTouchedByPaths([
          'example/__tests__/Switch.harness.tsx',
        ]),
      })
    ).toEqual(['check', 'harness:ios', 'harness:android']);
    expect(
      requiredGatesFor({
        stage: 'review',
        touchedGates: gatesTouchedByPaths(['ios/core/Thing.swift']),
      })
    ).toEqual(['check', 'harness:ios']);
  });

  it('docs and tooling touch no gate', () => {
    expect(
      gatesTouchedByPaths(['docs/DESIGN.md', 'scripts/gate-core.mjs'])
    ).toEqual([]);
  });

  it('merge still asks for every gate', () => {
    expect(requiredGatesFor({ stage: 'merge', touchedGates: [] })).toHaveLength(
      5
    );
  });
});

describe('a ledger line is compared on the most specific digest both sides carry', () => {
  const entries = hashed(FILES);
  const trees = platformTreesFromEntries(entries);
  const gateTrees = gateTreesFromEntries(entries);
  const tree = codeTreeDigest(entries);
  const line = (overrides) =>
    ledgerLineFromRun({
      gate: 'real-input:ios',
      command: 'node scripts/real-input/ios.mjs',
      tree,
      trees,
      gateTrees,
      treeAfter: tree,
      head: 'abc',
      branch: 'task/x',
      durationMs: 1,
      result: 'pass',
      startedAt: 0,
      ...overrides,
    });

  it('a new line survives an edit outside its gate digest', () => {
    const edited = hashed({
      ...FILES,
      'example/__tests__/Switch.harness.tsx': 'changed',
    });
    const row = gateRowFor({
      gate: 'real-input:ios',
      list: [line({})],
      tree: codeTreeDigest(edited),
      trees: platformTreesFromEntries(edited),
      gateTrees: gateTreesFromEntries(edited),
    });
    expect(row.state).toBe('green');
    expect(row.matched).toBe('real-input:ios');
  });

  it('a line written before the gate digests is compared on its platform half', () => {
    const old = line({ gateTrees: null });
    const same = gateRowFor({
      gate: 'real-input:ios',
      list: [old],
      tree,
      trees,
      gateTrees,
    });
    expect(same.state).toBe('green');
    expect(same.matched).toBe('ios');
    const edited = hashed({
      ...FILES,
      'example/__tests__/Switch.harness.tsx': 'changed',
    });
    const moved = gateRowFor({
      gate: 'real-input:ios',
      list: [old],
      tree: codeTreeDigest(edited),
      trees: platformTreesFromEntries(edited),
      gateTrees: gateTreesFromEntries(edited),
    });
    expect(moved.state).toBe('stale');
    expect(moved.key).toBe('ios');
  });

  it('a line with neither falls back to the full tree', () => {
    const row = gateRowFor({
      gate: 'real-input:ios',
      list: [line({ gateTrees: null, trees: null })],
      tree,
      trees,
      gateTrees,
    });
    expect(row.state).toBe('green');
    expect(row.matched).toBe('full');
  });

  it('decideNeed reads the gate digest for a merge', () => {
    const decision = decideNeed({
      entries: [
        line({}),
        line({ gate: 'real-input:android' }),
        line({ gate: 'harness:ios' }),
        line({ gate: 'harness:android' }),
        line({ gate: 'check' }),
      ],
      tree,
      trees,
      gateTrees,
      stage: 'merge',
    });
    expect(decision.missing).toEqual([]);
  });
});

/* ------------------- the proof that an excluded path is never read ------------------ */

const tracked = (dir) =>
  execFileSync('git', ['ls-files', '-z', dir], { cwd: REPO, encoding: 'utf8' })
    .split('\0')
    .filter((file) => file !== '');

/**
 * The files each device run starts from. Harness: its CLI wrapper, its configs, the
 * Metro and Babel configs, every test file, and the build of the app it installs. A
 * real-input run: its runner, the app's entry and the same Metro and Babel configs;
 * Android also runs the e2e project and installs the `build-app.mjs` APK.
 */
const ROOTS = {
  'harness': () => [
    'scripts/harness.mjs',
    'example/rn-harness.config.mjs',
    'example/jest.harness.config.mjs',
    'example/metro.config.js',
    'example/babel.config.js',
    'scripts/build-app.mjs',
    ...tracked('example/__tests__'),
    ...tracked('example').filter(isHarnessTestFile),
  ],
  'real-input:ios': () => [
    'scripts/real-input/ios.mjs',
    'example/index.js',
    'example/metro.config.js',
    'example/babel.config.js',
  ],
  'real-input:android': () => [
    'scripts/real-input/android.mjs',
    'example/index.js',
    'example/metro.config.js',
    'example/babel.config.js',
    'scripts/build-app.mjs',
    ...tracked('example/e2e'),
  ],
};

/** Files that run in the app rather than in Node, and so cannot open a path. */
const inApp = (file) =>
  ['src/', 'example/src/', 'example/__tests__/'].some((prefix) =>
    file.startsWith(prefix)
  ) || file === 'example/index.js';

/** Is a string a path into an excluded file, as Node code would spell one? */
function namesExcluded(literal, excludedFiles) {
  const text = literal.replace(/\\/g, '/');
  // A sentence that mentions a file is a message, not a path anything opens.
  if (!/^[\w./@-]+$/.test(text)) return null;
  if (!text.includes('/')) {
    // A bare file name, as `path.join(dir, 'rn-harness.config.mjs')` spells it.
    if (!/\.\w+$/.test(text)) return null;
    return (
      excludedFiles.find((file) => path.posix.basename(file) === text) ?? null
    );
  }
  return (
    excludedFiles.find(
      (file) =>
        text.includes(file) || text.endsWith(`/${path.posix.basename(file)}`)
    ) ?? null
  );
}

/** Directories excluded whole, spelled as Node code would join them. */
function namesExcludedDir(literal, gate) {
  const text = literal.replace(/\\/g, '/').replace(/\/+$/, '');
  for (const exclusion of GATE_DIGEST_EXCLUSIONS[gate]) {
    const rule = typeof exclusion === 'string' ? exclusion : exclusion.path;
    if (!rule.endsWith('/')) continue;
    const dir = rule.slice(0, -1);
    // `path.join(root, 'example', 'e2e')` spells the directory one segment at a time.
    const last = dir.slice(dir.lastIndexOf('/') + 1);
    if (
      text === last ||
      text === dir ||
      text.endsWith(`/${dir}`) ||
      text.includes(`${dir}/`)
    ) {
      return dir;
    }
  }
  return null;
}

function excludedFor(gate) {
  return tracked('.').filter(
    (file) =>
      platformsOwningFile(file).includes(gate.split(':')[1]) &&
      !gateDigestOwnsFile(gate, file)
  );
}

/**
 * Every file a gate reaches that its digest leaves out, and every path to such a file
 * that reached Node code spells out, with how it was reached.
 */
function violations(gate, roots) {
  const excluded = new Set(excludedFor(gate));
  const reached = reachableFiles(REPO, roots);
  const found = [];
  for (const [file, record] of reached) {
    if (excluded.has(file)) {
      found.push(`${gate} reads ${chainTo(reached, file)}`);
      continue;
    }
    if (inApp(file)) continue;
    for (const literal of record.literals) {
      const hit =
        namesExcluded(literal, [...excluded]) ??
        namesExcludedDir(literal, gate);
      if (hit != null) {
        found.push(
          `${gate}: ${file} names "${literal}", which the ${gate} digest leaves out (${hit})`
        );
      }
    }
  }
  return found;
}

describe('a path leaves a gate digest only when that gate never reads it', () => {
  for (const gate of ['harness:ios', 'harness:android']) {
    it(`${gate} reaches no real-input file and no example screen`, () => {
      expect(violations(gate, ROOTS.harness())).toEqual([]);
    });
  }

  it('real-input:ios reaches no harness-only file and no Android-only real-input file', () => {
    expect(violations('real-input:ios', ROOTS['real-input:ios']())).toEqual([]);
  });

  it('real-input:android reaches no harness-only file and no iOS-only real-input file', () => {
    expect(
      violations('real-input:android', ROOTS['real-input:android']())
    ).toEqual([]);
  });

  it('the walk does reach what it should, so an empty answer means something', () => {
    const harness = reachableFiles(REPO, ROOTS.harness());
    expect(harness.has('src/index.ts')).toBe(true);
    expect(harness.has('scripts/harness-run-state.js')).toBe(true);
    const ios = reachableFiles(REPO, ROOTS['real-input:ios']());
    expect(ios.has('example/src/App.tsx')).toBe(true);
    expect(ios.has('scripts/real-input/uiautomator.mjs')).toBe(true);
    const android = reachableFiles(REPO, ROOTS['real-input:android']());
    expect(android.has('scripts/real-input/png-pixel.mjs')).toBe(true);
  });

  it('every exclusion names a path that exists, so a rename cannot leave a stale one', () => {
    for (const gate of DEVICE_GATES) {
      for (const exclusion of GATE_DIGEST_EXCLUSIONS[gate]) {
        const rule = typeof exclusion === 'string' ? exclusion : exclusion.path;
        expect([rule, fs.existsSync(path.join(REPO, rule))]).toEqual([
          rule,
          true,
        ]);
      }
    }
  });

  it('the digests keep exactly the files the harness testMatch selects', () => {
    const exampleDir = path.join(REPO, 'example');
    const selects = (patterns) => {
      const globs = patterns.map((glob) =>
        glob.replace('<rootDir>', exampleDir)
      );
      const yes = globs.filter((glob) => !glob.startsWith('!'));
      const no = globs.filter((glob) => glob.startsWith('!'));
      // jest-util's globsToMatcher: any positive glob and no negated one, with dot files.
      const any = picomatch(yes, { dot: true });
      const none =
        no.length > 0
          ? picomatch(
              no.map((glob) => glob.slice(1)),
              { dot: true }
            )
          : () => false;
      return (file) =>
        any(path.join(REPO, file)) && !none(path.join(REPO, file));
    };
    const testMatch = (isolated) => {
      const before = process.env.NITRO_UI_HARNESS_ISOLATED;
      process.env.NITRO_UI_HARNESS_ISOLATED = isolated ? '1' : '0';
      let config;
      jest.isolateModules(() => {
        config = require('../../example/jest.harness.config.mjs').default;
      });
      if (before === undefined) delete process.env.NITRO_UI_HARNESS_ISOLATED;
      else process.env.NITRO_UI_HARNESS_ISOLATED = before;
      return config.testMatch;
    };
    const plain = selects(testMatch(false));
    const isolated = selects(testMatch(true));
    const candidates = [
      ...tracked('example'),
      'example/src/pickers/__tests__/Picker.harness.tsx',
      'example/src/__tests__/isolated/Cold.harness.ts',
      'example/src/__tests__/helpers.ts',
      'example/src/PickerScreen.harness.tsx',
      'example/e2e/__tests__/form.harness.jsx',
    ];
    for (const file of candidates) {
      const run = plain(file) || isolated(file);
      expect([file, isHarnessTestFile(file)]).toEqual([file, run]);
      if (run) {
        expect([file, gateDigestOwnsFile('harness:ios', file)]).toEqual([
          file,
          true,
        ]);
        expect([file, gateDigestOwnsFile('harness:android', file)]).toEqual([
          file,
          true,
        ]);
      }
    }
    // The fixture has to exercise both answers, or the loop above proves nothing.
    expect(candidates.filter((file) => plain(file))).toContain(
      'example/src/pickers/__tests__/Picker.harness.tsx'
    );
    expect(candidates.filter((file) => isolated(file))).toContain(
      'example/src/__tests__/isolated/Cold.harness.ts'
    );
  });

  it('a harness run never bundles the app entry: react-native-harness swaps it', () => {
    // The harness is told the app entry is `./index.js` ...
    const config = fs.readFileSync(
      path.join(REPO, 'example/rn-harness.config.mjs'),
      'utf8'
    );
    expect(config).toMatch(/entryPoint:\s*'\.\/index\.js'/);
    // ... and its Metro resolver answers a request for that entry with its own
    // runtime entry, which registers the harness UI and imports nothing of the app.
    const resolver = fs.readFileSync(
      path.join(
        REPO,
        'node_modules/@react-native-harness/bundler-metro/dist/resolvers/resolver.js'
      ),
      'utf8'
    );
    expect(resolver).toContain('createHarnessEntryPointResolver');
    expect(resolver).toContain("'@react-native-harness/runtime/entry-point'");
    const entry = fs.readFileSync(
      path.join(
        REPO,
        'node_modules/@react-native-harness/runtime/dist/entry-point.js'
      ),
      'utf8'
    );
    const imports = [...entry.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(
      imports.every((spec) => spec === 'react-native' || spec.startsWith('./'))
    ).toBe(true);
  });
});
