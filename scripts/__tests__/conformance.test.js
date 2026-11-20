import { describe, expect, it } from 'vitest';

import {
  CONFORMANCE_EXEMPTIONS,
  CONFORMANCE_RULES,
  CONTENT_SIZED_BOX,
  DECLARED_FALLBACKS,
  HEIGHT_ONLY_FALLBACK,
  POISON_SIZES,
  repoRoot,
  RULE_IDS,
  boxRuleFor,
  checkA11yTable,
  checkContentSizedBox,
  checkCoverage,
  checkFallbackTable,
  failingKeys,
  recycleNotes,
  checkInAppFixtures,
  checkRecycleNotes,
  checkLaunchPinAgreesWithTable,
  checkSharedTableMirror,
  coverageMatrix,
  findingKey,
  readerFor,
  repoManifests,
  repoSizingTable,
  sharedInAppTable,
} from '../conformance-core.mjs';
import {
  A11Y_CONTROLS,
  A11Y_EXEMPTIONS,
  A11Y_PRESENTATIONS,
} from '../real-input/a11y.mjs';
import { runA11ySweep, SCROLL_PROBE_LIMIT } from '../real-input/a11y-sweep.mjs';
import { parseHierarchy } from '../real-input/uiautomator.mjs';
import { Suite } from '../real-input/report.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = readerFor();

function manifest(overrides = {}) {
  return {
    id: 'switch',
    name: 'Switch',
    hybridView: 'NitroUiSwitch',
    sizing: 'intrinsic',
    exampleTab: 'switch',
    ...overrides,
  };
}

// Not `structuredClone`: the lint config declares no globals for this directory.
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function repoWithExtraControl(extra) {
  const manifests = repoManifests();
  if (extra != null) manifests.push(manifest(extra));
  return manifests;
}

/* ---------------------------------- the rules --------------------------------- */

describe('the rule list', () => {
  it('is the four rules, each with the gates that assert it', () => {
    expect(RULE_IDS).toEqual([
      'a11y-name-on-focusable-node',
      'declared-fallback',
      'no-leak-on-drop',
      'recycle-reset',
    ]);
    for (const rule of CONFORMANCE_RULES) {
      expect(rule.title.length).toBeGreaterThan(0);
      expect(rule.runs.length).toBeGreaterThan(0);
      for (const gate of rule.runs) {
        expect(gate).toMatch(/^(harness|real-input):(ios|android)$/);
      }
    }
    expect(
      CONFORMANCE_RULES.find((r) => r.id === 'a11y-name-on-focusable-node').runs
    ).toContain('real-input:android');
  });

  it('answers every rule for a self-sizing control, and says why for one that is not', () => {
    const sizing = JSON.parse(read('nitro-ui.sizing.json'));
    const covered = coverageMatrix([manifest()], { sizing });
    expect(
      Object.values(covered[0].rules).every((cell) => cell.state === 'covered')
    ).toBe(true);

    const plain = coverageMatrix(
      [manifest({ id: 'label', name: 'Label', sizing: undefined })],
      { sizing }
    );
    expect(plain[0].rules['declared-fallback'].state).toBe('not-applicable');
    expect(plain[0].rules['declared-fallback'].reason).toContain(
      'no sizing policy'
    );
    expect(plain[0].rules['no-leak-on-drop'].state).toBe('not-applicable');
    expect(plain[0].rules['recycle-reset'].state).toBe('covered');
  });

  it('picks up a control that does not exist yet', () => {
    const sizing = JSON.parse(read('nitro-ui.sizing.json'));
    const extra = repoWithExtraControl({
      id: 'rating',
      name: 'Rating',
      hybridView: 'NitroUiRating',
      sizing: 'intrinsic',
      exampleTab: 'rating',
    });
    const matrix = coverageMatrix(extra, { sizing });
    const rating = matrix.find((row) => row.name === 'Rating');
    expect(rating).toBeDefined();
    expect(rating.rules['a11y-name-on-focusable-node'].state).toBe('covered');
    expect(rating.rules['declared-fallback'].state).toBe('covered');
    expect(rating.rules['recycle-reset'].state).toBe('covered');
    expect(checkA11yTable(extra, read).join('\n')).toContain(
      'no a11y case for Rating'
    );
  });
});

/* ---------------------------------- coverage ---------------------------------- */

describe('coverage', () => {
  it('is complete for every control the registry declares', () => {
    const manifests = repoManifests();
    expect(manifests.map((m) => m.name)).toEqual([
      'BottomSheet',
      'Button',
      'ButtonGroup',
      'Checkbox',
      'Chip',
      'ContextMenu',
      'DatePicker',
      'Dialog',
      'Form',
      'IconButton',
      'ListItem',
      'Menu',
      'Picker',
      'Popover',
      'Progress',
      'SearchField',
      'SegmentedControl',
      'Slider',
      'Stepper',
      'Switch',
      'TextField',
      'Tooltip',
    ]);
    const matrix = coverageMatrix(manifests, {
      sizing: JSON.parse(read('nitro-ui.sizing.json')),
    });
    expect(checkCoverage(manifests, matrix)).toEqual([]);
  });

  it('goes red for a manifest no rule covers', () => {
    const manifests = repoWithExtraControl({
      id: 'rating',
      name: 'Rating',
      hybridView: 'NitroUiRating',
      sizing: undefined,
      exampleTab: 'rating',
    });
    const matrix = coverageMatrix(manifests, { sizing: {} });
    const problems = checkCoverage(manifests, matrix);
    expect(problems).toEqual([]);
    expect(checkA11yTable(manifests, () => null).join('\n')).toContain(
      'no a11y case for Rating'
    );
  });

  it('goes red when a matrix row is missing or a cell has no verdict', () => {
    const manifests = repoManifests();
    const matrix = coverageMatrix(manifests, { sizing: {} });
    expect(checkCoverage(manifests, matrix.slice(1))[0]).toContain(
      'a manifest with no row'
    );
    const broken = clone(matrix);
    delete broken[0].rules['recycle-reset'];
    expect(checkCoverage(manifests, broken)[0]).toContain('no verdict');
  });
});

