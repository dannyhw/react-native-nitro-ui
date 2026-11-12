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

import { findByTestId, findAllByDescription } from './uiautomator.mjs';

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
 * @property {'interactive'|'indicator'|'container'} role `interactive` controls have to
 *   be a node a person can act on; `indicator` controls only have to be a node with a
 *   box. A Progress draws and announces and is not something you press, so requiring
 *   `clickable` would assert something the component deliberately is not — and
 *   `android.widget.ProgressBar` is announced with its value by its *class*, which no
 *   flag in the dump says. A `container` names a **group**: the pressable things are its
 *   members, so the name has to sit on a box that still leads to them
 *   ({@link hasActableMembers}) — a container grades its contents, not its own actions.
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
 * @property {boolean} [wrapperIsControl] the control *is* the React Native view that
 *   carries the `testID` - a ContextMenu, which is a `View` with a menu on it. For every
 *   other case the wrapper is excluded from the iOS candidates, because React Native puts
 *   the label on it whatever the control does; here the wrapper is the element a screen
 *   reader stops on, so it is graded like any named element: one of them, on its box,
 *   enabled or hittable. Android needs nothing: the wrapper's `contentDescription` is
 *   the node the dump names.
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

/** @typedef {'switch'|'slider'|'button'|'segmented'|'datepicker'|'picker'|'progress'|'menu'|'chip'|'host'|'textfield'|'searchfield'|'checkbox'|'contextmenu'|'iconbutton'|'form'|'stepper'|'listitem'} ScreenId */

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
    id: 'chip',
    component: 'Chip',
    hybridView: 'NitroUiChip',
    screen: 'chip',
    label: 'Real-input chip',
    role: 'interactive',
    anchorTestId: 'real-input-chip',
    // A filter chip is an on/off control, and that is what it should announce: SwiftUI's
    // `Toggle(.button)` carries the toggle trait, which XCUITest reports as `switch` with
    // `value` 0/1 (measured, G12) - it has no separate type for a toggle *button*. The
    // assist chip is a `Button` and is not a case here; real input asserts it presses.
    iosTrait: 'switch',
  },
  {
    id: 'checkbox',
    component: 'Checkbox',
    hybridView: 'NitroUiCheckbox',
    screen: 'checkbox',
    label: 'Real-input checkbox',
    role: 'interactive',
    anchorTestId: 'real-input-checkbox',
    // iOS has no checkbox control, so every `iosStyle` is SwiftUI's `Toggle` — G31's
    // glyph styles change what it *draws* (Apple's `checkmark.circle.fill`, D47) and not
    // the element: still the toggle trait, which XCUITest reports as `switch` with
    // `value` 0/1 — the same answer Chip's filter chip measures. See
    // `docs/components/checkbox.md`. Android's `Role.Checkbox` is read from the
    // uiautomator tree by `CHECKS.checkbox`, which asserts `checkable`/`checked`.
    iosTrait: 'switch',
  },
  {
    id: 'icon-button',
    component: 'IconButton',
    hybridView: 'NitroUiIconButton',
    screen: 'iconbutton',
    label: 'Real-input icon button',
    role: 'interactive',
    anchorTestId: 'real-input-icon-button',
    // The press form is a `Button` whose label is `.iconOnly`, so the element a
    // reader stops on is the button and its name is the Label's title - which is
    // the only text the control has (`docs/components/icon-button.md`). The toggle
    // form carries the toggle trait instead, exactly as Chip's filter control does
    // (G12 measured `switch` with value 0/1 for `Toggle(.button)`), and its state
    // is what `real-input:ios` reads after a tap rather than a static type here.
    iosTrait: 'button',
  },
  {
    id: 'button-group',
    component: 'ButtonGroup',
    hybridView: 'NitroUiButtonGroup',
    screen: 'buttongroup',
    label: 'Real-input actions',
    // A group, not a control: `role: 'container'` grades the name where it genuinely
    // lives. `interactive` would demand that the node carrying "Real-input actions" can
    // itself be pressed, and measured on Android that node is Material's merged row —
    // `android.view.View` [212,805][868,931], no actions — with the three items as
    // separately reachable `clickable|focusable` views inside it. That is the shape a row
    // of commands *should* have; the wrong fix would be a press handler on the row, which
    // would make one stop of the whole group and hide the items.
    role: 'container',
    anchorTestId: 'real-input-button-group',
    // No `iosTrait`, for ContextMenu's reason rather than as debt: a group is not one
    // control, so there is no single kind to be told — its *items* are the buttons, and
    // each carries its own title. What is graded here is the group's own name: one
    // element announces "Real-input actions", it is on the anchor's box, and it is
    // enabled. Measured (G20, iOS 27), the `ControlGroup` under the wrapper is exactly
    // that one element, and the items stay separate stops under it.
    //
    // Android is the sharper half, and the reason this case exists: Material's
    // `ButtonGroup` merges its row into one semantics node, and it is that node which
    // takes the group's name — measured, `android.view.View` [212,805][868,931] with no
    // actions, with the three items still `clickable|focusable` inside it and still named
    // by their own text ("Copy", "Cut", "Paste"). So the finding to guard is a group whose
    // name stops leading to its items: a merged box with nothing pressable in it, or a
    // name that slid up onto the page.
  },
  {
    // A Stepper is one adjustable value on both platforms, not two buttons
    // (`docs/components/stepper.md`), and Android is the half this rule can see: the
    // row publishes the range info and the two Material buttons clear their own
    // semantics away, so a dump has to show ONE named node with no clickable node
    // under it. Two focus stops is precisely the bug this rule was written for (G6).
    id: 'stepper',
    component: 'Stepper',
    hybridView: 'NitroUiStepper',
    screen: 'stepper',
    label: 'Real-input stepper',
    role: 'interactive',
    anchorTestId: 'real-input-stepper',
    // What VoiceOver says, not what the tree reports: the element this control vends
    // carries the `.adjustable` trait (its own `refresh()`), and XCUITest has no
    // element type for a trait, so the measured announcement is in `A11Y_EXEMPTIONS`
    // below — the Slider row's arrangement, for the same reason. Writing the measured
    // word here would freeze the gap into the expectation. Measured G25 fix round 1 on
    // the lease's iPhone Air (iOS 27): the sweep's tree has the named element, at the
    // control's box, with `value="1"` — and its type is `other`, exactly as the Slider's
    // is, which is what that row is for.
    iosTrait: 'adjustable',
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
  {
    id: 'text-field',
    component: 'TextField',
    hybridView: 'NitroUiTextField',
    screen: 'textfield',
    label: 'Typing field',
    role: 'interactive',
    anchorTestId: 'text-typing',
    iosTrait: 'text field',
  },
  {
    id: 'search-field',
    component: 'SearchField',
    hybridView: 'NitroUiSearchField',
    screen: 'searchfield',
    label: 'Typing search field',
    role: 'interactive',
    anchorTestId: 'search-typing',
    // Both platforms are asked for the same announcement: UIKit gets it from the
    // `.searchField` trait the shared text traits carry, Compose from the editable node
    // it publishes under the label. Recording `other` because that is what a tree
    // happened to say would freeze a miss into the expectation (this table's header).
    iosTrait: 'search field',
  },
  {
    id: 'context-menu',
    component: 'ContextMenu',
    hybridView: 'NitroUiContextMenu',
    screen: 'contextmenu',
    label: 'Message from Grace',
    role: 'interactive',
    anchorTestId: 'ctx-accessible',
    // A ContextMenu *is* a `View`: the element that carries the name is the very view
    // React Native styled, with the menu on it (D36 item 1), so the iOS half grades the
    // anchor itself rather than looking under it.
    wrapperIsControl: true,
    // No `iosTrait`, by design rather than as debt: what the element is announced as is
    // the app's `accessibilityRole`, exactly as on a `View`; the menu's action is UIKit's,
    // derived from the interaction, and not a type. The name, the box and the single
    // element are still graded.
  },
  {
    id: 'form',
    component: 'Form',
    hybridView: 'NitroUiForm',
    screen: 'form',
    // What the component page promises (C1): a row with `onPress` is one element carrying
    // the row's name, not the row's two `Text`s. The label is therefore written on
    // `Form.Row` itself (`FormScreen.tsx`), which is the element that presses.
    //
    // Android keeps the promise: `applyChrome` makes a pressable row one clickable node, and
    // that node carries the name. It took two things to see that — performing
    // `ACTION_CLICK` rather than reading `isClickable` as a promise (`HybridNitroUiFormRow`),
    // and clearing `contentDescription` on the way into the view pool, which React Native's
    // `prepareToRecycleView` does not do and which let a recycled row keep answering for a
    // mount that had ended (both fix round 1; the upstream gap is a FOLLOWUPS line).
    //
    // iOS does not, measured twice on pair-b (G24 rounds 2 and 3) and unchanged by this
    // round: the only element with the name is the React Native view the app wrote the label
    // on, and the list's cell does not answer for the row's name at all — configuring the
    // cell's label and deriving it on every read give the same XCUITest tree, byte for byte.
    // That is the debt row below, and the reason this case is not deleted: the day UIKit is
    // made to answer, the row goes stale.
    label: 'Row with onPress',
    role: 'interactive',
    anchorTestId: 'form-row',
    // What the row has to be announced as, not what it is: a pressable row is a button
    // because the row presses. `other` is what the tree reports today, and recording the
    // measurement here would freeze the bug into the expectation.
    iosTrait: 'button',
  },
  {
    id: 'list-item',
    component: 'ListItem',
    hybridView: 'NitroUiListItem',
    screen: 'listitem',
    // The leaf has one element by construction: on iOS the row view is `isAccessibilityElement`
    // and its subtree is closed, on Android the Compose node carries `role = Button` and the
    // `contentDescription`, and the row's own texts are merged into it. The label is written by
    // the screen because the component would otherwise read title + subtitle in its own order —
    // which the harness asserts separately, in-app, where the order is readable.
    label: 'Real-input item',
    role: 'interactive',
    anchorTestId: 'real-input-listitem',
    // A row with `onPress` is a button (DECISIONS D46 item 1). What the tree reports today is
    // measured by the pass itself; a deviation goes in `A11Y_EXEMPTIONS`, never here.
    iosTrait: 'button',
  },
]);

