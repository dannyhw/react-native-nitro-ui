# FIX31 review (round 1)
## Verdict

**Approve.** The handshake reasoning holds, SearchField waits on a real signal, red proofs check out.

## Blocking findings

None.

## Non-blocking

1. Handshake (Q1): correct. `afterUpdate()` (`HybridNitroUiTextField.kt:792`) runs `applyWrite()`
   on every commit, count-only ones included (the revert case's `applied` proves that), and
   `reconcile()` (`core/NitroUiModel.kt:48`) refuses only while `jsEvents < nativeEvents`
   (`unreported` is never set for TextField; `composing` is decided again by `settle`). A refused
   write is never dropped for good: the commit that carries the last count also carries the
   app's latest `value`, because `useControlled` echoes and calls the handler in one callback,
   and React batches the two. So once JS catches up, `displayed == js`. A transforming handler
   (uppercase, filter) is applied on that commit; an equal value needs no write. A final
   `lastWrite == 'stale'` is a leftover record, not a wrong value. `lastWrite` is never reset by
   a no-op commit, so its last value says only how fast JS answered. No library bug in scope.
2. Fast path (Q2): the TextField case no longer types across unanswered keystrokes
   (`TextField.harness.tsx:364-373`). The fast path still has assertions in
   `SearchField.harness.tsx:451-471` (unpaced `abc`, same `NitroUiControlledValue`; it now
   waits for `jsEvents === nativeEvents`, then checks events, counts and JS value) and in the
   TextField maxLength case (`TextField.harness.tsx:423-441`, unpaced, waits for `abcde` with
   counts equal and checks `jsValues`). Like main's case, none of them forces the outrun: each
   takes that path only when the machine is slow. No deterministic coverage was lost, and
   TextField keeps no fast-path case of its own beyond maxLength. Minimal deterministic case:
   send three `imeInput('commit', …)` without awaiting between them. Then spin synchronously on
   `handle.nuiTestState()` until `nativeEvents === 3`, with a deadline; JS cannot answer while
   it spins, so every echo is behind. Then `stateWhen(text 'abc' && jsEvents === nativeEvents)`
   and assert `change:a|ab|abc`, `jsValues 'abc'`, and no `lastWrite` (it depends on batching).
   This proves `catchUp()` plus the drop on the real view. See Follow-ups.
3. `TextField.harness.tsx:380-384` repeats what the loop's last iteration established.
4. Brief deviation, disclosed and justified: option (a) asked the case to stop assuming each
   echo lands before the next key. The case now enforces that order. The literal option (a)
   cannot be pinned, because the final `lastWrite` depends on timing (point 1).

## Checks

- SearchField (Q3): `reportedWhen` (`SearchField.harness.tsx:177`) waits for
  `jsEvents === nativeEvents && text === 'abc'`. Assertions are unchanged (`:461-470`).
- Red proofs (Q4): the clone's gate logs for this branch show the hold run (19:41) red with
  `expected 'stale' to be 'none'` (TextField, test renamed `SLOW-ECHO …`) and `expected 2 to be 3`
  (SearchField), then a green run (19:42, 33 passed, 7 skipped) on a different tree. A green log
  names no tests, so the hold being present in it is taken from the report.
- No new sleep, timeout or retry. The comment (`:361-363`) says why and cites no history.
- `harness:ios`, `harness:android`, `check` pass on `494645ff`. CodeRabbit on #129: rate-limited.

## Follow-ups

- TextField/SearchField: add the deterministic outrun case from point 2 (Android first; iOS if
  `typeChar` can be fired without awaiting).
- Library: an app that sets state outside the change callback (`startTransition`, a timer,
  after `await`) gets the echo committed ahead of its `value`. `reconcile()` then applies the
  older value over newer keystrokes. The worker saw this: with a delayed `setValue` the field
  ended on `c`. DESIGN 3.5 does not mention it. Decide whether to document or handle it.
- The worker's: a deterministic `stale` case through `writers` while an event is in flight.
