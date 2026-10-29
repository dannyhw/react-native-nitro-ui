/**
 * The a11y conformance rule, read out of a `uiautomator dump`.
 *
 * X4's first rule, and the one the in-app harness cannot state at all on Android: the
 * queries inside the app walk real `View`s (`@react-native-harness/ui` matches
 * `View.contentDescription`), and Compose publishes its control's name on a
 * `SemanticsNode` that is not a `View`. From inside the app a hosted control's name is
 * invisible no matter what the component does — which is why `Slider.harness.tsx` and
 * `Progress.harness.tsx` assert only that the label reached the control, and say why.
 * `uiautomator dump` *is* the accessibility tree, so "which node does a screen reader
 * get?" is answerable from outside, from the `real-input:android` gate. That is where
 * this rule runs: not as a new gate, because a gate nobody runs is not a guardrail, and
 * the sweep rides a run that already boots the device, walks every screen and pays for
 * a dump.
 *
 * The bug it answers is the one two reviews found by hand (G5 review M2, G6 review M3,
 * `docs/tasks/FOLLOWUPS.md` "Core a11y check"): a control's name sitting on a node that
 * is **not** the node a person acts on. The control still taps perfectly, so every
 * other suite stays green while TalkBack announces a name nobody can act on, or acts
 * on something that says nothing.
 *
 * ## Everything below is measured, not assumed
 *
 * The table was written from a real dump of this app on `emulator-5570` (pair-b, the
 * lease's device), one screen per control, scrolled so each control had a box — and the
 * measurements are what decided the rule's shape rather than the other way round:
 *
 * - exactly **one** node carries each control's name. Two do not: that was G6's
 *   symptom, so the count is asserted, not assumed.
 * - a Switch's named node is 137×84 px inside a `clickable|checkable|focusable` node
 *   137×126 — the M3 touch target, taller than the track by design, and concentric with
 *   it. Rejecting that would be a rule saying "no control may have a touch target bigger
 *   than its visual", which is wrong; what matters is that acting at the name's centre
 *   acts on the control. So the rule is containment plus concentricity, not equality.
 * - a DatePicker's named node and its actionable node are the *same box*, and a
 *   Picker's named node *is* its actionable node (`android.widget.Spinner`,
 *   `clickable="true"`). Both pass, by different branches, which is the sign of a rule
 *   about the relationship rather than about one control's shape.
 * - a Slider's name is on an `android.widget.SeekBar` and a SegmentedControl's on a
 *   plain `View`, and **neither node is actionable, nor is any node concentric with
 *   them** — the only actionable node containing them is the screen's `ScrollView`,
 *   which is ambient, not the control. That is four real findings, and they are recorded
 *   in {@link A11Y_EXEMPTIONS} rather than fixed here. See the caveat there: it is the
 *   one measurement with an alternative explanation, which is exactly why it is written
 *   down instead of being quietly allowed.
 * - **the Progress screen cannot be dumped at all.** Its two indeterminate indicators
 *   animate forever, so `uiautomator dump` answers `could not get idle state` on every
 *   attempt, with or without the 60 Hz writer stopped — the same refusal that makes the
 *   manifest say `realInput: false`. Progress therefore has no case on its own screen
 *   and is covered instead by `hosted-progress`, a determinate Progress on the Host
 *   screen, which does idle (`android.widget.ProgressBar 996x11`, measured).
 *   `FOLLOWUPS.md` records the limitation: a control whose own screen never goes idle is
 *   only reachable through a screen that can, so what a screen reader announces for the
 *   *animating* indicators stays unasserted on Android.
 *
 * Split from `android.mjs` for the same reason `android-tree.mjs` is: that script boots
 * a device on import, this does not, so the rule's failure modes can be proved against
 * measured shapes in `scripts/__tests__/real-input-a11y.test.js`.
 */

import { findAllByDescription } from './uiautomator.mjs';

