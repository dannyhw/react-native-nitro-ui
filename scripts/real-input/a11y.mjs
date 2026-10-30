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
 * @property {string} anchorTestId the `testID` the control carries on screen, which is
 *   what the **iOS** half anchors on: XCUITest finds an element by
 *   `accessibilityIdentifier`, and the element React Native gives the `testID` to is the
 *   box the rule compares the named element's frame against. Android does not need it —
 *   React Native stores a `testID` as a view tag, which is not in a dump — so only the
 *   static cross-check uses the field on that side, to prove the anchor exists.
 * @property {string} [anchorTestIdAttribute] the exact JSX the screen must contain for
 *   that `testID`, when `testID="<anchorTestId>"` does not describe it — `HostScreen.tsx`
 *   numbers its batch Switches with a template literal. The same escape hatch
 *   `labelAttribute` is, for the same reason: a name that exists only as an
 *   interpolation still has to be there.
 * @property {string} [iosTrait] the element type a screen reader *should* be told this
 *   control is, as XCUITest names it (`switch`, `button`, `slider`, `segmented control`,
 *   `progress indicator`).
 *
 *   Never the type the tree happens to report today. Recording the measured value would
 *   freeze a bug into the expectation: the Slider's element announces itself as `other`,
 *   so a row that said `'other'` would go red on the day somebody fixes it, and the fix
 *   would come with a test to weaken. The measured deviation belongs in
 *   {@link A11Y_EXEMPTIONS}, which is deleted by a red test when the control is repaired.
 *
 *   Absent for a case whose announcement cannot be graded at all, which is itself a
 *   finding: `hosted-picker` has no element carrying its name (it announces the name
 *   twice), so there is nothing to compare a type with. Its debt row is what keeps that
 *   visible, and clearing it is what prompts whoever fixes it to say what the control
 *   should be announced as.
 */

