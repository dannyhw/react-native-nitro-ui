# FIX34 — Does a controlled TextField lose keystrokes when the app sets its value late?

**Branch:** `task/FIX34-async-controlled-value` (from `main` at `cd6e0eb8`) · **Round:** 1 of up to 3 ·
**Lease:** `FIX34-dzapt` (`pair-b`: iPhone Air / emulator-5570 / Metro `8293` iOS, `9293` Android)

## Summary

Yes — and React Native's `TextInput` loses the same keystrokes in the same place. Typing "abcdef"
at the harness's 30 ms cadence, every delivery mode lands the full text on TextField, SearchField
and RN `TextInput`, on both platforms, **except a `value` that arrives in a later task**: with
`setTimeout(…, 50)` the field ends on `"bdf"` — keys a, c and e are gone — on all three widgets on
Android and iOS. `setTimeout(…, 0)`, a microtask, and a real `startTransition` all keep the text,
because React batches the app's update into the same render as the echo, so the commit carries the
new `value` and the count together. The dividing line is therefore not "delayed" but "flushed in
the same task"; an `await` is a microtask and is safe, a timer is not.

The field flickers while this happens. The nitro arms were sampled every ~8 ms: `TextField`
showed `a, ac, b, ac, bd, ace, bdf` — the older `value` visibly replaces newer keystrokes.

Mechanism, both libraries: the echo of the event count commits on its own, carrying the app's
*older* `value`. nitro-ui echoes before the handler (`src/core/useControlled.ts:72`) and
`reconcile()` accepts a write once `jsEvents >= nativeEvents`
(`android/src/main/java/com/margelo/nitro/nitroui/core/NitroUiModel.kt:50`,
`ios/core/NitroUiModel.swift:58`) — a stale value that carries the fresh count passes. RN
`TextInput` sets `lastNativeText` and `mostRecentEventCount` after calling `onChangeText`
(`TextInput.js:393-410`), and its layout effect writes `props.value` with that same count
(`TextInput.js:198-232`). Same hole, same size: the library matches the bar rather than beating it.

Readings are one run per configuration; the same loss appeared independently in all four
device/widget combinations, so it was not re-run. `startTransition` was measured twice: the first
run's fourth row is a microtask (`Promise.resolve().then`), mislabelled at the time, and is
reported as its own row.

**Recommendation — (a) document it, roughly an hour.** Add to `docs/DESIGN.md` 3.5 and the
TextField/SearchField docs: set `value` in the same task as the callback; a `value` committed from
a later task can be applied over newer keystrokes, and RN `TextInput` behaves identically. (b) A
library change is not recommended at this cost: holding the echo until the app's `value` commits
undoes the no-visual-latency property 3.5 exists for and the throw-safety of echoing first;
"accept a `value` only when newer than the displayed text" needs an ordering text does not have.
Neither would beat RN, which loses the same way. (c) Leaving it undocumented is free now and costs
an app developer a lost-character bug they cannot explain.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2262 tests / 105 suites | `2765dee28f42` | 59.3 s | start 6.0 / med 13.3 / max 13.7 |
| `harness:ios` | **PASS** (from `merge/X65`) | 622 tests / 30 suites + isolated 6 tests / 3 suites | `f1c3b9f8171f` (harness:ios digest) | 14 m 54 s | start 9.2 / med 5.1 / max 15.6 |
| `harness:android` | **PASS** (completed: 1 of 31 units re-run, attempt 1; from `merge/X65`) | 27 tests / 1 suites | `f1c3b9f8171f` (harness:android digest) | 30.5 s + full run 18 m 51 s | start 3.2 / med 6.6 / max 9.9 |
| `real-input:ios` | **PASS** (from `merge/X65`) | — | `f1c3b9f8171f` (real-input:ios digest) | 45 m 29 s | start 3.4 / med 5.1 / max 17.2 |
| `real-input:android` | **PASS** (from `merge/X66`) | 76 tests / 28 suites | `2765dee28f42` (real-input:android digest) | 40 m 58 s | start 5.2 / med 3.0 / max 16.3 |
| `harness:android:LateValue` | stale (relaxed: HARNESS_TEST_TIMEOUT) | 3 failed of 3 tests / 1 suites | 7803889bbea5 (not this tree) | 16.3 s | start 7.5 / med 6.9 / max 7.5 |
| `harness:ios:LateValue` | stale (relaxed: HARNESS_TEST_TIMEOUT) | 3 failed of 3 tests / 1 suites | 7803889bbea5 (not this tree) | 17.5 s | start 6.5 / med 6.8 / max 7.2 |

`need --for review`: ✓ check — green; note: the code diff touches no platform-specific code, so no
device gate is asked for beyond check (a docs-only commit never invalidates a gate). need: review
is satisfied on this code tree.

The two `LateValue` rows are the throwaway measuring case, which is not committed — hence `stale`.
They are red on purpose: the harness prints app logs only from a failing run, so each test threw
its readings as its failure message. `HARNESS_TEST_TIMEOUT` was raised to hold twelve scenarios in
one `it`, which is why they read `relaxed`. Neither row is a gate for this branch.

## Red proofs

No test is committed by this task, so no mutation was run. The throwaway measuring case was
deleted before the final commit, which is why its two gate rows read `stale`.

## Files changed

- `docs/tasks/FIX34-async-controlled-value.report.md`: the report; no library or example change.

## Follow-ups

- fields: the loss threshold was not swept — the boundary sits between `setTimeout(…, 0)` and
  `setTimeout(…, 50)` at 30 ms per key, and neither number is the library's.
- `docs/DESIGN.md` 3.5: says a `value` written while an event is in flight is dropped, but not
  that a `value` arriving in a later task is applied over newer keystrokes.
- harness: `console.log` from a passing device run reaches no log anyone reads, so a measurement
  test has to fail in order to print its numbers.
