FIX ROUND

# FIX6 review: `task/FIX6-form-row-press` at `5c3ffe2b`

Read: AGENTS.md, the brief, the report, `git diff main...HEAD` file by file, and the code
around each change (`HybridNitroUiFormRow.kt`, `NitroUiFormViews.swift`, `HybridNitroUiForm.swift`,
`HybridNitroUiForm.kt` IME path, `support.ts` `reveal`, the view managers that set
`associated_hybrid_view_tag`, and the iOS hybrids that are and are not `NitroSwiftUIHost`).

Hygiene: one author address (the repo identity). No AI or agent mention, home path, email,
hostname or device name in any commit or changed file. Nothing changed under `scripts/`,
`.claude/`, `AGENTS.md`, `docs/agents/` or in the shared e2e helpers. Every file the report
names exists. `need --for review` prints "satisfied" on code tree `dad86d15420f` (HEAD), and
`gate.mjs table` prints the same table as the report. PR #95 has no inline review-bot comments
yet (CodeRabbit's summary says "review in progress"), so none are cited.

`check` was **not rerun**: `lease.mjs list` showed `in use (real-input:ios)` (lease TRAIN) at the
start, at the middle and at the end of this review, so per the instructions nothing that
loads the machine was run. The ledger's green `check` is on this same code tree.

## Must fix

**M1. Android: a `ContextMenu` inside a pressing row takes every tap from the row; iOS does not.**
`android/.../HybridNitroUiFormRow.kt:294-303`. The walk climbs from the deepest view to the
row and gives the touch up at the first ancestor carrying `associated_hybrid_view_tag`. That tag
is not a "hosted control" marker: every Nitro view manager sets it, including containers that
hold React Native children in place. `NitroUiContextMenuViewManager.kt:31-34` tags its
`ReactViewGroup` wrapper, and `ContextMenu.tsx:128-142` renders its children *inside* that
wrapper. So `<Form.Row onPress={open}><ContextMenu ...><Text>Account</Text></ContextMenu></Form.Row>`
on Android: every tap lands under the ContextMenu wrapper, `pending` is never set, and the row
never presses. On iOS `HybridNitroUiContextMenu` is not a `NitroSwiftUIHost`
(only the controls listed by `grep NitroSwiftUIHost< ios/components` are), so the same row
presses there. The two platforms now disagree, and `form.md:75-77` ("gives up the ones that
land on a nitro-ui control inside it") is true of neither in this case: a ContextMenu around
plain text is not a control the person tapped. Fix the Android side to match iOS's rule: mark
the hosted *controls* (the Compose host every control uses, as iOS marks `NitroSwiftUIHost`),
not "anything a Nitro view manager created". A real-input or harness case with a ContextMenu
(or any tagged container around RN text) in a pressing row would guard it.

**M2. Android opt-out case: the scroll-offset half cannot fail.**
`example/e2e/real-input/form.e2e.ts:303-349`. The field is parked with plain `reveal`
(line 308), which accepts any spot in the safe band, and nothing asserts that the keyboard then
covers it. A field the keyboard does not cover is never scrolled, with avoidance on or off, so
`|afterFocus.y - parked.y| <= 2` holds for a Form that ignores the prop as well as for a correct
one. The brief's line 3 asks for "neither the height nor the scroll offset"; only the height
half (the ruler) is proven, and the report's red proof is for that half only. Park the field
with `revealLowInPage` as the default case does (line 147) and assert the premise
(`parked.y + parked.height > keyboardTop`), then show the offset assertion red once (for
example, leave `pendingImeReveal` ignoring `avoidsKeyboardForIme` in `HybridNitroUiForm.kt:311`).
The comment at lines 333-335 also says the field is "read again after the list has been
travelled below, so a late scroll has had half a minute to arrive"; the read at line 336 comes
*before* the travel. Make the comment or the order true.

## Nice to have

**N1.** `form.e2e.ts:384` tolerance of 12 px: it cannot hide the defect. The padding is the
IME inset, and the case itself asserts the keyboard is over 120 px tall (line 331); the red run
read 883 px. Recorded so the next round does not tighten it for nothing.

**N2.** Non-interactive hosted views also take the row's tap on both platforms: a `Progress`, or a
`ListItem` without `onPress`, inside a pressing row is a `NitroSwiftUIHost` on iOS and tagged on
Android, so a tap on it does not press the row. Consistent across platforms, but `form.md:75-83`
speaks of "a control", and an app developer will not read a progress bar as one. One clause in
the doc, or a follow-up line.

**N3.** `HybridNitroUiFormRow.kt:315-316` and `NitroUiFormViews.swift` `deepestSubview`: the
geometric walk ignores `translationX/Y`, `scaleX/Y` and React Native's `zIndex` drawing order on
Android, and skips zero-size wrappers whose children overflow on both. A control moved by a
`transform` (or an animated slide) is hit-tested at its layout box. Rare in a row; a follow-up
line is enough.

**N4.** `NitroUiFormViews.swift:298`: `gestureRecognizerShouldBegin` is UIView's own override, so it
is asked for every recognizer attached to the cell, not only those it is delegate of. It now
returns `false` for any recognizer other than `pressGesture`; before, a pressable row let them
begin. Nothing else is attached to the cell today, so this is only a trap for later; scoping the
`=== pressGesture` check to the hosted-control test (`gestureRecognizer !== pressGesture ||
...`) keeps the old answer for anything else.

**N5.** `RealInputTests.swift:5967`: the doc comment cites a project document ("the sentence in
`docs/components/form.md` is a measurement and not a hope"), which AGENTS.md "Comments" rules
out. Say what the case asserts instead.

**N6.** `form.md:82`: "Aim a control that must not press the row at a row without `onPress`" reads
oddly; "Put a control that must not press the row in a row without `onPress`".
The Pressable paragraph (`form.md:79-82`) says exactly what the report says (a React Native
`Pressable`, `Switch` or `TextInput` answers *and* presses the row), and the brief's "Decided"
allows documenting it with a follow-up line, which the report has. Only the `Pressable` half is
measured, and only on Android so far; the iOS run below measures it on iOS.

**N7.** `example/src/FormScreen.tsx`: the echo bar went from 10 to 16 counters, and the
"Keyboard avoidance" toggle now shares a row with `form-outside` (`flex: 1`, half its old
width). The `echoGrid` style comment still promises "two lines of small counters". No row
other cases read was moved inside the Form (the two new rows go at the end of Connectivity, after the
`form-switch` row, and the Network/Notes sections only shift down, which every case reaches by
scrolling), and `harness:*` and `real-input:android --control form` are green with them. On
iOS the taller bar shortens the Form's viewport, and `scrollIntoView` treats `window.minY + 150`
as the top of the reachable band; see the device list.

## What the iOS device round should also check

The XCUITest cases have never run; read closely they look sound, with these risks:

1. **Red proofs on iOS.** Restore `gestureRecognizerShouldBegin` to `isPressable` and confirm
   `assertPressInsideAPressingRow` goes red on "the row of a tap that belonged to its switch"
   (presses `2`). The worker did not measure iOS first, as the brief asked, so this run is also
   the first evidence that the old iOS behaviour pressed the row at all. If the old code already
   held on iOS, the brief says it still needs a mutation that the case catches.
2. **Opt-out on iOS.** `assertFormWithoutAvoidanceLeavesItsContentAlone` needs a mutation that
   ignores `avoidsKeyboard` in `HybridNitroUiForm.swift` and goes red on `ib`, `h` or `off`. Also
   confirm it is not ending in `XCTSkip` (no keyboard window on a host with a hardware keyboard
   connected); a skip there is "not measured", not a pass.
3. **Element lookup inside a pressable row.** The pressable cell sets `isAccessibilityElement =
   true` (`HybridNitroUiForm.swift:731`). FOLLOWUPS records XCUITest still listing the row's
   inner wrappers, so `required("form-row-switch-control")` and `required("form-row-inner-control")`
   should resolve; if they do not, the cases abort before asserting anything.
4. **The hit walk on a real SwiftUI host.** A tap on the switch must resolve, via
   `deepestSubview`, to a view under the `NitroSwiftUIHost` (the Fabric wrapper's content view).
   The red proof in item 1 shows that; a green with no red does not.
5. **The React Native Pressable case** measures the "answers and presses the row" sentence on iOS
   for the first time.
6. **Neighbours on the Form screen.** The full `testRealInputForm` (not only the new cases): the
   keyboard case, the row highlight and drag cases, and the `--a11y` Form case, with the taller
   echo bar and the two new pressable rows in the sweep's tree.
7. Re-run `check` on the merge tree; it was not rerun here (see above).