/**
 * One control's a11y case: what to look for, on which screen, and what its node has to
 * say about itself.
 *
 * @typedef {object} A11yControl
 * @property {string} id the case's own name — the manifest id for a plain control, and
 *   a `hosted-`-prefixed one for a control composed by a `<Host>`
 * @property {string} component the manifest `name` this case guards. Coverage is keyed
 *   on this, which is what lets one control be covered twice — its own screen and
 *   inside a `<Host>` — without the matrix claiming two controls.
 * @property {string} hybridView the component's Fabric name, for the report line
 * @property {ScreenId} screen the example tab that renders it
 * @property {string} label the `accessibilityLabel` the example screen puts on it
 * @property {'interactive'|'indicator'} role `interactive` controls have to be a node a
 *   person can act on; `indicator` controls only have to be a node with a box. A
 *   Progress draws and announces and is not something you press, so requiring
 *   `clickable` would assert something the component deliberately is not — and
 *   `android.widget.ProgressBar` is announced with its value by its *class*, which no
 *   flag in the dump says.
 * @property {boolean} [hosted] the control *inside a* `<Host>`. Measured difference:
 *   the child's own RN view is laid out at 0×0 (D24) and never appears with a box, so
 *   the Compose node carrying the name is the only one there is.
 * @property {string} [labelAttribute] the exact JSX the screen must contain for this
 *   label, when `accessibilityLabel="<label>"` does not describe it — `HostScreen.tsx`
 *   names its batch Switches with a template literal. The static cross-check looks for
 *   this string, so a label that exists only as an interpolation still has to be there.
 */

/** @typedef {'switch'|'slider'|'button'|'segmented'|'datepicker'|'picker'|'progress'|'host'} ScreenId */

/* Which screen file renders each tab lives in `screens.mjs`, because
 * `scripts/conformance-core.mjs` needs the same map to check these labels against the
 * screens, and a map kept in two files is a map that drifts. */

/**
 * The controls the rule covers, with the label each example screen carries.
 *
 * Written out rather than derived: the labels are JSX literals in the screens, so there
 * is nothing to generate from. `checkA11yTable` in `scripts/conformance-core.mjs` then
 * asserts every pair still appears in the screen it names and that every manifest has a
 * case, so a rename on either side goes red instead of the rule quietly looking for a
 * name nothing draws, and a new control without a case is a failing test rather than a
 * gap.
 *
 * The `hosted-*` cases are the brief's "the hostable ones inside `<Host>` where it
 * applies": a `<Host>` composes its children's semantics itself, so the node carrying the
 * name is built by a different code path than the unhosted control's — and a fix to one
 * has already missed the other in this repo's history (G6's re-review).
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
  },
  {
    id: 'slider',
    component: 'Slider',
    hybridView: 'NitroUiSlider',
    screen: 'slider',
    label: 'Controlled slider',
    role: 'interactive',
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
    // No case for Progress *on its own screen*: that screen cannot be dumped at all
    // (see the header — `uiautomator dump` never idles while an indeterminate
    // indicator animates, the same refusal that makes the manifest say
    // `realInput: false`). Progress is covered instead by `hosted-progress` below, and
    // `FOLLOWUPS.md` records what that leaves unasserted.
    id: 'hosted-switch',
    component: 'Switch',
    hybridView: 'NitroUiSwitch',
    screen: 'host',
    label: 'Hosted switch 0',
    // Interpolated in the screen, so the static cross-check looks for the template.
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
 * A rule a control is known to fail, recorded rather than fixed.
 *
 * @typedef {object} A11yExemption
 * @property {string} control the `A11yControl.id`
 * @property {string} followups the `docs/tasks/FOLLOWUPS.md` line that owns the fix
 * @property {RegExp} matches which problem it covers — an exemption is tied to one
 *   *finding*, not to a control, so a second and different failure on the same control
 *   still goes red.
 */

/**
 * The debt list, and the reason the suite can land green on its first run.
 *
 * An entry is not a `TODO`: {@link staleExemptions} proves each one still describes a
 * problem the current code produces, so a control that gets fixed has its exemption
 * removed by a red test rather than by a reviewer noticing. That is the difference
 * between this list and a skipped test.
 *
 * The four rows are one finding, measured on pair-b: the Slider's and
 * SegmentedControl's names are on nodes no screen reader can act on, and nothing
 * concentric with them can be either. **The caveat, stated because it is the one
 * measurement with an alternative explanation:** the dump is taken with `uiautomator`'s
 * own `UiAutomation` connection, which does *not* enable touch exploration, and Compose
 * may well mark a semantics node focusable only when a touch-exploration service is up.
 * So this may be a dump artefact rather than a component bug — which is precisely why it
 * is recorded as debt and printed on every run, and why `FOLLOWUPS.md` names the
 * measurement that would settle it (repeat the dump with TalkBack running and see
 * whether the four nodes come back `focusable="true"`). If they do, the rows come out
 * and `role: 'interactive'` gets the same trust on Android it has on iOS.
 *
 * @type {ReadonlyArray<A11yExemption>}
 */
