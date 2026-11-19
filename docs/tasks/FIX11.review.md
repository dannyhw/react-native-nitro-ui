FIX ROUND

# FIX11 review (task/FIX11-bottom-sheet-drag-ignored at 25893b70)

`check` was not run: `lease.mjs list` shows FIX8's lease `in use (real-input:ios)`. No CodeRabbit
inline comments on PR #102, only its summary.

## The cause

Confirmed against the 1.5.0-beta02 `material3-android` AAR in the Gradle cache (bytecode, no
sources jar). `BottomSheetImpl` builds
`anchoredDraggable(state, Vertical, enabled = sheetGesturesEnabled && currentValue != Hidden, flingBehavior = ...)`,
and `SheetState.show()` animates with `MotionScheme.defaultSpatialSpec()`, which is a spring.
The spring's sub-pixel tail explains the recorded failure. Two reads 150 ms apart agree within
2 px (so `restingBox` returns 1391) while `currentValue` is still `Hidden`, and the drag that
starts then is dropped whole. The red proof's own numbers back this up: the box read "rising" at
1390, then came to rest at 1391. The cause explains every recorded failure. The fix does not work
by waiting or retrying. `PositionalThreshold = 56.dp` and `VelocityThreshold = 125.dp` are
`BottomSheetDefaults` internals in this version (its `<clinit>`).

## Must fix

M1. A stale `oweDetentReport` sends a spurious `detent` event the next time the sheet opens.
`HybridNitroUiBottomSheet.kt:728`: `!opening || model.consumeDetentReport()` only consumes the
flag while `opening` is true. Take the sequence the report itself measured: the drag starts in
the rise, the sheet settles 200 ms in, and the drag ends at 900 ms. The first settle is not
reported, because the flag is still false. Then the up sets the flag (`:644`) and calls
`expand()`. The Expanded settle is reported through `!opening` and the flag stays true. The flag
is reset only in `reset()` (`:227`), on recycle, so nothing clears it at dismissal or at the next
presentation. The next ordinary, undragged open of that sheet reports its opening detent. In the
example it logs `detent:0` with no drag. This is the same sequence the new test drives. Clear the
flag when a presentation starts, or consume it on every emission.

M2. A drag down during the rise makes the sheet vanish with no exit animation. `:648` calls
`model.userDismissed()`, which runs `userClosed(animate = false)` (`:175-181`) and sets
`closing = false` on the premise that "Material has hidden the sheet already". Here Material has
not hidden it. `presented` and `closing` are both false, so `Component` (`:551`) drops the sheet
in one frame, scrim included, and `LaunchedEffect(presented)`'s `hide()` never runs. The events
match a swipe down; what the person sees does not. Close through a path that keeps `closing` set
and lets `hide()` run.

M3. The root acts on gestures that a child view holds. `measureDragUntilSettled` (`:332-362`)
sees every MOVE and UP, even after a child disallows interception: `:376` deliberately does not
set the flag on the root itself. It reads only the Y component, with no check that the gesture
was vertical-led and no regard for `onChildStartedNativeGesture`. It fires on 8 dp of vertical
drift (the touch slop) plus a release velocity of 125 dp/s. A sideways fling on the fit sheet's
horizontal list, a Slider or Switch drag, or a text-selection drag can easily have that much
drift and speed. Started during the rise, such a gesture expands a two-detent sheet or, drifting
down, dismisses a one-detent sheet (abruptly, per M2) while the person is scrolling something
else. The window is the rise plus the spring tail: short, but the same window this task treats
as reachable by a person.

## Notes

N1. Thresholds: the values match 1.5.0-beta02, but the rule does not. Material tests the fling
velocity first and the offset from the settled anchor second. `:635` lets the direction of travel
win, so a drag up that ends in a flick down expands the sheet. Nothing would notice if upstream
changed either constant. A JVM test that reads the two internal fields reflectively, or a pin
next to the material3 version, would catch it.

N2. Multi-touch: `event.y` is pointer index 0, and `ACTION_POINTER_DOWN`/`ACTION_POINTER_UP` are
not handled. When the first finger lifts, index 0 becomes another finger, and the travel jumps
by the distance between them.

N3. `ACTION_CANCEL` leaves `dragVelocity` set. The next `ACTION_DOWN` (`:338`) replaces it
without `recycle()`.

N4. No test covers the `DetentReporter` change. The new case asserts no event log, so restoring
`.drop(1)` would leave it green. Asserting the log after the drag, then closing the sheet,
reopening it and asserting the log again, would cover that change and would have caught M1.

N5. The new case does not check that the drag began before the sheet settled. On a slow read it
passes through Material's own drag without exercising the fix. Its red proof shows it does fail
when the window is hit, so this is noted, not blocking.

N6. A drag on Material's grabber (`BottomSheetDefaults.DragHandle`, on by default) starts outside
the `AndroidView`, so during the rise it is still dropped. That conflicts with the brief's goal
("no drag is silently ignored"). The report's follow-up says a rising drag on the sheet's
`ScrollView` is "dropped as before". That contradicts the KDoc at `:318-319` ("every gesture ...
passes whether or not a child view ends up holding it") and M3's reading. If the root does see
it, the content scrolls and the sheet also jumps to Expanded on release. One of the two claims
is wrong.

N7. Changeset: "is followed" overstates the change. The sheet does not track the finger; it
moves to the detent when the drag ends. The file also lacks a final full stop.

N8. Comments: the `dragUntilSettled` KDoc (`:312-322`) is 10 lines and the threshold comment
(`:626-629`) is 4. AGENTS.md "Comments" asks for one to three.

N9. A two-detent sheet no taller than half the screen ("converged") has nothing to rise to. A
drag up during its rise still sets the flag and calls `expand()`, so its first settle reports
the expanded index as a change even though the sheet's height does not change.

N10. The report's gate table repeats its header row.

Scope and hygiene are fine: 5 files, nothing under `scripts/`, `.claude/`, `AGENTS.md`,
`docs/agents/` or the shared e2e helpers. One author address, nothing personal. The existing
two-detent case is unchanged, and no assertion was loosened, no wait lengthened and no retry
added. Perf is fine: the root does no work per touch while no handler is latched, and the
composition reads `currentValue` only at settles.
