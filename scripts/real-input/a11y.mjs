/**
 * The a11y conformance rule, read out of a `uiautomator dump`.
 *
 * X4's first rule, and the one the in-app harness cannot state at all on Android:
 * the test queries inside the app walk real `View`s (`@react-native-harness/ui`'s
 * `ViewQueryHelper` matches `View.contentDescription`), and Compose publishes its
 * control's name on a `SemanticsNode` that is not a `View`. So from inside the app a
 * hosted control's name is invisible no matter what the component does — which is why
 * `Slider.harness.tsx` and `Progress.harness.tsx` assert only that the label reached
 * the control, and say why in a comment. `uiautomator dump` *is* the accessibility
 * tree, so the question "which node does TalkBack get?" is answerable from outside,
 * from the `real-input:android` gate. That is where this rule runs: it is not a new
 * gate, because a gate nobody runs is not a guardrail.
 *
 * The bug it answers is the one two reviews found by hand (G5 review M2, G6 review
 * M3, `docs/tasks/FOLLOWUPS.md` "Core a11y check"): the control's name sits on a node
 * that is **not** the node the control is. TalkBack then announces a name with no
 * behaviour, or a behaviour with no name, and the control still taps perfectly, so
 * every other suite stays green.
 *
 * Split from `android.mjs` for the same reason `android-tree.mjs` is: the script
 * boots a device on import, this does not, so the rule's failure modes can be proved
 * against a real dump in `scripts/__tests__/real-input-a11y.test.js`.
 */

import { findAllByDescription } from './uiautomator.mjs';

/**
 * One control's a11y case: what to look for, on which screen, and what its node has
 * to say about itself.
 *
 * @typedef {object} A11yControl
 * @property {string} id the case's own name — the manifest id for a plain control,
 *   and a `<Host>`-prefixed one for a control composed by a `<Host>`
 * @property {string} component the manifest `name` this case guards. Coverage is
 *   keyed on this, which is what lets one control be covered twice (its own screen
 *   and inside a Host) without the rule claiming two controls.
 * @property {string} hybridView the component's Fabric name, for the report line
 * @property {ScreenId} screen the example tab that renders it — the same union
 *   `controls.mjs` uses, plus `progress`, which no real-input row needs.
 * @property {string} label the `accessibilityLabel` the example screen puts on it
 * @property {'interactive'|'indicator'} role `interactive` controls have to be a node
 *   a person can act on (`clickable` / `checkable` / `focusable`); `indicator`
 *   controls only have to be a node with a box. A Progress draws and announces; it is
 *   not something you press, and requiring `clickable` would be asserting something
 *   the component deliberately is not.
 * @property {boolean} [hosted] the control *inside a* `<Host>`. Two differences, both
 *   measured: the child's own RN view is laid out at 0×0 (D24) and is not in the
 *   accessibility tree with a box, and the label Compose publishes is the only node
 *   that exists — so there is no anchor to compare against, and the named node is
 *   judged on its own.
 * @property {string} [labelAttribute] the exact JSX the screen must contain for this
 *   label, when the plain `accessibilityLabel="<label>"` form does not describe it —
 *   `HostScreen.tsx` names its batch Switches with a template literal. The
 *   cross-check looks for this string, so a label that only exists as an
 *   interpolation still has to be there.
 * @property {string} [anchorTestId] a `testID` the same screen renders for the same
 *   control — its RN-side box. When present the rule compares the named node's box
 *   with it, which is what separates "the name reached the control" from "the name is
 *   on a wrapper around it": the wrapper is a real layout box and differs by whole
 *   pixels, and a pure "does the name exist" check cannot see that.
 */

/** @typedef {'switch'|'slider'|'button'|'segmented'|'datepicker'|'picker'|'progress'|'host'} ScreenId */

/**
 * Which screen file renders each tab, for the cross-check in
 * `scripts/conformance-core.mjs` (`checkA11yTable`), which has to know where to look
 * for a label. Written out because a tab id is not a file name (`datepicker` renders
 * `DatePickerScreen.tsx`, `host` renders `HostScreen.tsx` for every component).
 *
 * @type {Readonly<Record<ScreenId, string>>}
 */