export const A11Y_EXEMPTIONS = Object.freeze([
  {
    control: 'slider',
    followups: 'X4 a11y: Compose RangeInfo nodes are not actionable in a dump',
    matches: /not actionable/,
  },
  {
    control: 'segmented-control',
    followups: 'X4 a11y: nothing actionable at the named node',
    matches: /not actionable/,
  },
  {
    control: 'hosted-slider',
    followups: 'X4 a11y: Compose RangeInfo nodes are not actionable in a dump',
    matches: /not actionable/,
  },
  {
    control: 'hosted-segmented',
    followups: 'X4 a11y: nothing actionable at the named node',
    matches: /not actionable/,
  },
]);

/**
 * Run one control's rule, splitting what it found into new failures and known debt.
 *
 * @param {A11yControl} control
 * @param {ReadonlyArray<import('./uiautomator.mjs').UiautomatorNode>} tree
 * @returns {{failures: string[], known: string[], exempt: boolean}} `failures` must go
 *   red; `known` are covered by {@link A11Y_EXEMPTIONS} and are printed instead;
 *   `exempt` says this control's problems matched a row, which is what
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
 * A run that covered a control and matched no row for it is the signal that the control
 * has been fixed: the entry has to go, or the rule would keep excusing a class of bug
 * that no longer exists. This is what stops the list decaying into a permanent skip
 * list.
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
  const all = findAllByDescription(tree, control.label);
  const named = all.filter(
    (node) => node.bounds.width > 0 && node.bounds.height > 0
  );
  if (named.length === 0) {
    // Two failures read the same from here and it is worth telling them apart: no node
    // at all, versus a node named with no box. A `<Host>` child composed outside the
    // scroll clip answers with a zero rect — measured, and the reason
    // `requireControlOnScreen` scrolls rather than trusting a name — and a zero rect
    // means no person can reach it either.
    return [
      all.length > 0
        ? `${control.hybridView}: ${String(all.length)} node(s) carry the name ` +
          `"${control.label}" and every one of them has a zero-sized box, so the ` +
          'name is in the accessibility tree with nothing drawn under it to focus'
        : `${control.hybridView}: no node in the accessibility tree carries the ` +
          `name "${control.label}" at all, so a screen reader announces this ` +
          'control as nothing',
    ];
  }

  const problems = [];
  if (named.length > 1) {
    // G6 review M3's symptom exactly: the name on the control *and* on something else,
    // so a screen reader stops twice and reads the value on only one of the stops.
    problems.push(
      `${control.hybridView}: ${String(named.length)} nodes carry the name ` +
        `"${control.label}" (${named.map((node) => describeNode(node)).join('; ')}) ` +
        '— a name on more than one node is a control a screen reader announces twice, ' +
        'and only one of those stops carries the value'
    );
  }

  const node = named[0];
  if (node.scrollable === 'true') {
    // Measured: the only `scrollable="true"` node containing a control is the page's own
    // `ScrollView`, and it is `focusable="true"` as well — so it would satisfy the
    // actionable test below, and a control whose name had slid onto it would be announced
    // as the whole screen. No control in this library scrolls.
    problems.push(
      `${control.hybridView}: "${control.label}" is on a scroll container ` +
        `(${describeNode(node)}), not on a control — a screen reader would read the ` +
        'whole page as this control, and pressing the control would do nothing at all'
    );
  } else if (
    control.role === 'interactive' &&
    !isActable(node) &&
    !hasActableHome(node, tree)
  ) {
    problems.push(
      `${control.hybridView}: the node that carries "${control.label}" is not ` +
        `actionable, and nothing whose box is the control's is either ` +
        `(${describeNode(node)}) — the name sits where a screen reader can stop ` +
        'but nobody can act, which is the split G5 M2 and G6 M3 found by hand. ' +
        `The nearest actionable box containing it is ${nearestActable(node, tree)}`
    );
  }
  return problems;
}

/**
 * Whether a person can act on this node directly.
 *
 * `checked` is deliberately not in here: a node that reports a state is not a node you
 * can change, and the M3 Compose Popup rows in the Picker dump are `checkable="true"`
 * *and* `checked="true"` whether or not they can be pressed.
 *
 * @param {import('./uiautomator.mjs').UiautomatorNode} node
 */
