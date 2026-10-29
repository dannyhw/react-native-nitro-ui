// Per-component *behaviour* stays hand-written (X3 brief): the bench arms dispatch on
// `component === '…'`, and the real-input suite has one check per control on each
// platform. Nothing in the compiler or the registry notices when a new control is
// missing from one of those tables - the arm renders nothing, or the suite runs one
// check fewer - so this file says so. Same shape as `src/__tests__/host.test.tsx`,
// which asserts the hostable set rather than generating it.
//
// These are text scans of the real sources rather than imports: the bench arms are
// React Native modules jest cannot render here (they need Nitro and the Expo UI
// package), and the iOS checks are Swift. What a scan can prove is the thing that
// actually goes missing - that the table has a case for this control at all. Each
// check collects what is absent and asserts the list is empty, so a failure names the
// controls rather than dumping a source file.

import { beforeAll, describe, expect, it } from '@jest/globals';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  MANIFEST_BASENAME,
  checkRealInputRows,
  manifestsFromEntries,
  renderedTabs,
} from '../registry-core.mjs';
import {
  checkA11yTable,
  checkCoverage,
  checkInAppFixtures,
  coverageMatrix,
  failingKeys,
  followupsResolver,
} from '../conformance-core.mjs';

/** Where the conformance suite keeps its per-control fixtures, and its tables. */
const HARNESS_FILE = 'example/__tests__/Conformance.harness.tsx';
/** The document every `failing` cell has to be able to cite. */
const FOLLOWUPS_FILE = 'docs/tasks/FOLLOWUPS.md';

const repoRoot = resolve(process.cwd());

function readRepo(path) {
  return existsSync(join(repoRoot, path))
    ? readFileSync(join(repoRoot, path), 'utf8')
    : null;
}

beforeAll(() => {
  if (!existsSync(join(repoRoot, 'src/components'))) {
    throw new Error(
      `Run jest from the repository root (looked in ${repoRoot}).`
    );
  }
});

