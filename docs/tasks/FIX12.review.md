FIX ROUND

# FIX12 review (task/FIX12-bottom-sheet-rising-drag at 8a81cb43, against origin/main)

`check` not run: FIX13's lease is `in use (real-input:ios)`, "hold device runs". Back checked in
the 1.5.0-beta02 `material3-android` bytecode.

## 1. FIX11.review M1-M3

- M1 closed. The flag is consumed on every emission (`:907`), cleared when a presentation starts
  (`:151`) and cleared on recycle (`:235`). The detent case goes red when both guards are removed.
- M2 closed. `userDismissed(animate = true)` (`:829`) leaves `closing = composed`, so `hide()` runs
  and its `finally` clears `closing` (`:789-797`). `dismissible` is checked first.
- M3 closed as written. The handler latches at the down only off scrolling content (`:337-341`).
  A child's disallow request or `onChildStartedNativeGesture` stops the hand-over (`:381-409`).
  `end()` requires `|dy| >= slop && |dy| > |dx|`. RN's `TextInput` and JS responders both claim
  the gesture. New M1 is a different defect in the same measurement.

## 2. `dispatchTouchEvent` at the root

Nothing that starts after the settle is consumed, altered or delayed: `update` nulls
`dragUntilSettled` (`:876`), `handlerAtDown` returns before any hit test, no tracker is obtained,
and `super`'s result passes through. A gesture latched in the rise is measured past the settle by
design, and its hand-over leaves the event unchanged. Multi-touch and ACTION_CANCEL are handled
(FIX11 N2, N3 closed). No per-event allocation: one pooled tracker per rising gesture, one box of
the handler's arguments at the UP. `releaseSheetRoot` -> `forgetDrag()` (`:678`) resets on recycle
and dismissal; the grabber view has no reset (N3).

## 3. Back

Right. `ModalBottomSheet_YbuCTN8$lambda$2$0`: `currentValue == Expanded && hasPartiallyExpandedState`
-> `partialExpand()`, else `hide()` then `onDismissRequest`; `getCurrentValue()` is
`getSettledValue()`. Back before `expand()` settles closes the sheet, as after a Material fling: not
a library defect, and the witness hides none (a close after the settle still goes red). A person
can hit the ~0.2-0.3 s sub-2 px tail; the library does not widen it (N5).

## 4. Tests

Assertion changes since FIX11's tip are the brief's decided ones; waits are on signals, no retry.
The `readsBeforeItLeaves` cap went 4 s -> 6 s (`:422`), only bounding a loop that exits when the
node leaves, so it cannot green the vanish. The slide-out case still fails for the one-frame vanish:
under `animate = false` both `presented` and `closing` are false at the UP, `Component` (`:728`)
composes nothing, and the first `count()` is 0. Proofs: detent :407, slide-out :462, sideways :80,
Back :388. `sheet-two-detent` is example-only scaffolding; no README or doc mention. Gaps: N1, N2, N6.

## 5-6. Scope and owed gates

Scope is clean (no `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/` or shared helpers), one
author address, nothing personal; changeset and comments in N4, N7. Owed, not run here:
`check` (stale on this tree); a second green `real-input:android -- --control bottom-sheet` (the
`--a11y switch` run is narrower and does not count); one full `real-input:android`. Also
`real-input:ios`, which the report misses: `need --for merge` lists it, because
`BottomSheetScreen.tsx` counts for both platforms and `RealInputTests.swift:3431-3442` drags the
`sheet-two-header` this branch made taller.

## Must fix

M1. A rising drag is measured in the sheet's own moving frame, so the rise itself reads as a drag
down (`:525-528`, `:537-538`, `:554`). `fromY`, the travel and every `tracker.addMovement(event)`
use view-local y. The opening animation carries the root up under a still finger, so local y grows
by however far the sheet rose. A press held on the header, the title or a button during the rise
reaches the slop with the first jitter MOVE, which a real finger sends. Its local velocity is
thousands of px a second downward, `:815` reads that as down, and `:829` dismisses the sheet. A
slow drag up that the sheet outruns also closes the sheet instead of expanding it. The grabber band
rides in the sheet and has the same flaw. No test catches this: injected taps send no MOVE, and the
existing swipes outrun the sheet. CodeRabbit flagged it on 25893b70, and it is still present.
Measure travel and velocity in screen space (`getRawY(index)`, or the root's on-screen offset), and
feed the tracker events in that space. Prove it with a still hold on the rising header (`swipe`
with `from == to`, ~300 ms) that leaves the sheet up with an empty log, red on this tree.

M2. `scrollsUnderneath` compares local coordinates with parent-relative edges (`:365`). It should
read `childX >= child.width` and `childY >= child.height`, not `> child.right` and `> child.bottom`.
As written, a point up to `child.top` px below a scroller, or `child.left` px to its right, counts
as inside it, and the loop returns that child's verdict. A rising drag in that gap is dropped, for
example under `sheet-hscroll`. One line; CodeRabbit flagged it on 67de06d9, and it is valid.

## Notes

N1. The sideways case only proves the guard at the down. `sheet-hscroll` scrolls, so
`claimedByChild` and the vertical-led test never run, and removing just those two stays green.
N2. No case proves its drag began before the settle (FIX11 N5). A late drag passes the slide-out
case through Material's own swipe-dismiss, which keeps the sheet composed in the same way.
N3. `RisingDragGrabberView` has no release hook (tracker unrecycled if dropped mid-gesture); untested.
N4. The changeset's "is no longer dropped" overstates the change. A drag on scrolling content, a
text field or a control that claims the gesture is still left to that content during the rise
(CodeRabbit's changeset note, partly valid).
N5. `docs/components/bottom-sheet.md:80` "Back steps down a detent first" holds once the sheet has
settled; one clause (a Back while it moves closes it, as in Material) would make it exact.
N6. The detent case swapped `staysUp` (1.2 s watch) for one `count()` after `Detent 0`: stronger
on the step-down, but a later close goes unwatched.
N7. Comments: `bottom-sheet.e2e.ts:536` "The brief decided this case's log" cites a project
document. `readsBeforeItLeaves`'s KDoc is 6 lines. The KDoc at `:349` says "or edits", but the
check tests only scrolling.
N8. The latched hand-over does not check `model.presented`. If Back or JS closes the sheet during a
rising drag, an upward release calls `expand()` (`:826`). That cancels `hide()`, whose `finally`
clears `closing`, and the sheet vanishes in one frame. Rare.
N9. CodeRabbit's other inline comments (intercept vs dispatch, direction order, the flag, the log
reads) are addressed in this tree; FIX11 N9 (converged sheet) stays a follow-up.