/* ------------------------------ the fallback table -------------------------- */

describe('the declared-fallback rule', () => {
  it('goes red when a fallback is shared by two controls', () => {
    const manifests = repoManifests();
    const sizing = JSON.parse(read('nitro-ui.sizing.json'));
    const copied = clone(DECLARED_FALLBACKS);
    copied.NitroUiSlider.ios = { ...copied.NitroUiSwitch.ios };
    const problems = checkFallbackTable(manifests, sizing, copied);
    expect(problems.join('\n')).toContain(
      '61x28 on ios for NitroUiSlider and NitroUiSwitch'
    );
    expect(problems.join('\n')).toContain('one of these rows was copied');
  });

  it('excuses exactly the one shared row, and nobody else at that size', () => {
    expect(
      checkFallbackTable(repoManifests(), repoSizingTable()).join('\n')
    ).not.toContain('48x48');

    const thirdAndroidOwner = clone(DECLARED_FALLBACKS);
    thirdAndroidOwner.NitroUiMenu.android = { width: 48, height: 48 };
    const androidJoined = checkFallbackTable(
      repoManifests(),
      repoSizingTable(),
      thirdAndroidOwner
    ).join('\n');
    expect(androidJoined).toContain('48x48 on android');
    expect(androidJoined).toContain('NitroUiMenu');
    expect(androidJoined).toContain('one of these rows was copied');

    const asItStands = checkFallbackTable(repoManifests(), repoSizingTable());
    expect(asItStands.join('\n')).not.toContain('61x28');

    const sizing = repoSizingTable();
    const three = clone(DECLARED_FALLBACKS);
    three.NitroUiSlider.ios = { ...three.NitroUiSwitch.ios };
    const joined = checkFallbackTable(repoManifests(), sizing, three).join(
      '\n'
    );
    expect(joined).toContain('61x28 on ios for');
    expect(joined).toContain('NitroUiSlider');
    expect(joined).toContain('one of these rows was copied');

    const moved = clone(DECLARED_FALLBACKS);
    moved.NitroUiMenu.ios = { width: 61, height: 30 };
    moved.NitroUiSwitch.ios = { width: 61, height: 30 };
    expect(
      checkFallbackTable(repoManifests(), sizing, moved).join('\n')
    ).toContain('61x30 on ios');
  });

  it('goes red when a control has no row in the table', () => {
    const manifests = repoWithExtraControl({
      id: 'rating',
      name: 'Rating',
      hybridView: 'NitroUiRating',
      sizing: 'intrinsic',
      exampleTab: 'rating',
    });
    const problems = checkFallbackTable(
      manifests,
      {
        ...JSON.parse(read('nitro-ui.sizing.json')),
        HybridNitroUiRating: 'intrinsic',
      },
      DECLARED_FALLBACKS
    );
    expect(problems.join('\n')).toContain(
      'no DECLARED_FALLBACKS row for NitroUiRating'
    );
  });

  it('goes red when the sizing table and the manifest disagree', () => {
    const manifests = repoManifests();
    const sizing = JSON.parse(read('nitro-ui.sizing.json'));
    const problems = checkFallbackTable(
      manifests,
      { ...sizing, HybridNitroUiSwitch: 'deferred' },
      DECLARED_FALLBACKS
    );
    expect(problems.join('\n')).toContain(
      'HybridNitroUiSwitch says "deferred"'
    );
    const missing = checkFallbackTable(manifests, {}, DECLARED_FALLBACKS);
    expect(missing[0]).toContain('no row for Hybrid');
    expect(missing[0]).toContain('0x0');
  });

  it('goes red when a declared size is not positive', () => {
    const zeroed = clone(DECLARED_FALLBACKS);
    zeroed.NitroUiButton.android = { width: 0, height: 48 };
    expect(
      checkFallbackTable(
        repoManifests(),
        JSON.parse(read('nitro-ui.sizing.json')),
        zeroed
      ).join('\n')
    ).toContain('is not a positive size');
  });

  it('passes the clean tables, which is the assertion the mutations above are measured against', () => {
    expect(
      checkFallbackTable(
        repoManifests(),
        JSON.parse(read('nitro-ui.sizing.json'))
      )
    ).toEqual([]);
  });

  it('uses the poison size for the platform under test', () => {
    expect(POISON_SIZES.android).not.toEqual(POISON_SIZES.ios);
    const allSizes = new Set(
      Object.values(DECLARED_FALLBACKS).flatMap((entry) => [
        `${String(entry.ios.width)}x${String(entry.ios.height)}`,
        `${String(entry.android.width)}x${String(entry.android.height)}`,
      ])
    );
    for (const platform of ['ios', 'android']) {
      const size = POISON_SIZES[platform];
      expect(allSizes.has(`${String(size.width)}x${String(size.height)}`)).toBe(
        false
      );
    }
  });
});

/* ---------------------- the box rule: which axes are the control's ------------- */

