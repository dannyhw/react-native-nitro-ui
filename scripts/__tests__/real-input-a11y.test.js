/**
 * The Android a11y rule, against dumps measured from the running app.
 *
 * Two claims, and the second is the one that matters. The first is that the rule passes
 * on each control's real subtree — worth little on its own, because a rule that accepts
 * everything passes too. The second is that each failure mode the rule exists to catch
 * makes it red, on a fixture built by *breaking* a measured tree in the way the bug does
 * it. That is the proof AGENTS.md asks for, and it is why the fixtures are dumped rather
 * than written: a hand-typed tree tests the rule against a shape the code may never see.
 *
 * The fixtures came from `scripts/conformance/make-a11y-fixtures.mjs` on pair-b
 * (`emulator-5570`), one screen per control, scrolled so every control had a box.
 *
 * @file
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from '@jest/globals';

import {
  A11Y_CONTROLS,
  A11Y_EXEMPTIONS,
  a11yProblems,
  checkControlA11y,
  staleExemptions,
} from '../real-input/a11y.mjs';
import { parseHierarchy } from '../real-input/uiautomator.mjs';

/** @type {Map<string, import('../real-input/uiautomator.mjs').UiautomatorNode[]>} */
const parsed = new Map();

/**
 * A control's measured tree, parsed once so node identity survives — the mutations below
 * find the node to break by object, which only works if there is one instance of it.
 *
 * @param {string} id an `A11yControl.id`
 */
function tree(id) {
  if (!parsed.has(id)) {
    parsed.set(
      id,
      parseHierarchy(readFileSync(`${__dirname}/fixtures/a11y/${id}.xml`, 'utf8'))
    );
  }
  return parsed.get(id);
}

/**
 * @param {string} id an `A11yControl.id`
 * @returns {import('../real-input/a11y.mjs').A11yControl}
 */
function control(id) {
  const found = A11Y_CONTROLS.find((candidate) => candidate.id === id);
  if (found == null) throw new Error(`no a11y case "${id}"`);
  return found;
}

/** The node a verdict is about, so a mutation can be named precisely. */
function named(id) {
  const node = tree(id).find(
    (candidate) => candidate.contentDesc === control(id).label
  );
  if (node == null) throw new Error(`fixture ${id} has no named node`);
  return node;
}

/** The measured tree with one node replaced by a patched copy, the rest verbatim. */
function mutate(id, target, patch) {
  return tree(id).map((node) => (node === target ? { ...node, ...patch } : node));
}

const ZERO_BOX = {
  x1: 0,
  y1: 0,
  x2: 0,
  y2: 0,
  cx: 0,
  cy: 0,
  width: 0,
  height: 0,
};

