# FIX26 — Two more tests wait for the value they read

**Branch:** `task/FIX26-more-timing-reads` (from `main` at `8c42b8c`) · **Round:** 1 of up to 3 ·
**Lease:** none — the acquire queued for 8 minutes and never got a pair; both pairs were held by
merge `real-input` runs with hours of TTL left. No device work ran.

## Summary

Both reads the brief names now wait for the value they read.

`SearchField › submits on the Search key, then blurs` waited for the field's own report to say
`!focused`, then read the JS event log once. Submit and blur have no event counter, so the file has
a new `logReached(id, expected)`: it polls the log until it holds as many entries as expected, then
returns it, and the case asserts the same six-entry list as before. Its timeout is the file's usual
5000 ms and its poll the usual 20 ms; nothing is retried and no sleep was added. A log that never
fills throws with the entries it holds and the entries still missing.

`HostPopups › opens two popup owners in one Host` read `picker.selectedIndex` straight after the
pick and the menu report returning to closed. The menu closing says nothing about the app's write,
which lands on a later commit, so that read now goes through the file's existing `indexReached` and
asserts `2` as it did. The assertion is unchanged.

No library code, no other case, no shared helper and no assertion changed.

The device half of the Proof section is **not done**: the two red proofs, `harness:ios` and
`harness:android`. `lease.mjs list` showed `FIX24` and `X62` holding both pairs in
`real-input:android`, each planning a `real-input:ios` run next (which must run alone on a quiet
machine), so no lease was available and no build was started either. The queued acquire was stopped
rather than left to boot a pair unattended. `check` is green on this code tree, which is all of
`need --for review` that does not need a device.

The next round with a lease owes four runs, in this order, from one both-platform lease with both
apps built first so the stamps stay fresh: the SearchField mutation, the HostPopups mutation, then
the two full harness gates.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2214 tests / 100 suites | `723e4719144d` | 1 m 02 s | start 105.8 / med 69.3 / max 105.8 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | **PASS** (from `merge/FIX22-FIX23`) | — | `af6676d243db` (real-input:ios digest) | 45 m 19 s | start 3.3 / med 6.0 / max 66.7 |
| `real-input:android` | **PASS** (from `merge/FIX22-FIX23`) | 76 tests / 28 suites | `af6676d243db` (real-input:android digest) | 37 m 46 s | start 9.8 / med 5.9 / max 12.2 |

`need --for review`: need: 2 gate(s) missing for review: harness:ios, harness:android.

## Red proofs

Not run: both mutations need a device and no lease came. Prepared, JS-only, one line each, reverted
the same run — the app stamps stay fresh through them because neither touches native code:

- `SearchField › submits on the Search key, then blurs` -> in `src/components/SearchField/SearchField.tsx`,
  `useStableCallback(onSubmitEditing ?? onSubmitNotProvided)` becomes `useStableCallback(onSubmitNotProvided)`,
  so no `submit:` reaches the log -> expected red at the `logReached` call, from the new error line
  `SearchField submitted: log holds [...5 entries...] after 5000ms; still missing ["submit:tea"]`.
  Run: `node scripts/gate.mjs harness:android -- SearchField`, then `git checkout -- src/components/SearchField/SearchField.tsx`.
- `HostPopups › opens two popup owners in one Host` -> in `TwoPopupOwners`, the picker's
  `onChange` refuses index 2 (`if (event.index !== 2) setIndex(event.index)`), so the app's write
  never reaches the control -> expected red at `expect(await indexReached(picker, 2)).toBe(2)`, from
  `No answer for "the hosted picker to hold index 2" within 8000ms`. Run:
  `node scripts/gate.mjs harness:android -- HostPopups`, then `git checkout -- example/__tests__/HostPopups.harness.tsx`.

## Files changed

- `example/__tests__/SearchField.harness.tsx`: new `logReached`, and the submit case waits through it.
- `example/__tests__/HostPopups.harness.tsx`: the two-owner case reads the index through `indexReached`.

## Follow-ups

- `perf:renders`: `DatePicker.perf-test.tsx` failed its 5000 ms jest timeout on the first `check` in
  this fresh worktree and passed the one rerun; green since, on the same tree.
- `HostPopups › opens its dialog as a window of the Host's composition`: `FIX24`'s lease note records
  it red in its own merge run, a menu left open on exit, with the Android fix in that diff; the fix
  is not in this base. Red here too would be FIX24's, not this diff's.

## Questions for orchestrator

- The code change and `check` are done; four device runs are owed. Options: (a) hand this branch the
  next free both-platform lease and let it run the two mutations and both harness gates back to
  back — recommended, since nothing else is left to do and the tree is stable so one build of each
  app serves all four runs; (b) re-base onto whatever `main` is then, which costs a rebuild of both
  apps and a fresh `check`.