function isActable(node) {
  return (
    node.clickable === 'true' ||
    node.checkable === 'true' ||
    node.focusable === 'true'
  );
}

/**
 * Whether some node a person can act on *is* this control: the named node's own box, or
 * one that contains it.
 *
 * Containment is the measured shape of "the name is on the control". A Switch's named
 * track is 137×84 inside a `clickable|checkable|focusable` node 137×126 — the Material
 * touch target, taller than the visual by design, and concentric with it; a DatePicker's
 * two nodes share one box exactly. Box *equality* is therefore not the rule: it would
 * report every control with a proper touch target as broken, and the next person to trip
 * over it would delete the check.
 *
 * What it does reject is measured too. Containment is what makes the search mean
 * "the control's own actionable box" rather than "a screen with a button on it": strip
 * the Switch's touch target and the only actionable node left is the page's scroll view,
 * and a rule that accepted any actionable node anywhere in the tree would call that a
 * pass.
 *
 * @param {import('./uiautomator.mjs').UiautomatorNode} named
 * @param {ReadonlyArray<import('./uiautomator.mjs').UiautomatorNode>} tree
 */
function hasActableHome(named, tree) {
  return actableHomes(named, tree).length > 0;
}

/**
 * @param {import('./uiautomator.mjs').UiautomatorNode} named
 * @param {ReadonlyArray<import('./uiautomator.mjs').UiautomatorNode>} tree
 * @returns {Array<import('./uiautomator.mjs').UiautomatorNode>} smallest first
 */
function actableHomes(named, tree) {
  return tree
    .filter(
      (node) =>
        node !== named &&
        isActable(node) &&
        node.scrollable !== 'true' &&
        covers(node.bounds, named.bounds)
    )
    .sort((a, b) => area(a) - area(b));
}

/**
 * The closest thing to an answer, for the failure message: the smallest actionable node
 * containing the named box at all, including the scroll view it would otherwise skip.
 * Quoting it is what turns "not actionable" from a dead end into a lead.
 *
 * @param {import('./uiautomator.mjs').UiautomatorNode} named
 * @param {ReadonlyArray<import('./uiautomator.mjs').UiautomatorNode>} tree
 */
function nearestActable(named, tree) {
  const homes = tree
    .filter(
      (node) =>
        node !== named && isActable(node) && covers(node.bounds, named.bounds)
    )
    .sort((a, b) => area(a) - area(b));
  return homes.length === 0
    ? 'nothing on screen'
    : `a ${homes[0].className} ${box(homes[0].bounds)} ` +
        `${describeActors(homes[0])}` +
        (homes[0].scrollable === 'true' ? ', which is the page, not the control' : '');
}

/** Points: both boxes come from the same dump, so a difference at whole-pixel scale is
 *  a real layout difference and anything under it is the dump rounding a fraction. */
const BOX_TOLERANCE_PX = 2;

function covers(outer, inner) {
  return (
    outer.x1 <= inner.x1 + BOX_TOLERANCE_PX &&
    outer.y1 <= inner.y1 + BOX_TOLERANCE_PX &&
    outer.x2 >= inner.x2 - BOX_TOLERANCE_PX &&
    outer.y2 >= inner.y2 - BOX_TOLERANCE_PX
  );
}

function area(node) {
  return node.bounds.width * node.bounds.height;
}

/** @param {{x1: number, y1: number, x2: number, y2: number}} b */
function box(b) {
  return `[${String(b.x1)},${String(b.y1)}][${String(b.x2)},${String(b.y2)}]`;
}

/** @param {import('./uiautomator.mjs').UiautomatorNode} node */
function describeActors(node) {
  const actors = [
    node.clickable === 'true' && 'clickable',
    node.checkable === 'true' && 'checkable',
    node.focusable === 'true' && 'focusable',
  ].filter(Boolean);
  return actors.length === 0 ? 'no actions' : actors.join('|');
}

/**
 * A node the way a failure should quote it: what it is, what it can do, where it is.
 *
 * @param {import('./uiautomator.mjs').UiautomatorNode} node
 * @returns {string}
 */
export function describeNode(node) {
  return (
    `${node.className} ${describeActors(node)} ${box(node.bounds)}`
  );
}