/** @typedef {'switch'|'slider'|'button'|'segmented'|'datepicker'|'picker'|'progress'|'menu'|'host'} ScreenId */

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
    anchorTestId: 'switch-controlled',
    iosTrait: 'switch',
  },
  {
    id: 'slider',
    component: 'Slider',
    hybridView: 'NitroUiSlider',
    screen: 'slider',
    label: 'Controlled slider',
    role: 'interactive',
    anchorTestId: 'slider-controlled',
    // What it is: `other` with a value, measured — the element the component vends
    // (`NitroUiSliderAccessibilityElement`, `.adjustable`), which XCUITest reports by that
    // type. What it should be is a slider, so that is what is asserted, and the gap is the
    // `announced as an other` row of `A11Y_EXEMPTIONS`.
    iosTrait: 'slider',
  },
  {
    id: 'button',
    component: 'Button',
    hybridView: 'NitroUiButton',
    screen: 'button',
    label: 'Real-input button',
    role: 'interactive',
    anchorTestId: 'real-input-enabled',
    iosTrait: 'button',
  },
  {
    id: 'segmented-control',
    component: 'SegmentedControl',
    hybridView: 'NitroUiSegmentedControl',
    screen: 'segmented',
    label: 'Real-input segmented control',
    role: 'interactive',
    anchorTestId: 'real-input-segmented',
    iosTrait: 'segmented control',
  },
  {
    id: 'date-picker',
    component: 'DatePicker',
    hybridView: 'NitroUiDatePicker',
    screen: 'datepicker',
    label: 'Real-input date picker',
    role: 'interactive',
    anchorTestId: 'real-input-date',
    iosTrait: 'button',
  },
  {
    id: 'picker',
    component: 'Picker',
    hybridView: 'NitroUiPicker',
    screen: 'picker',
    label: 'Real-input picker',
    role: 'interactive',
    anchorTestId: 'real-input-picker',
    iosTrait: 'button',
  },
  {
    id: 'menu',
    component: 'Menu',
    hybridView: 'NitroUiMenu',
    screen: 'menu',
    label: 'Real-input menu',
    role: 'interactive',
    anchorTestId: 'real-input-menu',
    // What it *should* be announced as. The trigger is a Button's box
    // (`docs/components/menu.md`), so this is the Button case's expectation rather than a
    // guess at what the tree reports today — the header of this table says why the
    // measured value never goes here. If the popup chrome makes XCUITest report something
    // else, that is a finding with a debt row, not a reason to soften this one.
    iosTrait: 'button',
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
    anchorTestId: 'host-switch-0',
    anchorTestIdAttribute: 'testID={`host-switch-${index}`}',
    iosTrait: 'switch',
  },
  {
    id: 'hosted-slider',
    component: 'Slider',
    hybridView: 'NitroUiSlider',
    screen: 'host',
    label: 'Hosted slider',
    role: 'interactive',
    hosted: true,
    anchorTestId: 'host-slider',
    iosTrait: 'slider',
  },
  {
    id: 'hosted-button',
    component: 'Button',
    hybridView: 'NitroUiButton',
    screen: 'host',
    label: 'Hosted button',
    role: 'interactive',
    hosted: true,
    anchorTestId: 'host-button',
    iosTrait: 'button',
  },
  {
    id: 'hosted-segmented',
    component: 'SegmentedControl',
    hybridView: 'NitroUiSegmentedControl',
    screen: 'host',
    label: 'Hosted segmented',
    role: 'interactive',
    hosted: true,
    anchorTestId: 'host-segmented',
    iosTrait: 'segmented control',
  },
  {
    id: 'hosted-picker',
    component: 'Picker',
    hybridView: 'NitroUiPicker',
    screen: 'host',
    label: 'Hosted picker',
    role: 'interactive',
    hosted: true,
    anchorTestId: 'host-picker',
    // No `iosTrait`, and it is not laziness: measured, a hosted Picker's inner element
    // announces itself as "Hosted picker, Hosted picker" — the label twice — so no
    // element in its subtree carries the label alone and the iOS half cannot name the
    // control's element at all. That is a finding in its own right, in
    // `docs/tasks/FOLLOWUPS.md`; the static anchor check still runs.
  },
  {
    id: 'hosted-date-picker',
    component: 'DatePicker',
    hybridView: 'NitroUiDatePicker',
    screen: 'host',
    label: 'Hosted date picker',
    role: 'interactive',
    hosted: true,
    anchorTestId: 'host-datepicker',
    iosTrait: 'button',
  },
  {
    id: 'hosted-progress',
    component: 'Progress',
    hybridView: 'NitroUiProgress',
    screen: 'host',
    label: 'Mixed linear progress',
    role: 'indicator',
    hosted: true,
    anchorTestId: 'host-mixed-progress-linear',
    iosTrait: 'progress indicator',
  },
]);

/**
 * A rule a control is known to fail, recorded rather than fixed.
 *
 * @typedef {object} A11yExemption
 * @property {string} control the `A11yControl.id`
 * @property {'android'|'ios'|'both'} platform which half's finding this covers. A row that
 *   did not name one would claim both from one measurement: the Android debt is about
 *   nodes a dump marks non-actionable, and if the same control's *iOS* case started
 *   matching it, the run would keep silent about a second and different bug.
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
 * **The four Android rows are one finding**, measured on pair-b: the Slider's and
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
 * **The three iOS rows** are what the XCUITest pass found on pair-a, and they are
 * different bugs on the same two controls — on iOS those controls *are* actionable
 * (`enabled`/`hittable` both true), so no Android row could cover them even if it named
 * both platforms:
 *
 * - `slider` and `hosted-slider`: the element a screen reader reaches is announced as
 *   `other` with a value, not as a slider. It is the one the component vends
 *   (`NitroUiSliderAccessibilityElement`, `.adjustable`), and XCUITest reports that
 *   element's type as Other — so VoiceOver says the name and the number but never says
 *   what kind of control it is.
 * - `hosted-picker`: no element under the `testID` is announced as "Hosted picker" at
 *   all. The one the label reaches announces **"Hosted picker, Hosted picker"** — the
 *   name twice, because the hosted Picker's own label and its `accessibilityLabel`
 *   arrive at the same element. A person hears the name stutter.
 *
 * @type {ReadonlyArray<A11yExemption>}
 */
