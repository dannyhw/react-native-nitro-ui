# FIX22 — Tests wait for the value they read instead of racing it

**Branch:** `task/FIX22-ci-timing-reads` (from the tip of
`task/FIX21-search-field-app-language`, `main` at `fd0ba95`) · **Round:** 1 of up to 3 ·
**Lease:** `FIX22-702lx` (`emulator-5570` + `iPhone Air` simulator / Metro `9293` and `8293`)

## Summary

Three CI cases passed only on a fast machine because each read a value before the signal that
produces it had arrived. All three now wait for their own signal, and every assertion is the one
that was there before: same expected values, same counts, same "no other event" checks.

- The SearchField clear pair waited for the field's own report (`text === ''`) and then read the
  JS event log at once. Both platforms publish the report before the event reaches JS, so the log
  could still be one short (`expected [] to deeply equal ['change:']`), or — in the reverse case —
  the clear's event could land after the moment the "no further events" count was taken
  (`expected ['change:'] to deeply equal []`). A new `reportedWhen` helper waits for the report
  *and* for the field's event counts to agree: `jsEvents` is the count `useControlled` echoes back
  with the commit that ran the app's callbacks, so once it equals `nativeEvents` the app has been
  told every change native published. The wait is on the change channel, which is what a clear is;
  focus, blur and submit are not counted, which is why the submit case is not rewritten this way.
- The hosted Picker read `picker.selectedIndex` after waiting for its menu to close. A pick closes
  the menu natively, and React's `setIndex` reaches the control on a later commit, so the closed
  menu said nothing about the index (`expected 1 to be 2`). The three reads after a pick now go
  through `indexReached`, which polls the control's own `selectedIndex` with the file's usual
  8 s answer timeout.
- The Slider real-drag case read the echoed value once, straight after a swipe that took 1.7 s on
  CI, while the screen already showed the moved value. `settledValue` reads until the echo has
  moved off the value the drag started from and two reads 250 ms apart agree — the value at rest —
  with a 20 s budget, and the two number assertions are untouched.

No library code changed, and nothing was loosened: no fixed sleep replaced a wait, no retry added.
What round 1 did raise was one timeout — the 20 s budget on the Slider wait — which Fix round 1
took out, so nothing on this branch waits longer than the timeout its file already used. The waits
poll the value each case asserts a moment later, so a value that never arrives fails with a message
naming the drag or the pick it was waiting for.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2191 tests / 97 suites | `f01e11f8da75` | 59.4 s | start 4.5 / med 7.1 / max 7.9 |
| `harness:ios` | **PASS** | 620 tests / 30 suites + isolated 6 tests / 3 suites | `f01e11f8da75` (harness:ios digest) | 16 m 42 s | start 6.8 / med 6.2 / max 11.6 |
| `harness:android` | **PASS** (completed: 1 of 31 units re-run, attempt 1) | 27 tests / 1 suites | `f01e11f8da75` (harness:android digest) | 32.9 s + full run 18 m 18 s | start 7.5 / med 8.0 / max 9.7 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:android:SearchField:HostPopups` | stale | 7 failed of 42 tests / 2 suites | efc0e4dd1d50 (not this tree) | 1 m 43 s | start 10.3 / med 10.6 / max 15.5 |
| `real-input:android:--control:slider` | **PASS** | 1 tests / 1 suites | `f01e11f8da75` (real-input:android digest) | 10 m 11 s | start 10.8 / med 7.5 / max 15.8 |

`need --for review`: `need: review is satisfied on this code tree.` The two real-input gates are
deliberately left for merge; the brief's `real-input:android -- --control slider` row above is the
filtered proof run, which satisfies nothing else.

## Red proofs

- `SearchField > reports the clear button as one empty edit and keeps the focus` -> in
  `TextFieldModel.observe`, the change counted and published for the clear is never sent to JS
  (`state.user` runs, `onChange` is skipped) -> red at the new wait:
  `SearchField cleared: the clear, and every event reported to JS never happened; last report
  {"text":"","focused":true,"nativeEvents":3,"jsEvents":2,…}`.
- `SearchField > takes no submit from a Return pressed on a query it has just cleared` -> the same
  dropped clear event -> red at the same wait, before the count is taken:
  `SearchField recleared: … never happened; last report {"text":"","nativeEvents":3,"jsEvents":2,…}`.
- `Host · a hosted Picker's menu is a window of the Host > a row closes it, the handshake holds,
  and a refusal still closes it` -> `HybridNitroUiPicker.selectedIndex`'s setter refuses the write
  (`state.js` keeps what it held) -> `No answer for "the hosted picker to hold index 2" within
  8000ms`; the `toBe(0)` read after the second pick goes red on the same mutation.
- `Host · … > relays the rows when the options change while it is open` -> the same refused write
  -> `No answer for "the hosted picker to hold index 4" within 8000ms`.
- `real-input/slider.e2e.ts > a real drag moves the Slider and the value JS echoes follows it` ->
  `SliderModel.dragTo` quantises `displayed` instead of the sampled value, so the drag moves
  nothing -> `real-input: the drag from a quarter to four fifths of the track never moved the echo
  - the echo never settled away from "0.250", it reads "0.250"`.

Those two mutated runs (one filtered `harness:android`, one filtered `real-input:android`) also
turned neighbours red for reasons the mutations explain: the one-shot "drop this change" flag
leaks across a recycled view, so `submits on the Search key` lost `change:t`, and the refused
picker write also reaches `opens two popup owners…` and `follows all seven when two of them trade
places`. Neither mutation is on the branch.

## Files changed

- `example/__tests__/SearchField.harness.tsx:177`: `reportedWhen`, used by both clear cases.
- `example/__tests__/HostPopups.harness.tsx:199`: `indexReached`, used by the three reads that
  follow a pick.
- `example/e2e/real-input/slider.e2e.ts:21`: `settledValue`, used for both drags; the starting
  value is read once through `textOf` so the wait knows what the drag moved away from.

## Follow-ups

- Flaky: `Form section drawing (E2, Android) > reserves a band with its padding and draws into a
  layer as tall as its section (E2)`, 2026-11-20, `harness:android` started 00:05:05Z — one failure
  of 678, the file passed alone on the single rerun the flake skill allows. It failed in the full
  run and passed on its own, which is the sequence-dependent shape rather than a slow machine.
- `check` was red once at 23:44 with two `scripts/__tests__` failures, run while this worktree's
  own `bun install` was still regenerating `nitrogen/generated` under it; the green run above is on
  a quiet tree.
- `example/__tests__/HostPopups.harness.tsx:911`: `expect(picker.selectedIndex).toBe(2)` in
  "opens two popup owners in one Host" is the same read-after-pick race; the brief named only the
  three reads above, so it is unchanged.
- `example/__tests__/SearchField.harness.tsx:566`: "submits on the Search key, then blurs" reads
  the log straight after waiting for the native blur, and CI run 44504146726 shows it two events
  short (`expected ['focus', 'change:t', …(2)] to deeply equal ['focus', 'change:t', …(4)]`). Same
  shape, but no counter covers submit and blur, so it needs a different signal; unchanged.
- The brief's out-of-scope cases are untouched, and none of them is this pattern: the Menu
  split-trigger case, the HostPopups "closes when the control is disabled" case (its CI failure is
  the `expanded` read after re-enabling), and the TextField and SearchField "round-trips" reads.
