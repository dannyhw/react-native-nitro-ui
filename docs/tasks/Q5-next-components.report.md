# Q5 — Which components next, and their designs

**Branch:** `task/Q5-next-components` (from `origin/main` at `17440f8`) · **Round:** 1 of up to 2 (brief: 1 round
plus at most 1 fix round) · **Lease:** none (research and design only, no devices)

Methods note: nothing was built or run. Facts come from this repo at `17440f8`; from Xcode 27's iPhoneOS 27.0 SDK
(`SwiftUI.swiftinterface`, UIKit headers); from `javap` on the resolved `material3-android` 1.4.0 AAR in the Gradle
cache; from the installed `@expo/ui` 58.0.22 and `react-native` 0.88.0 in the main checkout's `node_modules`; and from
npm's public downloads API (week 2026-10-23 to 10-29). All of these were read-only. Paths outside the repo carry a
prefix: `swiftui:` is `SwiftUI.swiftinterface`, `uikit:` is UIKit's `Headers/`, `m3:` is material3 1.4.0, `expo-ui:` is
`@expo/ui` 58.0.22 and `rn:` is `react-native` 0.88.0. A claim I could not check in a source is marked *(reading)*.

## Summary

**Ranked list** (priority order; Appendix A has the scores and the order to start them in):

1. **AlertDialog + ConfirmationDialog.** Both platforms have the real control. It needs no box and no React Native
   children, and it reuses DatePicker's presentation lifecycle and Menu's row structs.
2. **BottomSheet.** The most wanted candidate (`@gorhom/bottom-sheet` 3.8 M downloads a week), with a real control on
   each platform. It needs React Native children inside a presented window, which no nitro-ui component can do yet, so
   it starts with a spike.
3. **Chip.** A cheap inline control: Material 3 chips on Android; SwiftUI `Toggle(.button)` or a capsule `Button` on
   iOS.
4. **Checkbox.** Material 3 `Checkbox`/`TriStateCheckbox` on Android. iOS has no checkbox, so it renders a `Toggle`
   there, as Expo does.
5. **ContextMenu.** Reuses Menu's `group`, and builds on BottomSheet's work on React Native children.

After those: Stepper, Toast/Snackbar, Tooltip/Popover (added), Gauge, ColorPicker, Form/List/Section (Appendix D).

**Dialog design (Appendix B).** One native view with two exports. It is not called `Alert`, which collides with React
Native's `Alert`.
- `isPresented` is controlled through the existing event-count handshake. That fixes an Expo bug: if the app ignores
  `onIsPresentedChange`, Expo's alert can never be reopened.