describe('the a11y rule, on measured trees', () => {
  it('passes the controls today’s code gets right, and reports the rest as debt', () => {
    const verdicts = A11Y_CONTROLS.map((entry) => {
      const result = checkControlA11y(entry, tree(entry.id));
      return { id: entry.id, failures: result.failures, known: result.known };
    });
    expect(
      verdicts.filter((v) => v.known.length === 0).map((v) => v.id)
    ).toEqual([
      'switch',
      'button',
      'date-picker',
      'picker',
      'hosted-switch',
      'hosted-button',
      'hosted-picker',
      'hosted-date-picker',
      'hosted-progress',
    ]);
    // The rest are not silently passing: each is a finding, printed, with a debt row.
    expect(
      verdicts.filter((v) => v.known.length > 0).map((v) => v.id)
    ).toEqual(['slider', 'segmented-control', 'hosted-slider', 'hosted-segmented']);
    // And nothing *fails*, which is the difference between landing green and hiding: a new
    // failure on a control with a debt row still goes red, because rows match findings.
    for (const verdict of verdicts) {
      expect(verdict.failures).toEqual([]);
    }
  });

  it('goes red when a name moves to the container around the control', () => {
    // G5 M2 and G6 M3 exactly: the label ends up on a layout box *around* the control,
    // which is not the control, is not actionable, and leaves the control unnamed. The
    // box here is the RN content container (1080 wide, the whole page) — the measured
    // shape a wrapper has when a component sets `accessibilityLabel` on its host view
    // rather than on the thing it renders.
    //
    // Worth naming what the *other* mutation is not: moving the name onto the Switch's
    // own 137x126 touch-target node is not a bug, because a person pressing that box is
    // pressing the control, and the rule passes it on purpose. What has to go red is a
    // name on a box that is not the control's.
    const target = named('switch');
    const wrapper = tree('switch').find(
      (node) =>
        node !== target &&
        node.className === 'android.view.ViewGroup' &&
        node.bounds.width === 1080 &&
        node.bounds.height === 2040 &&
        node.scrollable !== 'true'
    );
    expect(wrapper).toBeDefined();
    const mutated = tree('switch').map((node) => {
      if (node === target) return { ...node, contentDesc: '' };
      if (node === wrapper) return { ...node, contentDesc: control('switch').label };
      return node;
    });
    const problems = a11yProblems(control('switch'), mutated);
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain('is not actionable');
    // The nearest actionable box it found is the page, which the message says.
    expect(problems[0]).toContain('which is the page, not the control');
  });

  it('goes red when the name is on the control AND on something else', () => {
    // The more common half of the same bug, and G6's: both nodes carry it, so a screen
    // reader stops twice and only one of the stops has the value.
    const mutated = tree('switch').map((node) =>
      node.className === 'android.widget.ScrollView'
        ? { ...node, contentDesc: control('switch').label }
        : node
    );
    const problems = a11yProblems(control('switch'), mutated);
    expect(problems.join('\n')).toContain('2 nodes carry the name');
    expect(problems.join('\n')).toContain('announces twice');
  });

  it('goes red when the name has no box', () => {
    // Measured for real on a hosted control below the fold: Compose names it and draws
    // nothing, which is why the sweep scrolls before reading.
    const problems = a11yProblems(
      control('hosted-button'),
      mutate('hosted-button', named('hosted-button'), { bounds: ZERO_BOX })
    );
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain('zero-sized box');
  });

  it('goes red when the name disappears', () => {
    const problems = a11yProblems(
      control('date-picker'),
      mutate('date-picker', named('date-picker'), { contentDesc: 'Something else' })
    );
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain('announces this control as nothing');
  });

  it('goes red for an interactive control whose named node cannot be acted on', () => {
    // The Picker passes because its name is on a `Spinner` that is itself `clickable`.
    // Take that flag away and no other node whose box is the control's is actionable, so
    // the rule has to say so.
    const stripped = mutate('picker', named('picker'), { clickable: 'false' });
    const problems = a11yProblems(control('picker'), stripped);
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain('is not actionable');
    // …and the message names the nearest thing it did find, so the failure is a lead.
    expect(problems[0]).toContain('The nearest actionable box containing it is');
    expect(problems[0]).toContain('which is the page, not the control');
  });

  it('does not let the page’s scroll view stand in for a control', () => {
    // The ScrollView is `focusable="true"`, `scrollable="true"` and contains everything.
    // If containment-plus-any-action were the rule, every control on Earth would pass, so
    // this is the assertion that keeps the rule from being a tautology: the Slider's
    // finding has to name the scroll view as *rejected*, not as an answer.
    const scroller = tree('slider').find((node) => node.scrollable === 'true');
    expect(scroller.focusable).toBe('true');
    expect(scroller.bounds.width).toBeGreaterThan(named('slider').bounds.width);
    const problems = a11yProblems(control('slider'), tree('slider'));
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain('which is the page, not the control');
  });

  it('goes red when a name lands on the scroll container itself', () => {
    // The inverse of the last test, and the reason `scrollable` is parsed at all: the
    // scroll view is focusable, so "the name is on an actionable node" is *true* here.
    // A control whose name had slid onto the page would be announced as the whole screen.
    const scroller = tree('switch').find((node) => node.scrollable === 'true');
    const mutated = tree('switch').map((node) => {
      if (node === scroller) return { ...node, contentDesc: control('switch').label };
      if (node === named('switch')) return { ...node, contentDesc: '' };
      return node;
    });
    const problems = a11yProblems(control('switch'), mutated);
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain('is on a scroll container');
  });

  it('accepts a Material touch target taller than the visual it wraps', () => {
    // The negative control, and the reason the rule is containment rather than box
    // equality: the Switch's named node is 137x84 inside a clickable|checkable|focusable
    // node 137x126 (measured). A rule demanding equality would report four healthy
    // controls as broken, and the next person to trip over it would delete it.
    const target = named('switch');
    expect(target.clickable).toBe('false');
    expect(target.checkable).toBe('false');
    const home = tree('switch').find(
      (node) =>
        node !== target &&
        node.bounds.width === target.bounds.width &&
        node.bounds.height > target.bounds.height &&
        node.clickable === 'true'
    );
    expect(home).toBeDefined();
    expect(a11yProblems(control('switch'), tree('switch'))).toEqual([]);
    // And the pass is the *home* doing it: strip the home's flags and the same tree
    // goes red, so the assertion above is not passing on the scroll view.
    const stripped = mutate('switch', home, {
      clickable: 'false',
      checkable: 'false',
      focusable: 'false',
    });
    expect(a11yProblems(control('switch'), stripped)[0]).toContain('is not actionable');
  });
});

