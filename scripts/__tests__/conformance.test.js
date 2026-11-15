/**
 * The conformance suite's tables and cross-checks, with no device.
 *
 * This is where "the suite picks up a new manifest automatically" is proved: the
 * coverage matrix and its check are run against a manifest the repo does not have
 * (a `Menu`), and the suite has to notice. A manifest-driven suite that only passes on
 * the seven controls it was written for is a suite with seven hand-written cases and a
 * loop around them, which is what X4 exists to replace.
 *
 * @file
 */

import { describe, expect, it } from '@jest/globals';

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

/** A manifest with just enough shape for the rules to reason about it. */
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

/**
 * A deep copy, for mutating a table without touching the real one.
 *
 * `structuredClone` would be the obvious call and is available in the Node this repo runs
 * scripts with, but ESLint's config for `scripts/__tests__` declares no globals, so an
 * undefined identifier there is a lint error rather than a runtime problem. A JSON round trip
 * is enough for these tables and says what it does.
 */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** The repo's manifests, with one control added that this repo does not have. */
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
        // `harness:<platform>` or `real-input:<platform>`. A rule that named a gate the
        // ledger does not know would report green forever.
        expect(gate).toMatch(/^(harness|real-input):(ios|android)$/);
      }
    }
    // The Android a11y half has to name the gate it actually rides.
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
    // Recycle reset always applies: identity is a thing every control can get wrong.
    expect(plain[0].rules['recycle-reset'].state).toBe('covered');
  });

  it('picks up a control that does not exist yet', () => {
    // The brief's central requirement, tested by adding one. It used to be `Menu`, which is
    // how this file proves the mechanism keeps working: Menu arrived in the registry, and the
    // probe control moved on to a name the repo still does not have. A new manifest gets a row
    // and a verdict from every rule — `not-applicable` or `covered`, never silence.
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
    // A control with no a11y case is a red run, not a matrix cell that explains itself.
    // Round 1 had both, and the matrix half could not be reached: `checkA11yTable` fails
    // the same tree first, so a cell waiting to say "no case for Rating" was dead code
    // (review N9). One owner for the condition, and it is this.
    expect(checkA11yTable(extra, read).join('\n')).toContain(
      'no a11y case for Rating'
    );
  });
});

/* ---------------------------------- coverage ---------------------------------- */

