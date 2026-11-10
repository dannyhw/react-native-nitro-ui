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

The one design decision a reviewer needs: **neither wheel reads its value as it turns.** A
`ScrollField` names the row nearest its snap line continuously — `TimeScrollImpl` forwards
every one of those to `state.hour`/`state.minute` — so the dial's "the fields moved, so
somebody picked" rule would price a roll from 09:20 to 14:05 at fifty-odd events. Both wheels
keep the rule and replace the trigger: the value is read at a *rest*, one rest one report.
Picker has a real rest to subscribe to (`isScrollInProgress`); `TimeScroll`'s drum states are
private to Material's implementation, so rest there is `collectLatest` over the two fields with
a 180 ms window, measured against a real fling rather than guessed. The refused-pick write-back
hangs off the same rest, so a snap-back is the widget moving home, not this file repainting it.

`tintColor` reaches the selected row and the centre band; the unselected rows keep Material's
content colour, which is the one thing on a wheel it cannot take. `variant="wheel"` in
`date`/`datetime` stays the inline calendar — Material has no wheel calendar, and a drum of days
would be our control in Material's paint. That is the one place `variant` means something
different on the two platforms, and `date-picker.md` says so in its Limits rather than in a
footnote.

`TimeScroll` keeps its rows out of the accessibility tree, so the value travels as
`stateDescription` on one node per drum. Two consequences are documented rather than papered
over: the tree carries no rows to compare against a reported value, and the node does not say
`scrollable`, so TalkBack offers no scroll actions on it.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |

`need --for review`: pending.

## Red proofs

- pending

## Files changed

- `android/.../HybridNitroUiPicker.kt`: `ScrollField` drum, the rest-read settle, sizing keys, recycle reset.
- `android/.../HybridNitroUiDatePicker.kt`: `TimeScroll` for `wheel` + `time`, `syncTimeWheel`, date/datetime unchanged.
- `example/__tests__/{Picker,DatePicker}.harness.tsx`, `scripts/real-input/{android,screens}.mjs`: the two wheels' coverage.
- `docs/components/{picker,date-picker}.md`, `README.md`, `.changeset/g29-android-wheels.md`.

## Follow-ups

- picker wheel: `ScrollField` ignores `tintColor` on unselected rows — needs a theme-level scheme, not a per-view tint.
- both wheels: a drum's rows are absent from the a11y tree on both platforms, so "the row shown is the value reported" can only be checked through the app's own echo.
- `TimeScroll`: no settle to subscribe to; if Material ever exposes one, the 180 ms window should go.