export const SCREEN_FILE = Object.freeze({
  switch: 'example/src/SwitchScreen.tsx',
  slider: 'example/src/SliderScreen.tsx',
  button: 'example/src/ButtonScreen.tsx',
  segmented: 'example/src/SegmentedControlScreen.tsx',
  datepicker: 'example/src/DatePickerScreen.tsx',
  picker: 'example/src/PickerScreen.tsx',
  progress: 'example/src/ProgressScreen.tsx',
  host: 'example/src/HostScreen.tsx',
});

/**
 * The controls the rule covers, with the label each example screen carries.
 *
 * Written out rather than derived: the labels are JSX literals in the screens, so
 * there is nothing to generate from — and `checkA11yTable` asserts every pair still
 * appears in the screen it names, so a rename on either side goes red instead of the
 * check quietly looking for a name nothing draws. Every manifest has a case, which is
 * what makes a new control's omission a failing test rather than a gap.
 *
 * The `hosted-*` cases are the brief's "the hostable ones inside `<Host>` where it
 * applies": a `<Host>` composes its children's semantics itself, so the label's node
 * is built by a different code path than the unhosted control's, and a fix to one has
 * already missed the other in this repo's history.
 *
 * @type {ReadonlyArray<A11yControl>}
 */
export const A11Y_CONTROLS = Object.freeze([
  {
    id: 'switch',
    component: 'Switch',
    hybridView: 'NitroUiSwitch',
    screen: 'switch',
    label: 'Controlled switch',
    role: 'interactive',
    anchorTestId: 'switch-controlled',
  },
  {
    id: 'slider',
    component: 'Slider',
    hybridView: 'NitroUiSlider',
    screen: 'slider',
    label: 'Controlled slider',
    role: 'interactive',
    anchorTestId: 'slider-controlled',
  },
  {
    id: 'button',
    component: 'Button',
    hybridView: 'NitroUiButton',
    screen: 'button',
    label: 'Real-input button',
    role: 'interactive',
  },
  {
    id: 'segmented-control',
    component: 'SegmentedControl',
    hybridView: 'NitroUiSegmentedControl',
    screen: 'segmented',
    label: 'Real-input segmented control',
    role: 'interactive',
  },
  {
    id: 'date-picker',
    component: 'DatePicker',
    hybridView: 'NitroUiDatePicker',
    screen: 'datepicker',
    label: 'Real-input date picker',
    role: 'interactive',
  },
  {
    id: 'picker',
    component: 'Picker',
    hybridView: 'NitroUiPicker',
    screen: 'picker',
    label: 'Real-input picker',
    role: 'interactive',
  },
  {
    // The one control with no `real-input` row (its manifest says
    // `realInput: false`), which is exactly why the rule keeps its own table:
    // piggy-backing on the real-input rows would have left Progress unguarded. It is
    // also the only screen this suite never visited, and the only one that needs the
    // 60 Hz writer stopped before a dump can be read — `PROGRESS_IDLE` in android.mjs.
    id: 'progress',
    component: 'Progress',
    hybridView: 'NitroUiProgress',
    screen: 'progress',
    label: 'Variant switcher',
    role: 'indicator',
    anchorTestId: 'progress-variant',
  },
  {
    id: 'hosted-switch',
    component: 'Switch',
    hybridView: 'NitroUiSwitch',
    screen: 'host',
    label: 'Hosted switch 0',
    labelAttribute: 'accessibilityLabel={`Hosted switch ${String(index)}`}',
    role: 'interactive',
    hosted: true,
  },
  {
    id: 'hosted-slider',
    component: 'Slider',
    hybridView: 'NitroUiSlider',
    screen: 'host',
    label: 'Hosted slider',
    role: 'interactive',
    hosted: true,
  },
  {
    id: 'hosted-button',
    component: 'Button',
    hybridView: 'NitroUiButton',
    screen: 'host',
    label: 'Hosted button',
    role: 'interactive',
    hosted: true,
  },
  {
    id: 'hosted-segmented',
    component: 'SegmentedControl',
    hybridView: 'NitroUiSegmentedControl',
    screen: 'host',
    label: 'Hosted segmented',
    role: 'interactive',
    hosted: true,
  },
  {
    id: 'hosted-picker',
    component: 'Picker',
    hybridView: 'NitroUiPicker',
    screen: 'host',
    label: 'Hosted picker',
    role: 'interactive',
    hosted: true,
  },
  {
    id: 'hosted-date-picker',
    component: 'DatePicker',
    hybridView: 'NitroUiDatePicker',
    screen: 'host',
    label: 'Hosted date picker',
    role: 'interactive',
    hosted: true,
  },
  {
    id: 'hosted-progress',
    component: 'Progress',
    hybridView: 'NitroUiProgress',
    screen: 'host',
    label: 'Mixed linear progress',
    role: 'indicator',
    hosted: true,
  },
]);