describe('coverage', () => {
  it('is complete for every control the registry declares', () => {
    const manifests = repoManifests();
    // The list is the registry's own: a new control has to be looked at here, and
    // the assertion under it is the one that decides whether it is covered.
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
    // Every rule answers `not-applicable` with a reason, so coverage is complete — but
    // the a11y rule's reason is a gap, and `checkA11yTable` is where that is caught.
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
    // The "someone pasted the previous component's number" shape, invisible to the
    // generated policy check because the policy is right and only the number is stale.
    const manifests = repoManifests();
    const sizing = JSON.parse(read('nitro-ui.sizing.json'));
    const copied = clone(DECLARED_FALLBACKS);
    copied.NitroUiSlider.ios = { ...copied.NitroUiSwitch.ios };
    const problems = checkFallbackTable(manifests, sizing, copied);
    // Two names now that the Checkbox draws its own glyph on iOS (DESIGN.md D47) and
    // declares its own box: before that, three shared the Switch's 61x28 and the
    // excused pair still left a third name to refuse.
    expect(problems.join('\n')).toContain(
      '61x28 on ios for NitroUiSlider and NitroUiSwitch'
    );
    expect(problems.join('\n')).toContain('one of these rows was copied');
  });

  it('excuses exactly the one shared row, and nobody else at that size', () => {
    // Since DESIGN.md D47 the table has one shared row: on iOS a Checkbox draws its own
    // glyph and declares its own box, so the only honest sharing left is Android's, where
    // a bare Checkbox and a default IconButton are each Material 3's
    // `MinInteractiveComponentSize`. `SHARED_FALLBACK_ROWS` is what lets it; this test is
    // what keeps the exception a row rather than a hole.
    expect(
      checkFallbackTable(repoManifests(), repoSizingTable()).join('\n')
    ).not.toContain('48x48');

    // A third control at *that* size is still the paste the rule exists to catch: the row
    // names two owners, and three is not two.
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

    // And iOS has no row to excuse any more: since DESIGN.md D47 a Checkbox declares its
    // glyph box, so the Switch's 61x28 is one row again.
    const asItStands = checkFallbackTable(repoManifests(), repoSizingTable());
    expect(asItStands.join('\n')).not.toContain('61x28');

    // A third control at the same size is still the paste the rule exists to catch: the
    // exception names two owners, and three is not two.
    const sizing = repoSizingTable();
    const three = clone(DECLARED_FALLBACKS);
    three.NitroUiSlider.ios = { ...three.NitroUiSwitch.ios };
    const joined = checkFallbackTable(repoManifests(), sizing, three).join(
      '\n'
    );
    expect(joined).toContain('61x28 on ios for');
    expect(joined).toContain('NitroUiSlider');
    expect(joined).toContain('one of these rows was copied');

    // And it is a statement about that number: the same two components sharing a
    // different one is a copy again.
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
    // And the missing-row case, which is the one that puts a control in the `0x0` branch.
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
    // A poison that equalled a real fallback would make the poisoned assertion green on
    // the bug, which is the exact failure mode the rule exists to avoid.
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

/* The three modes are not theoretical: the first device run of this suite went red on
 * Slider, Progress and Button, and the rule was wrong rather than the controls. A `fillWidth`
 * control's width is its parent's, and a content-sized control's declaration is a documented
 * middle of a measured table. */

describe('which axes a declared fallback describes', () => {
  it('reads the axis from the generated sizing policy', () => {
    const sizing = repoSizingTable();
    // `intrinsic` and content-sized disagree about the same policy, so Button is listed
    // explicitly and the policy alone cannot be the whole answer.
    expect(boxRuleFor('NitroUiSwitch', sizing)).toBe('both');
    expect(boxRuleFor('NitroUiSlider', sizing)).toBe('height');
    expect(boxRuleFor('NitroUiProgress', sizing)).toBe('height');
    expect(boxRuleFor('NitroUiButton', sizing)).toBe('none');
    // Menu joined the content-sized list with G7a: its trigger is a Button's box and its
    // width is its title's, so its declaration is Button-sized by decree rather than a
    // measured configuration (`HybridNitroUiMenu.swift:451-458` says so in words).
    expect(boxRuleFor('NitroUiMenu', sizing)).toBe('none');
    // An unknown control keeps the strictest rule: a policy the table lost should cost a
    // red run, not a widened assertion.
    expect(boxRuleFor('NitroUiRating', sizing)).toBe('both');
  });

  it('gives a Checkbox its height, and not its whole box', () => {
    // The narrowness the review asked for, in both directions: the Checkbox left
    // `CONTENT_SIZED_BOX` (which skipped the box and hid a declaration 8 dp shorter than
    // every measured configuration of the control) and joined the list whose height is
    // still compared.
    const sizing = repoSizingTable();
    expect(boxRuleFor('NitroUiCheckbox', sizing)).toBe('height');
    expect(CONTENT_SIZED_BOX).not.toContain('NitroUiCheckbox');
    expect(HEIGHT_ONLY_FALLBACK).toContain('NitroUiCheckbox');
  });

  it('goes red for a CONTENT_SIZED_BOX entry that is not an intrinsic control', () => {
    // Adding a name here skips a comparison, so membership is checked against the manifests
    // rather than trusted. The interesting case cannot be produced by this repo's tree —
    // Progress really is `fillWidth` — so the list is injected, which is exactly what the
    // mistake looks like: somebody puts a fillWidth control in the list to skip its height
    // comparison.
    expect(
      checkContentSizedBox(repoManifests(), ['NitroUiProgress']).join('\n')
    ).toContain('sizing: "fillWidth"');
    expect(
      checkContentSizedBox(repoManifests(), ['NitroUiGhost']).join('\n')
    ).toContain('no manifest declares that control');
    // And the real list is legitimate on the real tree, which is the assertion the two
    // mutations above are measured against.
    expect(checkContentSizedBox(repoManifests())).toEqual([]);
    expect(checkFallbackTable(repoManifests(), repoSizingTable())).toEqual([]);
  });
});

/* ------------------------ the recycle hole, as two lists see it ---------------------- */

describe('a recycle hole, as the fixture and the debt list describe it', () => {
  /** A harness file with one fixture whose `probe` is the given kind. */
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
    // No table is not "no control has a hole" — that reading is how a check disappears
    // without leaving a trace. `checkInAppFixtures` is what reports an absent table.
    expect(recycleNotes(null)).toEqual({});
    expect(recycleNotes('nothing in this file')).toEqual({});
  });

  it('goes red when a fixture calls its rule a hole and no debt row owns it', () => {
    // The re-review's finding verbatim: the controls with no probe had a sentence in a
    // fixture and a `covered` cell, and nothing could tell a hole in the guard from an
    // exemption. A `blindSpot` is a failing cell, so it cannot live only in a comment.
    const problems = checkRecycleNotes(harnessWith('blindSpot'), []);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(
      'the Switch fixture says its recycle rule is a `blindSpot`'
    );
    expect(problems[0]).toContain('add the row');
  });

  it('goes red when a debt row covers a control whose probe can produce the finding', () => {
    // The dangerous direction: a probe lands, its row is left behind, and the run prints
    // "known failing" over a number that now means something.
    expect(checkRecycleNotes(harnessWith('probe'), [row]).join('\n')).toContain(
      'that fixture has a residue probe'
    );
  });

  it('goes red when the two files disagree about whether the control holds state', () => {
    // `noProbe` says there is nothing to reset; a debt row says the reset is unreachable.
    // Both cannot be true of one control, and the honest reading is that the probe is
    // missing — which is the row being refused, not the note being rewritten.
    expect(
      checkRecycleNotes(harnessWith('noProbe'), [row]).join('\n')
    ).toContain('disagree about whether the control holds state');
  });

  it('goes red when a row guards a control no fixture guards', () => {
    // Nothing reports the key, so nothing can ever retire the row, and it sits there
    // excusing a finding no probe is capable of producing.
    expect(
      checkRecycleNotes(harnessWith('blindSpot', 'Slider'), [row]).join('\n')
    ).toContain('no fixture guards that control');
  });

  it('is quiet on the repo as it stands, and the two lists agree cell for cell', () => {
    const harness = read('example/__tests__/Conformance.harness.tsx');
    expect(checkRecycleNotes(harness)).toEqual([]);
    // The statement the four tests above exist to make unfakeable: the set of fixtures
    // that call their rule a hole *is* the set of debt rows, in both directions.
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
    // And every reason that reaches the coverage table is a sentence, not a fragment:
    // the cell's whole claim is that the suite cannot reach the rule, so it has to say so.
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
  // A component with no box that presents a window (G11's dialogs) cannot be read by the
  // sweep, so its case says where the presentation-aware rule runs instead. The rows are
  // coverage only for what they claim, and each way a row can claim too much is red here.
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
    // Two files, one contract. The config's default pin is what makes a
    // locale-dependent row comparable on any runner, and a mismatch is a device-run
    // failure, so drift between the two cannot hide: it is either red here (a row the
    // pin contradicts), red on every device run (a row the pin does not match), or
    // red here for the row that names a locale nothing pins.
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
    // And the case that starts the drift: the pin deleted, so the app inherits the
    // machine's locale.
    expect(
      checkLaunchPinAgreesWithTable(
        configText.replace(/const DEFAULT_APP_TEST_LOCALE = '[^']*'/, '')
      ).join('\n')
    ).toContain('no DEFAULT_APP_TEST_LOCALE');
    // A locale on the Android row would be a premise no run could check, because the
    // emulator's locale is an AVD setting nothing here passes. Built as data rather
    // than by editing the source: the check takes the table, and the table it must
    // refuse is one field wide.
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
    // The box rule is in the mirror for the same reason the numbers are: which axes a
    // control's declaration describes comes from the generated sizing policy, and a suite
    // that decided that on the device could decide it wrongly and go green.
    expect(shared.boxRules).toEqual(
      Object.fromEntries(
        Object.keys(DECLARED_FALLBACKS).map((hybridView) => [
          hybridView,
          boxRuleFor(hybridView, repoSizingTable()),
        ])
      )
    );
    // And it is JSON-safe: a `Date` or a function would round-trip into `null`, which
    // would make the mirror check above compare two different things and pass.
    expect(JSON.parse(JSON.stringify(shared))).toEqual(shared);
  });
});

/* ------------------------------ the in-app fixtures -------------------------- */

describe('the debt, as the matrix sees it', () => {
  it('collapses the a11y cases onto their components, once per control', () => {
    // The debt list carries both platforms' rows for one control, and one component can
    // have two cases (its own screen and inside a `<Host>`). The matrix is about
    // components, so every row for one control makes exactly one failing cell. The rows
    // are passed in, so this does not name whatever the debt list holds today.
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
    // `failingKeys` reads both lists, so a new in-app exemption reaches the matrix without
    // anyone editing a second table — the same reason the a11y rows are read from the list.
    const row = {
      component: 'Switch',
      rule: 'recycle-reset',
      followups: 'X4: Switch keeps a recycled owner',
      detail: 'checked survives',
    };
    expect(failingKeys(A11Y_EXEMPTIONS, [row])).toContain(
      findingKey('Switch', 'recycle-reset')
    );
    // And it does not disturb the rows that already exist — which means passing the real
    // list plus the new one, since a one-row list *replaces* it and reads as two fewer keys.
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
    // The scan reads the FIXTURES table's rows, not the file's text (X4 review N3). Round 1
    // asked whether `name: 'Picker'` appeared anywhere, so a row whose members are prose used
    // to pass it. Anything a `// TODO` can satisfy is not a coverage claim.
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
    // The leftover row is not silently ignored either: an unnamed row in the table is one no
    // manifest declares, which is the same bug reported from the other end.
    expect(wholeRow).toContain('a fixture guards');

    // The subtler half. The row is real and only its `component` has become a comment, so a
    // text scan still finds `name: 'Picker'` while the sizing rules ask the engine about a
    // component this fixture never names.
    const noComponent = harness().replace(
      "    component: 'NitroUiPicker',",
      "    // component: 'NitroUiPicker',"
    );
    expect(noComponent).not.toBe(harness());
    const rowOnly = checkInAppFixtures(repoManifests(), noComponent).join('\n');
    expect(rowOnly).toContain('says null');
  });

  it('reads the engine’s registration before it seeds anything', () => {
    // The shape M5 is about, checked structurally because the failure is an ordering
    // between two calls in one file and no host test can mount a control.
    //
    // `prewarmSizing` answers "is this name in `fallbacks_`" and `seedSizingSize` writes
    // `fallbacks_` (`NitroUiSizingEngine.cpp:512`, `:855`), so the first poison in this file
    // makes every later "is it registered?" the poison's own answer. The suite therefore
    // asks once, for every control, in the file's first test — and the poison must come
    // after it. A file that re-reads per test would pass the assertion above and still be
    // measuring nothing.
    const harness = read('example/__tests__/Conformance.harness.tsx');
    const readCall = harness.indexOf('readRegistrationOnce();');
    expect(readCall).toBeGreaterThan(-1);
    const firstPoison = harness.indexOf('poison(fixture.component)');
    expect(firstPoison).toBeGreaterThan(readCall);
    // Asked once for the whole file, not per fixture row: a per-row read is exactly the
    // bug, and `readRegistrationOnce`'s own guard is what makes it cheap, so a call site
    // outside that guard would mean the read is being done somewhere else entirely.
    const calls = [...harness.matchAll(/readRegistrationOnce\(\)/g)].length;
    const insideGuard = harness.slice(
      harness.indexOf('function readRegistrationOnce'),
      harness.indexOf('/**', harness.indexOf('function readRegistrationOnce'))
    );
    expect(
      calls - [...insideGuard.matchAll(/readRegistrationOnce\(\)/g)].length
    ).toBe(1);
    // And the question is asked in exactly one place. The engine seam's name appears as its
    // own definition and as the one call inside the reader; a second call anywhere else in
    // the file would be a per-test read wearing the fix's clothes.
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
    // The other half of N3. `declaredFallback` and `boxRuleFor` throw on a missing row, and
    // round 1 called them in the `describe` body — Jest runs that while collecting, so one
    // fixture whose component had no shared-table row aborted the whole file and reported
    // nothing about the six controls that were fine. Inside an `it` the same throw is one red
    // test with its control's name on it. Device-only code, so this proves the shape rather
    // than the behaviour: no lookup between the loop's `describe(` and its first `it(`.
    // The suite's own loop. Anchored on its `describe`, because `readRegistrationOnce` above
    // it iterates the same table and is allowed to call things at module scope.
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
    // …and they really are called, or this guard is guarding nothing.
    expect(body).toContain('declaredFallback(');
    expect(body).toContain('boxRuleFor(');
  });

  it('says so when the fixture table itself cannot be found', () => {
    // The failure mode of a scan that quietly finds nothing: rename the table and the old
    // substring check reported every control covered, because a doc comment elsewhere in the
    // file still said `name: 'Switch'`. An unreadable table has to be its own problem.
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
    // A row *of the table*, which is the shape the bug has: the control leaves the registry,
    // its fixture stays, still rendering and still green. An object appended after the table
    // is not a fixture, and the old scan reporting it as one was the too-much-reading that
    // the test above refuses from the other side.
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
  /** A log in the shape `CheckLog` has, recording instead of printing. */
  function fakeLog() {
    return {
      notes: [],
      failures: [],
      // Every description, pass or fail. The sweep's passing line is an assertion about what
      // a reader sees, so a test has to be able to read it back — `failures` alone can only
      // ask what went wrong, never what the run claimed when it did not.
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

  /** A navigation that records where it was asked to go. */
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
    };
  }

  /** A collector for the logs the sweep opens. */
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

  /** What `fn` printed, for a claim about the summary line a human reads. */
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

  /** A node with a box, in the shape `parseHierarchy` produces. */
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
    // The measured reason: a hosted control below the fold answers a dump with no box, so
    // a sweep that read only the top of a screen would report healthy controls as missing.
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
    // The other half of that scroll, and the case a `contentDesc === label` test would
    // pass without ever exercising: a named node drawn at nothing. It is the same finding
    // the rule reports when it gives up (`zero-sized box`), so a sweep that stopped here
    // would exempt a control that merely needed one more swipe — and the box check in the
    // scroll loop would be dead code that reads like a guard.
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

  it('judges the last tree after the scroll budget runs out, and says what it saw', () => {
    // Named but never boxed: the budget ends and the rule still has to speak, because
    // "I could not find it" and "it is drawn at nothing" are different bugs.
    const { begin, logs } = collector();
    const navigation = fakeNavigation(() => [
      node('Controlled switch', { width: 0, height: 0 }),
    ]);
    return runA11ySweep(begin, navigation, switchCase()).then(() => {
      expect(navigation.scrolls).toBe(SCROLL_PROBE_LIMIT);
      expect(logs[0].log.failures.join('\n')).toContain('zero-sized box');
    });
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
    // The Slider's named node is not actionable and has a row. The same control with no
    // name at all is a different finding, and the row must not excuse it.
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
    // …and the *passing line* has to agree with that note (X4 re-review, low). The first
    // version printed "is named on one node a person can act on" beside a note saying it is
    // not, which is a ✓ that contradicts the finding two lines above it — and a reader who
    // scans the verdicts, or a tool that greps for the ✓, reads the opposite of the run.
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
    // The self-clearing half, at the device end: give the Slider an actionable node and
    // its row matches nothing, so the sweep opens an `a11y:debt` log that says to delete it.
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
      // A tree where every control is named on one actionable node: no Android debt row
      // matches anything, so every one of them is stale — which is the same proof as
      // above, over the whole table. Counted from the list, not written out, so adding or
      // retiring a row does not edit this test.
      expect(result.matched).toEqual([]);
      expect(result.stale.length).toBe(
        A11Y_EXEMPTIONS.filter(
          (row) => row.platform === 'android' || row.platform === 'both'
        ).length
      );
    });
  });

  it('reads a real measured dump the same way the unit test says it does', () => {
    // The sweep and the pure rule have to agree on a real tree, or the gate and the test
    // are checking two different things. The Switch's own dump, through the fake device.
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
    // The sweep reaches every screen by tapping a tab, and on a run over the whole table
    // those are the majority of the run's navigations. `goToScreen` re-presses a tab
    // until its screen arrives and reports each re-press through the log it is *given*
    // (`log?.retried?.()`), so a sweep that hands it nothing records the retry nowhere
    // and `Suite.finish` reports a run that never retried — the brief's "a retry is
    // allowed only if it is counted and reported", failing on the silent half (X21).
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
    // The retry has to be in the auxiliary check's own log — that is the log the sweep
    // opened for the case, and the only one the fake could have been handed.
    expect(suite.auxiliary[0].log.retries).toEqual([
      'navigation: the "Switch" tab answered on tap 2/3 - the earlier tap(s) were ' +
        'never delivered',
    ]);
    // ...and in the one line a reader of the run looks at first.
    expect(printed).toContain('1 input sequence(s) needed a retry');
    expect(printed).toContain('1 of them on an auxiliary check');
  });

  it('counts every source of retry in the run’s one total', async () => {
    // Three fix rounds, three sources, one number. E5 counts a re-dragged gesture on the
    // control's log, the tab-tap guard counts a re-pressed control there too, and the sweep
    // counts a re-tapped tab on an auxiliary log (X21). Both E5 and X21 edited the line that
    // prints the total, so the merge keeps both halves: a total over the controls alone
    // denies the sweep's re-taps — the exact silence X21 was raised for. 2 + 1 so neither
    // half can satisfy it alone.
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
