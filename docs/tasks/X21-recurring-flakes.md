# X21 — The four flakes that keep costing merge rounds a re-run

**Worktree / branch:** named in your delegation message (`task/X21-recurring-flakes`). **Round cap:** 1 round, plus
at most 2 fix rounds (D19). **Devices:** your lease (`node scripts/lease.mjs acquire --task X21 --boot`).

## Why

Nearly every merge round in the last two weeks re-ran at least one device gate for a failure nobody's diff caused.
Each re-run costs 10–40 minutes of a device pair. E5 fixed the Slider drag one at its cause. These four are left:

1. **iOS real-input, `testRealInputTextField`:** `frozen: 1 edits refused` where the check wants `2`
   (`example/ios/NitroUiExampleUITests/RealInputTests.swift`, around line 3721). Seen in X19, E2, E3, G16 and E5. E5
   suspects the check assumes one edit per typed character and never retries a keystroke.
2. **Android harness, `BottomSheet · 50 cycles`:** mounted 9 of 10. Seen in E2, FIX4 (twice) and others.
3. **Android real-input, `goToScreen`:** a slow tab arrival (seen at `hosted-date-picker`) aborts the whole run
   instead of looking again.
4. **Android harness, `Slider › steps to the next legal value when a screen reader asks`:** `expected [3, 6, 3] to
   deeply equal [3, 6, 9]` (FOLLOWUPS).

## Read first

AGENTS.md (red proofs, **never `pkill`/`killall`**, "every failure leaves evidence"), `scripts/gate.mjs`'s header
(`logs --failed --all`), `scripts/real-input/*`, and the committed failure excerpts: `docs/tasks/*/failures/*.log`
(grep for each failure's text).

## Do

For each of the four:
1. **Find the cause** from the evidence: the retained gate logs (`node scripts/gate.mjs logs --failed --all`) and
   the committed excerpts. Count how often it failed and on which machines and loads, and quote the lines that show
   the cause.
2. **Fix the cause.** Don't loosen an assertion, lengthen a timeout on its own, or add a blind retry.
   - A retry is acceptable only where the real system can drop an input, the retry is counted and reported the way
     real-input press retries are, and the report says why the input can be dropped.
   - If the cause is in the product (a real race in BottomSheet or Slider), fix the product and say so: that's a
     bug users can hit.
3. **Prove it.**
   - **Red:** a reproduction that makes the failure happen on demand (load, a slowed step, a forced ordering)
     against the old code, and passes with the fix.
   - **Green:** the gate run repeatedly. At least 5 back-to-back runs of the affected test, filtered runs allowed
     (`gate.mjs harness:android -- BottomSheet`), with no failure. Put the counts in the report.

If one of the four can't be found or fixed inside the round, say what you learned and leave it as one FOLLOWUPS line.
Don't widen the task.

## Not in scope

Anything else, which goes as one FOLLOWUPS line.

## Gates

`check`, both `harness:*` and both `real-input:*`, then `need --for review`. Report at
`docs/tasks/X21-recurring-flakes.report.md`, with a table at the top: flake, runs seen failing, cause, fix, and
proof. Export the ledger with `gate.mjs export --task X21`.
