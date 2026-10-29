/**
 * The iOS half of the accessibility rule.
 *
 * X4's review found that the in-app harness could not fail this rule on iOS at all:
 * React Native copies an `accessibilityLabel` prop onto its own component view
 * (`RCTViewComponentView.mm:471`), and the harness's query finds a view by that same label
 * (`ViewQueryHelper.mm:65`), so the box it measured and the "labelled box" it measured were
 * one and the same view. The rule moved to XCUITest, which walks the tree VoiceOver walks.
 *
 * These tests are why the move is worth the extra machinery: `iosA11yProblems` decides from
 * a tree handed to it, so every way the bug can appear is proved here in milliseconds, and
 * `scripts/real-input/ios.mjs` runs the same function against a simulator's log.
 *
 * The nodes are written as the real pass reported them on pair-a (`iPhone 17`, the tree
 * `RealInputTests.testRealInputA11y` prints): every control has the React Native wrapper
 * carrying its `testID` *and* the hosted element carrying the same name. A fixture that
 * left the wrapper out would be a fixture where the old bug is impossible.
 *
 * @file No device: see the header of `./real-input-a11y.test.js` for why the rule lives
 *       apart from the runner.
 */

import { describe, expect, it } from '@jest/globals';

import {
  A11Y_CONTROLS,
  checkIosControlA11y,
  exemptionsFor,
  iosA11yProblems,
  parseIosA11yLog,
  staleExemptions,
} from '../real-input/a11y.mjs';

/** The measured box of `switch-controlled`, as XCUITest reported it. */
const SWITCH_BOX = { x: 325, y: 217.3333282470703, width: 61, height: 28 };

/**
 * One element, defaulting to "a hosted element at the control's box, announcing the
 * control's name, as a switch, and ready to be acted on".
 *
 * Defaults matter here: each test states only the one thing it breaks, so a red fixture is
 * readable as one difference from the measured truth.
 */
function node(overrides = {}) {
  return {
    type: 'switch',
    enabled: true,
    hittable: true,
    id: '',
    label: 'Controlled switch',
    value: '0',
    frame: { ...SWITCH_BOX },
    anchor: false,
    ...overrides,
  };
}

/** The React Native wrapper: same box, same name, and the `testID` that anchors the case. */
function wrapper(label = 'Controlled switch', frame = SWITCH_BOX) {
  return node({ id: 'switch-controlled', label, frame, anchor: true });
}

/** The tree the current iOS code produces for a Switch — the shape all seven pass. */
function switchTree() {
  return [wrapper(), node()];
}

/**
 * @param {string} id an `A11yControl.id`
 */
function control(id) {
  const found = A11Y_CONTROLS.find((candidate) => candidate.id === id);
  if (found == null) throw new Error(`no a11y case "${id}"`);
  return found;
}