- Actions are a typed struct array. A tap fires `onAction(id)`, then `onIsPresentedChange(false)` (D32's order).
- iOS presents UIKit's `UIAlertController` through a helper factored out of DatePicker's popover. That means no
  hosting controller per closed dialog, deterministic dismissal on drop, and a real anchor for action sheets.
- Android composes Material 3 `AlertDialog`, and `ModalBottomSheet` rows for the confirmation form.
- It has no sizing (`sizing: null`).

**BottomSheet design (Appendix C).** The content is React Native children, using React Native `Modal`'s own pattern:
- an absolute shadow node sized from native state;
- children mounted into the presented container;
- a touch root of its own.

iOS uses UIKit's `UISheetPresentationController`. Android uses Material 3 `ModalBottomSheet`, whose two-detent limit is
documented. `isPresented` uses the same handshake as the dialog. The content is mounted only while the sheet is
presented.

**Riskiest spikes.**
- **Dialog:** presenting from a plain view in every context (inside an RN `Modal`, a screens `formSheet`, or a
  controller that is already presenting), and dismissing deterministically mid-transition.
- **BottomSheet:** React Native children inside a presented window on both platforms. They have to mount, lay out at the
  sheet's width, take touches, and settle a `fit` detent without a visible jump.

## Gates

No code changed. `node scripts/gate.mjs table` (Node 24) prints `table: nothing recorded yet - run a gate first.` for
code tree `9d4eee3e8894` at `17440f8`. This commit is docs-only, so the code tree stays the same. The brief asks for
no gate (read-only, no devices).

## Red proofs

None. No test or gate was added.

## Files changed

- `docs/tasks/Q5-next-components.report.md` (new): this file.

## Follow-ups

- Conformance: X4's a11y rule applies to every manifest with no exemption (`scripts/conformance-core.mjs:141-154`), and
  `no-leak-on-drop` is keyed to the sizing engine (`:166-174`). A component with no box that presents a window needs a
  presentation-aware variant of both.
- Bench: no scenario measures a presentation, because `presentedNs` is the control's own first frame. Dialog and
  BottomSheet need a `present.<id>` scenario with a native "presentation shown" stamp.
- iOS core: the presentation helper is private to DatePicker (`NitroUiDatePickerPresentation`,
  `ios/components/DatePicker/HybridNitroUiDatePicker.swift:811`). Dialog and BottomSheet want it in `ios/core`.
- `docs/PLAN.md` "Later" still says "None of these is built yet". It needs a pass once the owner picks.

## Questions for orchestrator

- **A. Names.**
  - Options: `AlertDialog` + `ConfirmationDialog` over one native view; one `Dialog` with a `variant` prop; or `Alert`.
  - **Recommend the first.** It uses Material's and SwiftUI's own words, and `Alert` collides with
    `import { Alert } from 'react-native'`.
- **B. How iOS presents the dialog.**
  - Options: UIKit `UIAlertController` through a core helper, like DatePicker's popover; or SwiftUI
    `.alert`/`.confirmationDialog` inside a hosting controller.
  - The SwiftUI option follows principle 1 literally. But it costs a hosting controller for every closed dialog, and its
    dismissal on drop and its action-sheet anchor are unproven.
  - **Recommend UIKit**, with a side-by-side SwiftUI arm in the spike to show the pixels are the same.
- **C. ConfirmationDialog on Android.**
  - Options: a Material 3 `ModalBottomSheet` with one row per action (Material's action-sheet idiom); or an
    `AlertDialog` with stacked buttons.
  - **Recommend the sheet.** It is also the first Android `ModalBottomSheet` in the library, which de-risks BottomSheet.
- **D. A dismissal the app refuses.**
  - The case: the app keeps `isPresented` true after the dismissal is echoed back.
  - Options: present the dialog again (the handshake's answer, and what React Native's `Modal` does with `visible`); or
    treat the native dismissal as final until JS writes `false`.
  - **Recommend presenting it again**, with a dev warning once per instance. `dismissible={false}` is how to keep a
    dialog or sheet up.
- **E. BottomSheet detents on Android.**
  - Options: accept Material 3's two (partially expanded at half height; expanded at the content height or full), and
    map custom heights onto them; or draw a custom sheet that is not Material 3.
  - **Recommend accepting the two**, documented as a platform limit (D29/D32 style).
- **F. BottomSheet content lifetime.**
  - Options: mount the content only while presented (Expo does this); or offer `keepMounted`.
  - **Recommend mounting only while presented** for v1. `keepMounted` can come later.
- **G. Order.**
  - Start the BottomSheet spike in parallel with the dialog build, rather than after it.
  - **Recommend parallel.** The two share only the core presentation helper, and the spike is the long pole.

---

## Appendix A — Ranking

Scores are 1 (poor) to 5 (strong). For "Risk / effort", 5 means cheap and safe. Demand figures are npm downloads per
week.

| # | Candidate | Native counterpart (iOS / Android) | Fit with the Hybrid View model | Demand | Risk / effort, reuse | Expo UI 58.0.22 ships |
| - | --- | --- | --- | --- | --- | --- |
| 1 | AlertDialog + ConfirmationDialog | **5**: `UIAlertController` (`.alert` and `.confirmationDialog`, iOS 15) / M3 `AlertDialog`, `ModalBottomSheet` | **4**: a presentation with no box, data-only; DatePicker already presents on both platforms | **5**: every app; RN's `Alert` is imperative and AppCompat-styled on Android; `@expo/react-native-action-sheet` 474 k | **4**: reuses DatePicker's lifecycle and witnesses, and Menu's rows | iOS `Alert`, `ConfirmationDialog` (slots); Android `AlertDialog`, `BasicAlertDialog`; no ConfirmationDialog on Android |
| 2 | BottomSheet | **5**: `UISheetPresentationController` (iOS 15; custom detents iOS 16) / M3 `ModalBottomSheet` (two detents) | **2**: needs RN children in a presented window: a new shadow node, an iOS mount override, and an Android `ViewGroupManager` with a touch root | **5**: `@gorhom/bottom-sheet` 3.83 M, `react-native-modal` 812 k, true-sheet 297 k | **1**: spike first; the mechanism unlocks ContextMenu and Popover content later | iOS `BottomSheet`, Android `ModalBottomSheet`, universal `BottomSheet` (`snapPoints`) |
| 3 | Chip | **4**: `Toggle(.button)` or a capsule `Button`, both native controls but not a chip / M3 chips | **5**: inline, intrinsic; a filter chip has a value, so it uses the handshake | **3**: filters, tags | **4**: a sibling of Button and Switch | Android chips only |
| 4 | Checkbox (RadioGroup goes to Picker) | **2**: none on iOS (`CheckboxToggleStyle` is iOS-unavailable) / M3 `Checkbox`, `TriStateCheckbox` | **5**: inline | **4**: `expo-checkbox` 223 k, community 97 k | **4**: a Switch clone | Android `Checkbox`; universal `Checkbox` renders a `Toggle` on iOS |
| 5 | ContextMenu | **3**: `UIContextMenuInteraction` / none (an M3 `DropdownMenu` at the press point is a convention) | **2**: wraps RN children in place, and has to arbitrate gestures with RN | **4**: zeego 176 k, context-menu-view 120 k | **2**: reuses Menu's `group` fully, plus C2 | iOS only |
| 6 | Stepper | **2**: SwiftUI `Stepper` (iOS 13) / none | **5**: inline, handshake | **2** | **5** | iOS only |
| 7 | Toast/Snackbar | **2**: none / M3 `Snackbar` | **2**: not a view; an imperative HybridObject plus an overlay | **4**: toast-message 891 k, burnt 273 k | **3**: the iOS side would be our own drawing | Android `SnackbarHost` |
| 8 | Tooltip/Popover (added) | **4**: popover (iOS 16.4 compact adaptation) / M3 `TooltipBox` | **3**: text is data; content needs C2 | **2** | **3**: reuses DatePicker's popover | iOS `Popover`, Android `Tooltip` |
| 9 | Gauge | **2**: SwiftUI `Gauge` (iOS 16) / none | **5**: display-only, like Progress | **1** | **5**: as a Progress variant | iOS only |
| 10 | ColorPicker | **2**: SwiftUI `ColorPicker` (iOS 14) / none | **4**: a swatch plus a system presentation | **2**: `reanimated-color-picker` 103 k (JS) | **3** | iOS only |
| 11 | Form/List/Section | **4**: SwiftUI `Form`/`List` / `LazyColumn` + `ListItem` (no Form) | **1**: the container architecture (core-architecture §6), and D23 | **3** | **1**: an architecture project | iOS `Form`/`List`/`Section`, Android `LazyColumn`, universal `List` |

**How the scores turn into a rank.**
- A native counterpart on both platforms and demand weigh most.
- Risk is handled by gating a candidate behind a spike, not by demoting it. Otherwise the most-wanted candidate never
  gets built.
- The cheap inline controls (Chip, Checkbox, Stepper) need little design. They are copies of Switch or Button with a
  different composable, which is why their designs are a paragraph each.

**Order to start.**
1. The Dialog build (a G task).
2. In parallel, the BottomSheet spike (one round, both platforms; its report decides go or no-go under D19's spike
   rule).
3. Chip, also in parallel, since nothing depends on it.
4. The BottomSheet build, if the spike says go.
5. Checkbox.
6. ContextMenu, once C2's children mechanism exists.

## Appendix B — AlertDialog and ConfirmationDialog

### B1. Public API

A dialog has a value, whether it is presented, so it follows `Switch`, not `Menu`. `useControlled` and the
event-count handshake apply (`src/core/useControlled.ts:51`). The actions are data, as Menu's rows are
(`src/components/Menu/Menu.nitro.ts`).

```ts
export interface DialogAction {
  id: string;                                   // what onAction reports; unique, stable
  title: string;
  role?: 'default' | 'cancel' | 'destructive';  // at most one 'cancel'
  disabled?: boolean;
}
interface DialogProps extends ViewProps {
  isPresented: boolean;                                  // required: controlled only
  onIsPresentedChange?: (isPresented: boolean) => void;  // every native open/close
  title: string;
  message?: string;
  actions: DialogAction[];                               // at least one (dev throw otherwise)
  onAction?: (id: string) => void;
  dismissible?: boolean;      // outside tap / back / swipe close it; default true
  tintColor?: ColorValue;
}
export type AlertDialogProps = DialogProps;
export interface ConfirmationDialogProps extends DialogProps {
  titleVisibility?: 'automatic' | 'visible' | 'hidden';  // SwiftUI's; default 'automatic'
}

// NitroUiDialog.nitro.ts — one native view behind both exports
export interface NitroUiDialogAction { id: string; title: string; role: string; disabled: boolean }
export interface NitroUiDialogProps extends HybridViewProps {   // no NitroUiIntrinsicProps
  variant: string;                 // 'alert' | 'confirmation'
  presented: boolean;              // JS copy of isPresented
  mostRecentEventCount: number;
  title: string; message: string | null; titleVisibility: string;
  actions: NitroUiDialogAction[];
  dismissible: boolean; tintColor: number | null;
  testID: string | null; nuiPerfId: number | null;
  onPresentedChange?: (presented: boolean, eventCount: number) => void;
  onAction?: (id: string) => void;
}
// methods: nuiTestStateReport(): string; nuiTestPerformAction(id: string): void; nuiTestDismiss(): void
```

**Spec conventions.**
- Every prop is `T | null` and callbacks are `fn?` (D7, D7b).
- `hybridRef` is read-only and `@internal` (D14).
- `actions` gets one stable array identity: the wrapper memoises it on a content string, as Menu does with its rows.
- Every test hook hops to main with a commit (`docs/architecture/core.md` §5).
- There is no `accessibilityLabel`; the title is the dialog's name (B5).

**Events.**
- **Action tap:** `onAction(id)`, then `onIsPresentedChange(false)`. The choice is reported before the close (D32).
- **Dismissal without an action:** only `onIsPresentedChange(false)`. That covers an outside tap, back, a swipe, the
  implicit Cancel iOS adds, and the view leaving its window while presented.
- **JS writes `false`:** native dismisses with animation and emits nothing, because it was not a native interaction.
- **`isPresented` true at mount:** the dialog presents once, when the view first has a window.

**A dismissal the app refuses (question D).** If JS still says `true` once it has seen the dismissal's event count,
`reconcile()` puts `displayed` back to `true` and the dialog presents again.
- The dev build warns once per instance: "dismissed by the user but `isPresented` is still true".
- An action tap always closes the dialog. iOS cannot keep an alert up after an action, so Android closes too, which
  Material leaves to the caller.

**Why this beats Expo.** Expo's `AlertView` keeps a `@State isPresented` and follows `props.isPresented` only through
`.onChange` (`expo-ui:ios/Alert/Alert.swift`). An app that ignores `onIsPresentedChange` leaves the prop at `true`, so
writing `true` again changes nothing and the alert never reopens. The handshake is what closes that gap.

**The box.**
- The wrapper's base style is `{ position: 'absolute', width: 0, height: 0 }`, and it always passes
  `pointerEvents="none"`.
- An app may place the box with `style`, for example absolutely over the button that opens the dialog. The box is the
  action sheet's anchor (B2).
- The anchor is not a trigger slot: a trigger made of React Native children needs C2's mechanism. That can come later.

### B2. iOS: UIKit `UIAlertController`, presented through a core helper

**The view.** `HybridNitroUiDialog: HybridNitroUiDialogSpec, RecyclableView`. Its `view` is a plain `UIView` with
`isUserInteractionEnabled = false` that is not an accessibility element. There is no `NitroSwiftUIHost` and no
`UIHostingController`: a closed dialog in every row of a list should cost a view, not a SwiftUI graph.

**Mapping.**
- The controller is `UIAlertController(title:message:preferredStyle:)`, with `.alert` or `.actionSheet` (iOS 8).
- Each action is a `UIAlertAction` with style `.default`, `.cancel` or `.destructive`, and `isEnabled = !disabled`.
  `isEnabled` can be set while the alert is up.
- The SwiftUI equivalents are `.alert(_:isPresented:actions:message:)` and
  `.confirmationDialog(_:isPresented:titleVisibility:actions:message:)`, both iOS 15 (`swiftui:13345`, `:22483`).
  Roles map to `ButtonRole.destructive`/`.cancel` (iOS 15). `.confirm`/`.close` (iOS 26, `swiftui:11764-11771`) are out
  of v1.
- SwiftUI presents this same controller on iOS *(reading)*. The spike's side-by-side screenshot settles that.
- `titleVisibility: 'automatic'` copies SwiftUI's default for an iOS action sheet, which is to hide the title
  *(reading, checked by the same screenshot)*.

**Presenter.** A core `NitroUiPresentation` helper, factored out of `NitroUiDatePickerPresentation`
(`ios/components/DatePicker/HybridNitroUiDatePicker.swift:811-1062`):
- The presenter is the nearest view controller on the responder chain that is not a navigation or tab controller (the
  same walk as `findContainerViewController`, `ios/core/NitroSwiftUIHost.swift:618`), then walked up its
  `presentedViewController` chain to the top.
  - The walk to the top is new: DatePicker presents from its contained controller directly.
  - It is what lets a dialog open over an RN `Modal`, over another dialog, or over the app's own presentation.
- An action sheet sets `popoverPresentationController.sourceView = view` and `sourceRect = bounds`. That is mandatory
  on iPad, where UIKit throws without a source. It is also the anchor if iOS 26+ anchors iPhone action sheets *(spike)*.
- The helper keeps three things from DatePicker: the process-wide `livePresentations` count (`:848`); `hideImmediately`
  for a drop during the entry transition (`:1011`); and the real dismissal deferred to the presentation's completion.
- No containment is needed. There is no hosting controller to contain, and the responder chain from the Fabric view
  already reaches the screen's controller.

**Closing.**
- An action's handler fires `onAction`, then the native dismissal: `user(false)` and an emit.
- An iPad popover closed by an outside tap reports through `presentationControllerDidDismiss`, the same delegate path
  DatePicker uses (`:1054`).
- `didMoveToWindow` with a nil window while presented dismisses without animation and is reported as a native event.

**Live updates.**
- `title`, `message` and `isEnabled` update the presented controller in place.
- Adding, removing or renaming actions while presented applies at the next presentation, because `UIAlertController`
  cannot drop an action. Android recomposes in place, and this platform difference is documented.

### B3. Android: Material 3 `AlertDialog` and `ModalBottomSheet` in the host composition

**Host.** `DialogHost : NitroComposeHost<DialogModel>`. Its `Component(model)` is
`if (model.presented) { DialogWitness(model); when (variant) { … } }`. The witness is a `DisposableEffect` on a
process-wide `livePresentations` that also clears the flag on dispose. It is the same machinery as DatePicker's
dialog: `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiDatePicker.kt:274`, the witness at `:1251`, and
`DatePickerDialog(onDismissRequest = …)` at `:1312-1317`.

**The `alert` variant.** `AlertDialog(onDismissRequest, confirmButton, modifier, dismissButton, icon, title, text, …,
properties = DialogProperties(dismissOnBackPress = dismissible, dismissOnClickOutside = dismissible))`, from
`m3:AndroidAlertDialog_androidKt`.
- The non-cancel actions go in the `confirmButton` slot as `TextButton`s, in order; Material's `AlertDialogFlowRow`
  wraps them. The cancel action goes in `dismissButton`.
- A destructive action uses `ButtonDefaults.textButtonColors(contentColor = colorScheme.error)`, from a process-wide
  cache keyed on the scheme. Building it inside the composable would break `docs/architecture/core.md` §3, "Shared
  objects".

**The `confirmation` variant (question C).** `ModalBottomSheet(onDismissRequest, sheetState =
rememberModalBottomSheetState(skipPartiallyExpanded = true), sheetGesturesEnabled = dismissible, properties =
ModalBottomSheetProperties(shouldDismissOnBackPress = dismissible, shouldDismissOnClickOutside = dismissible))`.
- In 1.4.0, the overload that takes the gestures flag and the three-argument properties both exist
  (`m3:ModalBottomSheetKt`, `m3:ModalBottomSheetProperties`).
- The content is an optional title and message header, then one `ListItem` per action
  (`Modifier.clickable(enabled = !disabled)`), destructive rows in the error colour, and the cancel action last.
- A programmatic close runs `sheetState.hide()` before the subtree stops composing. Otherwise the sheet vanishes
  without its animation. The witness counts until the subtree leaves.

**Teardown.** Drop disposes the composition, which takes the window down. That is the H2b rule
(`docs/components/host.md`, "Popups and dialogs").

**Hosting.** The dialog is **hostable**: a Compose dialog opened from the Host's composition is proven for DatePicker
(H2b). A layout move does *not* close it, because the rule for anchored popups does not apply to a window with no
anchor.

**Two open questions for the spike.**
- Does `NitroComposeHost` compose at a `0 × 0` box with no measured root? If not, a core flag `presentsOnly` composes on
  attach and skips `NitroUiMeasuredRoot`.
- Does a Compose dialog window survive its host view's detach, for example a screen push? If it does, the host closes
  the dialog on detach and reports it, as iOS does.

### B4. Sizing

`sizing: null`, which means "not self-sizing" (`scripts/registry-core.mjs:115-128`):
- no row in `nitro-ui.sizing.json`;
- no `nuiSizingKey`/`nuiSizingId`;
- no declared fallback;
- no `measureContent`.

D17 does not apply, because the platform lays out the presented window.

### B5. Accessibility

**The view.** Neither platform exposes it. iOS sets `isAccessibilityElement = false` and
`accessibilityElementsHidden = true`. Android sets `importantForAccessibility = NO` on the host and
`clearAndSetSemantics {}` on the empty composition.

**The window.** It belongs to the platform:
- `UIAlertController` is modal to VoiceOver, which reads the title, then the message.
- The Compose `AlertDialog` window takes TalkBack focus.
- The confirmation sheet adds `semantics { paneTitle = title }` so TalkBack announces it on open. Material does not set
  one *(reading)*.

**Disabled actions.** iOS uses `isEnabled = false`; Android uses `TextButton(enabled = false)` or a disabled
`clickable`. Real input asserts `enabled="false"` in the dump. That is the check Menu's rows failed: they report
`enabled="true"` (`docs/components/menu.md`, Accessibility).

**Test ids.** `testID` stays React Native's on the view. The presented window also gets `<testID>-dialog`: iOS through
the alert view's `accessibilityIdentifier`, Android through `Modifier.testTag` with `testTagsAsResourceId` on the
dialog root, so XCUITest and uiautomator can find it.

### B6. Recycling and drop

- **`prepareForRecycle()`:** close first, without animation, through the helper (DatePicker does the same at
  `ios/components/DatePicker/HybridNitroUiDatePicker.swift:1398`). Then reset every prop, both event counts, and the
  per-mount flags.
- **`onDropView()`:** close (on iOS, through `hideImmediately` if the drop is mid-transition), then drop the callbacks.
  On Android, the host's drop disposes the composition.
- **Registrations:** none beyond the host's. The iOS completion closures do not capture `self`, for the reason
  DatePicker gives.

### B7. Harness and real-input plans

**Harness: a new `Dialog.harness.tsx` beside the other suites.** The harness cannot tap into another window
(`example/__tests__/Switch.harness.tsx:216-227`, H9/H10). So its oracles are `nuiTestStateReport()`, which is read
from the controller iOS actually built and from the Android model as composed, plus test hooks that run the real
handlers.

1. JS presents → `presented=1;live=1;actions=3;title=…`. JS dismisses → `live=0`, and no event: proved with a barrier
   twin whose `nuiTestDismiss()` does fire.
2. `nuiTestPerformAction('delete')` → exactly `action:delete`, then `presented:false`, and `live=0`.
3. A disabled action reports nothing (barrier twin). iOS reads `isEnabled == false` back from the built controller.
4. Refusal: the parent keeps `true` → `live` returns to 1 after the echo, with one dev warning.
5. Presented at mount → exactly one presentation (`presentCount=1`), after the view gets its window.
6. Drop while open, and drop 50–150 ms after presenting (the entry transition) → a fresh mount reads `live=0`, and on
   iOS `topPresented` is not an alert.
7. Recycle while open, using `example/__tests__/Recycling.harness.tsx`'s flag-on pattern → the reused view reads
   `presented=0`, with no old title or actions.
8. Inside an RN `Modal` → presents, reads `live=1`, and on iOS `presenter=<modal controller class>`. Dismissal returns
   to 0.
9. Two dialogs open at once → both counted, each closes independently, and the count returns to 0.
10. A title, message or `disabled` change while presented is reflected in place. An action-set change applies at the
    next presentation on iOS and in place on Android, and both directions are asserted so the difference is pinned.
11. Android only:
    - the confirmation variant composes a sheet (`kind=sheet;rows=N`);
    - a hosted dialog presents, and dropping the Host takes it down (`example/__tests__/HostPopups.harness.tsx`'s
      pattern).

**Real input.** iOS: `testRealInputDialog` in `example/ios/NitroUiExampleUITests/RealInputTests.swift`. Android:
`CHECKS.dialog` in `scripts/real-input/android.mjs`.
- An RN button opens the dialog. iOS finds `app.alerts[title]`; Android finds a dialog window with the title in the
  dump.
- A real tap on an action echoes `action:delete,presented:false`. Cancel echoes `presented:false` alone.
- A disabled action shows `isEnabled == false` / `enabled="false"`, and a tap on it does nothing.
- Android back and a scrim tap each close the dialog. With `dismissible={false}`, neither does.
- Confirmation form: an iOS action sheet (or the iOS 26+ anchored form, per the spike); Android rows, and a swipe down
  closes it.

**Red proofs to run.**
- Swap action-before-close → test 2.
- Drop `hideImmediately` → test 6 (DatePicker's own red).
- Drop the `dismissible` mapping → the back-key case.
- Drop `isEnabled` → test 3.

**Registry and conformance.** `component.json`: `sizing: null`, `hostable: true`, `realInput: true`. X4's a11y and
leak rules need the presentation variants named in Follow-ups.

### B8. Bench arms

- **`mount.dialog`, `memory.dialog`, `leak.dialog`** (N = 1/50/200 closed dialogs, the dialog-per-row case):
  - `rn-core` is a bare-`View` floor. RN has no declarative alert, and `Alert` is an API.
  - `expo-ui-*` is `@expo/ui/swift-ui`'s `Alert` with an empty trigger. Expo's Compose `AlertDialog` shows as soon as
    it is mounted, so the Android comparison arm for a closed dialog is the Host alone, and the report must say so.
  - The D15 target applies. If Android's closed-dialog composition misses it, the fix is to compose lazily on the first
    present, decided by measurement.
- **`present.dialog`** (the new scenario in Follow-ups): from the JS commit to the presented window's first frame (the
  iOS present completion; the Android dialog window's first pre-draw), K cycles. RN's `Alert.alert` is the `rn-core`
  peer.

### B9. Risks, and the spike questions to settle first

1. **Riskiest. iOS presenting from a plain view.** Does the presenter walk find a controller that can present in each
   case: inside an RN `Modal`, inside a react-native-screens `formSheet`, and while the screen's controller is already
   presenting? Is the dismissal still deterministic during the entry transition? Do UIKit and SwiftUI give identical
   screenshots? Where does an iOS 26/27 iPhone action sheet with a `sourceView` draw?
2. **Android at `0 × 0`.** Does a composition with no measured root compose there and open a dialog window? Does the
   window survive the host's detach? What is the cost of a closed instance at N = 200?
3. **`ModalBottomSheet` closing.** Its hide animation against a programmatic close, a drop and a recycle: no window may
   be left behind, and the witness has to return to 0.

## Appendix C — BottomSheet

### C1. Public API

```tsx
<BottomSheet isPresented={open} onIsPresentedChange={setOpen} detents={['medium', 'large']}>
  <Text>Anything React Native can render</Text>
</BottomSheet>
```

```ts
export type BottomSheetDetent = 'fit' | 'medium' | 'large' | { height: number } | { fraction: number };
export interface BottomSheetProps extends ViewProps {
  isPresented: boolean;                                  // controlled, same handshake as Dialog
  onIsPresentedChange?: (isPresented: boolean) => void;
  children?: React.ReactNode;                            // React Native content
  detents?: BottomSheetDetent[];                         // default ['fit']
  onDetentChange?: (index: number) => void;              // user drags only; report-only in v1
  onDismiss?: () => void;                                // after the sheet is gone, whichever way
  dismissible?: boolean;                                 // swipe, scrim, back; default true
  showsGrabber?: boolean;                                // default true
  cornerRadius?: number;
  containerColor?: ColorValue;
  accessibilityLabel?: string;                           // names the sheet (C7)
}
// spec: presented, mostRecentEventCount, detents: NitroUiSheetDetent[] ({ kind: string; value: number }),
// dismissible, showsGrabber, cornerRadius: number | null, containerColor: number | null,
// accessibilityLabel, testID, nuiPerfId; onPresentedChange(presented, count), onDetentChange(index), onDismissed()
```

**Content.** The content is React Native children. Data-only content is ConfirmationDialog's job. The wrapper renders
the children from `isPresented` turning true until `onDismissed`. That is Expo's `isMounted` pattern
(`expo-ui:src/swift-ui/BottomSheet/index.tsx`), so a closed sheet costs a `0 × 0` node (question F).

**Detents** use SwiftUI's words, because principle 1 says names follow the platform where they differ. The wrapper
validates and sorts them.
- The selected detent is uncontrolled in v1. A programmatic detent change needs a method with a main-thread hop (D14,
  `docs/architecture/core.md` §5), so it comes later.
- **iOS 16+** supports every kind. On **iOS 15.x** (the RN 0.86 floor), only `medium` and `large` exist; `fit`,
  `height` and `fraction` map to `large`, and that is documented.
- **Android (question E).** `m3:SheetValue` is `Hidden`/`PartiallyExpanded`/`Expanded`, nothing else.
  - `medium` → `PartiallyExpanded` (half the container height *(reading)*).
  - The largest other detent → `Expanded`: `large` with the content at `fillMaxHeight`; `fit` at the content's height;
    `{ height }` or `{ fraction }` with the content constrained to that height.
  - Asking for more than one non-`medium` detent gives a dev warning, and the largest wins.

**Events.**
- A user dismissal fires `onIsPresentedChange(false)` when the dismissal starts. `onDismiss` fires once the sheet is
  gone, and also after a programmatic close.
- A user drag fires `onDetentChange(index)`.
  - iOS: `sheetPresentationControllerDidChangeSelectedDetentIdentifier`, which is not called for programmatic changes
    (`uikit:UISheetPresentationController.h`).
  - Android: `snapshotFlow { sheetState.currentValue }`.

**Refusal** behaves as in B1.

### C2. React Native children in a presented window (the new mechanism)

Copy React Native's `Modal`, which solves the same three problems.

**Layout.**
- **RN's way:** `Modal`'s descriptor sizes its node from native state and makes it absolute
  (`rn:ReactCommon/react/renderer/components/modal/ModalHostViewComponentDescriptor.h:26-34`), and its shadow node is a
  `RootNodeKind` (`…/ModalHostViewShadowNode.h:35`).
- **Ours:**
  - A `PresentedContainerShadowNode` and descriptor. It is a new `cpp/` template, and `scripts/patch-nitrogen.mjs`
    repoints the generated aliases to it, as it already does for intrinsic sizing.
  - Its state is `{ width, height, fitsContent }`:
    - the width is the sheet's content width;
    - the height is the largest detent's height, or undefined for `fit`, which lets Yoga size the node from its
      children.
  - Native pushes that state through the same `updateState` path the sizing engine uses.

**Mounting on iOS.**
- **RN's way:** `Modal` inserts each child into its controller's view
  (`rn:React/Fabric/Mounting/ComponentViews/Modal/RCTModalHostViewComponentView.mm:311-316`).
- **Ours:**
  - Post-process the generated `.mm` to forward `mountChildComponentView:index:` and
    `unmountChildComponentView:index:` to Swift (`docs/research/core-architecture.md` §6 already planned this for
    containers).
  - The sheet's view is outside the surface's touch handler, so the sheet attaches its own `RCTSurfaceTouchHandler`, as
    `rn:…/Modal/RCTFabricModalHostViewController.mm:26,45` does.

**Mounting on Android.**
- **RN's way:** `Modal` uses a `DialogRootViewGroup` that is a `RootView`
  (`rn:ReactAndroid/src/main/java/com/facebook/react/views/modal/ReactModalHostView.kt:507-585`).
- **Ours:**
  - A hand-written `ViewGroupManager`, with `android/src/main/java/com/margelo/nitro/nitroui/NitroUiHostViewManager.kt:12-29`
    as the precedent.
  - Its `addView` redirects into a `SheetRootViewGroup` that copies RN's: a `RootView` with a `JSTouchDispatcher` and
    a `JSPointerDispatcher`, which pushes its size through state.
  - The root goes into the sheet with `AndroidView(factory = { root })`.

**Reuse.** ContextMenu (children in place), a Popover with content and, eventually, Form/List build on this mechanism.

### C3. iOS: UIKit sheet presentation

**The controller.** A `SheetController: UIViewController` whose view holds the children, presented with
`modalPresentationStyle = .pageSheet` and configured through `sheetPresentationController` (iOS 15):
- `detents`: `.medium()` and `.large()` (iOS 15); `.custom(identifier:resolver:)` (iOS 16,
  `uikit:UISheetPresentationController.h:75`);
- `prefersGrabberVisible`, `preferredCornerRadius`;
- `largestUndimmedDetentIdentifier = nil`, so the sheet is modal;
- `prefersScrollingExpandsWhenScrolledToEdge = true`;
- `invalidateDetents()` (iOS 16, `:156`) whenever the `fit` content height changes;
- `isModalInPresentation = !dismissible`;
- `presentationControllerDidDismiss` → `user(false)`.

**Why not SwiftUI.** The alternative is `.sheet(isPresented:onDismiss:content:)` with `.presentationDetents(_:selection:)`
(iOS 13 and 16, `swiftui:9145`, `:28180-28184`). But the content is UIKit views (React Native), so SwiftUI would add a
hosting controller and a `UIViewRepresentable` around them for no gain. It would also give up the deterministic
present and dismiss DatePicker learned to need, and the sheet underneath is the same `UISheetPresentationController`
either way.
- iOS 16.4's `presentationBackgroundInteraction`/`presentationContentInteraction` correspond to
  `largestUndimmedDetentIdentifier` and `prefersScrollingExpandsWhenScrolledToEdge`. Non-modal sheets are out of v1.
- iOS 27's `preferredPlacement` (`:120`) is not used.

**Presenter and lifecycle.** The B2 helper: top of the presenter chain, `hideImmediately`, live count.

### C4. Android: Material 3 `ModalBottomSheet` with an `AndroidView` root

**Host.** `SheetHost : NitroComposeHost<SheetModel>`, **not hostable**: the Host refuses React Native children by
design (`docs/components/host.md`, "What a Host cannot hold").

**Composition.** `if (model.presented) ModalBottomSheet(…) { SheetWitness(model); AndroidView({ root }, …) }`, with:
- `onDismissRequest = { model.userDismiss() }`;
- `sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = !hasMedium, confirmValueChange = { dismissible || it != SheetValue.Hidden })`;
- `shape` from `cornerRadius`, and `containerColor`;
- `dragHandle = if (showsGrabber) { { BottomSheetDefaults.DragHandle() } } else null`;
- `properties = ModalBottomSheetProperties(shouldDismissOnBackPress = dismissible, shouldDismissOnClickOutside = dismissible)`.

The signatures are 1.4.0's: `m3:ModalBottomSheetKt` (`ModalBottomSheet-YbuCTN8`), `m3:SheetState` (`show`, `hide`,
`expand`, `partialExpand`), and `m3:ModalBottomSheetProperties`.

**Closing.** A close runs `sheetState.hide()`, then the subtree stops composing. The witness counts the window's
lifetime, as DatePicker's does.

**Touches.** The window is Material's `ModalBottomSheetDialogWrapper`, a dialog with predictive back (from the class
list in the AAR). React Native children in it receive touches only through the root's `JSTouchDispatcher`.

**Nested scrolling.** An RN `ScrollView` inside the sheet has to hand a drag to the sheet at its top edge. That needs
`nestedScrollEnabled` plus `rememberNestedScrollInteropConnection()` on the `AndroidView`, and the spike has to check it.

### C5. Sizing

**No D17.** The sheet's own box is `0 × 0` and absolute (the `Modal` node), with `sizing: null`. The content's box comes
from native state, not from the sizing engine.

**The first present costs one state commit.** Yoga needs the sheet's width before it can lay out the content, which is
also what RN's `Modal` pays on its first layout.

**`fit` waits for its height.** A `fit` sheet waits for Yoga's content height before it shows, so its first frame is at
the right detent. iOS presents after the first content layout; Android calls `show()` once the root reports a height.
The spike measures whether that wait is visible.

**Rotation and iPad.** The width comes from the sheet's real content frame. It is pushed again on rotation
(`viewWillTransition` / `onSizeChanged`).

### C6. Presentation, dismissal, and how it meets RN `Modal`, navigation and recycling

- **Inside an RN `Modal`:** iOS presents from the modal's controller, which the responder chain reaches first. On
  Android, the sheet window stacks over the `Modal`'s dialog. Both are tested (C8).
- **Nesting:** a sheet in a sheet, or a Dialog in a sheet, is correct by construction, because the inner view's
  responder chain passes through the sheet's controller.
- **react-native-screens:**
  - Popping the screen drops the view, which closes the sheet.
  - Leaving the window while presented (a push on top) closes the sheet and reports it.
  - Native-stack `formSheet` stays the alternative when the sheet should be part of navigation.
- **Keyboard:** UIKit sheets move above the keyboard. Android's `contentWindowInsets` with a `TextInput` is a spike item.
  TextField itself stays out of scope (T19).
- **Recycling:** `RecyclableView` with a full reset that closes the sheet without animation before anything else.
  Fabric unmounts the children before the parent is pooled.
- **Drop:** close, detach the touch handler, release the root. On Android, the drop also disposes the composition,
  which removes the window, and clears the root's state wrapper.

### C7. Accessibility

**iOS.**
- The presented sheet is modal to VoiceOver.
- The grabber is the system's element, adjustable between detents *(reading)*.
- `accessibilityLabel` names the container view (`accessibilityViewIsModal = true`) and is posted with `.screenChanged`
  on present.

**Android.**
- `semantics { paneTitle = label }` on the sheet content, so TalkBack announces the sheet on open.
- Material's drag handle carries expand, collapse and dismiss actions *(reading)*.

**Both.** React Native content keeps React Native's own accessibility. What TalkBack and VoiceOver actually say stays a
human pass, as for Menu.

### C8. Harness and real-input plans

**Harness: a new `BottomSheet.harness.tsx`.** It cannot tap into the sheet (H9/H10). Its oracles are the content's JS
`onLayout` and `nuiTestStateReport()`.

1. `fit` with a 240-tall content → `presented=1;live=1;detent=fit;contentHeight=240±1`, and the content's `onLayout`
   reads 240. 240 is chosen because it matches no detent: `medium` is about half the screen and `large` about all of
   it, so a failed `fit` cannot pass by accident.
2. Width: the content's `onLayout` width equals the container width native reports. On a phone that also equals the
   window width, so this check only counts paired with test 1 (AGENTS' fixture rule).
3. `['medium', 'large']` → the initial detent reads `medium`. `nuiTestSelectDetent(1)` runs the delegate path →
   `onDetentChange(1)`.
4. JS dismiss → `onDismiss` once, no `onIsPresentedChange`, and the content unmounts afterwards.
5. Refusal → the sheet presents again after the echo.
6. Drop while open, and drop during the entry transition → a fresh mount reads `live=0`. On iOS `topPresented` is not a
   sheet; on Android the window count is 0.
7. Recycle while open → `presented=0`, with no children.
8. Inside an RN `Modal` → presents, and the presenter is the modal's controller.
9. Present at mount; present while out of a window, then attach.
10. Leak: present and dismiss 20 times, then unmount → `live=0`. On Android, no `LifecycleRegistry` growth (the B1 rule;
    `example/__tests__/MountChurn.harness.tsx`'s approach). On iOS, the controller is deallocated (a weak probe in the
    report).
11. A content change while presented with `fit` → the new height is reflected. Red proof: skip `invalidateDetents` (iOS)
    or the height push (Android).

**Real input.** iOS: `testRealInputBottomSheet`. Android: `CHECKS.bottomsheet`.
- A real tap on an RN `Pressable` inside the sheet echoes `pressed`. That proves the touch root. Red proof: don't attach
  `RCTSurfaceTouchHandler` / `JSTouchDispatcher`.
- Dragging the grabber up echoes `detent:1`.
- A swipe down, the Android back key and a scrim tap each echo `presented:false`. With `dismissible={false}`, none of
  them does.
- The sheet's React Native text nodes appear in its window's tree.

**Registry and conformance.** `component.json`: `sizing: null`, `hostable: false`, `realInput: true`. It needs the same
presentation variants of the a11y and leak rules as the dialog.

### C9. Bench arms

- **`present.bottom-sheet`** (the new scenario): from the JS commit to the sheet at rest with its content (the iOS
  present completion; on Android, `sheetState` settled plus a frame). It also records UI CPU per present, memory while
  presented, and the leak slope over present/dismiss cycles. The content is 20 RN `Text` rows.
  - `rn-core` is a **peer** here, not a floor: an RN `Modal` (`presentationStyle="pageSheet"` on iOS) with the same
    content.
  - `expo-ui-*` is Expo's universal `BottomSheet` (`expo-ui:src/universal/BottomSheet`) with React Native children.
- **`mount.bottom-sheet`**, closed, at N = 1/50: the cost of a sheet that is mounted but not shown.

### C10. Risks, and the spike questions to settle first

1. **Riskiest. React Native children in a presented window, on both platforms.** They have to mount (the `.mm`
   override; the `ViewGroupManager`), lay out at the sheet's width through state, and take touches through our own
   touch root. A `fit` sheet has to settle without a visible jump. One spike on both platforms with fixed content
   decides go or no-go (D19).
2. **Android behaviour:** nested scrolling between an RN `ScrollView` and the Material sheet; the keyboard with a
   `TextInput`.
3. **Post-processing coupling:** the `.mm` mount override and a new shadow-node template add to
   `scripts/patch-nitrogen.mjs`'s dependence on nitrogen's output (core-architecture R1). They hard-fail on a missing
   anchor, as the existing patches do.
4. **Platform limits, as product calls:** Android's two detents (question E); custom detents falling back to `large`
   on iOS 15.x.
5. **Competition:** `@lodev09/react-native-true-sheet` and react-native-screens' `formSheet` already present native
   sheets.
   - The differentiators are the Compose Material 3 sheet on Android, one controlled API, and safety under drop and
     recycle.
   - If the spike's bench shows parity and nothing more, stopping is a legitimate outcome.

## Appendix D — The rest of the list

**Chip.**
- Android has Material 3 `AssistChip`, `FilterChip`, `InputChip` and `SuggestionChip`.
- iOS has no chip, but two real controls cover the two jobs:
  - a filter chip is `Toggle(isOn:) { Label }.toggleStyle(.button)` (iOS 15, `ButtonToggleStyle`, `swiftui:1258-1260`);
  - an assist chip is a `Button` with `.buttonStyle(.bordered)`, `.buttonBorderShape(.capsule)` and `.controlSize(.small)`.
- It is inline and `intrinsic`. A filter chip's `selected` is a value, so it uses Switch's handshake.
- Material's selected filter chip gains a leading check, so `selected` belongs in the sizing key on Android.
- One-node semantics, the sizing key's shape and the fallback rules all come from Button. Expo ships only the Compose
  chips. It is one G round.

**Checkbox (and RadioGroup).**
- Android has Material 3 `Checkbox`, `TriStateCheckbox` (indeterminate) and `RadioButton`.
- iOS has no checkbox: `CheckboxToggleStyle` is `@available(iOS, unavailable)` (`swiftui:15783-15787`). So `Checkbox`
  renders the switch `Toggle` on iOS, which is exactly what Expo's universal `Checkbox` does
  (`expo-ui:src/universal/Checkbox/index.ios.tsx`). Indeterminate is Android-only.
- It should be its own export rather than a Switch variant, so Android announces `Role.Checkbox`.
- RadioGroup is not a new component. It is Picker's job: an Android `variant="radio"` (a column of `RadioButton` rows),
  with iOS keeping `menu`.
- Demand: `expo-checkbox` 223 k a week. Effort: a Switch clone.

**ContextMenu.**
- iOS: `UIContextMenuInteraction` on the Fabric view that wraps the React Native children. SwiftUI's `.contextMenu`
  needs SwiftUI content, so it does not fit.
  - The menu is built from Menu's `group` as a `UIMenu` of `UIAction`s, the same tree G9's probe reads
    (`docs/tasks/G9-ios-menu-untitled-group.report.md`).
  - The preview is the system's snapshot of the view.
- Android has no platform long-press menu. The design is an M3 `DropdownMenu` opened at the press point, with Menu's
  rows and its `MenuWitness`.
- It needs children in place: iOS mounts them already, and Android needs C2's `ViewGroupManager`.
- It also needs gesture arbitration, so that a `Pressable` inside does not fire `onPress` after the menu opens.
- Medium-high risk. It goes after the BottomSheet spike.

**Stepper.**
- iOS: SwiftUI `Stepper(value:in:step:)` (iOS 13, `swiftui:26296`). Android has no Material stepper; two
  `OutlinedIconButton`s around a number would be composition, not a platform control.
- A discrete value with the handshake, and `intrinsic` sizing. G1's "(+ Stepper on iOS)" in `docs/PLAN.md` was never
  built.
- Cheap, but native on one platform only, so it ranks below the two-platform controls. Ship it with the composed Android
  form documented as such.

**Toast/Snackbar.**
- Android: Material 3 `Snackbar` through `SnackbarHostState.showSnackbar`, which suspends and returns
  `ActionPerformed` or `Dismissed`. iOS has no system toast.
- It is not a view. Per `docs/research/nitro-patterns.md` pattern 11, it is an imperative HybridObject
  (`showSnackbar(options): Promise<result>`) that owns an overlay composition on the activity's decor view.
- Demand is real (`react-native-toast-message` 891 k, `burnt` 273 k), but the iOS half would be our own drawing, against
  principle 1.
- Recommend leaving it until the owner says whether an Android-only or non-native iOS component is acceptable.

**Tooltip/Popover (added; not on the brief's list).**
- iOS: `.popover` with `presentationCompactAdaptation(.popover)` (iOS 16.4, `swiftui:28191`), or the UIKit popover
  DatePicker already presents. Android: Material 3 `TooltipBox` with `PlainTooltip`/`RichTooltip`.
- A text tooltip is data, anchored to its own box the way DatePicker's popover is. A popover with content needs C2.
- Low-medium demand. It goes after ContextMenu.

**Gauge.** SwiftUI `Gauge` (iOS 16, `swiftui:25246`), with nothing on Android. A `variant="gauge"` on Progress (iOS 16+;
Material's circular indicator on Android) is cheaper than a new component. Low demand.

**ColorPicker.** SwiftUI `ColorPicker` (iOS 14, `swiftui:31262`): a swatch that opens the system picker, a
presentation the system owns, as with Menu. Android has no Material colour picker, so the Android half would be ours.
Low demand (`reanimated-color-picker` 103 k is JavaScript). Not now.

**Form/List/Section.**
- This is not a component task. It is the container architecture of `docs/research/core-architecture.md` §6: virtual
  native children and one hosting tree.
- iOS has `Form`, `List` and `Section`; Android has `LazyColumn` with Material 3 `ListItem`, and nothing like `Form`.
- D23 already showed a shared iOS hosting tree losing on mount and unmount CPU.
- It belongs after C2, as an architecture spike rather than a G task.