export const A11Y_EXEMPTIONS = Object.freeze([
  {
    control: 'slider',
    platform: 'android',
    followups: 'X4 a11y: Compose RangeInfo nodes are not actionable in a dump',
    matches: /not actionable/,
  },
  {
    control: 'segmented-control',
    platform: 'android',
    followups: 'X4 a11y: nothing actionable at the named node',
    matches: /not actionable/,
  },
  {
    control: 'hosted-slider',
    platform: 'android',
    followups: 'X4 a11y: Compose RangeInfo nodes are not actionable in a dump',
    matches: /not actionable/,
  },
  {
    control: 'hosted-segmented',
    platform: 'android',
    followups: 'X4 a11y: nothing actionable at the named node',
    matches: /not actionable/,
  },
  {
    control: 'slider',
    platform: 'ios',
    followups: 'X4 a11y: the Slider is announced as other and not as a slider',
    matches: /announced as an other/,
  },
  {
    control: 'hosted-slider',
    platform: 'ios',
    followups: 'X4 a11y: the Slider is announced as other and not as a slider',
    matches: /announced as an other/,
  },
  {
    control: 'hosted-picker',
    platform: 'ios',
    followups: 'X4 a11y: a hosted Picker announces its label twice',
    // Only the stutter (X4 re-review M3). `/announced as/` matched the *lost-label*
    // sentence as well — "no element other than the React Native wrapper is announced as
    // …" — which is what every other way of losing a name produces. So the case would
    // stay green if `accessibilityLabel` stopped reaching the hosted Picker entirely, and
    // `staleExemptions` could never retire the row for that either.
    matches: /announces the control's name twice/,
  },
]);

/**
 * The exemptions that apply to one control on one platform.
 *
 * @param {string} controlId
 * @param {'android'|'ios'} platform
 * @param {ReadonlyArray<A11yExemption>} [table]
 */
export function exemptionsFor(controlId, platform, table = A11Y_EXEMPTIONS) {
  return table.filter(
    (entry) =>
      entry.control === controlId &&
      (entry.platform === platform || entry.platform === 'both')
  );
}

/**
 * Run one control's rule, splitting what it found into new failures and known debt.
 *
 * @param {A11yControl} control
 * @param {ReadonlyArray<import('./uiautomator.mjs').UiautomatorNode>} tree
 * @param {'android'|'ios'} [platform] which debt list to read. Defaults to Android, the
 *   only reader this had before the XCUITest pass.
 * @param {ReadonlyArray<A11yExemption>} [exemptions]
 * @returns {{failures: string[], known: string[], exempt: boolean}} `failures` must go
 *   red; `known` are covered by {@link A11Y_EXEMPTIONS} and are printed instead;
 *   `exempt` says this control's problems matched a row, which is what
 *   {@link staleExemptions} clears the list against.
 */
export function checkControlA11y(
  control,
  tree,
  platform = 'android',
  exemptions = exemptionsFor(control.id, platform)
) {
  return splitOnDebt(a11yProblems(control, tree), exemptions);
}

/**
 * New failures versus recorded debt, for either platform's rule.
 *
 * @param {string[]} problems
 * @param {ReadonlyArray<A11yExemption>} exemptions
 */