describe('which axes a declared fallback describes', () => {
  it('reads the axis from the generated sizing policy', () => {
    const sizing = repoSizingTable();
    expect(boxRuleFor('NitroUiSwitch', sizing)).toBe('both');
    expect(boxRuleFor('NitroUiSlider', sizing)).toBe('height');
    expect(boxRuleFor('NitroUiProgress', sizing)).toBe('height');
    expect(boxRuleFor('NitroUiButton', sizing)).toBe('none');
    expect(boxRuleFor('NitroUiMenu', sizing)).toBe('none');
    expect(boxRuleFor('NitroUiRating', sizing)).toBe('both');
  });

  it('gives a Checkbox its height, and not its whole box', () => {
    const sizing = repoSizingTable();
    expect(boxRuleFor('NitroUiCheckbox', sizing)).toBe('height');
    expect(CONTENT_SIZED_BOX).not.toContain('NitroUiCheckbox');
    expect(HEIGHT_ONLY_FALLBACK).toContain('NitroUiCheckbox');
  });

  it('goes red for a CONTENT_SIZED_BOX entry that is not an intrinsic control', () => {
    expect(
      checkContentSizedBox(repoManifests(), ['NitroUiProgress']).join('\n')
    ).toContain('sizing: "fillWidth"');
    expect(
      checkContentSizedBox(repoManifests(), ['NitroUiGhost']).join('\n')
    ).toContain('no manifest declares that control');
    expect(checkContentSizedBox(repoManifests())).toEqual([]);
    expect(checkFallbackTable(repoManifests(), repoSizingTable())).toEqual([]);
  });
});

/* ------------------------ the recycle hole, as two lists see it ---------------------- */

describe('a recycle hole, as the fixture and the debt list describe it', () => {
  function harnessWith(kind, name = 'Switch') {
    const body =
      kind === 'probe'
        ? "      leaveBehind: 'a tap on the control',"
        : `      ${kind}:\n        'the reason the suite gives for not probing',`;
    return [
      'const FIXTURES: ReadonlyArray<Fixture> = [',
      '  {',
      `    name: '${name}',`,
      "    component: 'NitroUiSwitch',",
      '    probe: {',
      body,
      '    },',
      '  },',
      '];',
    ].join('\n');
  }

  const row = {
    component: 'Switch',
    rule: 'recycle-reset',
    followups: 'X4 recycle rule: Switch holds residue no read-out can show',
    detail: 'nothing reports the drawn value',
  };

  it('reads the note each fixture declares, and the reason with it', () => {
    const notes = recycleNotes(harnessWith('blindSpot'));
    expect(notes.Switch.kind).toBe('blindSpot');
    expect(notes.Switch.reason).toBe(
      'the reason the suite gives for not probing'
    );
    expect(recycleNotes(harnessWith('noProbe')).Switch.kind).toBe('noProbe');
    expect(recycleNotes(harnessWith('probe')).Switch).toEqual({
      kind: 'probe',
    });
    expect(recycleNotes(null)).toEqual({});
    expect(recycleNotes('nothing in this file')).toEqual({});
  });

  it('goes red when a fixture calls its rule a hole and no debt row owns it', () => {
    const problems = checkRecycleNotes(harnessWith('blindSpot'), []);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(
      'the Switch fixture says its recycle rule is a `blindSpot`'
    );
    expect(problems[0]).toContain('add the row');
  });

  it('goes red when a debt row covers a control whose probe can produce the finding', () => {
    expect(checkRecycleNotes(harnessWith('probe'), [row]).join('\n')).toContain(
      'that fixture has a residue probe'
    );
  });

  it('goes red when the two files disagree about whether the control holds state', () => {
    expect(
      checkRecycleNotes(harnessWith('noProbe'), [row]).join('\n')
    ).toContain('disagree about whether the control holds state');
  });

  it('goes red when a row guards a control no fixture guards', () => {
    expect(
      checkRecycleNotes(harnessWith('blindSpot', 'Slider'), [row]).join('\n')
    ).toContain('no fixture guards that control');
  });

  it('is quiet on the repo as it stands, and the two lists agree cell for cell', () => {
    const harness = read('example/__tests__/Conformance.harness.tsx');
    expect(checkRecycleNotes(harness)).toEqual([]);
    const notes = recycleNotes(harness);
    expect(
      Object.entries(notes)
        .filter(([, note]) => note.kind === 'blindSpot')
        .map(([name]) => name)
        .sort()
    ).toEqual(
      CONFORMANCE_EXEMPTIONS.filter((r) => r.rule === 'recycle-reset')
        .map((r) => r.component)
        .sort()
    );
    for (const [name, note] of Object.entries(notes)) {
      if (note.kind === 'probe') continue;
      expect(note.reason.length).toBeGreaterThan(40);
      expect(`${name}: ${note.reason}`).not.toMatch(/\s\+$/);
    }
  });
});

/* ------------------------------- the a11y table ------------------------------ */

describe('the a11y table cross-check', () => {
  it('passes as the repo stands', () => {
    expect(checkA11yTable(repoManifests(), read)).toEqual([]);
  });

  it('goes red when a label stops existing in the screen it names', () => {
    const screen = read('example/src/SwitchScreen.tsx');
    const without = (path) =>
      path === 'example/src/SwitchScreen.tsx'
        ? screen.replace('accessibilityLabel="Controlled switch"', '')
        : read(path);
    expect(checkA11yTable(repoManifests(), without).join('\n')).toContain(
      'looking for a name no screen renders'
    );
  });

  it('goes red when the table’s hybridView drifts from the manifest', () => {
    const problems = checkA11yTable(repoManifests(), read, [
      { ...A11Y_CONTROLS[0], hybridView: 'NitroUiToogle' },
      ...A11Y_CONTROLS.slice(1),
    ]);
    expect(problems.join('\n')).toContain('says hybridView');
  });

  it('goes red when a case names a screen with no file', () => {
    const problems = checkA11yTable(repoManifests(), read, [
      { ...A11Y_CONTROLS[0], screen: 'nope' },
      ...A11Y_CONTROLS.slice(1),
    ]);
    expect(problems.join('\n')).toContain('names no file for');
  });

  it('goes red when an anchor testID is gone', () => {
    const screen = read('example/src/SwitchScreen.tsx');
    const without = (path) =>
      path === 'example/src/SwitchScreen.tsx'
        ? screen.replace(/testID="switch-controlled"/, '')
        : read(path);
    const problems = checkA11yTable(repoManifests(), without, [
      { ...A11Y_CONTROLS[0], anchorTestId: 'switch-controlled' },
      ...A11Y_CONTROLS.slice(1),
    ]);
    expect(problems.join('\n')).toContain('no testID "switch-controlled"');
  });

  it('goes red for a case that guards a control no manifest declares', () => {
    const problems = checkA11yTable(repoManifests(), read, [
      ...A11Y_CONTROLS,
      {
        id: 'ghost',
        component: 'Ghost',
        hybridView: 'NitroUiGhost',
        screen: 'host',
        label: 'Ghost',
      },
    ]);
    expect(problems.join('\n')).toContain('no manifest declares that control');
  });
});

