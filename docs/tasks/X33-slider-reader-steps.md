# X33 — Slider: screen-reader steps compare the shown value, and the step test stops flaking

**Worktree / branch:** named in your delegation message (`task/X33-slider-reader-steps`). **Round cap:** 1 round, plus at
most 2 fix rounds (D19). **Devices:** your lease (`node scripts/lease.mjs acquire --task X33 --boot --wait-minutes 240
--out <file>`, then export it). On one lease, run device gates **one at a time**: both platforms share the lease's Metro
port.

## Read first

- AGENTS.md: the perf contract, the event-count handshake, red proofs, **never `pkill`/`killall`**.
- X32's Stepper fix for the same class of bug, on branch `origin/task/X32-review-debt` (in review, not yet on
  `main`): `git diff origin/main...origin/task/X32-review-debt -- android/` and its report there.
- `android/src/main/java/**/SliderModel.kt` (`accessibilityStepToward`), its unit tests in `SliderModelTest.kt`, and
  `example/__tests__/Slider.harness.tsx` around "steps to the next legal value when a screen reader asks" (~line 1982).
- `docs/tasks/FOLLOWUPS.md` line 56: the long-standing flake of that test.

## Do

1. **The comparison** (X32 follow-up): Android's `SliderModel.accessibilityStepToward` compares the reader's target with
   the `Double` value, but the semantics node publishes a `Float`. A reader that asks for the value it was shown can be
   read as a step when the step is not exact in binary (e.g. `step = 0.1`). Compare against the value as it went through
   the float, as X32 did for Stepper. Unit tests on inexact steps, shown red first. Check that iOS's adjustable
   increment/decrement has no equivalent problem; fix it only if it does, and say which.
2. **The flake** (FOLLOWUPS:56): the third accessibility step sometimes reports the previous value. Seen as
   `expected [3, 6, 3] to deeply equal [3, 6, 9]` and `[3,6,9,6]` vs `[3,6,9,10]`, at load1 from 3 to 142. Find the cause
   (a race between the reader's action and the published progress, or the comparison above), fix it at its cause, and
   prove it. Make the race happen on purpose with a test variant that keeps the real timing, and show it red before the
   fix. Do not loosen the assertion.
3. A patch changeset if the fix is user-visible. Mark FOLLOWUPS:56 `**done by X33**` (the Slider part only) if you
   close it.

## Not in scope

Other controls' screen-reader paths, Slider API changes, and anything else. Each gets one line in your report's follow-ups.

## Gates

`check`, both `harness:*` and `real-input:android` (plus `real-input:ios` if you change iOS code), then
`need --for review`. To measure the flake, run the Slider suite filtered many times (`gate.mjs harness:android --
Slider`) before and after the fix, and put the counts in the report. Report at `docs/tasks/X33-slider-reader-steps.report.md`.
Export the ledger with `gate.mjs export --task X33`.
