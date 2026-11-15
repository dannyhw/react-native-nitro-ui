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
  checkRecycleNotes,
  coverageMatrix,
  failingKeys,
  recycleNotes,
} from '../conformance-core.mjs';
import { SCREEN_TAB, screenTab } from '../real-input/screens.mjs';
import { exampleTabs } from '../real-input/tab-targets.mjs';

/** Where the conformance suite keeps its per-control fixtures, and its tables. */
const HARNESS_FILE = 'example/__tests__/Conformance.harness.tsx';

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
 * function it sits in. A file can render the same batch two ways, and a control
 * added to only one of them still appears in the file.
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
  // Each arm dispatches on `component` and falls back to rendering the Switch, so
  // a control missing from an arm is not a type error: its cell silently
  // measures Switches.
  const benchIds = () => manifests.filter((m) => m.bench === true);
  const mentionsId = (id) => `component === '${id}'`;
  // The id every arm falls through to (see the fallback test below).
  const fallback = 'switch';

  it("exactly one control is the arms' fallback, and it is named", () => {
    // Every arm ends by rendering the Switch without testing `component`, so it
    // is the one id the per-arm assertion cannot look for.
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
      const wanted = benchIds().filter((m) => m.id !== fallback);
      expect(missingFrom(source, mentionsId, wanted)).toEqual([]);
    });

    it(`${path} handles every component in each of its render paths`, () => {
      // A rename inside one of the file's two render paths leaves the id in the
      // file, so the check above still passes.
      const groups = dispatchesByFunction(readRepo(path) ?? '');
      expect(groups.length).toBeGreaterThan(0);
      // Every id the file dispatches on anywhere, minus the fallback.
      const widest = [...new Set(groups.flatMap((group) => [...group.ids]))]
        .filter((id) => id !== fallback)
        .sort();
      // Each path handles a control explicitly or falls through to the fallback,
      // so the sets are equal once that id is excluded.
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
    // The host arm is scheduled for controls that are hostable and benched, the
    // same rule `hostArm()` in scripts/registry-core.mjs uses. `hostable` alone
    // is not that set.
    const hostArm = manifests.filter(
      (m) => m.hostable === true && m.bench === true
    );
    expect(
      missingFrom(
        readRepo('bench/src/implementations/nitroUi.tsx'),
        mentionsId,
        hostArm
      )
    ).toEqual([]);
  });
});

/**
 * The tabs `example/src/App.tsx` renders, in bar order, read from its `TABS` array.
 */
function appTabs() {
  return exampleTabs(readRepo('example/src/App.tsx'));
}

/** Every string the example app draws, so an echo testID can be proved to exist. */
function exampleSourceText() {
  return readdirSync(join(repoRoot, 'example/src'))
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => readRepo(`example/src/${name}`) ?? '')
    .join('\n');
}

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

  it('names each control exactly once, because the table is the run order', () => {
    // Both runners walk this list, so a second row for one id would run that
    // control's check twice, the second time on the viewport the first left.
    const ids = controls().map((control) => control.id);
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
  });

  // One test per row, so a failure names the control whose check vanished rather than
  // failing on whichever one sorts first.
  for (const control of controls()) {
    it(`${control.id} has a check on both platforms`, () => {
      // Android is a suite of files, one per control: e2e collects each file on its
      // own, so a control whose file was deleted does not fail — it runs nothing.
      // The same silent gap the old driver's `CHECKS` comparison guarded.
      const file = `example/e2e/real-input/${control.id}.e2e.ts`;
      // Named in the value rather than in a message argument, which jest ignores.
      expect(
        existsSync(join(repoRoot, file))
          ? 'present'
          : `${file} is missing, so no real touch is delivered to ` +
              `"${control.id}" and nothing would notice`
      ).toBe('present');
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

    it(`${control.id}'s screen can be reached on Android`, () => {
      // The post-suite reads reach a screen by the tab row in
      // `scripts/real-input/screens.mjs` and then poll an echo testID to learn
      // the screen came up, so a screen missing from that table is a run that
      // dies mid-way on a device instead of a failing `check`.
      const { id } = appTabs().find((tab) => tab.id === control.screen) ?? {};
      // Named in the value rather than in a message argument, which jest ignores.
      expect(String(id)).not.toBe('undefined');
      const tab = screenTab(control.screen);
      // The echo has to be drawn by something. Matched against every example
      // source, because a screen can borrow its echo from a widget it renders.
      const drawn = new RegExp(`["'\`]${tab.anchor}["'\`]`).test(
        exampleSourceText()
      );
      expect(drawn).toBe(true);
    });

    it(`${control.id}'s Android check opens the screen its row names`, () => {
      // The e2e suite reaches a screen by tapping the tab whose testID is
      // `tab-<screen>`, so the pair that has to agree is the row's `screen` and
      // the `openScreen` call in the control's own file. A device gate is the
      // wrong place to discover that the two disagree.
      const text =
        readRepo(`example/e2e/real-input/${control.id}.e2e.ts`) ?? '';
      expect(
        text.includes(`openScreen(screen, '${control.screen}')`)
          ? 'opens it'
          : `example/e2e/real-input/${control.id}.e2e.ts never opens the ` +
              `screen "${control.screen}" that scripts/real-input/controls.mjs ` +
              'names for it'
      ).toBe('opens it');
    });
  }
});