describe('the a11y presentation cases', () => {
  const withDialog = (patch) =>
    repoManifests().map((m) => (m.name === 'Dialog' ? { ...m, ...patch } : m));

  it('covers Dialog, BottomSheet, Tooltip and Popover, and only through their real-input checks', () => {
    expect(A11Y_PRESENTATIONS.map((entry) => entry.component)).toEqual([
      'Dialog',
      'BottomSheet',
      'Tooltip',
      'Popover',
    ]);
    expect(checkA11yTable(repoManifests(), read)).toEqual([]);
  });

  it('goes red for a Dialog with neither kind of case', () => {
    const problems = checkA11yTable(
      repoManifests(),
      read,
      A11Y_CONTROLS,
      undefined,
      []
    );
    expect(problems.join('\n')).toContain('no a11y case for Dialog (dialog)');
  });

  it('goes red when the presented component turns out to have a box', () => {
    const problems = checkA11yTable(withDialog({ sizing: 'intrinsic' }), read);
    expect(problems.join('\n')).toContain(
      'a control with a box is read by the sweep'
    );
  });

  it('goes red when nothing opens the window it says is read', () => {
    const problems = checkA11yTable(withDialog({ realInput: false }), read);
    expect(problems.join('\n')).toContain(
      'nothing ever opens the window this case says is read'
    );
  });

  it('goes red when its hybridView drifts, or it guards no manifest', () => {
    expect(
      checkA11yTable(repoManifests(), read, A11Y_CONTROLS, undefined, [
        { ...A11Y_PRESENTATIONS[0], hybridView: 'NitroUiDialgo' },
      ]).join('\n')
    ).toContain('says hybridView "NitroUiDialgo"');
    expect(
      checkA11yTable(repoManifests(), read, A11Y_CONTROLS, undefined, [
        ...A11Y_PRESENTATIONS,
        { id: 'ghost', component: 'Ghost', hybridView: 'NitroUiGhost' },
      ]).join('\n')
    ).toContain('the presentation case "ghost" guards "Ghost"');
  });

  it('goes red for a component in both tables', () => {
    const problems = checkA11yTable(repoManifests(), read, [
      ...A11Y_CONTROLS,
      {
        id: 'dialog-box',
        component: 'Dialog',
        hybridView: 'NitroUiDialog',
        screen: 'host',
        label: 'Hosted switch 0',
        labelAttribute: 'accessibilityLabel={`Hosted switch ${String(index)}`}',
      },
    ]);
    expect(problems.join('\n')).toContain(
      'is in both A11Y_CONTROLS and A11Y_PRESENTATIONS'
    );
  });
});

/* ------------------------------- the shared mirror --------------------------- */

describe('the in-app table mirror', () => {
  it('is what the harness file embeds, byte for byte', () => {
    const harnessText = readFileSync(
      join(repoRoot(), 'example/__tests__/Conformance.harness.tsx'),
      'utf8'
    );
    expect(checkSharedTableMirror(harnessText)).toEqual([]);
  });

  it('pins the launch locale the table needs, and refuses an unpinnable one', () => {
    const configText = readFileSync(
      join(repoRoot(), 'example/rn-harness.config.mjs'),
      'utf8'
    );
    expect(checkLaunchPinAgreesWithTable(configText)).toEqual([]);
    expect(
      checkLaunchPinAgreesWithTable(
        configText.replace(
          "const DEFAULT_APP_TEST_LOCALE = 'en_US'",
          "const DEFAULT_APP_TEST_LOCALE = 'de_DE'"
        )
      ).join('\n')
    ).toContain('measured in en-US');
    expect(
      checkLaunchPinAgreesWithTable(
        configText.replace(/const DEFAULT_APP_TEST_LOCALE = '[^']*'/, '')
      ).join('\n')
    ).toContain('no DEFAULT_APP_TEST_LOCALE');
    const withAndroidLocale = clone(DECLARED_FALLBACKS);
    withAndroidLocale.NitroUiDatePicker.android.measuredUnderLocale = 'en-US';
    expect(
      checkLaunchPinAgreesWithTable(configText, withAndroidLocale).join('\n')
    ).toContain('nothing pins the emulator');
  });

  it('goes red when the region is missing, corrupt, or stale', () => {
    expect(checkSharedTableMirror('export {}').join('\n')).toContain(
      'no "BEGIN CONFORMANCE SHARED TABLE" region'
    );
    const good = readFileSync(
      join(repoRoot(), 'example/__tests__/Conformance.harness.tsx'),
      'utf8'
    );
    expect(
      checkSharedTableMirror(
        good.replace('"tolerance": 0.6', '"tolerance": 0.7')
      ).join('\n')
    ).toContain('no longer matches');
    const broken = good.replace('"tolerance": 0.6,', '"tolerance": ,');
    expect(checkSharedTableMirror(broken).join('\n')).toContain('is not JSON');
  });

  it('mirrors every number the in-app rules assert against, and nothing else', () => {
    const shared = sharedInAppTable();
    expect(Object.keys(shared)).toEqual([
      'declaredFallbacks',
      'poisonSizes',
      'tolerance',
      'boxRules',
      'exemptions',
    ]);
    expect(shared.declaredFallbacks).toEqual(DECLARED_FALLBACKS);
    expect(shared.boxRules).toEqual(
      Object.fromEntries(
        Object.keys(DECLARED_FALLBACKS).map((hybridView) => [
          hybridView,
          boxRuleFor(hybridView, repoSizingTable()),
        ])
      )
    );
    expect(JSON.parse(JSON.stringify(shared))).toEqual(shared);
  });
});