function splitOnDebt(problems, exemptions) {
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

/* --------------------------------- the iOS half --------------------------------- */

/**
 * One element of the accessibility tree XCUITest walked, as the Swift side prints it.
 *
 * @typedef {object} IosA11yNode
 * @property {string} id the element's `accessibilityIdentifier`, which is where React
 *   Native puts a `testID`
 * @property {string} label what a screen reader says for it
 * @property {string} type the element type, named the way VoiceOver names it (`switch`,
 *   `button`, `other`), because that word is the assertion's subject
 * @property {{x: number, y: number, width: number, height: number}} frame in screen points
 * @property {boolean} enabled
 * @property {boolean} hittable whether a touch would land here
 * @property {string} value the announced value, which is what separates the element a
 *   control answers with from a plain box that repeats its label
 * @property {boolean} anchor the element React Native gave the control's `testID` — the
 *   wrapper, which is the box the named element is compared *against* and never the one
 *   being graded
 */

/**
 * How far a named element's box may sit from the control's before the name counts as
 * being somewhere else.
 *
 * Points. Measured, the pairs agree to well under a tenth (React Native lays the wrapper
 * out in fractions and SwiftUI reports the same rect), while the failure the rule exists
 * for — a name slid onto a container — is off by tens. A tenth of a point is the noise
 * floor of two independent reads of one layout, not a licence for a name to wander.
 */
const IOS_FRAME_TOLERANCE_PT = 0.5;

/**
 * One control's iOS case, read from the tree XCUITest walked.
 *
 * The Android half reads `uiautomator dump`; this reads what
 * `RealInputTests.probeA11yTree` prints, and both apply the same rule from the same
 * table: the control carries its name, on the box it is drawn at, as the kind of thing
 * it is.
 *
 * Why it has to be the real tree rather than the in-app harness, which used to claim to
 * assert this: React Native copies an `accessibilityLabel` prop onto the component view
 * (`RCTViewComponentView.mm:471-473`), and the harness query matches that same view by
 * label (`ViewQueryHelper.mm:65`). So the harness's "box" and its "labelled box" were the
 * same view — the comparison in `Conformance.harness.tsx` could not go wrong, and the
 * element *inside* the React Native view that a screen reader actually stops on was never
 * looked at. XCUITest walks that tree.
 *
 * @param {A11yControl} control
 * @param {ReadonlyArray<IosA11yNode>} tree
 * @returns {string[]} problems, empty when the control passes
 */
export function iosA11yProblems(control, tree) {
  if (control.anchorTestId == null) {
    return [
      `${control.hybridView}: no anchorTestId, so the iOS rule has no box to read`,
    ];
  }
  const anchor = tree.find((node) => node.id === control.anchorTestId);
  if (anchor == null) {
    return [
      `no element with accessibilityIdentifier "${control.anchorTestId}" in the tree, ` +
        'so this run never found the control and can say nothing about its name',
    ];
  }
  // The wrapper is excluded from the *candidates* rather than forgiven inside them. It
  // always carries the label, because React Native put it there, so counting it as "the
  // element that names the control" is the tautology the in-app rule was guilty of. What
  // is being asked is whether anything *under* that wrapper is announced as the control.
  const named = tree.filter(
    (node) => node.label === control.label && !node.anchor && hasArea(node)
  );
  const problems = [];
  if (named.length === 0) {
    const unboxed = tree.filter(
      (node) => node.label === control.label && !node.anchor && !hasArea(node)
    );
    // A name that arrived *twice* is its own finding, and it has to say so (X4 re-review
    // M1). A doubled label never equals `control.label`, so it used to fall into the
    // "no element other than the wrapper" sentence below — and the hosted Picker's debt
    // row matched that sentence, which is a shape every other way of losing a label also
    // produces: the exemption excused a missing name as readily as a stuttered one, and
    // the case could not go red at all. So the stutter is named here, and only the
    // stutter, and the lost-label sentence is left to mean what it says.
    const doubled = tree.filter(
      (node) =>
        !node.anchor &&
        hasArea(node) &&
        announcesTwice(node.label, control.label)
    );
    if (doubled.length > 0) {
      problems.push(
        `${control.hybridView}: the element under "${control.anchorTestId}" ` +
          `announces the control's name twice (${doubled
            .map(describeIosNode)
            .join(
              '; '
            )}): the label reaches one element along with the control's own ` +
          'name, so a person hears it stutter, and no element carries the label alone — ' +
          'which is also why this case cannot grade the name, box or trait'
      );
      return problems;
    }
    problems.push(
      unboxed.length > 0
        ? `${control.hybridView}: ${String(unboxed.length)} element(s) under ` +
            `"${control.anchorTestId}" are announced as "${control.label}" and every ` +
            'one has a zero-sized box, so the name is in the tree with nothing drawn under it'
        : `${control.hybridView}: no element other than the React Native wrapper is ` +
            `announced as "${control.label}" — the only node that carries the name is ` +
            'the box React Native made, which is a name on a wrapper rather than on the ' +
            `control (wrapper: ${describeIosNode(anchor)})`
    );
    // Nothing to grade on name, but a doubled name is still a doubled name, and the
    // message above would otherwise be the whole story.
    return problems;
  }
  if (named.length > 1) {
    problems.push(
      `${control.hybridView}: ${String(named.length)} elements under ` +
        `"${control.anchorTestId}" are announced as "${control.label}" ` +
        `(${named.map(describeIosNode).join('; ')}) — a name on more than one ` +
        'element is a control a screen reader announces twice, and only one of those ' +
        'stops carries the value'
    );
  }

  const node = named[0];
  if (!sameBox(node.frame, anchor.frame)) {
    problems.push(
      `${control.hybridView}: "${control.label}" is announced by the element at ` +
        `${iosBox(node.frame)} while the control is drawn at ${iosBox(anchor.frame)} ` +
        "— the name is on a box that is not the control's, so VoiceOver stops " +
        'somewhere else than the thing a person presses'
    );
  }
  if (control.role === 'interactive' && !node.enabled && !node.hittable) {
    problems.push(
      `${control.hybridView}: the element announced as "${control.label}" ` +
        `(${describeIosNode(node)}) is neither enabled nor hittable — a screen ` +
        'reader can stop here but nobody can act, which is the split G5 M2 and G6 M3 ' +
        'found by hand'
    );
  }
  if (control.iosTrait != null && node.type !== control.iosTrait) {
    problems.push(
      // "is announced as an other and not as a slider": the debt row matches on that whole
      // phrase, and a comma-separated "announced as X, not as Y" would put the correction
      // between the two halves — so a row meant for one wrong word would end up excusing
      // any wrong word in the same sentence.
      `${control.hybridView}: "${control.label}" is announced as ` +
        `${article(node.type)} ${node.type} and not as ${article(control.iosTrait)} ` +
        `${control.iosTrait} — the announcement lost the kind of control this is, so ` +
        'a person hears a name with no idea what can be done with it'
    );
  }
  return problems;
}

/**
 * The iOS half's debt, split the same way the Android half splits its own.
 *
 * @param {A11yControl} control
 * @param {ReadonlyArray<IosA11yNode>} tree
 * @param {ReadonlyArray<A11yExemption>} [exemptions]
 */
export function checkIosControlA11y(
  control,
  tree,
  exemptions = exemptionsFor(control.id, 'ios')
) {
  return splitOnDebt(iosA11yProblems(control, tree), exemptions);
}

/**
 * Read one case's tree out of the xcodebuild log, as the Swift pass printed it.
 *
 * The lines are `real-input a11y <id> | <type> | <enabled> | <hittable> | <selected> |
 * <identifier> | <label> | <value> | <frame>`, one per element, emitted per case with the
 * anchor's box first. Parsing is here rather than in Swift so the rule and its fixtures
 * live in one file — and so a mistake in the format is a unit-test failure rather than a
 * device run that quietly reads zero elements.
 *
 * @param {string} log the xcodebuild test log
 * @returns {Map<string, IosA11yNode[]>} by control id, in table order
 */
export function parseIosA11yLog(log) {
  /** @type {Map<string, IosA11yNode[]>} */
  const byControl = new Map();
  for (const line of log.split('\n')) {
    if (!line.includes('real-input a11y ')) continue;
    const fields = fieldsOf(line);
    const caseName = fields.get('case');
    if (caseName == null || fields.get('kind') !== 'node') continue;
    const node = {
      type: fields.get('trait') ?? 'unknown',
      enabled: fields.get('enabled') === 'true',
      hittable: fields.get('hittable') === 'true',
      id: fields.get('id') ?? '',
      label: fields.get('label') ?? '',
      value: fields.get('value') ?? '',
      frame: {
        x: Number(fields.get('x')),
        y: Number(fields.get('y')),
        width: Number(fields.get('w')),
        height: Number(fields.get('h')),
      },
      anchor: false,
    };
    // A line whose box did not parse is a format change, and silently dropping the
    // element would make the case pass on nothing.
    if (
      !Number.isFinite(node.frame.width) ||
      !Number.isFinite(node.frame.height)
    ) {
      throw new Error(
        `real-input: an a11y line from the iOS run carries no readable box: ${line.trim()}`
      );
    }
    const list = byControl.get(caseName) ?? [];
    list.push(node);
    byControl.set(caseName, list);
  }
  // Mark the wrapper after the fact: the element that carries the control's `testID` is
  // the box the named element is compared against, and one definition of that is better
  // than two that have to agree.
  for (const [controlId, nodes] of byControl) {
    const entry = A11Y_CONTROLS.find((candidate) => candidate.id === controlId);
    if (entry?.anchorTestId == null) continue;
    for (const node of nodes) {
      if (node.id === entry.anchorTestId) node.anchor = true;
    }
  }
  return byControl;
}

/**
 * The `key=value` pairs of one printed line, with `key="quoted value"` supported.
 *
 * @param {string} line
 * @returns {Map<string, string>}
 */
function fieldsOf(line) {
  const fields = new Map();
  for (const match of line.matchAll(/(\w+)=("(?:[^"\\]|\\.)*"|\S+)/g)) {
    const value = match[2].startsWith('"') ? JSON.parse(match[2]) : match[2];
    if (!fields.has(match[1])) fields.set(match[1], value);
  }
  return fields;
}

function hasArea(node) {
  return node.frame.width > 1 && node.frame.height > 1;
}

/**
 * Does this announcement say the control's name more than once?
 *
 * The shape X4 measured on a hosted Picker: `accessibilityLabel` and the control's own
 * name land on one element, and VoiceOver reads "Hosted picker, Hosted picker". Matched
 * by counting occurrences rather than by pattern-matching a separator, because the joiner
 * is UIKit's ("Label, Label"), the platform's localisation, or the component's own
 * concatenation, and a rule that only caught `", "`-joins would excuse a
 * `"Label Label"` one. The name being there *once* is what the rule wants, so "twice or
 * more" is the whole finding.
 *
 * @param {string} label what the element is announced as
 * @param {string} controlLabel the `accessibilityLabel` the case looks for
 */
function announcesTwice(label, controlLabel) {
  if (controlLabel === '') return false;
  const first = label.indexOf(controlLabel);
  if (first === -1) return false;
  return label.indexOf(controlLabel, first + controlLabel.length) !== -1;
}

function sameBox(a, b) {
  return (
    Math.abs(a.x - b.x) <= IOS_FRAME_TOLERANCE_PT &&
    Math.abs(a.y - b.y) <= IOS_FRAME_TOLERANCE_PT &&
    Math.abs(a.width - b.width) <= IOS_FRAME_TOLERANCE_PT &&
    Math.abs(a.height - b.height) <= IOS_FRAME_TOLERANCE_PT
  );
}

function iosBox(frame) {
  return `(${num(frame.x)}, ${num(frame.y)}, ${num(frame.width)}, ${num(frame.height)})`;
}

function num(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function article(word) {
  return /^[aeiou]/.test(word) ? 'an' : 'a';
}

/**
 * @param {IosA11yNode} node
 */
function describeIosNode(node) {
  return (
    `${node.type} "${node.label}" at ${iosBox(node.frame)}` +
    `${node.value === '' ? '' : ` value "${node.value}"`}` +
    `${node.enabled ? '' : ' disabled'}`
  );
}

/**
 * Exemptions that no longer describe anything, because nothing produced them.
 *
 * A run that covered a control and matched no row for it is the signal that the control
 * has been fixed: the entry has to go, or the rule would keep excusing a class of bug
 * that no longer exists. This is what stops the list decaying into a permanent skip
 * list.
 *
 * Scoped to one platform, because the two halves can fail the same control for unrelated
 * reasons: the Slider's Android name is on a node nothing can act on and its iOS name is
 * announced as the wrong kind of control. Clearing the Android bug would otherwise read
 * as though the iOS row had been earned too — and the row that stays would then excuse a
 * bug nobody is looking for.
 *
 * @param {Iterable<string>} coveredIds the ids the run actually read
 * @param {Iterable<string>} matchedIds the ids whose problems matched an exemption
 * @param {'android'|'ios'} [platform] whose rows to clear
 * @param {ReadonlyArray<A11yExemption>} [table]
 * @returns {string[]} stale exemption descriptions, in `A11Y_EXEMPTIONS` order
 */
export function staleExemptions(
  coveredIds,
  matchedIds,
  platform = 'android',
  table = A11Y_EXEMPTIONS
) {
  const covered = new Set(coveredIds);
  const matched = new Set(matchedIds);
  return table
    .filter(
      (exemption) =>
        (exemption.platform === platform || exemption.platform === 'both') &&
        covered.has(exemption.control) &&
        !matched.has(exemption.control)
    )
    .map(
      (exemption) =>
        `A11Y_EXEMPTIONS: the ${exemption.platform} entry for ` +
        `"${exemption.control}" (${exemption.followups}) matched no problem ` +
        'this run — the control passes the rule now, so delete the exemption ' +
        'and let the rule guard it'
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
 * one that contains it **and is roughly its size**.
 *
 * Containment is the measured shape of "the name is on the control". A Switch's named
 * track is 137×84 inside a `clickable|checkable|focusable` node 137×126 — the Material
 * touch target, taller than the visual by design, and concentric with it; a DatePicker's
 * two nodes share one box exactly. Box *equality* is therefore not the rule: it would
 * report every control with a proper touch target as broken, and the next person to trip
 * over it would delete the check.
 *
 * Containment alone is too small a claim, though, and said "whose box is the control's"
 * without delivering it (X4 review N1): any `focusable` wrapper a screen deep would
 * qualify. So the candidate also has to be within {@link ACTABLE_HOME_AREA_RATIO} of the
 * named box's area. That bound is the gap in the dumps, not a taste — across all thirteen
 * Android cases the actionable node containing a control's name is between 1.0× (a
 * DatePicker and its field, same box) and 1.5× (a Switch's touch target over its track),
 * and the next actionable container of any kind is the page at 17.6×. A control that
 * grew a focusable wrapper 4× its size is a control whose press target is a region, not
 * the control, and that is what the ratio now refuses.
 *
 * @param {import('./uiautomator.mjs').UiautomatorNode} named
 * @param {ReadonlyArray<import('./uiautomator.mjs').UiautomatorNode>} tree
 */
function hasActableHome(named, tree) {
  return actableHomes(named, tree).length > 0;
}

/**
 * Area multiple of the named box beyond which a containing actionable node is a region of
 * the screen rather than the control. Measured: real touch targets are 1.0–1.5×, the page
 * is 17.6×+, so this sits in the gap and either side of it can be shown to matter.
 */
const ACTABLE_HOME_AREA_RATIO = 4;

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
        covers(node.bounds, named.bounds) &&
        // The scroll filter above removes the page when the dump labels it scrollable;
        // this one removes a page, a list, or a card that happens to be `focusable` and
        // not scrollable, which the dump's flag does not cover.
        area(node) <= area(named) * ACTABLE_HOME_AREA_RATIO
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
        (homes[0].scrollable === 'true'
          ? ', which is the page, not the control'
          : '');
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
  return `${node.className} ${describeActors(node)} ${box(node.bounds)}`;
}
