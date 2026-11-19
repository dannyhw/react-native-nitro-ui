# FIX12 — Finish the Android BottomSheet's rising-sheet drag, and prove it

**Branch:** `task/FIX12-bottom-sheet-rising-drag` (from `task/FIX11-bottom-sheet-drag-ignored` at
`67de06d9`, `main` at `52aa4c5`) · **Round:** 1 of up to 3 ·
**Lease:** `FIX12-1hjne` (`emulator-5570` / Metro `9293`)

## Summary

The two-detent sheet now says, inside its own window, which detent the app was told it settled at
(`sheet-two-detent`), and the cases that drag it up act on that instead of on a box that stopped
moving. That is the round's one real decision, so here is why.

`SheetState.currentValue` *is* `AnchoredDraggableState.settledValue`, and Material writes that only
when an animation ends: its three assignments are all at the end of `anchoredDrag`, `animateTo` or
`snapTo`. Material's own back handling is
`if (currentValue == Expanded && hasPartiallyExpandedState) partialExpand() else hide()`. So a Back
that arrives while the sheet is still travelling toward `Expanded` — inside the spring's sub-pixel
tail, after the header has stopped moving by more than 2 px and before the settle — closes the sheet
from wherever it has got to. That is FIX11's `expected 0 to be 1`. Material's own fling ends in the
same `animateTo` and has the same window, so this is not a defect to fix under Material, and no wait
was lengthened to hide it: the test now waits for the *settle*, and the only witness for a settle
that is readable while the sheet is up is the library's own detent report, rendered inside the
sheet. The report is made for a settle and for nothing else, which is what makes the witness sound.

Both log reads under a sheet window are gone: the detent case closes the reopened sheet and asserts
both closes, and the sticky arm's read is dropped, its superset being the read after the sticky
sheet's own button. The slide-out case takes the shape the brief decided — a box read on the way
down plus the reported dismissal, where zero boxes is the one-frame vanish — and the two reopen
taps reveal their opener first, which the two arms that had never executed needed.

`targetValue == Hidden`, as the review's M4 asks for, cannot be part of arming the hook: `animateTo`
runs inside `anchoredDrag(targetValue = …)`, which sets `dragTarget` before it animates, and
`targetValue` is `dragTarget ?: closest(offset)`. During the opening it names the detent the sheet is
rising to, so that condition would leave the hook unarmed for the whole rise — it would undo the fix.
The latch that a settle landing mid-gesture is measured through is FIX11's, at 200 ms into a 900 ms
drag. `userClosed` reports the close on both paths — `presented:false` at the request, `dismiss` when the
composition ends — so M3's unreported dismissal has no mechanism in this tree that the code shows: the
slide-out case's log assertion is the probe for it, and that arm of the case has never executed, on
any tree. No device run was started this round: `lease.mjs list` showed FIX7's `real-input:ios`
running from the first minute of the round to the last, and a device gate, a test run and an app build
all wait for that to clear. What the brief's Proof asks for is listed under Owed.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2178 tests / 96 suites | `3aa4a98e9925` | 1 m 06 s | start 6.3 / med 9.3 / max 10.9 |
| `harness:ios` | **PASS** (from `task/FIX6-form-row-press`) | 601 tests / 30 suites + isolated 6 tests / 3 suites | `647545962a59` (harness:ios digest) | 14 m 23 s | start 14.8 / med 7.4 / max 19.1 |
| `harness:android` | **PASS** (from `task/FIX11-bottom-sheet-drag-ignored`) | 659 tests / 31 suites + isolated 6 tests / 3 suites | `2c94e69bee09` (harness:android digest) | 17 m 57 s | start 11.1 / med 9.7 / max 48.9 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

`need --for review`: `need: review is satisfied on this code tree.` (`check` green, and
`harness:android` green on its own digest from `task/FIX11-bottom-sheet-drag-ignored`, which this
round changes no library code to disturb.)

## Red proofs

**None run.** The round never got the device, so no new assertion was shown to fail. Four mutations
are named here so that three of the four proofs need one build and one run between them, because they
break disjoint guards and each goes red in a different case:

- `a detent dragged to during the rise is reported once, and the next open reports nothing` ->
  `HybridNitroUiBottomSheet.kt`: `val owed = model.consumeDetentReport()` -> `val owed =
  model.oweDetentReport`, spending nothing -> the last assertion, the log across both closes, gains a
  `detent:0` from the reopened sheet's own opening settle.
- `a drag down during the rise slides the sheet out and reports the dismissal` ->
  `upward == false -> model.userDismissed(animate = true)` -> `animate = false` -> the box count,
  `the sheet was gone before it could be read once after the drag ended`, with `ys []`.
- `a sideways fling on the sheet list during the rise neither expands the sheet nor closes it` ->
  the handler at `NitroUiSheetRootView.drag` stops asking `scrollsUnderneath`, and `end()` drops
  `claimedByChild` and the vertical-led test -> `the sideways fling closed the sheet`.
- `a drag up on the two-detent header expands the sheet, Back steps down a detent, and a second Back
  closes it` -> the witness made unsound: `DetentReporter`'s first `snapshotFlow` reads
  `sheetState.targetValue` instead of `currentValue`, so the report names the detent the sheet is on
  its way to rather than the one it settled at -> `Back from the expanded detent closed the sheet`.
  This one cannot share a run with the first: both pass through the detent report. FIX11 measured the
  same assertion red in two of three runs with the rest read the box makes and no witness, which is
  the same cause seen from the other side.

## Files changed

- `example/src/BottomSheetScreen.tsx`: the two-detent sheet renders the detent its own
  `onDetentChange` reported (`sheet-two-detent`), reset when the sheet is opened, so the settle is
  readable inside the sheet's window.
- `example/e2e/real-input/bottom-sheet.e2e.ts`: `settledDetent`, the settle waited for before each
  Back that is meant to step down, the two log reads moved out from under a sheet window, the
  slide-out case as one box plus the reported dismissal, and the reopen taps given their `reveal`.

## Follow-ups

- bottom-sheet: the settled two-detent case's 400 ms drag reaches just inside the window's top edge;
  it is inside the slop that swallows a drag, and this round left the aim alone.
- bottom-sheet: `RisingDragMeasurement` still has no JVM test - `VelocityTracker` and `MotionEvent`
  keep it off a plain JUnit run, so the guards the third mutation above breaks are covered only on a
  device.
- bottom-sheet: M4's condition is rejected on the source above; if a real person's sideways fling is
  ever seen to move a rising sheet, the arming window - not the latch - is where to look.
- report: `harness:ios` and `real-input:ios` are green from other branches on their own digests;
  nothing in this round touches `ios/`.

## Owed

- `real-input:android -- --control bottom-sheet` green twice on the final tree, then one full
  `real-input:android` green: none started.
- The four red proofs above.
- The first execution of the sticky arm of the slide-out case, and of the sideways case's green path
  since the log expectation was widened - both were unreachable behind FIX11's red assertion.

## Questions for orchestrator

1. The brief's Proof is three device runs plus a mutant run, and every minute of this round had
   FIX7's `real-input:ios` in use with the note "needs a quiet machine". Options: give this branch a
   window on `pair-b` while an iOS run holds `pair-a` (an Android emulator run does share the CPU,
   which is exactly what that note asks to keep clear), or schedule this branch's device work after
   FIX7 merges. Recommendation: the latter, with this branch's review held until the filtered run is
   green - the round's changes are test and example only, so the library cannot have been broken by
   them.