describe('the debt list', () => {
  it('is the four measured findings, and nothing else', () => {
    expect(A11Y_EXEMPTIONS.map((entry) => entry.control)).toEqual([
      'slider',
      'segmented-control',
      'hosted-slider',
      'hosted-segmented',
    ]);
    for (const entry of A11Y_EXEMPTIONS) {
      // Each row names the FOLLOWUPS line that owns the fix, so debt has an address.
      expect(entry.followups.length).toBeGreaterThan(0);
    }
  });

  it('excuses only the finding it describes', () => {
    // A row matched to `not actionable` must not excuse a *missing* name: that is the
    // difference between recorded debt and a disabled test.
    const missing = mutate('slider', named('slider'), { contentDesc: '' });
    const result = checkControlA11y(control('slider'), missing);
    expect(result.exempt).toBe(false);
    expect(result.failures.length).toBe(1);
    expect(result.failures[0]).toContain('announces this control as nothing');
  });

  it('goes red when a control is fixed and its row is left behind', () => {
    // The self-clearing half: give the Slider's own node a press and the row stops
    // matching, which `staleExemptions` reports — so a row cannot outlive the bug.
    const fixed = mutate('slider', named('slider'), { clickable: 'true' });
    const result = checkControlA11y(control('slider'), fixed);
    expect(result.known).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.exempt).toBe(false);
    expect(
      staleExemptions(
        A11Y_CONTROLS.map((entry) => entry.id),
        []
      )
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('the entry for "slider"'),
        expect.stringContaining('delete the exemption'),
      ])
    );
    // Every row the run covered is reported, not just the one that was fixed: a run that
    // saw all four controls and found nothing is four pieces of evidence.
    expect(
      staleExemptions(A11Y_CONTROLS.map((entry) => entry.id), []).length
    ).toBe(A11Y_EXEMPTIONS.length);
  });

  it('says nothing about a control the run never read', () => {
    // A filtered `--control slider` run must not report the three rows it skipped as
    // stale, or a partial run would look like three fixes.
    expect(staleExemptions(['slider'], ['slider'])).toEqual([]);
    expect(staleExemptions([], [])).toEqual([]);
    expect(staleExemptions(['slider'], [])).toEqual([
      expect.stringContaining('the entry for "slider"'),
    ]);
  });
});
