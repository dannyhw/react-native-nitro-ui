# G29 — Real Android wheels: Picker `wheel` and DatePicker's time wheel

**Branch:** `task/G29-android-wheels` (from `main` at `6005b35e`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `G29-itkdc` (`emulator-5570` + iPhone Air 27.0 / Metro `8293`)

## Measured boxes

| Wheel | Device box (dp) | How measured |
| --- | --- | --- |
| Picker `wheel` | _harness log: `wheel box:`_ | `Picker.harness.tsx` in a 300 dp box, poisoned fallback |
| DatePicker `wheel` `time` | _harness log: `time drum box:`_ | `DatePicker.harness.tsx` in a 320 dp box, poisoned fallback |
| DatePicker `wheel` `date` | = `inline` `date` | same box as the inline calendar, asserted equal |

## Summary

Both wheels are Material's own now. `Picker variant="wheel"` draws `ScrollField` and
DatePicker's `wheel` + `time` draws `TimeScroll`, where Android previously gave a menu and an
inline calendar.

The bug that mattered was not the drawing. A drum is a pager, and React Native's scroll view
claims a vertical drag at touch slop, before the pager has seen it: in a scroller a fling
moved the window, not the drum, and JS heard nothing. `Modifier.nuiOwnVerticalDrags` (core)
asks the ancestors to stand down for a gesture begun on the drum — and both docs state the
bargain: that drag rolls the drum, and the page is scrolled beside it.

The one design decision a reviewer needs: **neither wheel reads its value as it turns.** A
`ScrollField` names the row nearest its snap line continuously — `TimeScrollImpl` forwards
every one of those to `state.hour`/`state.minute` — so the dial's "the fields moved, so
somebody picked" rule would price a roll from 09:20 to 14:05 at fifty-odd events. Both wheels
keep the rule and replace the trigger: the value is read at a *rest*, one rest one report.
Picker has a real rest to subscribe to (`isScrollInProgress`); `TimeScroll`'s drum states are
private to Material's implementation, so rest there is `collectLatest` over the two fields
behind a 180 ms window. That number is not a measured settle time — nothing exposes one — it
is proven from the other side: with no window one fling of the hour drum reports two changes;
with it, one. The refused-pick write-back hangs off the same rest, so a snap-back is the
widget moving home, not this file repainting it.

`tintColor` reaches the selected row and the centre band; the unselected rows keep Material's
content colour, which is the one thing on a wheel it cannot take. `variant="wheel"` in
`date`/`datetime` stays the inline calendar — Material has no wheel calendar, and a drum of days
would be our control in Material's paint. That is the one place `variant` means something
different on the two platforms, and `date-picker.md` says so in its Limits rather than in a
footnote.

`TimeScroll` keeps its rows out of the accessibility tree, so the value travels as
`stateDescription` on one node per drum. Both consequences are documented rather than papered
over: no rows to compare a reported value with, and no `scrollable` on the node, so TalkBack
offers no scroll actions.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |

`need --for review`: pending.

## Red proofs

Each line is `test -> what was broken in the widget -> the line that went red`. All of them
were run against a rebuilt app, and the two drum sizes were each proven twice (once per
platform half of the claim).

- `Picker · wheel variant › reports one event for a roll that passed several rows` -> read
  `selectedOption` per row instead of resting on `isScrollInProgress` ->
  `example/__tests__/Picker.harness.tsx:2562` `expected ['wheel-roll:1'] to deeply equal
  ['wheel-roll:4']`.
- `Picker · wheel variant › goes back to a menu and to a wheel, with nothing left behind` ->
  drop `wheelRequest = null` from `PickerModel.reset()` -> `Picker.harness.tsx:2644`
  `expected ['wheel-noop:2'] to deeply equal []` (a recycled host replayed its old owner's
  roll).
- `Picker · wheel variant › reports nothing for the row already shown, or for a disabled
  wheel` -> drop the `enabled` refusal from `applyUserSelection` -> `Picker.harness.tsx:2644`
  `expected ['wheel-disabled:2'] to deeply equal []`.
- `Picker · wheel variant › measures the drum from a poisoned fallback, at the box width` ->
  `.height(WheelHeight)` to `.height(120.dp)` -> `wheel box: 300.19x120.00`, `expected 80 to
  be less than or equal to 1` (the corrections the engine had to make for a height that was
  never measured).
- `DatePicker · wheel variant › measures the time drum from a poisoned fallback` -> pin
  `TimeScroll` to `.height(20.dp)` -> `time drum box: 280.38x20.19`, `expected 20.19 to be
  greater than or equal to 48`.
- `DatePicker · wheel variant › sends nothing from a disabled time drum` -> drop the
  `enabled` refusal from `DatePickerModel.select()` -> `DatePicker.harness.tsx:2056`
  `expected ['wheel-locked:1778850300000'] to deeply equal []`.
- `DatePicker · wheel variant › draws the calendar for a date wheel, because there is no date
  drum` -> let `wheel` draw a widget for `date` too -> `DatePicker.harness.tsx:366`
  `testID "wheel-date" (the date wheel) never reached 131.05x48.00 - last box 320.00x48.00,
  control measured 131.05x48.00` (it had become the compact field).
- real-input `date-picker: the wheel's time drum` -> delete the 180 ms rest window
  (`delay(TIME_WHEEL_SETTLE_MILLIS)`) -> `one roll of the hour reports exactly one change, not
  one per row crossed — expected 1, saw 2`, with `the hour drum at rest:
  real-input-wheel-time-events went to "2" when it should have stayed "1"` behind it. This is
  the DatePicker drum's per-row proof: `nuiTestSelect` writes a DatePicker's selection
  without moving its drums (D14), so no harness test can make a drum cross rows - a claim
  this round therefore refuses to write a harness test for.
- real-input `picker: the wheel` + `date-picker: the wheel's time drum` -> before
  `Modifier.nuiOwnVerticalDrags`, with the drum inside the example's scroller -> `one roll of
  the hour reports exactly one change — expected 1, saw 0` (twice red, at 12:07 and 13:04: the
  fling moved the page, not the drum).
- `Picker · wheel variant › rolls a refused pick back, and reports the next roll of it again`
  -> keying the snap-back on a `LaunchedEffect(shown)` instead of writing the pager from
  `afterUpdate()` -> red on a loaded run during development, the reason
  `docs/components/picker.md` says the drum is told directly; the refused row stayed painted
  and the second roll reported nothing.

Not proven by a mutation this round, and said plainly: `DatePicker · wheel variant › reverts a
time the parent refuses, and reports the next roll of it` and `› leaves nothing behind when
the drum becomes a field again`. The first covers the shared event-count handshake (proved
red for the dial by the pre-existing DatePicker cases and for the wheel by the two Picker
lines above); the second's failure mode - a drum carried into the mount that follows - is the
one proven red on the Picker side by the `wheelRequest` line. A DatePicker-specific mutation
for either is a fix-round item, not a claim.

## Files changed

- `android/.../HybridNitroUiPicker.kt`: `ScrollField` drum, the rest-read settle, sizing keys, recycle reset.
- `android/.../HybridNitroUiDatePicker.kt`: `TimeScroll` for `wheel` + `time`, `syncTimeWheel`, date/datetime unchanged.
- `example/__tests__/{Picker,DatePicker}.harness.tsx`, `scripts/real-input/{android,screens}.mjs`: the two wheels' coverage.
- `docs/components/{picker,date-picker}.md`, `README.md`, `.changeset/g29-android-wheels.md`.

## Follow-ups

- bench: the brief's `mount.picker` wheel-vs-menu number cannot be measured on this tree —
  the bench plan has one `mount.picker` cell and no `variant` knob (`rg wheel bench/src` is
  empty), so a wheel cell is a bench-host change (D15) rather than a run flag. No number is
  quoted here for that reason.
- `nuiTestSelect` on a DatePicker writes the selection (`applyUserSelection`) without moving
  its drums, so a drum roll is only reachable by a finger. Picker gained a drum-shaped seam
  for exactly this (`PickerModel.wheelRequest`, animated like a real row press); DatePicker
  has no equivalent, which is why its per-row proof is a real-input one.
- both wheels: a drum's rows are absent from the a11y tree on both platforms, so "the row
  shown is the value reported" can only be checked through the app's own echo.
- `TimeScroll`: no settle to subscribe to; if Material ever exposes one, the 180 ms window
  should go.
- picker wheel: `ScrollField` ignores `tintColor` on unselected rows — needs a theme-level
  scheme, not a per-view tint.
- tooling: `real-input:android --control <one>` still runs the whole a11y sweep (≈10 of the
  ≈15 minutes) unless `NUI_SKIP_A11Y_SWEEP=1`; a filtered red-proof run would rather not pay
  for it, and the flag is undocumented outside the script.
