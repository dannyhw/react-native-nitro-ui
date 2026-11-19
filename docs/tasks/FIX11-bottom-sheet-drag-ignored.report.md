**Branch:** `task/FIX11-bottom-sheet-drag-ignored` (from `main` at `52aa4c5`) · **Round:** 1 of up to 3 ·
**Lease:** `FIX11-s6abh` (`emulator-5570` / Metro `9293`)

## Summary

A drag that began on a two-detent Android sheet's header before Material had settled the sheet was
dropped whole: the sheet finished rising and rested at the detent it opened at, which is the
recorded `the header's top moved from 1391 to 1391`. Material 1.5.0-beta02 switches its own drag on
the sheet off with `enabled = gesturesEnabled && state.currentValue != Hidden`, and `currentValue`
is the state's *settled* value - written only when the opening animation finishes. A drag started
before then is never turned into a drag. It also stays dropped when the sheet settles partway
through the same gesture, which an instrumented run showed happening 200 ms into a 900 ms drag: a
drag is looked for only where a gesture begins.

Handing the drag over as scroll deltas - what a nested scroll does, and what the sheet's own
`ScrollView` does - cannot work: `dispatchRawDelta` writes the offset, and the running opening
animation writes its own value on the next frame. So during that window the sheet is not followed
1:1 with the finger. The root now measures a drag as it passes in - at `onInterceptTouchEvent`, the
only place it reliably sees one, since for a header drag `onTouchEvent` is never called - and at
the end of the gesture the composition moves the sheet to the detent the drag asked for, decided by
the 56.dp of travel or 125.dp-a-second fling Material3 itself asks for, through the same state
calls a settled drag ends in. A drag back down takes the library's own user-dismissal path, so
`onDismiss` and `onIsPresentedChange` report what a swipe down reports.

The other decision to read before the diff: `DetentReporter` no longer throws away its first
emission by count. The detent a sheet opens at is still not a change, but one the person dragged to
is reported even when the drag cancelled the opening animation and its settle is the first.

The flake itself - a drag from a box that already looked at rest - was not reproduced. What
reproduces every time is the same drop, aimed at the moment its window is open: the same rest at
`1391` it started from, with the sheet no longer visibly moving by then.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | stale | 2178 tests / 96 suites | a427c8bd9042 (not this tree) | 1 m 09 s | start 3.7 / med 13.8 / max 17.0 |
| `harness:ios` | **PASS** (from `task/FIX6-form-row-press`) | 601 tests / 30 suites + isolated 6 tests / 3 suites | `647545962a59` (harness:ios digest) | 14 m 23 s | start 14.8 / med 7.4 / max 19.1 |
| `harness:android` | stale | 659 tests / 31 suites + isolated 6 tests / 3 suites | 64861b7585e4 (not this tree) | 18 m 19 s | start 7.6 / med 7.1 / max 20.9 |
| `real-input:ios` | **PASS** (from `merge/FIX6`) | — | `647545962a59` (real-input:ios digest) | 44 m 44 s | start 3.5 / med 6.0 / max 22.2 |
| `real-input:android` | missing | — | — | — | — |
| `real-input:android:--control:bottom-sheet` | stale | 4 failed of 9 tests / 1 suites | a427c8bd9042 (not this tree) | 5 m 47 s | start 10.6 / med 4.5 / max 10.6 |
| `real-input:android:--control:bottom-sheet:--a11y:switch` | stale | 1 failed of 6 tests / 1 suites | 16de4a8edfe5 (not this tree) | 2 m 31 s | start 5.7 / med 4.2 / max 5.7 |

`need --for review`: need: review is satisfied on this code tree. The last row is the mutation run behind the red proof below:
the same six cases with the fix taken out again. The full `real-input:android` is the merge run:
the brief asks for the filtered one here.

## Red proofs

- `a drag that starts while the two-detent sheet is rising expands it` -> `the fix removed, the file
  back at the brief's commit` -> `ASSERTION_FAILED: the header was grabbed at y=1412, inside the box
  1339..1484 read while its top was still at 1390 of the 2424 window; the header came to rest at
  1391: expected 1391 to be less than 695`, with the other five cases of that file green.

## Files changed

- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiBottomSheet.kt`: the sheet's root
  measures a drag that passes it while the sheet has not settled at a value; the composition ends
  such a gesture at the detent the drag asked for; the detent report no longer throws away a
  dragged settle.
- `example/e2e/real-input/bottom-sheet.e2e.ts`: the case that grabs the header while the sheet is
  rising.
- `.changeset/bottom-sheet-drag-during-the-rise.md`: the patch entry.

## Follow-ups

- A drag that starts on the sheet's scrolling content while it is rising is left to that content,
  by rule: the list holds the gesture and its deltas reach the sheet only as raw deltas, which the
  opening animation overwrites anyway.
- The followed drag has no JVM test: `BottomSheet.harness.tsx` can move the sheet through the state
  calls but cannot inject a real drag, so only the real-input case covers it.
- `PositionalThreshold` and `VelocityThreshold` are internal to Material3, so 56.dp and 125.dp are
  copied here; if upstream moves them, the two ways into a detent will disagree.
- A rising-drag case reads a box to aim at and cannot prove the drag began before the sheet
  settled: on a slow read Material's own drag answers it, and the case passes either way.
- A two-detent sheet no taller than half the screen has nothing to rise to, so a drag up during its
  rise reports the expanded index as a change although its height does not move.

## Fix round 1

M1, M2 and M3 are implemented. N1, N2 and N3 sit in one `RisingDragMeasurement` shared by the
sheet's root and a band under Material's grabber, which is how N6's grabber drag is taken. N7, N8,
N10 and the ScrollView wording are done; N5 and N9 stay follow-ups. Three new cases: the whole
event log across a close and a reopen, the slide out of a dismissed rise, and a sideways fling
along the sheet's list.

One device run, on the tree before the last two commits: 4 failed of 9.

- `a drag up on the two-detent header expands it` observed `detent:0 > detent:1 > ...`: my M1 edit
  read `opening` after spending it, so every open reported its opening detent. Fixed.
- My two new cases read `sheet-log` through an open sheet's window, which finds no node. Fixed: the
  log is read with no sheet up.
- `a drag down during the rise slides the sheet out` is still red: that sheet stayed composed at
  y=1478 for the 4 s it was watched, so its drag reached no dismissal, followed or otherwise. Open,
  and the next round's lead: the case starts on the fit sheet's title, whose content carries a
  `TextInput` and a horizontal list.

Owed on this tree: `check`, `harness:android`, a green `real-input:android --control
bottom-sheet`, and every red proof of the new cases. Two device leases were held by other tasks
for most of the round; the run above is the window this round got.
