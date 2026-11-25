# FIX37 — The in-Form ListItem press case counts only its own press

**Branch:** `task/FIX37-listitem-late-press` (from `main` at `0db5b849`) · **Round:** 1 of up to 3 ·
**Lease:** `FIX37-bl598` (`iPhone Air` + `emulator-5570` / Metro `8293` / `9293`)

## Summary

The Android check was failing on a press it did not make.

The case presses the standalone `bare-item`, then waits only for that row's highlight to
*paint* — native state read back through `nuiTestLayoutReport()`. The press event that press
raised travels to JS on its own schedule. The case then takes `from = events.length` and
activates the `Form.Row`. On a slow runner `bare-item:press` lands after that index, so the
slice holds two events and the exact-equality assertion fails with `Array(2)` — the recorded CI
failure, at the recorded line.

Reproduced rather than assumed: a test-only 250 ms delay on the bare item's press delivery
reds the case as it stands, with that message on that line, and is green once the case waits
for the event — which says the surplus event was the bare item's own press. The competing
candidate, one row activation pressing the item twice, is not what the delay produces, and the
case still catches it: a handler that pushes `form-item:press` twice reddens it and names both
events.

The case now waits for `bare-item:press` to reach JS before it counts the row click, and in
doing so asserts the standalone press told the app exactly once. What the row assertion
requires is unchanged — one `form-item:press` from one `ACTION_CLICK`, same 400 ms quiet period
— and no timeout got longer, no retry appeared, no equality got looser. Both press assertions
now carry the events they counted in their failure message, so the next failure names what
arrived instead of printing `Array(2)`.

No library change. The full `harness:ios` and `harness:android` gates ran the `ListItem` suite
with every other suite, so they cover the filtered runs the brief names.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2267 tests / 106 suites | `5cdd550b07b9` | 1 m 02 s | start 19.1 / med 23.8 / max 26.1 |
| `harness:ios` | **PASS** (completed: 1 of 30 units re-run, attempt 1) | 88 tests / 1 suites | `5cdd550b07b9` (harness:ios digest) | 2 m 47 s + full run 13 m 00 s | start 2.9 / med 4.7 / max 5.8 |
| `harness:android` | **PASS** | 681 tests / 31 suites + isolated 6 tests / 3 suites | `5cdd550b07b9` (harness:android digest) | 18 m 23 s | start 3.9 / med 4.6 / max 6.2 |
| `real-input:ios` | **PASS** (from `merge/picker-name`) | — | `4cc109cd30e4` (real-input:ios digest) | 44 m 18 s | start 2.8 / med 3.9 / max 16.1 |
| `real-input:android` | **PASS** (from `merge/picker-name`) | 76 tests / 28 suites | `3fede299759f` (real-input:android digest) | 40 m 47 s | start 7.2 / med 2.9 / max 7.2 |
| `harness:android:ListItem` | **PASS** | 8 tests / 1 suites | `5cdd550b07b9` (harness:android digest) | 14.7 s | start 4.1 / med 4.4 / max 4.6 |
| `harness:ios:ListItem` | **PASS** | 8 tests / 1 suites | `5cdd550b07b9` (harness:ios digest) | 15.6 s | start 8.8 / med 13.1 / max 13.1 |

`need --for review`: `need: review is satisfied on this code tree.`

## Red proofs

- `ListItem.harness.tsx` -> `draws no insets, container or highlight of its own inside a
  Form.Row` before the change -> 250 ms `setTimeout` around the bare item's `events.push` ->
  `expected [ Array(2) ] to deeply equal [ 'form-item:press' ]` at the row-activation
  assertion, which is the CI failure reproduced on device.
- Same case with the change -> the same 250 ms delay -> green: `Tests: 8 passed, 8 total`.
- Same case with the change -> `recordPress` pushes `form-item:press` a second time for
  `form-item` -> `one activation of "form-row" should press the item once, saw
  ["form-item:press","form-item:press"]: expected [ Array(2) ] to deeply equal [
  'form-item:press' ]`.

## Files changed

- `example/__tests__/ListItem.harness.tsx` — the case waits for the press event of the press it
  made, and its press assertions name every event they counted.

## Follow-ups

- harness `waitForEvents`: an event delivered later than the 400 ms quiet period after the
  row's own event still lands outside every window; this fix covers delivery before the count,
  which is what the two CI logs showed.
- Flaky: `Conformance.harness.tsx` — suite failed to run, the app exited while it was being
  prepared, 2026-11-25, `harness:ios` start 16:21:24Z; green re-run on its own, with the
  Android gate no longer running beside it.