describe('the iOS a11y rule', () => {
  it('passes the tree the current code produces', () => {
    expect(iosA11yProblems(control('switch'), switchTree())).toEqual([]);
  });

  it('goes red when the name is on the wrapper and nowhere else', () => {
    // The exact bug the rule exists for, and the shape the in-app suite reported as a pass
    // for every control: React Native's component view carries the label, nothing beneath
    // it does. `box == labelBox` was the "evidence".
    const tree = [wrapper()];
    const problems = iosA11yProblems(control('switch'), tree);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(
      'no element other than the React Native wrapper'
    );
    expect(problems[0]).toContain(
      'a name on a wrapper rather than on the control'
    );
  });

  it('goes red when the named element is not at the control’s box', () => {
    // A name the person can act on belongs on the box the control is drawn at. Ten points
    // away is a different place: measured, the honest pair agrees to under a tenth.
    const tree = [
      wrapper(),
      node({ frame: { ...SWITCH_BOX, y: SWITCH_BOX.y + 10 } }),
    ];
    const problems = iosA11yProblems(control('switch'), tree);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('is on a box that is not the control');
  });

  it('still accepts the sub-tenth a second read of one layout produces', () => {
    // The tolerance is the noise floor of two independent reads, and it has to be tested
    // from both sides or it is just a number that makes the other test pass.
    const tree = [
      wrapper(),
      node({ frame: { ...SWITCH_BOX, height: SWITCH_BOX.height + 0.33 } }),
    ];
    expect(iosA11yProblems(control('switch'), tree)).toEqual([]);
  });

  it('goes red when the name reaches two elements', () => {
    // G6's symptom on this platform: two stops, one value.
    const tree = [
      wrapper(),
      node(),
      node({ frame: { ...SWITCH_BOX, width: SWITCH_BOX.width + 0.6 } }),
    ];
    const problems = iosA11yProblems(control('switch'), tree);
    expect(problems.join(' ')).toContain('announces twice');
  });

  it('goes red when the named element can be neither acted on nor focused', () => {
    const tree = [wrapper(), node({ enabled: false, hittable: false })];
    const problems = iosA11yProblems(control('switch'), tree);
    expect(problems[0]).toContain('neither enabled nor hittable');
  });

  it('leaves an indicator alone — Progress is not something you press', () => {
    // Measured: the hosted linear bar's element is `hittable=false` because it is 4 pt
    // tall. Requiring a press there would assert something the component deliberately is
    // not, and the first person to see it would loosen the whole rule.
    const progress = control('hosted-progress');
    const tree = [
      node({
        id: progress.anchorTestId,
        label: progress.label,
        type: 'progress indicator',
        frame: { x: 16, y: 378.33, width: 370, height: 4 },
        anchor: true,
        hittable: true,
      }),
      node({
        label: progress.label,
        type: 'progress indicator',
        value: '35%',
        frame: { x: 16, y: 378.33, width: 370, height: 4 },
        hittable: false,
      }),
    ];
    expect(iosA11yProblems(progress, tree)).toEqual([]);
  });

  it('goes red when the announcement loses the kind of control it is', () => {
    // The brief's trait. `other` is what XCUITest reports for a plain box: a person hears
    // a name with no idea what can be done with it.
    const tree = [wrapper(), node({ type: 'other' })];
    const problems = iosA11yProblems(control('switch'), tree);
    expect(problems[0]).toContain(
      'is announced as an other and not as a switch'
    );
  });

  it('goes red when no element carries the testID it anchors on', () => {
    // Not "the control is fine and unreadable" — if the anchor is gone, the run read
    // nothing and must not report a verdict either way.
    const problems = iosA11yProblems(control('switch'), [node()]);
    expect(problems[0]).toContain('never found the control');
  });

  it('tells a name with no box apart from a name that is absent', () => {
    // Two different bugs with the same symptom from one query, and different fixes.
    const tree = [
      wrapper(),
      node({ frame: { x: 0, y: 0, width: 0, height: 0 } }),
    ];
    expect(iosA11yProblems(control('switch'), tree)[0]).toContain(
      'zero-sized box'
    );
  });
});

