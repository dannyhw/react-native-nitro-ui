# X31 — Three test flakes and one missing assertion

**Worktree / branch:** named in your delegation message (`task/X31-test-flakes`). **Round cap:** 1 round, plus at most
2 fix rounds (D19). **Devices:** your lease (`node scripts/lease.mjs acquire --task X31 --boot --wait-minutes 240 --out
<file>`, then export it).

## Do (each from FOLLOWUPS; each fixed at its cause, never by loosening what the test checks)

1. **`real-input:android` `hosted-picker`:** the anchor is scrolled until barely on screen, Material opens the menu
   above it, and "the menu opens below the top of the box the Host drew" fails. Scroll the anchor to mid-screen before
   the tap, and/or accept above-placement when the box leaves no room below, asserting the menu sits on the correct
   side of the anchor either way.
2. **Form harness:** assert `giveUps === 0` after the cases that exercise the stale-section paths (the churn case, E1,
   E4), shown red by restoring a give-up path.
3. **Harness tap error text:** `No view found at point (0.00, 0.00)` prints the arguments, not the resolved point
   (`HarnessUI.mm` in the harness package, read-only for us). If the harness is a dependency, wrap or post-process the
   error in our test helpers so a failure names the `nativeId` and the resolved centre; otherwise one FOLLOWUPS line
   for upstream.
4. **`scripts/__tests__/ci-workflows.test.js:902`'s 2 s budget** flakes under load: make it measure what it means
   without a wall-clock budget that load can break, or raise it with a reason.

## Gates

`check`, both `harness:*` and both `real-input:*` (the Form harness and the Android real-input runner change), then
`need --for review`. Report at `docs/tasks/X31-test-flakes.report.md`. Export the ledger with `gate.mjs export --task X31`.
