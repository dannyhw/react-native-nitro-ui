# FIX23 — The iOS split Menu test waits for the action instead of a fixed 400 ms

**Branch:** `task/FIX23-menu-split-trigger-wait` (from `main` at `4ee96b56`) · **Round:** 1 of up
to 3 · **Lease:** `FIX23-aayrq` (iOS simulator / Metro `8295`)

## Summary

The iOS branch of "Menu · Split trigger (E3) › is two halves, and each one does only its own job"
pressed the trigger and then slept a fixed 400 ms before reading `primaryLog`. A primary action that
arrives later than that on a slow machine reads as `expected [] to deeply equal ['split:action']`,
which is what both recorded failures said. The branch now waits on the signal with the file's own
`waitForLog` and its usual 8 s timeout — the same thing the Android half of the test already does —
and then keeps a short `settle(250)` so the `stateLog` assertion still has a window in which a
stray open or close could land. Nothing else in the file changed, and no library code changed.

A timeout of that wait is a library statement rather than a timing one: the failure names the press
that reported nothing — `"the split trigger tap" reported 0 of 1 expected events within 8000ms:
nothing` — so a tap that runs no primary action reads as a library fault instead of as an
assertion against an empty array. Polling the signal is what the brief decided, and what the file
already does everywhere else; no sleep got longer and no timeout was raised.

The race itself was not reproduced: it needs a machine slow enough that the action lands after
400 ms, and both recorded sightings are one-off. The cause fixed is the read that raced the write,
and the evidence for it is the shape of the two failures — an empty log against a test that asserted
on a sleep, on a slow machine and in hosted CI.

`harness:android` is owed: no Android pair came free during this task while its iOS lease held one
of the two lease slots, and the Android app would have had to build from nothing on top of that.
The changed lines sit inside `if (Platform.OS !== 'android')`, so Android takes the same path it
took before; merge runs the full `harness:android` on this tree anyway.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2200 tests / 99 suites | `d4015760cc7f` | 55.8 s | start 8.9 / med 10.7 / max 12.4 |
| `harness:ios` | **PASS** | 620 tests / 30 suites + isolated 6 tests / 3 suites | `d4015760cc7f` (harness:ios digest) | 14 m 39 s | start 9.6 / med 8.1 / max 30.6 |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | **PASS** (from `merge/FIX20-FIX21`) | — | `a8bf12cd96b6` (real-input:ios digest) | 45 m 37 s | start 3.4 / med 6.9 / max 23.5 |
| `real-input:android` | **PASS** (from `merge/FIX20-FIX21`) | 76 tests / 28 suites | `a8bf12cd96b6` (real-input:android digest) | 38 m 23 s | start 5.7 / med 7.4 / max 16.7 |
| `harness:ios:Menu` | stale | 1 failed of 59 tests / 2 suites | 8169ecf1b3af (not this tree) | 1 m 29 s | start 5.1 / med 5.6 / max 7.7 |
| `harness:ios:Split%20trigger` | stale | — | 8169ecf1b3af (not this tree) | 2.7 s | start 5.3 / med 5.4 / max 5.4 |

`need --for review`: `need: 1 gate(s) missing for review: harness:android` (`check` and
`harness:ios` green).

## Red proofs

- `Menu · Split trigger (E3) › is two halves, and each one does only its own job` (iOS) ->
  `ios/components/Menu/HybridNitroUiMenu.swift` passes `primaryAction: {}` to SwiftUI's `Menu` in
  both arms of the `hasPrimaryAction` branch, so the trigger keeps its shape and runs no action ->
  `"the split trigger tap" reported 0 of 1 expected events within 8000ms: nothing.`, with the other
  58 tests of that run green (`harness:ios -- Menu`: 1 failed / 58 passed).

The mutation was reverted before the green run: the tree in the table above has no library change.

## Files changed

- `example/__tests__/Menu.harness.tsx`: the iOS split-trigger branch waits for `primaryLog` through
  `waitForLog` instead of sleeping 400 ms.

## Follow-ups

- check: `scripts/__tests__/patch-nitrogen.test.js > patch-nitrogen: scroll-corrected shadow node
  (G24) > is applied to the Form the repo generates`, 2026-11-20, `check` started 01:16:42Z —
  `ENOENT` on `nitrogen/generated/shared/c++/views/HybridNitroUiFormComponent.hpp`, which is in the
  tree; green on the one rerun.

## Questions for orchestrator

- `harness:android` for this branch: run it at merge, or queue it as its own short task with an
  Android lease? Recommendation: let merge run it — the changed lines are iOS-only, and merge runs
  that gate on this tree regardless.