describe('the Android navigation table agrees with the tab bar', () => {
  it('no row names a tab the example app stopped rendering', () => {
    const ids = new Set(appTabs().map((tab) => tab.id));
    expect(
      Object.keys(SCREEN_TAB).filter((screen) => !ids.has(screen))
    ).toEqual([]);
  });

  it('an unknown screen is named in the failure, not tapped as "undefined"', () => {
    let message = '<did not throw>';
    try {
      screenTab('searchfield-typo');
    } catch (error) {
      message = String(error.message);
    }
    expect(message).toContain('searchfield-typo');
    expect(message).toContain('SCREEN_TAB');
    expect(message).toContain('scripts/real-input/screens.mjs');
  });
});

describe('every component is covered by the conformance suite', () => {
  it('every manifest is covered, or has a stated reason', () => {
    const read = (p) => readRepo(p);
    const sizing = JSON.parse(read('nitro-ui.sizing.json') ?? '{}');
    const matrix = coverageMatrix(manifests, {
      sizing,
      failing: failingKeys(),
      // The recycle column reads the fixture table's notes, so `n/a` is the
      // suite's own sentence.
      recycleNotes: recycleNotes(read(HARNESS_FILE)),
    });
    expect(checkCoverage(manifests, matrix)).toEqual([]);
    expect(checkA11yTable(manifests, read)).toEqual([]);
    expect(checkInAppFixtures(manifests, read(HARNESS_FILE))).toEqual([]);
    expect(checkRecycleNotes(read(HARNESS_FILE))).toEqual([]);
  });

  it('the debt the matrix reports is the debt the runner reports', () => {
    // The keys are read from the exemption lists, so adding or retiring a row
    // does not edit this test.
    const keys = failingKeys();
    expect(new Set(keys).size).toBe(keys.length);
    // …and every one of those cells really is marked failing in the matrix.
    const matrix = coverageMatrix(manifests, {
      sizing: JSON.parse(readRepo('nitro-ui.sizing.json') ?? '{}'),
      failing: keys,
      recycleNotes: recycleNotes(readRepo(HARNESS_FILE)),
    });
    for (const key of keys) {
      const [name, rule] = key.split('|');
      expect(matrix.find((row) => row.name === name).rules[rule].state).toBe(
        'failing'
      );
    }
    // A control whose fixture says it holds nothing a reset could clear is
    // `not-applicable`, never `covered`.
    const notes = recycleNotes(readRepo(HARNESS_FILE));
    for (const [name, note] of Object.entries(notes)) {
      const cell = matrix.find((row) => row.name === name).rules[
        'recycle-reset'
      ];
      if (note.kind === 'probe') {
        expect(`${name}: ${cell.state}`).toBe(`${name}: covered`);
        continue;
      }
      expect(`${name}: ${cell.state}`).toBe(
        note.kind === 'noProbe' ? `${name}: not-applicable` : `${name}: failing`
      );
      if (note.kind === 'noProbe') {
        // The reason is the fixture's sentence, not a paraphrase written beside the matrix.
        expect(cell.reason).toContain(note.reason.slice(0, 40));
      }
    }
  });
});

describe('every component has the hand-written files behind its generated rows', () => {
  it('the example app defines a screen for each tab', () => {
    // The generated screen switch renders `<${Name}Screen />`. Looking for the
    // function name catches a file that is named for a different component.
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
