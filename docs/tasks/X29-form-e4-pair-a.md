# X29 — Form's E4 harness case is red on one simulator only

**Worktree / branch:** named in your delegation message (`task/X29-form-e4-pair-a`). **Round cap:** 1 round, plus at
most 2 fix rounds (D19). **Devices:** your lease (`node scripts/lease.mjs acquire --task X29 --boot`); you need the
pair whose iOS simulator is "nitro-ui A" (see `lease.mjs list`), so wait for it or acquire when it is the free one.

## The problem

`example/__tests__/Form.harness.tsx` "aims a row content at its Yoga origin on iOS and presses it on Android (E4)"
fails on pair-a's iOS simulator ("nitro-ui A") with `expect(probe.log.pressable).toBe(0)` → 10, even on `main`'s own
code (X25 restored the Form files and the harness to the base and it still failed there, in isolation). The same case
passes on pair-b's simulator ("nitro-ui B"), and every recent merge ran its `harness:ios` on pair-b. Both simulators
report the same runtime, locale and accessibility preferences. Evidence: X25's report (`origin/task/X25-form-ios-bench-crash`,
`docs/tasks/X25-form-ios-bench-crash.report.md`) and `node scripts/gate.mjs logs --branch task/X25-form-ios-bench-crash
--failed`.

## Do

1. Find what differs between the two simulators that changes E4's outcome: device model and screen size, the
   simulator's own state (stale app data, a hardware-keyboard or pointer setting, Dynamic Type, display zoom), a
   timing difference, or something in the test that depends on screen geometry.
2. If it's the simulator's state, make the lease's reset (or `doctor.mjs --setup`) put both pairs in the same state,
   and say so. If it's the test (an assumption about screen size or timing), fix the test without weakening what it
   checks. If it's a real Form bug that only some devices show, fix it in Form with a red proof.
3. E4 green on both pairs' simulators, run on each.

## Gates

`check`, `harness:ios` on pair-a and on pair-b (filtered `-- Form` runs are fine as evidence, plus one full
`harness:ios`), and `harness:android` if any shared test or Form code changes. Then `need --for review`. Report at
`docs/tasks/X29-form-e4-pair-a.report.md`, cause first. Export the ledger with `gate.mjs export --task X29`.
