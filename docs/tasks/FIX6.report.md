# FIX6 — A Form row's press is the row's alone, and opting out of keyboard avoidance changes nothing

**Branch:** `task/FIX6-form-row-press` (from `main` at `1b8d01e6`) · **Round:** 1 of up to 3 ·
**Lease:** `FIX6-4xsn7` (`emulator-5570` + iPhone Air / Metro android `9293`, ios `8293`)

## Summary

A `Form.Row` with `onPress` answered every down/up pair that reached it, so a tap on a
`Switch` inside the row flipped the switch *and* pressed the row. The row now gives up a
touch whose point belongs to a hosted nitro-ui control: it hit-tests its own children on
`ACTION_DOWN` and takes the tag every view manager puts on a hybrid view's root
(`associated_hybrid_view_tag`) as the sign that the touch is a control's. A tap beside the
control still presses the row, and the row answers again after its content has answered.
That tag rule did not survive review: fix round 1 replaced it with the host a control draws
itself in, and ran the iOS cases this round left unrun — **Fix round 1** says what the branch
does now.

Two decisions a reviewer needs. The rule is drawn around *hosted* controls, not around "a
child consumed the touch": `ReactViewGroup.onTouchEvent` returns `true` for every React
Native view, so consumption cannot tell a `Pressable` apart from plain row content. That is
measured, not assumed, and it is written into `docs/components/form.md` — React Native
content inside a pressing row answers the tap *and* presses the row. The hit-test is
geometric (the deepest visible descendant), so a tap on a control's own padding belongs to
the control: the same trade a switch trailing a Material `ListItem` makes. The row keeps
consuming through `super.dispatchTouchEvent`, so its children still see every event.

`keyboardAvoidance={false}` left one thing behind: `Form.tsx` padded its Android scroll
content by the reported IME inset whatever the prop said. The padding now honours the prop,
so opting out means what the docs say — no inset, no padding, no scroll, and the content
keeps the height and the offset it had before the keys appeared.

The same rule is implemented on iOS, where the cell's press recognizer declines a touch that
lands on a hosted control (`NitroUiHostedControl`, which `NitroSwiftUIHost` now carries), and
the three checks exist there as XCUITest cases inside `testRealInputForm`. `harness:ios` is
green on this tree, which is what shows that half compiles and that the Form's own harness
screens still hold with it in. The XCUITest cases have not been run, so the iOS half of the
press proof is owed and is not claimed here.

## Gates

Round one's rows are not repeated here. The report prints one table, regenerated for this
branch's final tree, under **Gates** in `## Fix round 2`: a second row for a gate would read
as a second run of it, and the ledger has one.

`need --for review` on round one's tree: satisfied; it asks the same three gates as the final tree.

## Red proofs

- `form.e2e.ts` "a tap on a control inside a pressing row is the control's, and a tap beside
  it is the row's" -> `HybridNitroUiFormRow.dispatchTouchEvent` left as it was (the row
  presses on every down/up pair) ->
  `ASSERTION_FAILED: getByTestId("form-row-switch-presses") expected "1", observed "2"`.
- the same test, and the React Native content test below it -> `pending = false` (the row
  answers no touch of its own) -> `ASSERTION_FAILED: getByTestId("form-row-switch-presses")
  expected "1", observed "0"` and `ASSERTION_FAILED: getByTestId("form-row-inner-presses")
  expected "1", observed "0"`.
- `form.e2e.ts` "opting out of keyboard avoidance leaves the content and its offset alone"
  -> `Form.tsx` padding its scroll content by `imeInset` whatever the prop says -> the Form's
  content sits `883` px higher at the end of its list with the keyboard up (top `1541` px)
  than with no keyboard, `expected 883 to be less than or equal to 12`.
- The iOS cases in `RealInputTests.swift` have not been run, so they have no red proof and
  the Android mutations above do not stand in for them.

## Files changed

- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiFormRow.kt`: the row gives
  up a touch whose point belongs to a hosted control.
- `ios/components/Form/NitroUiFormViews.swift`: the cell's press recognizer refuses a touch
  that lands on a hosted control.
- `ios/core/NitroSwiftUIHost.swift`: `NitroUiHostedControl`, the marker a hosted control
  carries.
- `src/components/Form/Form.tsx`: the scroll-content padding honours `keyboardAvoidance`.
- `example/src/FormScreen.tsx`: a pressing row with a `Switch` in it, one with a React Native
  `Pressable`, and a toggle for the Form's `keyboardAvoidance`.
- `example/e2e/real-input/form.e2e.ts`: the two press cases and the keyboard opt-out case.
- `example/ios/NitroUiExampleUITests/RealInputTests.swift`: the same three checks as
  XCUITest cases inside `testRealInputForm`.
- `docs/components/form.md`, `.changeset/form-row-press-and-keyboard-opt-out.md`.

## Follow-ups

- `src/components/Form/component.json`: the `form` control's title still lists only the
  checks the file had before this round; the file now also covers the press rule and the
  keyboard opt-out.
- A React Native `Pressable`, `Switch` or `TextInput` inside a row with `onPress` presses the
  row as well as answering (documented). Matching the hosted-control rule needs a way to tell
  a pressable React Native view from plain content at touch-down.
- `form.e2e.ts`: the opt-out check's content comparison allows 12 px. What it looks for is the
  IME inset — the red run read 883 px — so the tolerance hides nothing; recorded so a later
  round does not tighten it for nothing.
- The row's hit walk is geometric on both platforms: it reads layout boxes, so it ignores a
  control's `translation`/`scale`, React Native's `zIndex` drawing order on Android, and zero
  -size wrappers whose children overflow. A control moved by a transform is hit-tested where
  its box is, not where it is drawn.
- `example/src/FormScreen.tsx`: the echo bar is now 18 counters, the `echoGrid` comment still
  promises two lines of them, and the `Keyboard avoidance` toggle shares a row with
  `form-outside` at half its width. On iOS a taller bar shortens the Form's viewport.

## Questions for orchestrator

- **The iOS press proofs are owed.** `real-input:ios -- --control form` never ran: this
  worktree had no iOS app, and the first `harness:ios` refused before a test began —
  `bun run harness:ios: no app to test. build it: node scripts/build-app.mjs --platform ios`.
  After `build-app --platform ios` (227 s) the simulator ran tests at once and `harness:ios`
  passed, so nothing points at a broken simulator — the budget ran out before the XCUITest
  run. Recommend one short round on this branch: `real-input:ios -- --control form`, plus a
  mutation of `pressGesture` to prove the two new cases red. I would not merge the iOS half
  before that, since a compile-clean recogniser is not yet a measured one.
- `node scripts/gate.mjs need --for review` asks this tree for `check`, `harness:android` and
  `harness:ios` (the diff touches both platforms). Nothing in the ledger showed those as
  already green on this branch's code tree when the round started.

## Fix round 1

Android draws the line where iOS draws it: `hostedControlAt` asks whether the view under the
touch is a `NitroComposeHost` — the Compose host a control draws itself in — and not the
`associated_hybrid_view_tag` every view manager stamps on its root, which a `ContextMenu`
wrapper carries too. A `ContextMenu` around a `Text` was measured on both platforms: one
press for the row, the menu shut.

iOS had no working rule: with round one's check in place, a real tap on the switch still
pressed the row. The row now declines the press in `gestureRecognizer(_:shouldReceive:)`,
asked at the touch itself; at the recognizer's location it measured red. Three cases could
not pass as written: the row's own tap landed on its pressable, and the opt-out field was
parked where a wrong scroll would have left it (Android parks it with `revealLowInPage` now,
iOS at its list's end). The Form's other keyboard, highlight, drag and a11y cases ran, and a
`Pressable` inside a row moves both counters on iOS too.

**Gates**

Round one's table is replaced by the one under **Gates** in `## Fix round 2`; the ledger
keeps every run.

**New red proofs**

- `form.e2e.ts` "a tap on a nitro-ui wrapper of React Native content inside a pressing row is
  the row's" -> `HybridNitroUiFormRow.hostedControlAt` climbing the parents on
  `associated_hybrid_view_tag` again (what round one's tree did) ->
  `ASSERTION_FAILED: locator: getByTestId("form-row-context-presses") expected: text "1",
  observed: text "0" (match count 1)`.
- the same run, "opting out of keyboard avoidance leaves the content and its offset alone" ->
  `HybridNitroUiForm.revealFocusedRow` ignoring `avoidsKeyboardForIme`, so a Form told to
  leave the keyboard alone still scrolled for it -> `focusing the field left it 509 px from
  where it was parked […] expected 509 to be less than or equal to 2` — the field's own
  offset, the half round one's case could not fail on. Both mutations stood for that one run;
  its other six tests stayed green.
- `RealInputTests.swift` "the row of a tap that belonged to its switch" -> the row's press
  given every touch, with no `gestureRecognizer(_:shouldReceive:)` to decline one (the body
  `main` has) -> `the row of a tap that belonged to its switch: "form-row-switch-presses"
  should read "1"; it reads "2"`.
- `RealInputTests.swift` "the note field with avoidance off" -> `HybridNitroUiForm.afterUpdate`
  adding its keyboard observers whatever `avoidsKeyboard` says ->
  `XCTAssertLessThanOrEqual failed: ("287.33333333333337") is greater than ("2.0") […] the
  Form scrolled for a keyboard it was told to leave alone`. The case ran rather than skipped:
  that run's own progress line read `keyboardWindow=true`.

**Hygiene**

Ran on lease `FIX6-b3ym6` (`emulator-5570` + iPhone Air). One deviation recorded: a filtered
`real-input:android` run started while another lease showed `real-input:ios` in use; it used
only this task's emulator and adb server port.