/**
 * A rule a control is known to fail, recorded rather than failed.
 *
 * @typedef {object} A11yExemption
 * @property {string} control the `A11yControl.id`
 * @property {string} followups the `docs/tasks/FOLLOWUPS.md` line that owns the fix
 * @property {RegExp} matches which problem it covers — an exemption is tied to one
 *   *finding*, not to a control, so a second and different failure on the same
 *   control still goes red.
 */

/**
 * The debt list, and the reason the suite can land green on the first run.
 *
 * An entry is not a `TODO`: {@link staleExemptions} proves each one still describes a
 * problem the current code produces, so a control that gets fixed has its exemption
 * removed by a red test rather than by a reviewer noticing. That is the difference
 * between this list and a skipped test.
 *
 * @type {ReadonlyArray<A11yExemption>}
 */
export const A11Y_EXEMPTIONS = Object.freeze([]);

/**
 * Run one control's rule, splitting what it found into new failures and known debt.
 *
 * @param {A11yControl} control
 * @param {ReadonlyArray<import('./uiautomator.mjs').UiautomatorNode>} tree
 * @returns {{failures: string[], known: string[], exempt: boolean}} `failures` must
 *   go red; `known` are covered by {@link A11Y_EXEMPTIONS} and are printed instead;
 *   `exempt` says this control's problems matched an exemption, which is what
 *   {@link staleExemptions} clears the list against.
 */
export function checkControlA11y(control, tree) {
  const problems = a11yProblems(control, tree);
  const exemptions = A11Y_EXEMPTIONS.filter((entry) => entry.control === control.id);
  const known = problems.filter((problem) =>
    exemptions.some((entry) => entry.matches.test(problem))
  );
  return {
    failures: problems.filter((problem) => !known.includes(problem)),
    known: known.map(
      (problem) =>
        `known failing (` +
        `${exemptions.find((entry) => entry.matches.test(problem))?.followups}): ` +
        `${problem}`
    ),
    exempt: known.length > 0,
  };
}

/**
 * Exemptions that no longer describe anything, because nothing produced them.
 *
 * A run that covered a control and matched no exemption for it is the signal that the
 * control has been fixed: the entry has to go, or the rule would keep excusing a
 * class of bug that no longer exists. This is what stops the list decaying into a
 * permanent skip list.
 *
 * @param {Iterable<string>} coveredIds the ids the run actually read
 * @param {Iterable<string>} matchedIds the ids whose problems matched an exemption
 * @returns {string[]} stale exemption descriptions, in `A11Y_EXEMPTIONS` order
 */
export function staleExemptions(coveredIds, matchedIds) {
  const covered = new Set(coveredIds);
  const matched = new Set(matchedIds);
  return A11Y_EXEMPTIONS.filter(
    (exemption) =>
      covered.has(exemption.control) && !matched.has(exemption.control)
  ).map(
    (exemption) =>
      `A11Y_EXEMPTIONS: the entry for "${exemption.control}" ` +
      `(${exemption.followups}) matched no problem this run — the control passes ` +
      'the rule now, so delete the exemption and let the rule guard it'
  );
}

/**
 * One control's rule: does it carry its own name, on a node a person can act on?
 *
 * @param {A11yControl} control
 * @param {ReadonlyArray<import('./uiautomator.mjs').UiautomatorNode>} tree
 * @returns {string[]} problems, empty when the control passes
 */