/* ------------------------------ the in-app fixtures -------------------------- */

describe('the debt, as the matrix sees it', () => {
  it('collapses the a11y cases onto their components, once per control', () => {
    const table = [
      { id: 'slider', component: 'Slider' },
      { id: 'hosted-slider', component: 'Slider' },
    ];
    const rows = [
      { control: 'slider', platform: 'android' },
      { control: 'slider', platform: 'ios' },
      { control: 'hosted-slider', platform: 'android' },
    ];
    expect(failingKeys(rows, [], table)).toEqual([
      findingKey('Slider', 'a11y-name-on-focusable-node'),
    ]);
  });

  it('picks up a debt row on the in-app side too', () => {
    const row = {
      component: 'Switch',
      rule: 'recycle-reset',
      followups: 'X4: Switch keeps a recycled owner',
      detail: 'checked survives',
    };
    expect(failingKeys(A11Y_EXEMPTIONS, [row])).toContain(
      findingKey('Switch', 'recycle-reset')
    );
    expect(
      failingKeys(A11Y_EXEMPTIONS, [...CONFORMANCE_EXEMPTIONS, row]).length
    ).toBe(failingKeys().length + 1);
  });
});

describe('the in-app fixture table cross-check', () => {
  const harness = () => read('example/__tests__/Conformance.harness.tsx');

  it('has a fixture for every control the registry declares', () => {
    expect(checkInAppFixtures(repoManifests(), harness())).toEqual([]);
  });

  it('goes red for a manifest with no fixture, and names it', () => {
    const withRating = [
      ...repoManifests(),
      manifest({
        id: 'rating',
        name: 'Rating',
        hybridView: 'NitroUiRating',
        sizing: 'intrinsic',
        exampleTab: 'rating',
      }),
    ];
    expect(checkInAppFixtures(withRating, harness()).join('\n')).toContain(
      'no fixture for Rating'
    );
  });

  it('goes red when a box-less control does not opt out of the sizing rules', () => {
    const optedIn = harness().replace('    selfSizing: false,\n', '');
    expect(optedIn).not.toBe(harness());
    expect(checkInAppFixtures(repoManifests(), optedIn).join('\n')).toContain(
      'Dialog declares no sizing policy (sizing: null) and its fixture does not say'
    );
  });

  it('goes red when a self-sizing control opts out of its sizing rules', () => {
    const optedOut = harness().replace(
      "    component: 'NitroUiPicker',\n",
      "    component: 'NitroUiPicker',\n    selfSizing: false,\n"
    );
    expect(optedOut).not.toBe(harness());
    expect(checkInAppFixtures(repoManifests(), optedOut).join('\n')).toContain(
      'a self-sizing control cannot opt out of its fallback and leak rules'
    );
  });

  it('goes red for a fixture whose hybridView name drifted from the manifest', () => {
    const renamed = harness().replace(
      "    component: 'NitroUiPicker',",
      "    component: 'NitroUiComboBox',"
    );
    expect(renamed).not.toBe(harness());
    expect(checkInAppFixtures(repoManifests(), renamed).join('\n')).toContain(
      'says NitroUiComboBox'
    );
  });

  it('is not satisfied by a comment that mentions the control', () => {
    const commentedOut = harness().replace(
      ['  {', "    name: 'Picker',", "    component: 'NitroUiPicker',"].join(
        '\n'
      ),
      [
        '  {',
        "    // name: 'Picker',",
        "    // component: 'NitroUiPicker',",
      ].join('\n')
    );
    expect(commentedOut).not.toBe(harness());
    const wholeRow = checkInAppFixtures(repoManifests(), commentedOut).join(
      '\n'
    );
    expect(wholeRow).toContain('no fixture for Picker');
    expect(wholeRow).toContain('a fixture guards');

    const noComponent = harness().replace(
      "    component: 'NitroUiPicker',",
      "    // component: 'NitroUiPicker',"
    );
    expect(noComponent).not.toBe(harness());
    const rowOnly = checkInAppFixtures(repoManifests(), noComponent).join('\n');
    expect(rowOnly).toContain('says null');
  });

  it('reads the engine’s registration before it seeds anything', () => {
    const harness = read('example/__tests__/Conformance.harness.tsx');
    const readCall = harness.indexOf('readRegistrationOnce();');
    expect(readCall).toBeGreaterThan(-1);
    const firstPoison = harness.indexOf('poison(fixture.component)');
    expect(firstPoison).toBeGreaterThan(readCall);
    const calls = [...harness.matchAll(/readRegistrationOnce\(\)/g)].length;
    const insideGuard = harness.slice(
      harness.indexOf('function readRegistrationOnce'),
      harness.indexOf('/**', harness.indexOf('function readRegistrationOnce'))
    );
    expect(
      calls - [...insideGuard.matchAll(/readRegistrationOnce\(\)/g)].length
    ).toBe(1);
    const asks = [...harness.matchAll(/hasDeclaredFallback\(/g)];
    expect(asks).toHaveLength(2);
    expect(harness.slice(asks[0].index - 9, asks[0].index + 20)).toContain(
      'function hasDeclaredFallback'
    );
    const guard = harness.indexOf('function readRegistrationOnce');
    const guardEnd = harness.indexOf('\n}', guard);
    expect(asks[1].index > guard && asks[1].index < guardEnd).toBe(true);
  });

  it('looks the shared numbers up inside a test, not while collecting', () => {
    // Anchored on the suite's own `describe`: `readRegistrationOnce` above it iterates the
    // same table and may call things at module scope.
    const anchor = harness().indexOf(
      "describe('conformance · every control, four rules'"
    );
    expect(anchor).toBeGreaterThan(-1);
    const body = harness().slice(anchor);
    const firstTest = body.indexOf('it(');
    expect(firstTest).toBeGreaterThan(-1);
    const collection = body.slice(0, firstTest);
    for (const lookup of ['declaredFallback(', 'boxRuleFor(']) {
      expect(collection).not.toContain(lookup);
    }
    expect(body).toContain('declaredFallback(');
    expect(body).toContain('boxRuleFor(');
  });

  it('says so when the fixture table itself cannot be found', () => {
    const renamed = harness().replace(
      'const FIXTURES: ReadonlyArray<Fixture> = [',
      'const CASES: ReadonlyArray<Fixture> = ['
    );
    expect(renamed).not.toBe(harness());
    expect(checkInAppFixtures(repoManifests(), renamed).join('\n')).toContain(
      'could not be found'
    );
  });

  it('goes red for a fixture guarding a control nobody declares', () => {
    const extra = harness().replace(
      'const FIXTURES: ReadonlyArray<Fixture> = [\n',
      'const FIXTURES: ReadonlyArray<Fixture> = [\n  {\n    name: ' +
        "'Ghost',\n    component: 'NitroUiGhost',\n  },\n"
    );
    expect(extra).not.toBe(harness());
    expect(checkInAppFixtures(repoManifests(), extra).join('\n')).toContain(
      'a fixture guards "Ghost"'
    );
  });

  it('goes red when the whole suite is missing', () => {
    expect(checkInAppFixtures(repoManifests(), null)[0]).toContain(
      'no suite, so no control is checked'
    );
  });
});

/* ------------------------------- the device sweep ---------------------------- */

describe('the a11y sweep, against a fake device', () => {
  function fakeLog() {
    return {
      notes: [],
      failures: [],
      descriptions: [],
      note(message) {
        this.notes.push(message);
      },
      check(description, condition) {
        this.descriptions.push(description);
        if (!condition) this.failures.push(description);
        return condition;
      },
    };
  }

  function fakeNavigation(dump, screens = []) {
    return {
      screens,
      scrolls: 0,
      async goToScreen(screen) {
        screens.push(screen);
      },
      async scrollToTop() {},
      async scrollPage() {
        this.scrolls += 1;
      },
      dump,
      windowHeight: WINDOW_HEIGHT,
    };
  }

  const WINDOW_HEIGHT = 2424;

  /**
   * A page taller than the window, as `uiautomator` reports it: each node's box is cut at
   * the window's bottom edge, and a node wholly below the window is a zero-sized box at
   * the origin, the way a Spinner below the fold came back on a slow runner. Each swipe
   * moves the page `step` px, until it reaches its end; the swipes numbered in `dropped`
   * (from 1) move nothing, as a dropped input does. Rows of text fill the page between
   * the named nodes, as a screen's titles and captions do, so a swipe that moves it shows.
   */
  function scrollingPage(named, { step, end, dropped = [] }) {
    const rows = Array.from(
      { length: Math.ceil((end + WINDOW_HEIGHT) / 250) },
      (_, i) => ({
        label: '',
        top: i * 250,
        height: 40,
      })
    );
    const nodes = [...rows, ...named];
    const page = {
      offset: 0,
      scrolls: 0,
      dumps: [],
      async goToScreen() {},
      async scrollToTop() {
        page.offset = 0;
      },
      async scrollPage() {
        page.scrolls += 1;
        if (dropped.includes(page.scrolls)) return;
        page.offset = Math.min(end, page.offset + step);
      },
      dump() {
        const tree = nodes.map(({ label, top, height }) => {
          const y1 = top - page.offset;
          const y2 = Math.min(WINDOW_HEIGHT, y1 + height);
          return y1 >= WINDOW_HEIGHT
            ? node(label, { width: 0, height: 0 })
            : placed(node(label), { y1, y2 });
        });
        page.dumps.push(tree);
        return tree;
      },
      windowHeight: WINDOW_HEIGHT,
    };
    return page;
  }

  function placed(entry, { y1, y2 }) {
    const { x1, x2 } = entry.bounds;
    return {
      ...entry,
      bounds: {
        x1,
        y1,
        x2,
        y2,
        cx: (x1 + x2) / 2,
        cy: (y1 + y2) / 2,
        width: x2 - x1,
        height: y2 - y1,
      },
    };
  }

  const boxOf = (tree, label) =>
    tree.find((entry) => entry.contentDesc === label)?.bounds;

  function collector() {
    /** @type {Array<{id: string, log: any}>} */
    const logs = [];
    return {
      logs,
      begin(id, title) {
        const log = fakeLog();
        logs.push({ id, title, log });
        return log;
      },
    };
  }

  async function capturePrint(fn) {
    const lines = [];
    const original = console.log;
    console.log = (...args) => lines.push(args.join(' '));
    try {
      await fn();
    } finally {
      console.log = original;
    }
    return lines.join('\n');
  }

  function node(contentDesc, overrides = {}) {
    const width = overrides.width ?? 100;
    const height = overrides.height ?? 40;
    return {
      contentDesc,
      className: 'android.view.View',
      clickable: 'true',
      checkable: 'false',
      focusable: 'true',
      scrollable: 'false',
      ...overrides,
      bounds: {
        x1: 0,
        y1: 0,
        x2: width,
        y2: height,
        cx: width / 2,
        cy: height / 2,
        width,
        height,
      },
    };
  }

  const only = (id) => A11Y_CONTROLS.filter((entry) => entry.id === id);
  const switchCase = () => only('switch');
  const sliderCase = () => only('slider');

  it('scrolls until its control has a box, and judges the tree that has it', () => {
    let dumps = 0;
    const { begin, logs } = collector();
    const navigation = fakeNavigation(() => {
      dumps += 1;
      return dumps === 1 ? [] : [node('Controlled switch')];
    });
    return runA11ySweep(begin, navigation, switchCase()).then(() => {
      expect(dumps).toBe(2);
      expect(navigation.scrolls).toBe(1);
      expect(logs[0].log.failures).toEqual([]);
    });
  });

  it('keeps scrolling past a name with no box, and judges the tree that has one', () => {
    let dumps = 0;
    const { begin, logs } = collector();
    const navigation = fakeNavigation(() => {
      dumps += 1;
      return dumps === 1
        ? [node('Controlled switch', { width: 0, height: 0 })]
        : [node('Controlled switch')];
    });
    return runA11ySweep(begin, navigation, switchCase()).then(() => {
      expect(dumps).toBe(2);
      expect(navigation.scrolls).toBe(1);
      expect(logs[0].log.failures).toEqual([]);
    });
  });

  it('judges the last tree once two swipes leave the page unmoved, and says what it saw', () => {
    const { begin, logs } = collector();
    const navigation = fakeNavigation(() => [
      node('Controlled switch', { width: 0, height: 0 }),
    ]);
    return runA11ySweep(begin, navigation, switchCase()).then(() => {
      expect(navigation.scrolls).toBe(2);
      expect(logs[0].log.failures.join('\n')).toContain('zero-sized box');
    });
  });

  it('keeps scrolling a page whose swipes move it less than asked, past eight swipes', async () => {
    const { begin, logs } = collector();
    // 200 px per swipe: eight swipes leave the picker below the window, the ninth shows it.
    const page = scrollingPage(
      [
        { label: 'Hosted segmented', top: 3900, height: 95 },
        { label: 'Hosted picker', top: 4100, height: 95 },
      ],
      { step: 200, end: 4000 }
    );
    await runA11ySweep(begin, page, only('hosted-picker'));
    expect(page.scrolls).toBe(9);
    const graded = boxOf(page.dumps.at(-1), 'Hosted picker');
    expect(graded.height).toBe(95);
    expect(graded.y2).toBeLessThan(WINDOW_HEIGHT);
    expect(logs[0].log.failures).toEqual([]);
  });

  it('keeps scrolling past one dropped swipe mid-page', async () => {
    const { begin, logs } = collector();
    // Nine moving swipes show the picker; the third swipe is dropped, so it takes ten.
    const page = scrollingPage(
      [{ label: 'Hosted picker', top: 4100, height: 95 }],
      { step: 200, end: 4000, dropped: [3] }
    );
    await runA11ySweep(begin, page, only('hosted-picker'));
    expect(page.scrolls).toBe(10);
    const graded = boxOf(page.dumps.at(-1), 'Hosted picker');
    expect(graded.height).toBe(95);
    expect(graded.y2).toBeLessThan(WINDOW_HEIGHT);
    expect(logs[0].log.failures).toEqual([]);
  });

  it('scrolls once more when the control only touches the window’s bottom edge', async () => {
    const { begin, logs } = collector();
    // The runner's dump: `[42,2329][535,2424]`, cut at the edge, not the whole control.
    const page = scrollingPage(
      [{ label: 'Hosted segmented', top: 2329, height: 140 }],
      { step: 200, end: 2000 }
    );
    expect(boxOf(page.dump(), 'Hosted segmented').y2).toBe(WINDOW_HEIGHT);
    await runA11ySweep(begin, page, only('hosted-segmented'));
    expect(page.scrolls).toBe(1);
    const graded = boxOf(page.dumps.at(-1), 'Hosted segmented');
    expect(graded).toMatchObject({ y1: 2129, y2: 2269, height: 140 });
    expect(logs[0].log.failures).toEqual([]);
  });

  it('ends the probe where the page ends, and reports a missing control as today', async () => {
    const { begin, logs } = collector();
    // Three swipes reach the end, the next two move nothing; the case's name is never drawn.
    const page = scrollingPage(
      [{ label: 'Something else', top: 100, height: 40 }],
      {
        step: 300,
        end: 900,
      }
    );
    await runA11ySweep(begin, page, only('hosted-picker'));
    expect(page.scrolls).toBe(5);
    expect(logs[0].log.failures.join('\n')).toContain(
      'announces this control as nothing'
    );
    expect(logs[0].log.failures.join('\n')).not.toContain('still moving');
  });

  it('fails a case whose page never stops changing, saying the cap was reached', async () => {
    const { begin, logs } = collector();
    let dumps = 0;
    const navigation = fakeNavigation(() => {
      dumps += 1;
      return [
        node('Controlled switch', {
          width: 0,
          height: 0,
          resourceId: String(dumps),
        }),
      ];
    });
    await runA11ySweep(begin, navigation, switchCase());
    expect(navigation.scrolls).toBe(SCROLL_PROBE_LIMIT);
    expect(logs[0].log.failures[0]).toContain(
      `still moving after ${String(SCROLL_PROBE_LIMIT)} swipes`
    );
    expect(logs[0].log.failures.join('\n')).toContain('zero-sized box');
  });

  it('refuses a navigation that does not say how tall its window is', async () => {
    const { begin } = collector();
    const navigation = fakeNavigation(() => [node('Controlled switch')]);
    delete navigation.windowHeight;
    await expect(runA11ySweep(begin, navigation, switchCase())).rejects.toThrow(
      'windowHeight'
    );
  });

  it('reports a control that never appears as a failure, not as a scroll timeout', () => {
    const { begin, logs } = collector();
    const navigation = fakeNavigation(() => []);
    return runA11ySweep(begin, navigation, switchCase()).then((result) => {
      expect(logs.length).toBe(1);
      expect(logs[0].log.failures.join('\n')).toContain(
        'announces this control as nothing'
      );
      expect(result.covered).toEqual(['switch']);
      expect(result.stale).toEqual([]);
    });
  });

  it('prints debt rather than failing it, and still fails what the debt does not cover', async () => {
    const withDebt = collector();
    await runA11ySweep(
      withDebt.begin,
      fakeNavigation(() => [
        node('Controlled slider', { clickable: 'false', focusable: 'false' }),
      ]),
      sliderCase()
    );
    expect(withDebt.logs[0].log.notes.join('\n')).toContain('known failing');
    expect(withDebt.logs[0].log.failures).toEqual([]);
    expect(withDebt.logs[0].log.descriptions.join('\n')).toContain(
      'no clean pass either'
    );
    expect(withDebt.logs[0].log.descriptions.join('\n')).not.toContain(
      'is named on one node a person can act on'
    );

    const unnamed = collector();
    const result = await runA11ySweep(
      unnamed.begin,
      fakeNavigation(() => [node('Something else')]),
      sliderCase()
    );
    expect(result.matched).toEqual([]);
    expect(unnamed.logs[0].log.failures.join('\n')).toContain(
      'announces this control as nothing'
    );
  });

  it('fails the run when a debt row no longer describes anything', async () => {
    const { begin, logs } = collector();
    const result = await runA11ySweep(
      begin,
      fakeNavigation(() => [node('Controlled slider')]),
      sliderCase()
    );
    expect(result.stale).toEqual([
      expect.stringContaining('the android entry for "slider"'),
    ]);
    const debt = logs.find((entry) => entry.id === 'a11y:debt');
    expect(debt).toBeDefined();
    expect(debt.log.failures.join('\n')).toContain('delete the exemption');
  });

  it('navigates once per screen, not once per case', () => {
    const { begin } = collector();
    const screens = [];
    const navigation = fakeNavigation(
      () => A11Y_CONTROLS.map((entry) => node(entry.label)),
      screens
    );
    return runA11ySweep(begin, navigation).then(() => {
      expect(screens).toEqual([
        'switch',
        'slider',
        'button',
        'segmented',
        'datepicker',
        'picker',
        'menu',
        'chip',
        'checkbox',
        'iconbutton',
        'buttongroup',
        'stepper',
        'host',
        'textfield',
        'searchfield',
        'contextmenu',
        'form',
        'listitem',
      ]);
    });
  });

  it('runs every case in the table, so a new control is swept the day it is added', () => {
    const { begin, logs } = collector();
    const navigation = fakeNavigation(() =>
      A11Y_CONTROLS.map((entry) => node(entry.label))
    );
    return runA11ySweep(begin, navigation).then((result) => {
      expect(logs.map((entry) => entry.id)).toEqual([
        ...A11Y_CONTROLS.map((entry) => `a11y:${entry.id}`),
        // plus the debt log the run opens for itself when rows go stale
        'a11y:debt',
      ]);
      expect(result.covered.length).toBe(A11Y_CONTROLS.length);
      expect(result.matched).toEqual([]);
      expect(result.stale.length).toBe(
        A11Y_EXEMPTIONS.filter(
          (row) => row.platform === 'android' || row.platform === 'both'
        ).length
      );
    });
  });

  it('reads a real measured dump the same way the unit test says it does', () => {
    const { begin, logs } = collector();
    const tree = parseHierarchy(
      readFileSync(`${__dirname}/fixtures/a11y/switch.xml`, 'utf8')
    );
    return runA11ySweep(
      begin,
      fakeNavigation(() => tree),
      switchCase()
    ).then(() => {
      expect(logs[0].log.failures).toEqual([]);
      expect(logs[0].log.notes).toEqual([]);
    });
  });

  it('hands its log to the navigation, so a re-tapped tab reaches the summary', async () => {
    const suite = new Suite('android', []);
    const navigation = fakeNavigation(() => [node('Controlled switch')]);
    navigation.goToScreen = async (screen, log) => {
      navigation.screens.push(screen);
      log?.retried?.(
        'navigation: the "Switch" tab answered on tap 2/3 - the earlier tap(s) were ' +
          'never delivered'
      );
    };
    const printed = await capturePrint(async () => {
      await runA11ySweep(
        (id, title) => suite.beginAuxiliary(id, title),
        navigation,
        switchCase()
      );
      return suite.finish();
    });
    expect(suite.auxiliary[0].log.retries).toEqual([
      'navigation: the "Switch" tab answered on tap 2/3 - the earlier tap(s) were ' +
        'never delivered',
    ]);
    expect(printed).toContain('1 input sequence(s) needed a retry');
    expect(printed).toContain('1 of them on an auxiliary check');
  });

  it('counts every source of retry in the run’s one total', async () => {
    const controls = [
      { id: 'slider', title: 'Slider drag' },
      { id: 'switch', title: 'Switch' },
    ];
    const printed = await capturePrint(async () => {
      const suite = new Suite('android', controls);
      const slider = suite.begin(controls[0]);
      slider.retried('dragTo: reported no finished gesture, dragged it again');
      slider.retried('Slider: the value answered on tap 2/3');
      slider.check('the drag reported one gesture', true);
      const switchCheck = suite.begin(controls[1]);
      switchCheck.check('the switch answered', true);
      const sweep = suite.beginAuxiliary('a11y:slider', 'Slider a11y');
      sweep.retried('navigation: the "Slider" tab answered on tap 2/3');
      sweep.check('the tree names the control', true);
      expect(suite.finish()).toBe(0);
    });
    expect(printed).toContain('3 input sequence(s) needed a retry');
    expect(printed).toContain('1 of them on an auxiliary check');
  });
});