describe('the iOS debt rows', () => {
  it('prints the Slider’s real announcement as known failing, not as a pass', () => {
    // Measured on pair-a: the element under `slider-controlled` is `other` with value
    // "0.25" — the vended `.adjustable` element, which XCUITest reports by its type. The
    // rule still asks, and the debt list is what makes the answer printed rather than
    // swallowed.
    const slider = control('slider');
    const tree = [
      node({
        id: slider.anchorTestId,
        label: slider.label,
        type: 'other',
        frame: { x: 16, y: 217.33, width: 370, height: 31 },
        anchor: true,
        value: '',
      }),
      node({
        label: slider.label,
        type: 'other',
        value: '0.25',
        frame: { x: 16, y: 217.33, width: 370, height: 31 },
      }),
    ];
    const result = checkIosControlA11y(slider, tree);
    expect(result.failures).toEqual([]);
    expect(result.known).toHaveLength(1);
    expect(result.known[0]).toContain('known failing');
    expect(result.known[0]).toContain(
      'is announced as an other and not as a slider'
    );
    expect(result.exempt).toBe(true);
  });

  it('still fails the Slider for a bug its debt row does not describe', () => {
    // An exemption is tied to a finding, not to a control. The row excuses the wrong word
    // in the announcement; a name that has also moved off the control is a second problem,
    // and it has to go red *beside* the known one rather than being swallowed by it.
    const slider = control('slider');
    const tree = [
      node({
        id: slider.anchorTestId,
        label: slider.label,
        type: 'other',
        frame: { x: 16, y: 217.33, width: 370, height: 31 },
        anchor: true,
      }),
      node({
        label: slider.label,
        type: 'other',
        value: '0.25',
        frame: { x: 16, y: 260, width: 370, height: 31 },
      }),
    ];
    const result = checkIosControlA11y(slider, tree);
    expect(result.failures[0]).toContain('not the control');
    expect(result.known).toHaveLength(1);
    expect(result.exempt).toBe(true);
  });

  it('reports the hosted Picker’s doubled name as a finding, and keeps it debt', () => {
    // Measured: no element under `host-picker` is announced as "Hosted picker"; the one the
    // label reaches announces "Hosted picker, Hosted picker". The rule reads that as the
    // control having no name of its own — which is what a person would call a stutter.
    const picker = control('hosted-picker');
    const box = { x: 16, y: 578.67, width: 75.33, height: 34.67 };
    const tree = [
      node({
        id: picker.anchorTestId,
        label: 'Hosted picker',
        type: 'other',
        frame: box,
        anchor: true,
        value: '',
      }),
      node({
        label: 'Hosted picker, Hosted picker',
        type: 'button',
        frame: box,
        value: '',
      }),
    ];
    const problems = iosA11yProblems(picker, tree);
    expect(problems[0]).toContain(
      'no element other than the React Native wrapper'
    );
    const result = checkIosControlA11y(picker, tree);
    expect(result.known).toHaveLength(1);
    expect(result.exempt).toBe(true);
  });

  it('does not let one platform’s row excuse the other platform’s finding', () => {
    // The reason `A11Y_EXEMPTIONS` rows carry a platform. The Slider has debt on both
    // platforms, for different bugs; an iOS run that read a *correct* announcement must
    // match nothing, and the Android row must not be reachable from this side at all.
    const good = [
      node({
        id: 'slider-controlled',
        label: 'Controlled slider',
        type: 'slider',
        frame: { x: 16, y: 217.33, width: 370, height: 31 },
        anchor: true,
      }),
      node({
        label: 'Controlled slider',
        type: 'slider',
        value: '0.25',
        frame: { x: 16, y: 217.33, width: 370, height: 31 },
      }),
    ];
    const result = checkIosControlA11y(control('slider'), good);
    expect(result.known).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(exemptionsFor('slider', 'ios').length).toBe(1);
    // And the stale-clearing pass on iOS cannot report the Android rows, which that run
    // never read.
    expect(
      staleExemptions(
        A11Y_CONTROLS.map((entry) => entry.id),
        [],
        'ios'
      ).every((line) => line.includes('the ios entry'))
    ).toBe(true);
  });
});