const manifests = manifestsFromEntries(
  readdirSync(join(repoRoot, 'src/components'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((directory) => ({
      directory,
      text: readRepo(`src/components/${directory}/${MANIFEST_BASENAME}`),
    }))
    .filter((entry) => entry.text != null)
);

/**
 * The ids of `selected` whose `pattern` does not appear in `source`.
 *
 * @param {string | null} source
 * @param {(id: string) => RegExp | string} pattern
 * @param {any[]} selected
 */
function missingFrom(source, pattern, selected) {
  if (source == null) return ['<file missing>'];
  return selected
    .map((manifest) => manifest.id)
    .filter((id) => {
      const want = pattern(id);
      return typeof want === 'string'
        ? !source.includes(want)
        : !want.test(source);
    });
}

/**
 * The ids each `component === '…'` dispatch in `source` handles, grouped by the
 * function it sits in.
 *
 * A file can render the same batch two ways - `nitroUi.tsx` does, once as the plain
 * arm and once inside the shared `<Host>` - and adding a control to one of them and not
 * the other is exactly the miss that produces a number nobody asked for. The per-file
 * assertion below cannot see that, because the id does appear in the file.
 */
function dispatchesByFunction(source) {
  const groups = [];
  let current = null;
  for (const line of source.split('\n')) {
    if (/^(?:export )?function \w+/.test(line)) {
      current = { name: line.trim(), ids: new Set() };
      groups.push(current);
      continue;
    }
    const match = /component === '([a-z0-9-]+)'/.exec(line);
    if (match && current) current.ids.add(match[1]);
  }
  return groups.filter((group) => group.ids.size > 0);
}

describe('every bench component is implemented by every arm', () => {
  // Each arm dispatches on `component` and ends with a fallback that renders the
  // Switch - the first component, and the one the bare `mount`/`update` scenario names
  // (`splitScenario` in plan.ts). So a control missing from an arm is not a type error:
  // the cell silently measures seven more Switches, and the table prints a ratio for
  // it. Asserting the branch is present is the only thing between a typo in a manifest
  // id and a published number that is not what it claims to be.
  const benchIds = () => manifests.filter((m) => m.bench === true);
  const mentionsId = (id) => `component === '${id}'`;
  // The id every arm falls through to (see the fallback test below).
  const fallback = 'switch';

  it("exactly one control is the arms' fallback, and it is named", () => {
    // Every arm ends by rendering the Switch without testing `component`, which is
    // what `splitScenario` relies on: a bare `mount` is the switch's cell. That makes
    // it the one id the per-arm assertion cannot look for, so it is named here instead -
    // change it and this test says so rather than the arms quietly disagreeing.
    expect(
      manifests.filter((m) => m.benchUnsuffixed === true).map((m) => m.id)
    ).toEqual(['switch']);
  });

  for (const path of [
    'bench/src/implementations/nitroUi.tsx',
    'bench/src/implementations/rnCore.tsx',
    'bench/src/implementations/expoUi.ios.tsx',
    'bench/src/implementations/expoUi.android.tsx',
  ]) {
    it(`${path} handles every component in the plan`, () => {
      const source = readRepo(path);
      // `bench/src/types.ts`'s docstring spells out the consequence for the arm that
      // gets it wrong: a cell the plan asks for and no arm implements must fail the
      // launch, not measure the wrong control.
      const wanted = benchIds().filter((m) => m.id !== fallback);
      expect(missingFrom(source, mentionsId, wanted)).toEqual([]);
    });

    it(`${path} handles every component in each of its render paths`, () => {
      // The stronger form: a rename or deletion inside one of the file's two render
      // paths leaves the id in the file, so the check above still passes while that one
      // path now renders the wrong control.
      const groups = dispatchesByFunction(readRepo(path) ?? '');
      expect(groups.length).toBeGreaterThan(0);
      // Every id the file dispatches on anywhere, minus the fallback.
      const widest = [...new Set(groups.flatMap((group) => [...group.ids]))]
        .filter((id) => id !== fallback)
        .sort();
      // Each path handles a control explicitly or falls through to the fallback, so the
      // sets are equal once that one id is excluded. Collecting the offenders means the
      // failure names the function that lost the branch.
      const narrow = groups
        .filter(
          (group) =>
            JSON.stringify(
              [...group.ids].filter((id) => id !== fallback).sort()
            ) !== JSON.stringify(widest)
        )
        .map((group) => group.name);
      expect(narrow).toEqual([]);
    });
  }

  it('the host arm handles exactly the hostable set the plan asks for', () => {
    // The nitro-ui-host arm refuses anything outside its `components` list, and the
    // plan may only ask for what the arm accepts. Both sides come from the manifests
    // now, so the pair has to be compared once.
    const hostable = manifests.filter((m) => m.hostable === true);
    expect(
      missingFrom(
        readRepo('bench/src/implementations/nitroUi.tsx'),
        mentionsId,
        hostable
      )
    ).toEqual([]);
  });
});

describe('every real-input control has a check on both platforms', () => {
  const controls = () => {
    const text = readRepo('scripts/real-input/controls.mjs') ?? '';
    // Row blocks, parsed rather than pattern-matched on the whole row: a long title is
    // wrapped by prettier onto its own line, and the check must not depend on where.
    const rows = [];
    let current = null;
    for (const line of text.split('\n')) {
      if (line === '  {') current = {};
      else if (line === '  },' && current) {
        if (current.id) rows.push(current);
        current = null;
      } else if (current) {
        const id = /^ {4}id: '([a-z0-9-]+)',$/.exec(line);
        const screen = /^ {4}screen: '([a-z0-9]+)',$/.exec(line);
        if (id) current.id = id[1];
        if (screen) current.screen = screen[1];
      }
    }
    return rows;
  };

  it('the shared table lists every control whose manifest asks for one', () => {
    expect(
      checkRealInputRows(
        manifests.filter((m) => m.realInput === true),
        controls().map((control) => control.id)
      )
    ).toEqual([]);
  });

  it('every row names a screen the example app renders', () => {
    const tabs = new Set(
      renderedTabs(readRepo('example/src/App.tsx')).map((tab) => tab.tab)
    );
    expect(
      controls()
        .filter((control) => !tabs.has(control.screen))
        .map((control) => `${control.id} -> ${control.screen}`)
    ).toEqual([]);
  });

  // One test per row, so a failure names the control whose check vanished rather than
  // failing on whichever one sorts first.
  for (const control of controls()) {
    it(`${control.id} has a check on both platforms`, () => {
      expect(
        new RegExp(`^ {2}'${control.id}': async \\(t\\)`, 'm').test(
          readRepo('scripts/real-input/android.mjs') ?? ''
        )
      ).toBe(true);
      // The Swift check is named for the row id, camel-cased: `segmented-control` ->
      // `testRealInputSegmentedControl`, `hosted-slider` -> `testRealInputHostedSlider`.
      const pascal = `${control.id[0].toUpperCase()}${control.id
        .slice(1)
        .replace(/-([a-z0-9])/g, (_, letter) => letter.toUpperCase())}`;
      expect(
        (
          readRepo('example/ios/NitroUiExampleUITests/RealInputTests.swift') ??
          ''
        ).includes(`func testRealInput${pascal}(`)
      ).toBe(true);
    });
  }
});

describe('every component is covered by the conformance suite', () => {
  // X4's four rules are manifest-driven, which is only worth something if a manifest
  // nothing checks is impossible. This is the one place that asks the question for all
  // three tables at once — the rule × control matrix, the host-side a11y sweep's case
  // table, and the harness suite's fixture table — so a new control cannot land in the
  // registry without landing in the suite. The mechanism each check uses is tested in
  // `conformance.test.js`; this is the guard that runs it on the real tree.
  it('every manifest is covered, or has a stated reason', () => {
    const read = (p) => readRepo(p);
    const sizing = JSON.parse(read('nitro-ui.sizing.json') ?? '{}');
    const matrix = coverageMatrix(manifests, {
      sizing,
      failing: failingKeys(),
    });
    // A `failing` cell needs a line that exists in FOLLOWUPS.md, which is what
    // `followupsResolver` proves by returning null when the text is not there.
    expect(
      checkCoverage(manifests, matrix, followupsResolver(read(FOLLOWUPS_FILE)))
    ).toEqual([]);
    expect(checkA11yTable(manifests, read)).toEqual([]);
    expect(checkInAppFixtures(manifests, read(HARNESS_FILE))).toEqual([]);
  });

  it('the debt the matrix reports is the debt the runner reports', () => {
    // Two views of the same debt: the matrix prints `failing`, and the device run prints
    // `known failing` lines from the exemption lists. Deriving one from the other is what
    // keeps a report's coverage table honest when a row is added or removed.
    //
    // Three controls, and each one is a measurement rather than a guess: the Slider and
    // SegmentedControl names are on nodes a screen reader cannot act on in a dump
    // (Android), and the Slider is announced as the wrong kind of control (iOS), and a
    // hosted Picker announces its name twice. The two platforms fail some of the same
    // controls for different reasons, which is why `A11Y_EXEMPTIONS` rows carry a platform.
    const keys = failingKeys();
    expect(keys).toEqual([
      'Slider|a11y-name-on-focusable-node',
      'SegmentedControl|a11y-name-on-focusable-node',
      'Picker|a11y-name-on-focusable-node',
    ]);
    // …and every one of those cells really is marked failing in the matrix.
    const matrix = coverageMatrix(manifests, {
      sizing: JSON.parse(readRepo('nitro-ui.sizing.json') ?? '{}'),
      failing: keys,
    });
    for (const key of keys) {
      const [name, rule] = key.split('|');
      expect(matrix.find((row) => row.name === name).rules[rule].state).toBe(
        'failing'
      );
    }
  });
});

describe('every component has the hand-written files behind its generated rows', () => {
  it('the example app defines a screen for each tab', () => {
    // The generated screen switch renders `<${Name}Screen />`, so a missing file is a
    // build break; looking for the function name catches the subtler case of a file
    // that exists and is named for a different component.
    const absent = manifests
      .map((m) => `example/src/${m.name}Screen.tsx`)
      .filter(
        (path) =>
          !readRepo(path)?.includes(
            `function ${path.split('/').pop().replace('.tsx', '')}(`
          )
      );
    expect(absent).toEqual([]);
  });

  it('the library has a wrapper, a Nitro spec and a config for each', () => {
    const absent = manifests
      .flatMap((m) => [
        `src/components/${m.name}/${m.name}.tsx`,
        `src/components/${m.name}/${m.name}.nitro.ts`,
        `src/components/${m.name}/NitroUi${m.name}Config.ts`,
      ])
      .filter((path) => !existsSync(join(repoRoot, path)));
    expect(absent).toEqual([]);
  });
});