/**
 * A component with no box of its own that presents a platform window - G11's dialogs.
 *
 * The sweep cannot read one. It walks every screen as it stands, and a presentation's
 * view is a `0 x 0` anchor hidden from accessibility on purpose (Q5 Appendix B5): the
 * name a screen reader hears is the presented window's title, and that window exists
 * only while something has opened it. So this rule has a presentation-aware variant,
 * and it runs inside the component's own real-input check, which is the one thing that
 * opens the window with a finger: the window is up and carries its title, a disabled
 * action is `isEnabled == false` / `enabled="false"` in the tree while its twin is
 * enabled, and a real tap on the disabled one reports nothing.
 *
 * A case here is coverage only if that check exists, and only for a component that
 * really has no box: `checkA11yTable` refuses a row whose manifest is self-sizing (a
 * control with a box belongs in {@link A11Y_CONTROLS}, where the sweep reads it) or
 * asks for no real-input check (then nothing reads the window at all).
 *
 * @typedef {object} A11yPresentation
 * @property {string} id the manifest id, which is also the real-input check's id
 * @property {string} component the manifest `name`
 * @property {string} hybridView the component's Fabric name
 * @property {string} assertedBy where the presentation-aware rule runs, by name
 */

/** @type {ReadonlyArray<A11yPresentation>} */
export const A11Y_PRESENTATIONS = Object.freeze([
  {
    id: 'dialog',
    component: 'Dialog',
    hybridView: 'NitroUiDialog',
    assertedBy:
      '`testRealInputDialog` (RealInputTests.swift) and `CHECKS.dialog` ' +
      '(scripts/real-input/android.mjs)',
  },
  {
    id: 'bottom-sheet',
    component: 'BottomSheet',
    hybridView: 'NitroUiBottomSheet',
    assertedBy:
      "`testRealInputBottomSheet` (RealInputTests.swift) and `CHECKS['bottom-sheet']` " +
      "(scripts/real-input/android.mjs): the sheet's React Native content is read " +
      'and pressed through the accessibility tree, and the sheet carries <testID>-sheet',
  },
  {
    id: 'tooltip',
    component: 'Tooltip',
    hybridView: 'NitroUiTooltip',
    assertedBy:
      '`testRealInputTooltip` (RealInputTests.swift) and `CHECKS.tooltip` ' +
      "(scripts/real-input/android.mjs): the presented tooltip's title, message and " +
      'action are read and tapped through the accessibility tree',
  },
  {
    id: 'popover',
    component: 'Popover',
    hybridView: 'NitroUiPopover',
    assertedBy:
      "`testRealInputPopover` (RealInputTests.swift) and `CHECKS['popover']` " +
      "(scripts/real-input/android.mjs): the popover's React Native content is read " +
      'and pressed through the accessibility tree, and its content carries <testID>-popover',
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
 * One accessibility element listed under the accessible ContextMenu: one of the two
 * `Text`s the example screen puts inside it, at a box of its own.
 *
 * `describeIosNode` writes these, so the pattern is pinned to the real shape — a fixture
 * whose box is written any other way does not match the row, which is the point.
 */
const CTX_TEXT_STOP =
  'static text "(?:Grace Hopper|One element for screen readers, with the menu on it\\.)" ' +
  'at \\([\\d., -]+\\)';

/**
 * The ContextMenu debt sentence: any number of stops, as long as every one of them is one
 * of the wrapper's own Texts and the finding blames React Native's publication for it.
 */
const CONTEXT_MENU_TEXT_STOPS_ROW = new RegExp(
  `: \\d+ element\\(s\\) under "ctx-accessible" are stops of their own ` +
    `\\(${CTX_TEXT_STOP}(?:; ${CTX_TEXT_STOP})*\\) — ` +
    'React Native publishes each Text'
);

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
 * - `form`: nothing under the row's `testID` is announced as "Row with onPress" either.
 *   The only element with the name is the React Native wrapper for the row's own `Text`,
 *   announced as `other`, and the list's cell does not answer for the row's name — so the
 *   row is a group of stops with a named one in it, not the one button the Android half
 *   announces. G24 round 3 measured the same tree with the cell's label derived on read
 *   instead of stored at configuration time, which rules out the first guess (a stale
 *   snapshot) and leaves the merge itself unfixed.
 *
 * **The `icon-button` iOS row** came back in G23's fix round, with different numbers, and the
 * reason belongs here: the 44 pt touch target was expected to retire it and did not. Measured on
 * pair-a (iOS 27, `iPhone 17`), the name is still on the right element — `button`, enabled,
 * hittable — and it is inset further than before: React Native lays the host out at
 * 44 x 44 pt (`measureContent()` answers with the target, so the box is integral) while SwiftUI
 * reports its `Button` element at the style's own 38.67 pt, centred inside it. The target is a
 * clear layer *behind* the control, so the element keeps the drawn control's geometry. That also
 * retires G23 round 0's explanation — that a host a fraction of a point wider than the
 * Button's own integral width produced the inset — because this host is integral and the inset
 * stayed. So this is a target larger than the control it wraps, not two reads of one layout, and
 * {@link IOS_FRAME_TOLERANCE_PT} cannot cover it. VoiceOver stops on the control. It is recorded
 * rather than fixed because both ways of moving the stop onto the target were built and both left
 * the name on two elements, which is a worse finding than the inset; `FOLLOWUPS.md` owns the
 * measurement that retires the row.
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
    control: 'stepper',
    platform: 'android',
    followups:
      "G25 a11y: the Stepper's RangeInfo node is not actionable in a dump",
    // The same dump limitation the four Slider/SegmentedControl rows record, and for the
    // same reason: the merged row is actionable through Compose's *custom* `SetProgress`
    // action, and `uiautomator dump` prints only the standard clickable/scrollable
    // flags, so a control a reader can adjust with a swipe reads as "no actions". The
    // action itself is not taken on faith — `Stepper > steps once when a reader asks`
    // performs SetProgress on this node and asserts the step and the one event it
    // produces, so what is unasserted here is the flag, not the behaviour.
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
    control: 'stepper',
    platform: 'ios',
    followups:
      'G25 a11y: the Stepper is announced as other and not as an adjustable',
    // The same gap `ios:slider` records, on the same element kind: this control vends a
    // `UIAccessibilityElement` whose traits are `.adjustable` (measured by the harness
    // probe, which reads the trait mask itself — `traits=4096` plus the bool UIKit
    // computes from it), and XCUITest has no element type for a trait, so the tree calls
    // it `other`. The row is anchored on the whole sentence — `and not as an adjustable`
    // — because the *other* way an announcement goes wrong ("no element other than the
    // React Native wrapper is announced as …", X4 re-review M3's lesson) must stay red:
    // losing the label is not this debt. The kind is therefore excused and the name, the
    // box and the value are not, which is also what the harness case grades.
    matches: /announced as an other and not as an adjustable/,
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
  {
    control: 'context-menu',
    platform: 'ios',
    followups:
      'G16 a11y: an accessible ContextMenu still lists its Texts as stops on iOS',
    // One component, three walk histories, measured on iOS 27 (X22 fix round 1). An app
    // that goes straight to this case reads ONE node: the wrapper with the label, its
    // subtree hidden — the tree the rule actually wants. The same tree walked after the
    // sweep's other 21 cases lists the first Text; after the merged Stepper + Picker-radio
    // tree's 22 it lists both. Each Text shows up twice, and that is not XCUITest
    // duplicating: the sweep's own probe finds one child under the wrapper with the same
    // label and one child under *that*, so React Native really vends two nested elements
    // per `Text` (the `Text`'s component view, and the element its Paragraph vends). All
    // three readings have identical boxes and settle with no instability line, and the
    // other 22 cases read byte for byte the same in both logs — the count is when the tree
    // was walked, not what the component is. The reason it can change at all is React
    // Native's: the wrapper hides its subtree only once React Native has stored
    // `accessible` on the component view, and measured from this view's own getter that
    // store still reads false inside the Hybrid's `afterUpdate()`. A walk that lands in
    // that window publishes the subtree, and UIKit keeps what it has published.
    //
    // So: any count, but every stop listed has to be one of the wrapper's own two Texts,
    // and the sentence has to be the one that names React Native's publication as the
    // cause. A third label is not this row, and neither is the unnamed container box —
    // that box is the D37 item 2 regression (the wrapper not an element at all), which is
    // what G16's comment mistook four stops for.
    matches: CONTEXT_MENU_TEXT_STOPS_ROW,
  },
  {
    control: 'form',
    platform: 'ios',
    followups:
      'G24 a11y: a Form row is one button on Android; on iOS its name stays on the wrapper',
    // Measured twice on pair-b (G24 rounds 2 and 3), byte for byte the same: the only
    // element carrying the row's name is the React Native view the app put the label on —
    // which since fix round 1 *is* the row, `Form.Row` itself — announced as `other`, on the
    // row's box. The list's cell does not answer for the row's name at all, so writing the
    // cell's label at configuration time and deriving it on every read produce the same tree.
    // The row presses, the name is where the row is drawn, and what is missing is the merge
    // into one button element: the cell has to be the leaf that UIKit already made it.
    //
    // Anchored on the wrapper being announced as `other`: a cell that starts answering is
    // no longer this sentence, so the row goes stale and the run says so.
    matches:
      /is announced as "Row with onPress" .*\(wrapper: other "Row with onPress"/,
  },
  {
    control: 'icon-button',
    platform: 'ios',
    followups:
      "G23 a11y: the iOS IconButton's accessibility element is the drawn control, inset inside its 44 pt touch target",
    // The measured inset and nothing wider (G23 fix round, iOS 27, iPhone 17). `18.67`/`38.67`
    // inside `16`/`44` *is* the finding, so a name that has actually moved — onto the wrapper,
    // or off the centre of the target — is not excused by it. The vertical coordinate is the one
    // number allowed to float: it is where the screen happens to sit, and pinning it would make
    // this row stale whenever anything above IconButton changed height, which is a layout note and
    // not a regression in the name. Every other number is the finding itself, so
    // `staleExemptions` reports this row the moment the geometry changes for any reason —
    // including being fixed.
    matches:
      /is announced by the element at \(18\.67, [\d.]+, 38\.67, 38\.67\) while the control is drawn at \(16, [\d.]+, 44, 44\)/,
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
    (node) =>
      node.label === control.label &&
      (control.wrapperIsControl === true || !node.anchor) &&
      hasArea(node)
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

  if (control.wrapperIsControl === true) {
    // One element *with the menu on it* means its children are inside it: a view that is
    // an accessibility element hides its subtree. Measured the other way round (G16, the
    // content view's getter forced false): XCUITest still listed the wrapper with its
    // label - it lists any view with an identifier - and its two texts as stops of their
    // own, so the name check alone passed a wrapper VoiceOver never stops on.
    //
    // Two different things produce that finding, and the debt row excuses one of them, so
    // they are said differently (X22 fix round 1). XCUITest lists every element twice, so
    // the *count* is never the signal — 2 and 4 stops are the same component, measured on
    // either side of React Native publishing its second Text. What separates the two
    // shapes is whether the walk also reaches an **unnamed** box under the named wrapper:
    // that box is the container the texts hang off, and it only shows up when the wrapper
    // is not the element UIKit stops on (the D37 item 2 regression). Without it, the
    // wrapper *is* the element with the name and the menu, and what is listed alongside it
    // are its own texts — React Native's doing, recorded as debt.
    const separate = tree.filter((node) => !node.anchor && hasArea(node));
    const unnamed = separate.filter((node) => node.label === '');
    const labelled = separate.filter((node) => node.label !== '');
    if (labelled.length > 0) {
      problems.push(
        `${control.hybridView}: ${String(labelled.length)} element(s) under ` +
          `"${control.anchorTestId}" are stops of their own ` +
          `(${labelled.map(describeIosNode).join('; ')}) — ` +
          (unnamed.length > 0
            ? `the walk also reaches ${describeIosNode(unnamed[0])}, an unnamed box ` +
              'under the named wrapper, so the wrapper is not one accessibility ' +
              'element and a screen reader reaches its children and never the menu ' +
              'on it'
            : 'React Native publishes each Text inside the wrapper as an element of ' +
              'its own, so a reader stops on the texts as well as on the wrapper that ' +
              'carries the name and the menu')
      );
    }
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
  // Not `=== 'interactive'`: a group's element owes this too. The roles differ in *what*
  // has to be actable — the node itself versus its members — not in whether a stop that
  // carries a name may be inert on both counts.
  if (control.role !== 'indicator' && !node.enabled && !node.hittable) {
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
 * A `kind=stability` line is not an element and is skipped here; it is read by
 * `parseIosA11yStability`, which is how the report says *how many reads* a case's boxes cost.
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
 * The report's note about one case's re-reads, or `null` when there is nothing to say.
 *
 * A case whose two reads agreed prints no stability line, so fourteen healthy cases add nothing to
 * the report. Anything else belongs in it: a pass that read a control four times, or one that never
 * settled, has to be visible, because *otherwise a fix that retried its way to a green is
 * indistinguishable from a clean run* — which is precisely how an accessibility rule gets quietly
 * turned off.
 *
 * The note quotes the **first** read rather than the one before the last, because the first is the
 * box the old single-read pass would have decided on: that pair is the comparison a reader wants,
 * and it is the only one that survives a third or fourth read.
 *
 * @param {{reads: number, settled: boolean, moved: number, elapsedMs: number,
 *   firstAnchor?: {x: number, y: number, width: number, height: number}}} [stability]
 * @param {{x: number, y: number, width: number, height: number}} [settledAnchor] the box actually
 *   printed, so the note can name the ratio between the two reads instead of leaving a reader to
 *   divide four numbers in their head.
 * @returns {string | null}
 */
export function iosStabilityNote(stability, settledAnchor) {
  if (stability == null) return null;
  const firstRead =
    stability.firstAnchor == null
      ? ''
      : `; the first read said (${num(stability.firstAnchor.x)}, ` +
        `${num(stability.firstAnchor.y)}, ${num(stability.firstAnchor.width)}, ` +
        `${num(stability.firstAnchor.height)})`;
  // Said once, at the end, for whichever branch quoted the first read: naming the ratio twice in
  // one sentence would read like a bug in the note.
  const scale =
    stability.firstAnchor == null
      ? ''
      : describeFirstReadScale(stability.firstAnchor, settledAnchor);
  if (!stability.settled) {
    // Not a pass and not a failure: a measurement taken off a tree that would not hold still, the
    // one kind of green a reader has to be able to discount. Saying that out loud is what keeps a
    // bounded wait honest — the alternative is a silent number of reads nobody can interpret.
    return (
      `the boxes below are read ${String(stability.reads)} times and never agreed ` +
      `(${String(stability.moved)} frame(s) still different between the first and the last, ` +
      `${String(stability.elapsedMs)} ms${firstRead}) — this case is one sample of a tree that ` +
      'would not hold still, so discount it rather than trusting it' +
      scale
    );
  }
  return (
    `the boxes below are read ${String(stability.reads)} times before two agreed ` +
    `(${String(stability.moved)} frame(s) moved, ${String(stability.elapsedMs)} ms${firstRead}) ` +
    '— the first read was thrown away rather than decided on. The finding below is unaffected: ' +
    'the rule compares two elements of this one read, never two reads' +
    scale
  );
}

/** The scales a screen actually has, and the labels `firstReadScale` gives them. */
const SCREEN_SCALES = [
  { near: 1 / 3, label: '⅓' },
  { near: 1 / 2, label: '½' },
  { near: 1 / 4, label: '¼' },
  { near: 2, label: '2×' },
  { near: 3, label: '3×' },
];

/**
 * The scale ratio between the first read's box and the settled one, or `null` when there is no
 * single ratio to name.
 *
 * The failure this whole guard was written for was a first read at exactly ⅓ of the settled one on
 * every component: the screen scale, which is what identifies a stale snapshot from another render
 * pass rather than a control that genuinely moved. Answered once, here, because two readers of that
 * question — the note that prints the ratio and the WARN that promotes it (X16 item 4) — would
 * eventually disagree, and the disagreement would look like a warning contradicting the sentence
 * printed beside it.
 *
 * A label, not a number: `⅓`, `½`, `¼`, `2×`, `3×`, or the raw ratio to three places. All four
 * components have to share one ratio within half a percent, and it has to differ from 1, so a box
 * that merely happens to be smaller is not called a scaled read. A raw ratio is still a uniform
 * one, but it is not a scale a screen has, so only `screenScale` (below) is the stale-snapshot
 * question; this is the one the note quotes.
 *
 * @param {{x: number, y: number, width: number, height: number}} [first]
 * @param {{x: number, y: number, width: number, height: number}} [settled]
 * @returns {string | null}
 */
export function firstReadScale(first, settled) {
  if (first == null || settled == null) return null;
  const components = ['x', 'y', 'width', 'height'];
  let ratio = null;
  for (const key of components) {
    const before = first[key];
    const after = settled[key];
    if (!Number.isFinite(before) || !Number.isFinite(after) || after === 0) {
      return null;
    }
    const candidate = before / after;
    if (ratio == null) {
      ratio = candidate;
      continue;
    }
    if (Math.abs(candidate - ratio) > 0.005) return null;
  }
  if (ratio == null || Math.abs(ratio - 1) < 0.01) return null;
  // Named when it is one of the scales a screen actually has, and the raw ratio otherwise. The
  // components of two real reads never divide to the same digit exactly - boxes are rounded on
  // their way out of the test manager, so 108.33/325 is 0.333323 rather than 1/3 - which is why
  // these are comparisons with a tolerance and not key lookups.
  const found = SCREEN_SCALES.find(
    (candidate) => Math.abs(ratio - candidate.near) < 0.002
  );
  return found == null ? `${ratio.toFixed(3)}×` : found.label;
}

/**
 * `firstReadScale`'s label when it names a screen scale, and `null` for any other ratio.
 *
 * The stale-snapshot question, and the only one the WARN and the note's "another render scale"
 * sentence ask. A first read at 0.8× on all four components is uniform, but no screen renders at
 * 0.8×: that is a control animating in or a layout pass at another size, which is a note's business
 * and not a summary's (X17 item 1). One function rather than a label check at each call site, for
 * the reason `firstReadScale` gives.
 *
 * @param {{x: number, y: number, width: number, height: number}} [first]
 * @param {{x: number, y: number, width: number, height: number}} [settled]
 * @returns {string | null}
 */
export function screenScale(first, settled) {
  const label = firstReadScale(first, settled);
  return SCREEN_SCALES.some((scale) => scale.label === label) ? label : null;
}

/**
 * The WARN this case's re-reads deserve, or `null` for a case that earns none.
 *
 * A first read at exactly the screen's scale is a real accessibility bug that came and went. The
 * rule still grades the settled tree correctly, so the case *passes* — and that is precisely why it
 * has to be said somewhere a reader cannot miss: a finding that only appears as one line among
 * forty per-case notes is reported as a clean run by anyone who reads the verdict column. So it goes
 * on the summary, and the exit code does not change, because "the boxes are right" is still true.
 *
 * Only a named scale warns (`screenScale`). Two reads whose boxes differ by some arbitrary ratio are
 * a control that moved (or a tree still being laid out), which is what the notes are for - and so
 * are four components that share a ratio no screen has, like 0.8×. All four dividing by one of a
 * screen's own scales is the shape of a snapshot taken at another render scale, which is the shape
 * that failed twice on maintainer-mac-1 and that nobody saw in the report.
 *
 * @param {{reads: number, settled: boolean, moved: number, elapsedMs: number,
 *   firstAnchor?: {x: number, y: number, width: number, height: number}}} [stability]
 * @param {{x: number, y: number, width: number, height: number}} [settledAnchor]
 * @returns {string | null}
 */
export function iosStabilityWarning(stability, settledAnchor) {
  if (stability?.firstAnchor == null) return null;
  const label = screenScale(stability.firstAnchor, settledAnchor);
  if (label == null) return null;
  return (
    `its first accessibility read was this box at ${label} scale — a stale snapshot ` +
    `from another render pass, discarded by read ${String(stability.reads)}. The boxes ` +
    'reported here are the settled ones and the rule still graded them, so this is not a ' +
    'failure; it is a transient accessibility bug that came and went, and it is a warning ' +
    'so it does not become a footnote'
  );
}

/**
 * Reports one case's re-reads onto its check: the note always, the WARN when the shape says so.
 *
 * Lives here rather than inline in `ios.mjs` because `ios.mjs` is the runner and nothing can import
 * it without a simulator — and item 4 is exactly about the step that *publishes* the finding. A
 * helper nobody calls is worth nothing, and a text assertion on a call site is weak enough to survive
 * the call being switched off. Handed a real `CheckLog`, this is testable end to end: the note
 * appears, the warning appears, and the case's verdict does not move.
 *
 * @param {{note: (message: string) => void, warn: (message: string) => void}} check
 * @param {{reads: number, settled: boolean, moved: number, elapsedMs: number,
 *   firstAnchor?: {x: number, y: number, width: number, height: number}}} [stability]
 * @param {{x: number, y: number, width: number, height: number}} [settledAnchor]
 */
export function reportIosStability(check, stability, settledAnchor) {
  const note = iosStabilityNote(stability, settledAnchor);
  if (note != null) check.note(note);
  const warning = iosStabilityWarning(stability, settledAnchor);
  if (warning != null) check.warn(warning);
  return { note, warning };
}

/**
 * "…and the first read is this box at ⅓ scale" — said only when it is true.
 *
 * The render-scale sentence comes from `screenScale`, which is the same question `ios.mjs` asks
 * when it decides whether to WARN. Two implementations of "is this the screen-scale shape" would
 * eventually disagree, and the disagreement would look like a warning that contradicts the note
 * printed beside it. A uniform ratio that is not a screen scale is still quoted - a reader should
 * not have to divide four numbers - but as a box that moved, which is what the missing WARN says.
 *
 * @param {{x: number, y: number, width: number, height: number}} [first]
 * @param {{x: number, y: number, width: number, height: number}} [settled]
 */
function describeFirstReadScale(first, settled) {
  const scale = screenScale(first, settled);
  if (scale != null) {
    return (
      ` — the first read is this box at ${scale} scale, the shape of a snapshot taken at ` +
      'another render scale rather than a control that moved'
    );
  }
  const ratio = firstReadScale(first, settled);
  if (ratio == null) return '';
  return (
    ` — the first read is this box at ${ratio} on every component, which is no screen's ` +
    'scale, so it reads as a control that moved'
  );
}

/**
 * The stability line a case printed, if it printed one (`parseIosA11yLog` skips those lines).
 *
 * A `kind=stability` line exists only when a case cost more than the ordinary two reads, or when
 * the wait ran out: a control that settled immediately prints no extra line at all. Reading it in
 * the report is what keeps the fix honest — a pass that retried its way to a green would look
 * exactly like a green unless the log said how many reads it took, and an unsettled comparison is
 * a measurement a reader has to be able to discount.
 *
 * @param {string} log the xcodebuild test log
 * @returns {Map<string, {reads: number, settled: boolean, moved: number, elapsedMs: number,
 *   firstAnchor?: {x: number, y: number, width: number, height: number}}>}
 */
export function parseIosA11yStability(log) {
  /** @type {Map<string, any>} */
  const byControl = new Map();
  for (const line of log.split('\n')) {
    if (!line.includes('real-input a11y ')) continue;
    const fields = fieldsOf(line);
    if (fields.get('kind') !== 'stability') continue;
    const caseName = fields.get('case');
    if (caseName == null) continue;
    const reads = Number(fields.get('reads'));
    const settled = fields.get('settled') === 'true';
    const moved = Number(fields.get('moved'));
    const elapsedMs = Number(fields.get('elapsedMs'));
    // An unreadable count is a format change, and the difference between "settled after 3 reads"
    // and "never settled" is the whole point of reading the line: silence here would turn a
    // moving tree into an unremarked one. Same rule as an unreadable box above.
    if (!Number.isFinite(reads) || !Number.isFinite(moved)) {
      throw new Error(
        `real-input: a stability line from the iOS run carries no readable read count: ${line.trim()}`
      );
    }
    const entry = { reads, settled, moved, elapsedMs };
    if (fields.has('firstAnchorX')) {
      entry.firstAnchor = {
        x: Number(fields.get('firstAnchorX')),
        y: Number(fields.get('firstAnchorY')),
        width: Number(fields.get('firstAnchorW')),
        height: Number(fields.get('firstAnchorH')),
      };
    }
    byControl.set(caseName, entry);
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

  // Which node is "the control", when the tree offers more than one answer.
  //
  // `named[0]` is tree order, and tree order is not identity. Measured on a long
  // `real-input:android` session, the Form row's name was carried both by the row and by a
  // recycled wrapper the screen had re-used, `named[0]` was the latter, and the actionable half
  // of this rule graded *that* node — so the finding printed a container's box and said nothing
  // about the row a person actually presses (G24 fix round 1).
  //
  // So when the name is on more than one node and the dump can still name the control by its
  // own `testID`, ask the actionability question of that node. The duplicate above stays a
  // finding — this decides *which* node is graded, not whether a second one is allowed. With
  // one named node nothing changes, which is what keeps the other twenty-two controls graded
  // exactly as they are today.
  const anchor =
    named.length > 1 && control.anchorTestId != null
      ? findByTestId(tree, control.anchorTestId)
      : undefined;
  const node =
    anchor != null &&
    anchor.bounds.width > 0 &&
    anchor.bounds.height > 0 &&
    anchor.scrollable !== 'true' &&
    isActable(anchor)
      ? anchor
      : named[0];
  const subject =
    node === named[0]
      ? `the node that carries "${control.label}"`
      : `the node under "${String(control.anchorTestId)}"`;
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
  } else if (control.role === 'container' && !hasActableMembers(node, tree)) {
    // The group shape: the name is on the container because that is what a group's label
    // *is*, so the question is not whether the container can be pressed (it cannot, and
    // demanding it would push a component toward making a whole row one button) but
    // whether the labelled box still reaches the items it names.
    problems.push(
      `${control.hybridView}: "${control.label}" names a group whose box contains ` +
        `nothing a person can act on (${describeNode(node)}) — the group is announced ` +
        'and its items are not inside it, so a reader hears a name for a row it cannot ' +
        'actually reach'
    );
  } else if (
    control.role === 'interactive' &&
    !isActable(node) &&
    !hasActableHome(node, tree)
  ) {
    problems.push(
      `${control.hybridView}: ${subject} is not ` +
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
 * Whether the box a group's name sits on actually contains things a person can act on.
 *
 * The mirror of {@link hasActableHome}, and needed because that one is the wrong shape for
 * a group: measured on Android (G20), Material merges a `ButtonGroup`'s row into the node
 * that carries the group's `accessibilityLabel`, and the items stay separately reachable
 * just *inside* that box — a `View` at [212,805][868,931] with three clickable views
 * between 212 and 868. So the name is on a node with no actions of its own, which is
 * right for a container and reads as a failure to a rule that only knows "the control must
 * be pressable". What is worth asserting is the contents: a labelled group whose box holds
 * nothing pressable is a group that has swallowed its items.
 *
 * @param {import('./uiautomator.mjs').UiautomatorNode} named
 * @param {ReadonlyArray<import('./uiautomator.mjs').UiautomatorNode>} tree
 */
function hasActableMembers(named, tree) {
  return tree.some(
    (node) =>
      node !== named &&
      isActable(node) &&
      node.scrollable !== 'true' &&
      covers(named.bounds, node.bounds) &&
      // Members, not the group itself: a container that also reports its own press is
      // already graded by the `interactive` branch, which asks the harder question.
      area(node) < area(named)
  );
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