describe('reading the pass out of an xcodebuild log', () => {
  /** Two cases, in the shape `RealInputTests.testRealInputA11y` prints. */
  const LOG = [
    "Test Case '-[NitroUiExampleUITests.RealInputTests testRealInputA11y]' started.",
    'real-input a11y case=switch kind=anchor id=switch-controlled x=325.0 y=217.333 w=61.0 h=28.0 nodes=2',
    'real-input a11y case=switch kind=node trait="switch" enabled=true hittable=true id="switch-controlled" label="Controlled switch" value="" x=325.0 y=217.333 w=61.0 h=28.0',
    'real-input a11y case=switch kind=node trait="switch" enabled=true hittable=true id="" label="Controlled switch" value="0" x=325.0 y=217.333 w=61.0 h=28.0',
    'real-input a11y case=hosted-segmented kind=node trait="segmented control" enabled=true hittable=true id="host-segmented" label="Hosted segmented" value="" x=16.0 y=547.667 w=165.0 h=31.0',
    'real-input a11y case=hosted-picker kind=node trait="other" enabled=true hittable=true id="host-picker" label="Hosted picker" value="" x=16.0 y=578.667 w=75.333 h=34.667',
    'real-input a11y case=hosted-picker kind=node trait="button" enabled=true hittable=true id="" label="Hosted picker, Hosted picker" value="" x=16.0 y=578.999 w=75.333 h=34.333',
    "Test Case '-[... testRealInputA11y]' passed (140.173 seconds).",
  ].join('\n');

  it('keeps a two-word element type intact', () => {
    // Measured the hard way: the first version printed `trait=segmented control` unquoted,
    // the reader stopped at the space, and the rule reported "announced as a segmented and
    // not as a segmented control" — a parser artifact dressed up as a component bug, in a
    // run whose every other line was correct.
    const node = parseIosA11yLog(LOG).get('hosted-segmented')[0];
    expect(node.type).toBe('segmented control');
    expect(node.label).toBe('Hosted segmented');
  });

  it('reads each case’s elements, and marks the wrapper by its testID', () => {
    const trees = parseIosA11yLog(LOG);
    expect([...trees.keys()]).toEqual([
      'switch',
      'hosted-segmented',
      'hosted-picker',
    ]);
    const [anchor, hosted] = trees.get('switch');
    // The element that carries the `testID` is the wrapper however the pass orders its
    // lines; that is the one definition of "the control's box", shared with the rule.
    expect(anchor.anchor).toBe(true);
    expect(hosted.anchor).toBe(false);
    expect(hosted.value).toBe('0');
    expect(hosted.type).toBe('switch');
  });

  it('carries a label with a comma and spaces through intact', () => {
    // The reason the Swift side quotes these fields: splitting on whitespace would read the
    // hosted Picker's doubled name as "Hosted" and lose the rest of the line.
    const node = parseIosA11yLog(LOG).get('hosted-picker')[1];
    expect(node.label).toBe('Hosted picker, Hosted picker');
  });

  it('decides the whole run from the log alone', () => {
    // The point of parsing rather than asserting in Swift: this is the same call
    // `ios.mjs` makes against a simulator's log, so a fixture proves the device path.
    const trees = parseIosA11yLog(LOG);
    expect(
      checkIosControlA11y(control('switch'), trees.get('switch'))
    ).toMatchObject({
      failures: [],
      known: [],
    });
    const picker = checkIosControlA11y(
      control('hosted-picker'),
      trees.get('hosted-picker')
    );
    expect(picker.known).toHaveLength(1);
  });

  it('refuses a line whose box did not parse, rather than reading no elements', () => {
    // A format change would otherwise look like "thirteen cases measured nothing" and the
    // temptation would be to make missing lines a skip.
    // The *node* line, not the anchor's preamble, which the reader skips by design.
    const broken = LOG.replace(
      'label="Controlled switch" value="0" x=325.0 y=217.333 w=61.0 h=28.0',
      'label="Controlled switch" value="0" x=325.0 y=217.333 w=?? h=??'
    );
    expect(() => parseIosA11yLog(broken)).toThrow(/no readable box/);
  });

  it('reads a log with no a11y lines as no cases at all', () => {
    // `ios.mjs` turns this into a per-case "not measured" failure, which is how a pass that
    // never reached a screen stays a failure rather than a green section.
    expect(parseIosA11yLog('nothing here').size).toBe(0);
  });
});

describe('the Swift case list against the shared table', () => {
  const swift = require('node:fs').readFileSync(
    `${__dirname}/../../example/ios/NitroUiExampleUITests/RealInputTests.swift`,
    'utf8'
  );

  /** The `A11yCase(id: "…", testId: "…", label: "…")` entries in the Swift file. */
  const swiftCases = () => {
    const found = [];
    const pattern =
      /A11yCase\(id:\s*"([^"]+)",\s*testId:\s*"([^"]+)",\s*label:\s*"([^"]+)"/g;
    for (const match of swift.matchAll(pattern)) {
      found.push({ id: match[1], testId: match[2], label: match[3] });
    }
    return found;
  };

  it('has one case per row of the shared table, in the same order', () => {
    // The Swift file and `A11Y_CONTROLS` are two lists of the same thirteen controls, kept
    // in two languages. Without this, a renamed case in Swift measures a control nobody
    // asked about and its own case silently reports "not measured" — and a control that
    // quietly leaves the suite is the failure this whole file is built to prevent.
    expect(swiftCases()).toEqual(
      A11Y_CONTROLS.map((entry) => ({
        id: entry.id,
        testId: entry.anchorTestId,
        label: entry.label,
      }))
    );
  });

  it('goes red when the two lists disagree about a label', () => {
    // The same comparison must be able to fail, so it is proved here on a copy rather than
    // trusted because the two files happen to agree today.
    const table = A11Y_CONTROLS.map((entry) => ({ ...entry }));
    table[0] = { ...table[0], label: 'Renamed switch' };
    expect(swiftCases()).not.toEqual(
      table.map((entry) => ({
        id: entry.id,
        testId: entry.anchorTestId,
        label: entry.label,
      }))
    );
  });

  it('has a testID in the Swift list for every case the iOS rule reads', () => {
    // `hosted-picker` is the one case whose announcement the rule cannot grade (its debt
    // row says why), and it still has an anchor, because the wrapper's box is what the
    // finding is measured against.
    for (const entry of A11Y_CONTROLS) {
      expect(typeof entry.anchorTestId).toBe('string');
    }
  });
});
