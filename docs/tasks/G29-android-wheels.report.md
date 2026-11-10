# G29 — Real Android wheels: Picker `wheel` and DatePicker's time wheel

**Branch:** `task/G29-android-wheels` (from `main` at `6005b35e`) · **Rounds:** 1 + fix round 2 of
up to 3 (D19) · **Lease:** round 1 `G29-itkdc`, round 2 `G29-to3to` (both `emulator-5570` +
iPhone Air 27.0 / Metro `8293`)

## Measured boxes

All of them read off the device by `scripts/real-input/android.mjs` (density 2.625, API 35,
`nitroui_b`), because they are the numbers the report quotes and a fixture could only prove
the emulator had not changed.

| Wheel | Device box (dp) | How measured |
| --- | --- | --- |
| Picker `wheel` | 197 × **200**, in a box its story pins narrower than the 300 dp the harness used | real-input `drum box: 282,750 → 798,1275` (round 2's run, unchanged from round 1); the harness lays the same drum out at 300 dp wide and 200 dp tall |
| DatePicker `wheel` `time` | **379 × 120** in the full-width story, and inside it one drum per field — hour **66 × 120**, minute **80 × 120**, 42 px apart, with the AM/PM column beside them on this 12-hour device | round 2's real-input `time wheel box: 42,1005 → 1038,1320` and the two named drum nodes ("Select hour", "Select minutes"), which carry the drums' own boxes |
| DatePicker `wheel` `date` | **512 dp tall** — the inline calendar's own box, asserted equal to it | real-input `wheel + mode="date" box … = 512 dp tall, against the time wheel's 120 dp`; `DatePicker.harness.tsx` asserts the two boxes are the same box |

The heights are the widgets' claims, not the component's: `fillWidth` gives the width and each
`ScrollField` gives the height, which is why each sizing test poisons the fallback first and
then counts the correction. The time wheel's drum *widths* are content's, not the constant's:
`TimeWheelDrumWidth` (100 dp) is a cap behind `weight(1f, fill = false)`, and the two columns
land at 66 and 80 dp because that is what their rows need.

## Summary

Both wheels are Material's own now: `Picker variant="wheel"` draws `ScrollField`, and
DatePicker's `wheel` + `time` draws a drum per field out of the same widget, where Android gave a
menu and an inline calendar. Round 1 ended on a double-report and two missing iOS gates; **fix
round 2 below closes both** — and a third thing only the iOS run could find, a check that could no
longer reach the bottom of the page it shares with the new wheels — and the round-1 prose that the
fix round replaces is listed there.

The bug that mattered was not the drawing. A drum is a pager, and React Native's scroll view
claims a vertical drag at touch slop, before the pager sees it: a fling in a scroller moved
the window, not the drum, and JS heard nothing. `Modifier.nuiOwnVerticalDrags` (core)
asks the ancestors to stand down for a gesture begun on the drum — and both docs state the
bargain: that drag rolls the drum, and the page is scrolled beside it.

The one design decision a reviewer needs: **neither wheel reads its value as it turns.** A
`ScrollField` names the row nearest its snap line continuously, so the dial's "the fields moved,
so somebody picked" rule would price a 09:20→14:05 roll at fifty-odd events. Both wheels keep the
rule and replace the trigger: the value is read at a *rest*, one rest one report — a drum is
active while a finger is on it or its own `isScrollInProgress` is up, and the report is the row it
stands on when neither is true. The refused-pick write-back hangs off the same rest, so a
snap-back is the widget moving home, not this file repainting it.

`tintColor` reaches the selected row and the centre band; unselected rows keep Material's
content colour, the one thing on a wheel it cannot take. `variant="wheel"` in `date`/`datetime`
stays the inline calendar — Material has no wheel calendar, and a drum of days would be our
control in Material's paint. It is the one place `variant` means something different per
platform, stated in `date-picker.md`'s Limits.

`TimeScroll` keeps its rows out of the accessibility tree, so the value travels as
`stateDescription` on one node per drum: no rows to compare a reported value with, and no
`scrollable` on the node, so TalkBack offers no scroll actions. Both are documented.

## Gates

Round 1's table stood here. Fix round 2 re-ran four of those five gates on a new code tree, so the
one table this report carries is the generated one at the foot of `## Fix round 2` — what
`gate.mjs table` prints for this code tree, because a stale row is a claim and the ledger row is
evidence. Round 1's own runs, including the red one this round answers, are in
`docs/tasks/G29/gates.jsonl` and in the store `gate.mjs logs` lists.

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

→ **Done in fix round 2, with the diagnosis confirmed rather than assumed.** The settle is now the
wheel's own scroll and gesture rather than any window, the mutation that restores a window
reproduces `expected 1, saw 2` on command, and the four gates this section lists as never started or
left red are in the generated table in `## Fix round 2`.

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

- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiPicker.kt`: `ScrollField` drum, the rest-read settle, sizing keys, recycle reset.
- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiDatePicker.kt`: `TimeScroll` for `wheel` + `time`, `syncTimeWheel`, date/datetime unchanged.
- `android/src/main/java/com/margelo/nitro/nitroui/core/NitroUiWheelDrag.kt` (new, in the published manifest): `nuiOwnVerticalDrags`, the one
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
- tooling: `gate.mjs export`'s failure excerpt names the failing test but not the assertion line
  above it — the iOS `XCTAssertLessThanOrEqual failed:` text is in the stored log (line 32 of the
  red filtered run) and quoted here, but not in the committed excerpt, so committed evidence is a
  step weaker than the run's own output.

## Fix round 2 — the rest is the wheel's, not a clock's

**Lease:** `G29-to3to`.

**The settle is the wheel's own scroll, not a clock's.** A drum is *active* while a finger is on
it — `nuiOwnVerticalDrags` awaits the down and the up anyway — or while its
`ScrollFieldState.isScrollInProgress` is up, and the value is read on the edge where both fall: the
frame the pager's snap animation finished. `nuiReportAtWheelRest` (core) is that rule and both
wheels run through it; a mount leaves it unarmed, and a refused pick's snap-back is a scroll too, so
the handshake's refusal answers it rather than an event. A quiet period on the value stream cannot
be the edge, because a drum only *names* rows as they cross. `wheel` + `time` draws its own `ScrollField`s (hour, minute,
AM/PM on a 12-hour device) because `TimeScrollImpl` keeps its drum states private — from outside the
widget, "the drum is still turning" does not exist.

**Two finds only round 2's runs could make.** Two harness cases were reading Android's boxes off an
iPhone (SwiftUI's wheel is 216 dp, the menu a wheel recycles into is 82 × 34.67), and `harness:ios`
had never run on them. And the Date screen's low-row check scrolled with `app.swipeUp()`, which
always begins at the centre of the window — a drum now. The wheel kept that drag (correct: it is what
rolls a drum), one unmoved swipe read as "the end of the page", and the check pressed a row left at
y=1005 of a 912 pt window and reported *presented no popover*. It drags the page's own 16 pt of left
padding, where no wheel is laid out; it calls the end three unmoved steps rather than one, because
the `wideBox` inline rows do reach the gutter; and it asserts the row is on the window before
pressing it, so an unreachable page says so instead of blaming the control.

**Files:** core `NitroUiWheelDrag.kt` (the drag flag, the active-drum count, `nuiReportAtWheelRest`),
`HybridNitroUiDatePicker.kt` (the drums it draws itself and the settle that reads them),
`HybridNitroUiPicker.kt` (the same settle through the shared helper),
`example/__tests__/{Picker,DatePicker}.harness.tsx` (the two boxes), `RealInputTests.swift` (the low
row's scroll), `scripts/real-input/{android,screens}.mjs`, `example/src/DatePickerScreen.tsx`,
`docs/components/date-picker.md`, `README.md`, the changeset.

Red proofs, in the round-1 idiom (`test -> mutation -> the line that went red`):

- real-input `date-picker: the wheel's time drum` -> in `syncTimeWheel`, swap
  `nuiReportAtWheelRest(active) { … }` for the window this rule replaced,
  `snapshotFlow { readTimeDrums(…) }.collectLatest { delay(60); … }`, shortened from 180 ms so it
  does not have to wait for load -> `one roll of the hour reports exactly one change, not one per row
  crossed — expected 1, saw 2`, with `the hour drum at rest: real-input-wheel-time-events went to "2"
  when it should have stayed "1"` (`real-input:android:--control:date-picker`, exit 1, mutated APK on
  `nitroui_b`). The same app with the rule restored reads `expected 1, saw 1` for all five rolls.
- real-input `date-picker: the low row` -> keep `app.swipeUp()` and add only the row-on-the-window
  assert -> `RealInputTests.swift:5181 XCTAssertLessThanOrEqual failed: ("1041.3331705729165") is
  greater than ("912.0") — the last row of the Date screen ended at y 1005.0-1041.3 of a 912.0pt
  window, so it is off it` (`real-input:ios:--control:date-picker`, exit 1). With the gutter drag the
  same check reaches the real end (`scrolled in 14 steps, last 3 unmoved`, `roomBelow=50.0`), the
  popover measures `336 × 337`, and `testRealInputDatePicker passed (100.3s)`.

Superseded from round 1: the Summary's "`TimeScroll`'s drum states are private … behind a 180 ms
window" and the matching "`TimeScroll` for `wheel` + `time`" row of Files changed; the measured box
for `wheel` + `time`, which is the drums' own row, not `TimeScroll`'s 280 × 120; the follow-up "`TimeScroll`: no settle to subscribe to", now the reason the drums are drawn
here; and question 1, which is what this round is. Round 1's red proof for the window (deleting its
`delay`) stands — the same defect from the other end.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2010 tests / 85 suites | `5da281ff32f3` | 2 m 45 s | start 7.3 / med 9.7 / max 17.3 |
| `harness:ios` | **PASS** | 601 tests / 31 suites + isolated 6 tests / 3 suites | `5da281ff32f3` (ios tree) | 14 m 49 s | start 11.3 / med 10.8 / max 30.4 |
| `harness:android` | **PASS** | 657 tests / 31 suites + isolated 6 tests / 3 suites | `a57685d120dd` (android tree) | 18 m 23 s | start 6.7 / med 5.0 / max 13.2 |
| `real-input:ios` | **PASS** | — | `5da281ff32f3` (ios tree) | 44 m 27 s | start 15.3 / med 11.3 / max 97.7 |
| `real-input:android` | **PASS** | — | `5da281ff32f3` (android tree) | 67 m 40 s | start 11.1 / med 7.3 / max 51.5 |
| `harness:android:-t:wheel%20variant` | stale | 657 tests / 31 suites | c749a35e04e8 (not this tree) | 1 m 02 s | start 5.4 / med 5.0 / max 5.4 |
| `harness:android:DatePicker` | stale | 19 tests / 1 suites | 37936848b36d (not this tree) | 27.0 s | start 8.9 / med 8.2 / max 8.9 |
| `real-input:android:--control:date-picker` | stale | — | ef30471dccaa (not this tree) | 6 m 47 s | start 3.9 / med 3.9 / max 7.2 |
| `real-input:android:--control:date-picker:--background` | stale | — | e9e8a5c85cb6 (not this tree) | 0.4 s | start 3.8 / med 3.8 / max 3.8 |
| `real-input:android:--control:picker` | stale | — | 5de08269fd41 (not this tree) | 7 m 07 s | start 4.9 / med 4.3 / max 14.4 |
| `real-input:android:date-picker` | stale | — | 37936848b36d (not this tree) | 0.3 s | start 41.4 / med 41.4 / max 41.4 |
| `real-input:ios:--control:date-picker` | stale | — | b07e22b9377b (not this tree) | 13 m 31 s | start 14.6 / med 18.1 / max 38.1 |

`need --for review`: `✓ check`, `✓ harness:ios`, `✓ harness:android`, `✓ real-input:ios`,
`✓ real-input:android`. `need --for merge` still names `harness:android`: merge matches every gate on
the whole tree, review on a platform's own half, and the only commit since that run is
`RealInputTests.swift`, which moves `trees.ios` to `d6aea28dbe21` and leaves `trees.android` at
`4db576ac7650` — byte for byte the tree that run covered. The merge host re-keys all five anyway.

**Two greens of the load-sensitive fling:** `real-input:android` sits twice in the ledger on that same
`trees.android`, both PASS — `16:58:27Z` (66 m 13 s) and `20:28:37Z` (67 m 40 s), each reading
`expected N, saw N` for all five drum rolls. `real-input:ios:--control:date-picker` is the filtered
red/green pair above, one run either side of `c7da9333`.

## Questions for orchestrator

Round 1's two questions were both answered before fix round 2 started, so nothing is held open here.

- **The double-report** — answered: a settle must not be a wall-clock timeout, and the definition
  was left to the gesture and the scroll. Option (a) was taken (a fix round here); (b) and (c) are
  off the table, and the check that caught it was kept rather than relaxed. What came of it is
  `## Fix round 2` above, with the red proof and two greens of the load-sensitive fling.
- **The bench number** — answered: `mount.picker` has no `variant` knob, so no number is quoted
  and the cell is left to the bench host as the one follow-up line the brief allows.
- The gates round 1 owed (`harness:ios`, `real-input:ios`, `real-input:android` twice) are all in
  the generated table in `## Fix round 2`, and `task-ready` is green on this tree.
