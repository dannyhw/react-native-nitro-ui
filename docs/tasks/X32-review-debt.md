# X32 — Correctness debt from the Form, Stepper and Checkbox reviews

**Worktree / branch:** named in your delegation message (`task/X32-review-debt`). **Round cap:** 1 round, plus at most
2 fix rounds (D19). **Devices:** your lease (`node scripts/lease.mjs acquire --task X32 --boot --wait-minutes 240 --out
<file>`, then export it).

Each item is a `docs/tasks/FOLLOWUPS.md` line a review left on code that is already released. Fix each at its cause, with
a test shown red first (AGENTS.md). Read the FOLLOWUPS line for each before you start; the line numbers below are where
they are on `main` today.

## Do

1. **Form row press on iOS fires after a scroll** (FOLLOWUPS:299, G30 review). `NitroUiFormViews.swift`'s
   `pressGesture` starts at touch-down, recognises simultaneously with the scroll view, and calls `onPressTap` on
   `.ended` with no check on how far the finger went. So a flick that begins on a pressable row can scroll the list
   **and** fire the row's `onPress`. Apply ListItem's fix (`HybridNitroUiListItem.swift`, `pressChanged`: cancel once
   the touch travels past the slop or leaves the bounds), sharing the code if that is natural. The test is real input:
   a drag that starts on a pressable Form row scrolls and sends no press; a tap still sends exactly one. Android: check
   that the same flick sends no press there either. Fix it only if it does, and say which in the report.
2. **`docs/components/form.md` contradicts itself on iOS VoiceOver** (FOLLOWUPS:302). The API table (line 62) says the
   iOS screen-reader merge for a pressable `Form.Row` is recorded debt. The Accessibility section (line ~213) says the
   row is one element. Measure it from the XCUITest accessibility tree in real input, then make both places say what
   you measured. If it is not one element, say so plainly and do not build the merge in this task.
3. **Stepper** (FOLLOWUPS:291–293, G25 review):
   1. Android `setProgress` compares the reader's target with `publishedProgress` (a Double) where the node publishes
      `displayed.toFloat()`. Compare against the value as it went through the float, so a reader asking for the current
      value on a range with inexact stops is not read as one step up.
   2. iOS `trackBounds` passes the raw `maximumValue` while the shown value is tidied, so with `maximumValue = 0.1 + 0.2`
      the plus half stays live at the top. Tidy the bound the same way.
   3. Android's `didApplyDefault` branch sets `model.displayed` without `model.state.displayed`. Make a `defaultValue`
      and a first controlled write agree on where the control started, as iOS does.
4. **Checkbox** (FOLLOWUPS:296, CodeRabbit on #63):
   1. `Checkbox.harness.tsx` (~line 1372) should assert `probes === 0` before probing, so a regressed report reset
      cannot pass on the previous mount's count.
   2. iOS's `indeterminate` accessibility value is the English word "mixed" in every locale (`NitroUiCheckboxGlyph.swift`
      ~132, `Text(value)` with a `String`). Use what the system localises. If no system string exists, document it
      in `checkbox.md` instead.

Add a patch changeset for the user-visible fixes (1, 3, 4.2). When you're done, mark each FOLLOWUPS line you closed with
`**done by X32**`.

## Not in scope

Building the iOS VoiceOver merge for Form rows, Stepper or Checkbox API changes, other FOLLOWUPS lines, and anything
else. Each of those gets one line in your report's follow-ups.

## Gates

`check`, both `harness:*` and both `real-input:*`, then `need --for review`. Report at
`docs/tasks/X32-review-debt.report.md`. Export the ledger with `gate.mjs export --task X32`.
