# FIX6 — A Form row's press is the row's alone, and opting out of keyboard avoidance changes nothing

**Kind:** bugfix · **Devices:** both ·
**Budget:** 5 h for round one (an estimate: FIX5, one platform and no library change, took 2 h 45 min)

## Goal

A tap on a control inside a `Form.Row` with `onPress` no longer also presses the row, and
`keyboardAvoidance={false}` leaves the Form's content size alone when the keyboard shows.

## Why

Two `docs/tasks/FOLLOWUPS.md` lines ("a pressable `Form.Row` also fires `onPress`", "`Form.tsx`
pads the scroll content"), read from the code: the Android row fires on every down/up pair it
sees, and the padding ignores the prop. iOS is unmeasured.

## Behaviour

1. A real tap on a `Switch` inside a row with `onPress` flips the switch and reports its change
   once; the row's `onPress` does not fire. Same on iOS and Android.
2. A real tap on that row beside the switch still presses the row once and leaves the switch.
3. With `keyboardAvoidance={false}`, showing the keyboard changes neither the height nor the
   scroll offset of the Form's content, on both platforms. The default still moves a covered field.
4. `docs/components/form.md` says which of the row and a control inside it answers a tap, and
   what `keyboardAvoidance={false}` leaves to the app.

## Proof

- `form.e2e.ts` gains a case for lines 1 and 2, green under `-- --control form` on both
  `node scripts/gate.mjs real-input:android` and `node scripts/gate.mjs real-input:ios`.
- A test for line 3 that fails when the content is padded with the prop off, in the real-input
  file or the harness, wherever the keyboard inset it reads is a real one.
- Each new assertion shown red once: restore the old behaviour, or on a platform where nothing
  needed fixing, mutate what it guards. One line each in the report.
- The harness gates on both platforms, a patch changeset, `node scripts/gate.mjs check` passes
  and `node scripts/gate.mjs need --for review` prints nothing missing.

## Out of scope

- The other Form lines in FOLLOWUPS (the `onImeInset` setter, `requestChildRectangleOnScreen`,
  the global iOS keyboard observers, stale comments, the iOS row's accessibility elements).
- `scripts/`, and the shared e2e helpers (`support.ts`, `os-tree.ts`, `reader.ts`, `keyboard.ts`,
  `device-read.ts`, `press-feedback.ts`). If a proof needs a change to one, stop and ask.

## Decided already

- The control wins, as a switch in a `UITableView` cell or trailing a Material `ListItem` does.
- Measure iOS first. If it already holds, it still gets the test and a mutation.
- A React Native `Pressable` inside a row with `onPress`: measure both platforms and document
  it. Make it match line 1 if that costs under an hour; otherwise one follow-up line.
- The row's pressed highlight during a tap on an inner control is not part of the proof.
- Opting out means the Form does nothing for the keyboard: no padding, no scroll.
- New fixtures go on `example/src/FormScreen.tsx` without moving the rows other cases read.

## Context

`HybridNitroUiFormRow.kt` (`dispatchTouchEvent`), `ios/components/Form/NitroUiFormViews.swift`
(`pressGesture`), `src/components/Form/Form.tsx` (`imeInset`), `HybridNitroUiForm.swift`
(`avoidsKeyboard`), `example/src/FormScreen.tsx`, `example/e2e/real-input/form.e2e.ts`,
`example/__tests__/Form.harness.tsx`, `docs/components/form.md`.
