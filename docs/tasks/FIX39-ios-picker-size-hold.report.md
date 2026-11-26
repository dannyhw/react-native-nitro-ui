# FIX39 — An iOS Picker files a pick's width only under its own title

**Branch:** `task/FIX39-ios-picker-size-hold` (from `main` at `67a68647`) · **Round:** 1 of up to 3 ·
**Lease:** `FIX39-w8xq5` (`iPhone 17 (27.0)` / `emulator-5574` / Metro 8295 iOS, 9295 android)

## Summary

The misfile is on main, measured before anything changed by running the two left-key cases on iOS
with only their skip removed. A menu `Picker` with options `['One', 'Two', <long title>]` is picked
twice with no JS render between the picks, so the props batch React sent for the first pick reaches
native after the second pick has painted. That batch carries the sizing key of the long title while
native shows `One`. iOS had no hold — its host files a measured size as soon as it has one — so the
measure the pick's repaint causes landed under the key of the title the pick replaced. On main both
control modes cost one correction (`short=72.00x34.67 long=360.33x34.67`,
`picksDelta: corrections 1, immediate 1`); with the fix they pass as written on both platforms.

The hold is the host's, as decided, and shaped like Android's: `holdSizingReports()` stops
reporting and `releaseSizingReports(heldSizeBelongsToBatch:)` ends it, and while held
`refreshContentSize()` records the measure instead of filing it. `applyUserSelection` stamps what
the pick painted and arms the hold before the repaint; `afterUpdate()` releases it only to a batch
whose `jsEvents >= nativeEvents`, because an earlier batch keys the configuration the pick left,
and files what was held only while that title is still what is shown — clearing the stamp with the
release, so a too-early batch leaves both for the next. A refused pick, a pick of the row already
shown, a recycle and a drop leave nothing held.

Two notes for the reviewer. The stamp is model state, and the model reaches the host through one
closure wired at init: a pick is applied in the hosted SwiftUI binding, which is given the model,
not the host. And arming the hold is what asks for the measure — a pick cannot measure where it
paints, inside SwiftUI's own layout pass — so the hold marks one pending, and the next measure
applies the pick's repaint first. An ordinary pick still re-sizes to its new title, and the case
that picks without a render still counts one correction.

The host half is generic, so the next control that paints its own size change arms it the same
way; only the stamp and the "still shown" test are the Picker's. `docs/DESIGN.md` 3.6 no longer
carves iOS out of the rule; a line of `docs/components/picker.md` that said iOS needs no hold now
says who arms it.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2307 tests / 107 suites | `d810a6206b53` | 57.0 s | start 3.0 / med 5.7 / max 6.3 |
| `harness:ios` | **PASS** | 628 tests / 32 suites + isolated 6 tests / 3 suites | `d810a6206b53` (harness:ios digest) | 14 m 36 s | start 5.3 / med 3.0 / max 5.6 |
| `harness:android` | **PASS** | 684 tests / 32 suites + isolated 6 tests / 3 suites | `d810a6206b53` (harness:android digest) | 18 m 49 s | start 3.3 / med 4.0 / max 6.0 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | **PASS** (CI run 45730323679; from `merge/picker-hold`) | — | `95d5c2073183` (real-input:android digest) | 49 m 21 s | — |
| `harness:ios:Picker.harness` | stale | 2 failed of 59 tests / 2 suites | ec6231f905b6 (not this tree) | 53.7 s | start 2.6 / med 2.5 / max 2.6 |

`need --for review`: `need: review is satisfied on this code tree.`

## Red proofs

- `Picker.harness.tsx` "files nothing under a key two uncontrolled picks have left" and "files
  nothing under a key two controlled picks have left" -> the two cases alone, on main's library ->
  both red at `expect(afterPicks.corrections).toBe(0)`: `expected 1 to be +0`, in readings that
  carry `picksDelta: corrections 1, immediate 1`.
- The same two cases -> the fix with the caught-up check removed, `model.state.jsEvents >=
  model.state.nativeEvents` replaced by `true`, hold and stamp left in -> both red at the same
  line with the same `corrections: 1` reading. The caught-up check carries the fix, not the hold's
  mere presence.

## Files changed

- `ios/core/NitroSwiftUIHost.swift`: `holdSizingReports()` and
  `releaseSizingReports(heldSizeBelongsToBatch:)`; a held measure is recorded, not filed; recycle
  and drop clear both.
- `ios/components/Picker/HybridNitroUiPicker.swift`: the pick stamp, the "still shown" test, the
  hold armed where a pick is applied, and its release from a batch that has seen the pick.
- `example/__tests__/Picker.harness.tsx`: the two left-key cases run on iOS as well as Android.
- `docs/DESIGN.md`, `docs/components/picker.md`: the hold is both platforms'.

## Follow-ups

- `ios/components/Chip`, `ios/components/Menu`: neither arms a size hold for a change its own
  interaction paints, and neither was measured for the misfile this task fixes in the Picker.