export function a11yProblems(control, tree) {
  const named = findAllByDescription(tree, control.label).filter(
    (node) => node.bounds.width > 0 && node.bounds.height > 0
  );
  if (named.length === 0) {
    // Two failures read the same here and it is worth telling them apart: no node at
    // all, versus a node named with no box. A `<Host>` child composed outside the
    // scroll clip answers with a zero rect (measured, and the reason
    // `requireControlOnScreen` scrolls rather than trusting a name), and a zero rect
    // means no person can reach it either.
    const nameless = findAllByDescription(tree, control.label);
    return [
      nameless.length > 0
        ? `${control.hybridView}: ${String(nameless.length)} node(s) carry the name ` +
          `"${control.label}" and every one of them has a zero-sized box, so the ` +
          'name is in the accessibility tree with nothing drawn under it to focus'
        : `${control.hybridView}: no node in the accessibility tree carries the ` +
          `name "${control.label}" at all, so a screen reader announces this ` +
          'control as nothing',
    ];
  }
  const problems = [];
  if (named.length > 1) {
    // G6 review M3's symptom exactly: the name on the control *and* on a wrapper, so
    // TalkBack stops twice and reads the value on only one of them.
    problems.push(
      `${control.hybridView}: ${String(named.length)} nodes carry the name ` +
        `"${control.label}" (${named.map((node) => describeNode(node)).join('; ')}) ` +
        '— a name on more than one node is a control a screen reader announces ' +
        'twice, and only one of those stops carries the value'
    );
  }
  const node = named[0];
  if (control.role === 'interactive') {
    const actionable =
      node.clickable === 'true' ||
      node.checkable === 'true' ||
      node.focusable === 'true';
    if (!actionable) {
      problems.push(
        `${control.hybridView}: the node that carries "${control.label}" is not ` +
          `actionable (${describeNode(node)}) — the name sits where TalkBack can ` +
          'stop but nobody can act, which is the split G5 M2 and G6 M3 found by hand'
      );
    }
  }
  if (control.anchorTestId != null) {
    const anchor = tree.find(
      (candidate) => candidate.resourceId === control.anchorTestId
    );
    if (anchor == null) {
      problems.push(
        `${control.hybridView}: the screen no longer renders the control's own ` +
          `testID "${control.anchorTestId}", so the rule cannot say whether the ` +
          'name is on the control or on a wrapper around it'
      );
    } else if (!sameBox(anchor.bounds, node.bounds)) {
      problems.push(
        `${control.hybridView}: "${control.label}" is on a different box than the ` +
          `control ${control.anchorTestId} draws (${describeNode(node)} vs ` +
          `${describeNode(anchor)}) — the name is on the wrapper, not on the ` +
          'control the person touches'
      );
    }
  }
  return problems;
}

/**
 * The box comparison's tolerance, in pixels.
 *
 * Both nodes come from the same dump, so a sub-pixel difference cannot be the
 * interesting case; the interesting case is the RN wrapper, which is a real layout
 * box and therefore differs by whole pixels (a row's padding, the 16 dp an M3 field
 * is taller than the track inside it). Two px absorbs the rounding a dump applies to
 * a fractional layout without letting a wrapper through.
 */
const BOX_TOLERANCE_PX = 2;

/**
 * @param {{x1: number, y1: number, x2: number, y2: number}} a
 * @param {{x1: number, y1: number, x2: number, y2: number}} b
 */
function sameBox(a, b) {
  return (
    Math.abs(a.x1 - b.x1) <= BOX_TOLERANCE_PX &&
    Math.abs(a.y1 - b.y1) <= BOX_TOLERANCE_PX &&
    Math.abs(a.x2 - b.x2) <= BOX_TOLERANCE_PX &&
    Math.abs(a.y2 - b.y2) <= BOX_TOLERANCE_PX
  );
}

/**
 * A node the way a failure should quote it: what it is, whether it can be acted on,
 * and where it is.
 *
 * @param {import('./uiautomator.mjs').UiautomatorNode} node
 * @returns {string}
 */
export function describeNode(node) {
  return (
    `${node.className || 'node'} clickable=${node.clickable || '?'} ` +
    `checkable=${node.checkable || '?'} focusable=${node.focusable || '?'} ` +
    `bounds=[${String(node.bounds.x1)},${String(node.bounds.y1)}]` +
    `[${String(node.bounds.x2)},${String(node.bounds.y2)}]`
  );
}
