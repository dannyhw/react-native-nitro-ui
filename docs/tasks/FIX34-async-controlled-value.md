# FIX34 — Does a controlled TextField lose keystrokes when the app sets its value late?

**Kind:** research · **Devices:** both ·
**Budget:** 1.5 h (a measurement on both platforms against React Native's own `TextInput`; no
library change in this task)

## Goal

Find out, by measurement, whether an app that updates a controlled `TextField` or `SearchField`
value *after* the change callback returns (a timer, after an `await`, inside `startTransition`) can
lose what the user typed, and whether React Native's `TextInput` does the same. The owner then
decides whether to fix it, document it, or leave it.

## Why

While FIX31 was being proven, delaying the test's `setValue` made the field end on "c" instead of
"abc". `useControlled` (`src/core/useControlled.ts`) echoes `mostRecentEventCount` in the same
callback that calls the app's handler. If the app's `value` arrives in a later commit, the echo
commits first with the old `value`, the counts are equal, and `reconcile()` applies that older value
over newer keystrokes. `docs/DESIGN.md` 3.5 does not cover the case. React Native's `TextInput`
echoes its own count from internal state and may have the same limit. Beating `TextInput` is the
bar.

## Behaviour (what the report must answer)

1. For `TextField` (Android, iOS), `SearchField` (Android, iOS) and RN `TextInput` (both): type
   "abcdef" at the harness's normal speed. The app sets `value` in four ways: synchronously in
   `onChangeText`, after `setTimeout(…, 0)`, after `setTimeout(…, 50)`, and inside `startTransition`.
   Record the final text shown, the final JS value, and any flicker you can observe (intermediate
   values the field showed).
2. A table of the results, plus one paragraph on the mechanism for each library: why it does or
   does not lose text, citing code lines.
3. A recommendation, with cost, for each of: (a) document it in `docs/DESIGN.md` 3.5 and the
   component docs; (b) a library change, such as holding the echo until the app's value commits or
   accepting a `value` only when it is newer than the displayed text, with what it would risk; (c)
   leave it.

## Proof

- The measuring code is a throwaway harness case or example screen, run with filtered
  `harness:<platform> -- <file>` runs. It is not committed. The report quotes the readings.
- The report is the deliverable. `check` passes on the branch (docs only).

## Out of scope

- Any library change; other controls (Slider, Switch).
- `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/`, shared e2e helpers.

## Decided already

- Measure, don't reason alone. If a reading is ambiguous, run it again rather than guess.

## Context

`src/core/useControlled.ts`, `src/components/TextField/TextField.tsx` (`mostRecentEventCount`),
`android/src/main/java/com/margelo/nitro/nitroui/core/NitroUiModel.kt` (`reconcile`),
`ios/core/NitroUiModel.swift`, `docs/DESIGN.md` 3.5. React Native's `TextInput` source lives in
the example's `node_modules/react-native` (read only).
