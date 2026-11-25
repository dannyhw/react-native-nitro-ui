# FIX38 — An Android Picker never stores one title's width under another's

**Branch:** `task/FIX38-picker-size-hold` (from `main` at `c3a8b3a9`) · **Round:** 1 of up to 3 ·
**Lease:** `FIX38-mp6rv` (`emulator-5574` / `iPhone 17 (27.0)` / Metro 9295 android, 8295 iOS)

## Summary

The misfile is on main and was measured before anything changed. A menu Picker with options
`['One', 'Two', <long title>]` and no `selectedIndex` was picked twice with no JS render between
the picks, so the props batch React sent for the first pick reached native after the second pick
had painted. That batch carries the sizing key of the long title while native shows `One`, the
handshake refuses its stale index, `pickIsStillShown` is true, and the pick's held size is filed
under the long title's key. A freshly mounted Picker on that title then took a cached width that
was not its title's and corrected once to `384.76x56.00`. On main the two picks cost one
correction and that fresh Picker one more, controlled and uncontrolled alike (`short=280.00
long=384.76`, `corrections: 1` in both windows); with the fix both windows report none.

The fix follows Chip, as decided. Native releases a pick's held size reports only to a props batch
whose JS event count has caught up with native's, because only such a batch can name what is on
screen; `pickIsStillShown` still decides whether the held size is filed at all, and the hold
carries over the batches that came too early. An uncontrolled Picker could not produce a caught-up
batch — it echoed nothing — so `src/components/Picker/Picker.tsx` now echoes the event count of the
choice it last took, which `useControlled` only does while controlled. The shown index still comes
from `lastChoice`, which now carries the count beside it. That is why the radio-variant case reads
`mostRecentEventCount` as `1` after an uncontrolled pick.

One ordinary pick is unchanged: the batch after it is the caught-up one, so the hold releases in
one batch and the control re-sizes to the new title as before. A refused pick and a pick of the row
already shown behave as today. The two new cases cover the menu variant under both control modes;
the guard and the echo neither read the variant, and the wheel, drum and radio variants keep their
existing sizing cases. The cases ran on iOS at first — holding a pick's size report is Android's
mechanism, so they now run only where a report is held, and iOS's own reading is a follow-up.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2274 tests / 106 suites | `111d2cd95315` | 1 m 01 s | start 2.3 / med 7.6 / max 11.7 |
| `harness:ios` | **PASS** | 628 tests / 32 suites + isolated 6 tests / 3 suites | `111d2cd95315` (harness:ios digest) | 16 m 36 s | start 4.7 / med 4.0 / max 23.8 |
| `harness:android` | **PASS** | 684 tests / 32 suites + isolated 6 tests / 3 suites | `111d2cd95315` (harness:android digest) | 18 m 43 s | start 6.4 / med 4.0 / max 24.5 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:android:%2FPicker.harness` | stale | — | 5492448d9e8b (not this tree) | 0.9 s | start 5.4 / med 5.4 / max 5.4 |
| `harness:android:Picker.harness` | stale | 59 tests / 2 suites | e5a4c6efc7f6 (not this tree) | 58.7 s | start 3.8 / med 5.6 / max 5.8 |

`need --for review`: `need: review is satisfied on this code tree.`

## Red proofs

- `Picker.harness.tsx` "files nothing under a key two uncontrolled picks have left" and "files
  nothing under a key two controlled picks have left" -> the two cases alone, on main's library ->
  both red at `expect(afterPicks.corrections).toBe(0)`: `expected 1 to be +0`, in a run whose
  reading shows the fresh long Picker correcting once off the stale key
  (`cacheDelta: corrections 1, immediate 1`).
- The same two cases -> the fix with native's caught-up check removed and the JS echo left in ->
  both still red at `expect(afterPicks.corrections).toBe(0)`: `expected 1 to be +0`. The echo alone
  changes nothing about the misfile; the caught-up check carries the fix.
- `Picker.harness.tsx` "radio variant (G26) costs no correction when a pick moves the selection" ->
  the JS echo, before that case's expectation moved -> red at
  `expect(handles.get('radio-warm')?.mostRecentEventCount).toBe(0)`: `expected 1 to be +0`. The
  expectation now depends on the echo, which is what the change is.

## Files changed

- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiPicker.kt`, `afterUpdate`: release a
  pick's held size reports only to a batch whose event count has caught up with native's.
- `src/components/Picker/Picker.tsx`: an uncontrolled Picker echoes its pick's event count, so a
  caught-up batch always follows a pick.
- `example/__tests__/Picker.harness.tsx`: the two cases, the radio case's echo expectation, and
  the platform the cases run on.

## Follow-ups

- `docs/DESIGN.md` 3.5 lists which components echo an event count; the uncontrolled Picker's echo
  is worth a line there. The handshake itself did not change.
- iOS Picker sizing: the same two-pick sequence costs one correction there too, and iOS files a
  measured size as soon as it is measured rather than holding it, so its key is decided by a path
  this task neither fixes nor claims to understand. Out of scope here; the cases skip on iOS.
