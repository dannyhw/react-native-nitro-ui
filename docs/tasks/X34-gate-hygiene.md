# X34 — Gate hygiene: a leased shell can run `check`, a detached gate takes its runner with it, and two iOS real-input waits settle on state

**Worktree / branch:** named in your delegation message (`task/X34-gate-hygiene`). **Round cap:** 1 round, plus at most
2 fix rounds (D19). **Devices:** your lease (`node scripts/lease.mjs acquire --task X34 --boot --wait-minutes 240 --out
<file>`, then source it). Run device gates on one lease **one at a time**, because both platforms share its Metro port.
This worktree is new, so run `bun install` before `check`.

Each item below is a FOLLOWUPS line (the last lines of `docs/tasks/FOLLOWUPS.md`) that has cost tasks hours of re-runs.
Fix each at its cause, with a test shown red first, and never loosen what a test checks.

## Do

1. **`check` from a leased shell.** `scripts/__tests__/bench-baseline-merge.test.js` inherits `EMULATOR_PORT` (and the
   other lease variables) from the environment and dies on "ANDROID_SERIAL and EMULATOR_PORT disagree" (X32, X33).
   - Scrub the lease's variables from the child environment of every `scripts/__tests__` test that spawns a device-aware
     script. Find them all; don't fix only this one.
   - Add a guard test that runs the suite's spawning helpers with a fake lease exported.
2. **A detached gate's runner outlives its gate** (X32 incident). A `gate.mjs <gate> --background` whose `gate.mjs`
   parent died left its runner and Metro holding the emulator and the Metro port, with no ledger line. Make the runner
   go when its gate goes: a process group the gate owns and signals, and/or a parent-death check in the runner. The next
   gate on that lease must also see "a gate died without a line", not a busy Metro port. Prove it red: kill a gate's
   `gate.mjs` by pid mid-run on your lease and show what is left. **Kill only pids you started and recorded.**
3. **`lease-queue.test.js` poll race** (X33: red once, green twice). Find the race and make the test wait on state, not
   on time.
4. **Two load-sensitive iOS real-input waits** (X31):
   - the a11y sweep's "tab … is still outside the window" scroll (IconButton's tab at x 1158);
   - the Popover anchor's three-tap retry ("touch was never delivered").

   Make both settle on observed state (the tab's frame inside the window across two reads; the popover's own state)
   with a deadline, not a fixed count. Show each failing on purpose (for example a forced slow scroll, or a dropped
   first tap) before the fix.

## Not in scope

Library code, other flakes in FOLLOWUPS, and anything else. Each of those gets one line in your report's follow-ups.

## Gates

`check` (run once from a shell with your lease exported, to prove item 1), `real-input:ios` and `harness:ios` (the
iOS real-input runner and any test helpers change), plus `harness:android` and `real-input:android` if your diff
touches anything Android's runners use. Then `need --for review`. Report at `docs/tasks/X34-gate-hygiene.report.md`.
Export the ledger with `gate.mjs export --task X34`.
