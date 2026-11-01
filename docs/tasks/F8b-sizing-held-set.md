# F8b — Finish F8's sizing-engine fix: the held set's capacity cliff and one false red proof

**Worktree / branch:** F8's worktree and branch, `task/F8-ci-harness-hosted` at `8f05a44`, continuing PR #12.
**Round cap:** 1 round, plus at most 1 fix round. **Devices:** your lease (`lease.mjs acquire --task F8b --boot`).

Read first: `docs/tasks/F8-ci-harness-hosted.report.md`, "Fix round 2". That round fixed two leak routes in
`cpp/NitroUiSizingEngine.cpp`: a late layout after `forget()`, and an unbound row whose mount never arrives. It
also kept a re-shown view (`display: none` → shown, same id) correctable through a one-second "held set". A
review confirmed the mechanism, the thread safety, the timing and the leak closure. These are left:

## Must fix

1. **A false red proof.** `testAMountThatFilesBeforeItBindsSurvivesItsOwnWindow`
   (`scripts/native-tests/sizing.test.cpp:~752`) uses ids 5900/5910. The burst test (~484) forgets 5100–6099,
   leaving 5588–6099 marked finished in the 512-slot table. So `measure(5900)` takes the held path, not the
   unbound path, and deleting `waitingForBind_.erase` in `registerInstance` leaves it green.
   - Move its ids out of every earlier forgotten range (the reviewer used 35900/35910).
   - Assert `unboundFilingCount()==1` right after the measure, so a collision can't hide again.
   - Show red with the `waitingForBind_.erase` mutation.
   - Check the other new tests for the same id collision.
2. **The capacity cliff loses corrections.**
   - At `kLateFilingCapacity` (256), `stageLateFilingLocked` (`cpp:~331`) evicts the oldest held entry even when
     it's still inside its window.
   - Overflow past `kUnboundFilingCapacity` (1024) is demoted into that 256-slot set.
   - Reproduced:
     - re-showing 300 controls in one commit gives only 256 corrections;
     - a first commit of 1,324 unbound layouts gives only 1,280.

   That's a regression from before F8, which leaked but still corrected. Fix it so nothing inside its window is
   evicted for capacity. One option is to evict only entries past their window, so the set is bounded by the rate
   over one second. Keep a hard ceiling only as a memory backstop, sized well above any realistic single commit,
   and say what happens at the ceiling. Add native tests with more re-shows than the old cap (e.g. 300), and a
   first commit above 1,280. Show each red against `8f05a44`.

## Also

3. `flush` closes the unbound window but never prunes the held set (`cpp:~935`). Call `pruneLateFilingsLocked()` in
   `flush`, and assert `lateFilingCount()==0` in the flush-only and Picker-shaped tests.
4. A bind more than about 2 s late (1 s unbound + 1 s held) loses its correction. Either have `registerInstance`
   with no ledger row force a fresh measure or correction, or show why that's unsafe and record a follow-up.
5. Stale comments: `cpp:~679-683` (report "claims held entries", "the ring's width rather than a timer") and
   `hpp:~579,584` ("id horizon").
6. Trim `.changeset/f8-sizing-forget-is-final.md` to user-visible effects, in two or three sentences, with no
   engine internals.
7. Bound `emulator -accel-check` in `ci.yml:~287`.

## Gates

`check` (`test:native` runs under ASan/UBSan), both `harness:*`, then `need --for review`. Append a `## F8b`
section to `docs/tasks/F8-ci-harness-hosted.report.md` (200 words or less), with red proofs one line each, and
re-export the ledger.

## Not in scope

Anything outside the sizing engine's held-set and unbound handling and the items above.
