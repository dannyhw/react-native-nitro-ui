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

One table, regenerated on this round's final tree, under `## Fix round 2`.
Round 1's own table went stale as the tree moved and is not repeated here.

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

## Fix round 2

The rising drag reached no dismissal because the root measured it at `onInterceptTouchEvent`, which
Android stops asking once no child has taken the down - a plain title or header `Text` takes
nothing. Those drags arrive only in `onTouchEvent` (16 `MOVE`s there, 0 at the intercept), so no
travel was read. Measured at `dispatchTouchEvent`, the drag closes the sheet and `hide()` runs
228 ms, the sheet's own y 1426 → 2551.

`real-input:android --control bottom-sheet` is 6 of 9: the same three cases, none a library defect.
The slide-out case wants ≥2 boxes on the way out; the title leaves the window ~45 ms into that
spring, against 40 ms reads, so one is the ceiling (`ys [2157]`, twice). The detent-report case
reads `sheet-log` at :387 under the reopened sheet's window (`no node`), twice in three runs
earlier at :132, where Back closes the sheet. The sideways case expects `press:1` after Back, which
always logs `press:1 > presented:false > dismiss`.

Red proofs, one run, two mutations:

- slide-out → `animate = false` while rising → :443 `(ys [])`; the fix reads `ys [2157]`.
- sideways → `scrollsUnderneath`, `claimedByChild`, vertical-led checks dropped → :71 `the node left
  the tree`; the fix rests the chip.
- detent-report → the leaked flag → unprovable while :387 finds no node.

Owed: a green `real-input:android`, mutation A's proof, the sticky half of the slide-out case.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2178 tests / 96 suites | `2c94e69bee09` | 1 m 06 s | start 8.2 / med 9.1 / max 10.1 |
| `harness:ios` | **PASS** (from `task/FIX6-form-row-press`) | 601 tests / 30 suites + isolated 6 tests / 3 suites | `647545962a59` (harness:ios digest) | 14 m 23 s | start 14.8 / med 7.4 / max 19.1 |
| `harness:android` | **PASS** | 659 tests / 31 suites + isolated 6 tests / 3 suites | `2c94e69bee09` (harness:android digest) | 17 m 57 s | start 11.1 / med 9.7 / max 48.9 |
| `real-input:ios` | **PASS** (from `merge/FIX6`) | — | `647545962a59` (real-input:ios digest) | 44 m 44 s | start 3.5 / med 6.0 / max 22.2 |
| `real-input:android` | missing | — | — | — | — |
| `real-input:android:--control:bottom-sheet` | **FAIL** | 3 failed of 9 tests / 1 suites | `2c94e69bee09` (real-input:android digest) | 13 m 19 s | start 9.4 / med 6.4 / max 15.7 |
| `real-input:android:--control:bottom-sheet:--a11y:switch` | stale | 3 failed of 9 tests / 1 suites | 07d14e38df7f (not this tree) | 4 m 18 s | start 17.9 / med 7.2 / max 17.9 |

## Questions for orchestrator

None of the three reds is a library defect, so round 2 left all three assertions untouched. Each
needs a call about round 1's own cases, which no review has seen green.

1. `a drag down during the rise slides the sheet out`. The behaviour now matches M2: the drag
   dismisses, `hide()` runs a 228 ms Material spring, the sheet's own y runs 1426 → 1718 → 2105 →
   2340 → 2453 → 2551. What the case cannot see is two reads of it: the title's box leaves the
   window once the sheet's y passes 2279, which the spring reaches ~45 ms in, and one tree read
   costs 40-45 ms (the traces print `expect.toHaveText getByTestId("sheet-log")` at 40 ms, 41 ms,
   45 ms). Options: (a) assert ≥1 box plus the reported dismissal - its own docstring says one box
   is what separates a slide from "one frame, scrim included", and 0 boxes is the M2 bug exactly;
   (b) keep ≥2 and accept a red case, or a flaky one, until a slower exit is wanted for its own
   sake; (c) read a node that outlives the title - none exists: by the second read the whole sheet
   is below y 2454. (d) give the rising dismissal a softer spec than `hide()`'s - that would make
   this dismissal slower than a settled one, to satisfy a read. Recommend (a), by whoever owns the
   case; round 1's `last.y > first.y` then needs the same node read twice, so it wants (a) written
   as "≥1 box, and the sheet's reported dismissal".
2. `a detent dragged to during the rise is reported once`. Its last read is behind the reopened
   sheet's window, which finds no node at all - the read `3911ac0c` moved everywhere else. Closing
   the reopened sheet first and asserting both closes
   (`detent:1 > detent:0 > presented:false > dismiss > presented:false > dismiss`) proves the same
   claim, that the second open reports no detent, and makes mutation A provable. Say the word and
   it is a two-line test change.
3. The same case fails earlier in two of the three runs: `Back from the detent the drag asked for
   closed the sheet: expected 0 to be 1` (:132). Either Back
   does not step down a detent the drag asked for, or that drag sometimes asks for none. That is a
   real question, one device run per guess, and it is not reachable while the read in 2 is
   impossible. Treat it as its own defect (M4) or tell me to dig after the two reads are fixed.
4. `a sideways fling on the sheet list` expects the log to be exactly `press:1` after `app.back()`
   has closed the sheet, and a close always logs `presented:false > dismiss` - the string the
   file's own first case asserts. Extending the expected string adds the dismissal the case does not
   dispute; the guard it exists for (`the sideways fling closed the sheet`) is green on this tree and
   red under the mutation. Recommend extending it.

Also owed, unrunnable this round: the sticky half of the M2 case never executes, because the case
throws two lines earlier - `dismissible` is checked in `userDismissed`, but the rising sticky drag
is untested on a device.
