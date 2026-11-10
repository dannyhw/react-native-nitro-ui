# G29 — Real Android wheels: Picker `wheel` and DatePicker's time wheel

**Branch:** `task/G29-android-wheels` (from `main` at `6005b35e`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `G29-itkdc` (`emulator-5570` + iPhone Air 27.0 / Metro `8293`)

## Measured boxes

All of them read off the device by `scripts/real-input/android.mjs` (density 2.625, API 35,
`nitroui_b`), because they are the numbers the report quotes and a fixture could only prove
the emulator had not changed.

| Wheel | Device box (dp) | How measured |
| --- | --- | --- |
| Picker `wheel` | 197 × **200**, in a box its story pins narrower than the 300 dp the harness used | real-input `drum box: 282,703 → 798,1228`; the harness lays the same drum out at 300 dp wide and 200 dp tall |
| DatePicker `wheel` `time` | **280 × 120**, and inside it one drum per field: hour 100 × 120, minute 100 × 120, 42 px apart | real-input `time wheel box: 172,1020 → 908,1335` and the two named drum nodes ("Select hour", "Select minutes") |
| DatePicker `wheel` `date` | **512 dp tall** — the inline calendar's own box, asserted equal to it | real-input `wheel + mode="date" box … = 512 dp tall, against the time wheel's 120 dp`; `DatePicker.harness.tsx` asserts the two boxes are the same box |

The heights are the widgets' claims, not the component's: `fillWidth` gives the width and the
`ScrollField`/`TimeScroll` gives the height, which is why each sizing test poisons the
fallback first and then counts the correction.

## Summary

Both wheels are Material's own now: `Picker variant="wheel"` draws `ScrollField`, and
DatePicker's `wheel` + `time` draws `TimeScroll`, where Android gave a menu and an inline
calendar. **Not mergeable as it stands:** one fling of the time drum reported two changes on a
loaded box, and the freeze cut both iOS gates.

The bug that mattered was not the drawing. A drum is a pager, and React Native's scroll view
claims a vertical drag at touch slop, before the pager sees it: a fling in a scroller moved
the window, not the drum, and JS heard nothing. `Modifier.nuiOwnVerticalDrags` (core)
asks the ancestors to stand down for a gesture begun on the drum — and both docs state the
bargain: that drag rolls the drum, and the page is scrolled beside it.

The one design decision a reviewer needs: **neither wheel reads its value as it turns.** A
`ScrollField` names the row nearest its snap line continuously and `TimeScrollImpl` forwards
each one to `state.hour`/`.minute`, so the dial's "the fields moved, so somebody picked" rule
would price a 09:20→14:05 roll at fifty-odd events. Both wheels
keep the rule and replace the trigger: the value is read at a *rest*, one rest one report.
Picker has a real rest to subscribe to (`isScrollInProgress`); `TimeScroll`'s drum states are
private to Material's implementation, so rest there is `collectLatest` over the two fields
behind a 180 ms window. That number is not a measured settle time — nothing exposes one — it
is proven from the other side: with no window one fling of the hour drum reports two changes;
with it, one. The refused-pick write-back hangs off the same rest, so a snap-back is the
widget moving home, not this file repainting it.

`tintColor` reaches the selected row and the centre band; unselected rows keep Material's
content colour, the one thing on a wheel it cannot take. `variant="wheel"` in `date`/`datetime`
stays the inline calendar — Material has no wheel calendar, and a drum of days would be our
control in Material's paint. It is the one place `variant` means something different per
platform, stated in `date-picker.md`'s Limits.

`TimeScroll` keeps its rows out of the accessibility tree, so the value travels as
`stateDescription` on one node per drum: no rows to compare a reported value with, and no
`scrollable` on the node, so TalkBack offers no scroll actions. Both are documented.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2010 tests / 85 suites | `c749a35e04e8` | 2 m 49 s | start 6.2 / med 11.2 / max 17.7 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | **PASS** | 657 tests / 31 suites + isolated 6 tests / 3 suites | `c749a35e04e8` (android tree) | 18 m 33 s | start 8.4 / med 5.9 / max 33.8 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | **FAIL** | — | `c749a35e04e8` (android tree) | 16 m 15 s | start 5.1 / med 5.6 / max 17.5 |
| `harness:android:-t:wheel%20variant` | **PASS** | 657 tests / 31 suites | `c749a35e04e8` (android tree) | 1 m 02 s | start 5.4 / med 5.0 / max 5.4 |
| `harness:android:DatePicker` | stale | 19 tests / 1 suites | 37936848b36d (not this tree) | 27.0 s | start 8.9 / med 8.2 / max 8.9 |
| `real-input:android:--control:date-picker` | stale | — | 1a0a972a0d0f (not this tree) | 14 m 52 s | start 6.8 / med 4.9 / max 14.5 |
| `real-input:android:--control:date-picker:--background` | stale | — | e9e8a5c85cb6 (not this tree) | 0.4 s | start 3.8 / med 3.8 / max 3.8 |
| `real-input:android:--control:picker` | stale | — | 5de08269fd41 (not this tree) | 7 m 07 s | start 4.9 / med 4.3 / max 14.4 |
| `real-input:android:date-picker` | stale | — | 37936848b36d (not this tree) | 0.3 s | start 41.4 / med 41.4 / max 41.4 |

`need --for review`: `✓ check`, `✓ harness:android`, `✗ harness:ios — never run on this
tree` (the freeze). `real-input:android` is not part of review, but it is red on this tree and
is the blocker above.

## Status at the freeze

The orchestrator froze the tree at 15:12 UTC while `real-input:android` was 27 min
into its run. It was stopped (its own pid, and the Metro it had started on the leased port
8293; nothing else was touched), and `harness:ios` / `real-input:ios` were never started — so
**this branch has no iOS gate on the current tree**, which the brief asks for and the freeze
refuses. The branch is committed and clean; nothing is half-written in it.

Stopping it was the right call, because the run had already failed, on its own, before the
kill:

```text
✗ one roll of the hour reports exactly one change, not one per row crossed — expected 1, saw 2
✗ the hour drum at rest: real-input-wheel-time-events went to "2" when it should have stayed "1"
```

**One fling of the hour drum reported two changes.** That is the exact claim this variant is
about, so it is the one line that must not be waved through, and it is intermittent: the same
check passed at 13:52 on a tree that differs from this one by comments only, and failed at
14:55 with `load1` between 5 and 17 across the run. The likely reason is that the DatePicker
drum's rest is a *timeout*, and a timeout is the one settle definition that stretches when the
machine does: `TimeScroll` gives nothing to subscribe to, so 180 ms of quiet is treated as the
end of a roll, and a pager that pauses longer than that mid-flight reports its halfway row and
then its final row. The Picker drum reads `isScrollInProgress` instead and is much less
exposed, but a stalled frame could split it the same way.

The fix is to stop guessing from the clock and use the gesture that is already in this file:
`nuiOwnVerticalDrags` sees the pointer's *up* on the drum, so the settle can be armed from
that rather than from any quiet period, and the pair read is then the drum's final rest one
gesture later. That is a small change inside `HybridNitroUiDatePicker.syncTimeWheel` plus a
re-run of the fling a few times on a quiet box (a flaky check has to be repeated, not
greened once). Not attempted during the freeze, because an unverified fix on a frozen tree is
worth less than a precise bug report.

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
- `android/.../core/NitroUiWheelDrag.kt` (new, in the published manifest): `nuiOwnVerticalDrags`, the one
  gesture rule both drums need.
- `example/__tests__/{Picker,DatePicker}.harness.tsx`, `scripts/real-input/{android,screens}.mjs`: the two
  wheels' coverage — ten harness cases and the fling steps that read a drum's own box out of the dump.
- `example/src/{Picker,DatePicker}Screen.tsx`: the wheel stories and the fixtures the real-input flings aim at.
- `src/components/{Picker,DatePicker}/*.tsx`: the variant docs that said the wheel was iOS-only.
- `docs/components/{picker,date-picker}.md`, `README.md`, `.changeset/g29-android-wheels.md`,
  `etc/package-files.txt`.

No screenshot was re-taken, deliberately: `picker-android.png` photographs the open menu (the wheel row is
behind the popup in that frame, before and after), and `date-picker-android.png` photographs `compact` and
`inline`, which are unchanged. The Android wheel fixtures sit below both frames.

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
- hygiene, one incident: a `kill <pid>` was issued mid-round against a process matched by its
  command line (`gate.mjs harness:android`) rather than a pid recorded at launch, on the
  assumption it was a filtered run of this task that had stalled. The shared log store says the
  only other `harness:android` on the machine — `task/G27-merge`'s — had already finished 70
  minutes earlier, so the process killed was almost certainly this task's own. Reported because
  matching a gate process by pattern is exactly the habit the rules exist to stop.
- device state left behind, for whoever leases pair-b next: `emulator-5570` still carries an
  `adb reverse tcp:8080` that this task did not create (this task's own `tcp:8293` was removed
  before the lease was released, and no debug-host preference or `cmd uimode` was ever set).
- tooling: `real-input:android --control <one>` still runs the whole a11y sweep (≈10 of the
  ≈15 minutes) unless `NUI_SKIP_A11Y_SWEEP=1`; a filtered red-proof run would rather not pay
  for it, and the flag is undocumented outside the script.

## Questions for orchestrator

- **The double-report needs a decision before G29 merges.** Options: (a) a fix round here — arm
  the DatePicker drum's settle from the pointer-up `nuiOwnVerticalDrags` already sees instead of
  from 180 ms of quiet, then run the fling several times on a quiet box (recommended: it is my
  code, the seam is in the file, and the alternative is a timeout that is tuned until it
  stops failing); (b) raise the window to something embarrassing (400 ms+) and accept a laggy
  report; (c) land the Picker wheel only and hold the DatePicker drum back. The check that
  caught it (`one roll of the hour reports exactly one change`) is the right check — it should
  not be relaxed.
- Also still owed by this task, once gates are allowed again: `harness:ios`, `real-input:ios`,
  and a green `real-input:android` — twice, since one of its checks is now known to be
  load-sensitive.

- **The bench number the brief asks for does not exist to be taken.** `mount.picker` has one
  cell and no `variant` knob (`rg wheel bench/src` is empty), so wheel-vs-menu needs a bench
  fixture — a plan cell plus the two implementations' stories — which is bench-host work
  (D15) and cannot be reached by a flag. Options: (a) accept the gap and hand the cell to the
  bench host as a follow-up (recommended: `need` never asks for a bench, and the wheel's
  cost is bounded by the same `ScrollField` the menu does not use); (b) a fix round adding
  `mount.picker-variant-wheel` to the bench plan, which is a day of fixture work on the bench
  host's tree rather than a run here.
