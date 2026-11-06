# X20 — A real-input false green, an iOS lease that touches Android, and older iOS runtimes in the pool

**Worktree / branch:** named in your delegation message (`task/X20-gate-and-pool-fixes`). **Round cap:** 1 round, plus
at most 2 fix rounds (D19). **Devices:** your lease, only to prove items 2 and 3.

## Read first

AGENTS.md (the gate rules, red proofs, **never `pkill`/`killall`**, the lease rules), the header of
`scripts/lease.mjs` and `scripts/gate.mjs`, CONTRIBUTING "Leasing a device or port", and `docs/DECISIONS.md` D13 and
D42 item 1.

## Do

1. **A false green in Android real-input.** `scripts/real-input/android.mjs` catches `AbortedCheck` and moves on,
   assuming `t.log.abort` already recorded the failure (`scripts/real-input/report.mjs`). A bare `throw new
   AbortedCheck(...)` therefore passes the whole run. E1 hit this: one run reported PASS on a check that never ran.
   - Make an `AbortedCheck` the log never recorded count as a failure, or make the class impossible to throw from
     outside `report.mjs`.
   - Do the same for the iOS runner if it has the same catch.
   - Red proof: a check that throws a bare `AbortedCheck` must turn the run red.
2. **An iOS-only acquire touches the emulator.** Q9 took a lease for iOS only, yet `lease.mjs acquire` printed `pm
   clear` on the pair's emulator. Find out what the acquire does to a device the task didn't ask for, and stop it from
   touching (clearing, resetting, launching on) the other platform's device when the task asks for one platform.
   - Show the fix with a unit test where the lease code allows. Otherwise show it with a logged run, before and
     after.
3. **Older iOS runtimes for look checks (D42 item 1).** Make simulators on the other installed iOS runtimes (here 26.5
   and 27.1, whatever `xcrun simctl list runtimes` shows) leasable for short iOS-only checks. For example, `lease.mjs
   acquire --task <ID> --ios-runtime 26.5 --boot` hands out one simulator on that runtime, created by `doctor.mjs
   --setup` like the pairs.
   - They're for screenshots and probes. They never run the merge gates, and the default pairs are unchanged.
   - Document this in CONTRIBUTING.
   - Respect the lease's lifecycle rules: release leaves them booted, and only `reap` powers them off.

## Tests

Each item needs a red proof. The lease and gate scripts have unit tests under `scripts/__tests__`, so extend them.

## Not in scope

Anything else: one FOLLOWUPS line.

## Gates

`check`. The device gates aren't needed for script-only changes outside the platform halves; `need --for review`
says what is. Report at `docs/tasks/X20-gate-and-pool-fixes.report.md`. Export the ledger with `gate.mjs export --task
X20`.
