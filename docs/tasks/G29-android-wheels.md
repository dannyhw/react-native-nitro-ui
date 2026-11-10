# G29 — Real Android wheels: Picker `wheel` and DatePicker's time wheel

**Worktree / branch:** named in your delegation message (`task/G29-android-wheels`). **Round cap:** 1 round, plus at
most 2 fix rounds (D19). **Devices:** your lease (`node scripts/lease.mjs acquire --task G29 --boot`). Export the
lease's environment before any device gate.

## Read first

- AGENTS.md: the perf contract, the event-count handshake, red proofs, **never `pkill`/`killall`**, the README rule
  (D4) and CONTRIBUTING's "README screenshots".
- `docs/DECISIONS.md` D17, D39 and **D40** (pass 3 A: wheels).
- `docs/tasks/Q8-expressive-and-holdbacks.report.md` rows 7 and 8 and Appendix E pass 3 A: Picker `wheel` becomes
  material3 1.5's `ScrollField(state = rememberScrollFieldState(itemCount, index), …)`, and DatePicker
  `variant="wheel"` with `mode="time"` becomes `TimeScroll` (`TimePickerDisplayMode.Scroll`). Both are new in this
  beta: their height, semantics and settle are unmeasured, and **the value commits on settle**.
- Picker and DatePicker as they are on `main` (`docs/components/picker.md`, `date-picker.md`, both Android files),
  including Picker's new `radio` variant, the sizing engine and each component's declared fallbacks.

## Do

1. **Picker `variant="wheel"` on Android** draws `ScrollField` with Picker's options, `selectedIndex`, `disabled`,
   `tintColor` (the wheel's colours, or document what it can't take) and `accessibilityLabel`. The value goes through
   Picker's existing `applyUserSelection` and event-count handshake, so a refused pick snaps back and picking the
   shown row reports nothing. **One event per settled value**, never one per row the wheel passes.
2. **DatePicker `variant="wheel"` + `mode="time"` on Android** draws `TimeScroll` (24-hour or 12-hour per the device
   setting, as the existing `TimePicker` does), through DatePicker's existing value, clamps and handshake, one event
   per settle. `mode="date"` and `"datetime"` with `wheel` stay the inline calendar, documented.
3. **Sizing (D17):** measure each wheel on the device (don't copy iOS numbers), with sizing keys, conformance rules and
   fallbacks that don't coincide with the real size. A change of variant remounts.
4. **Accessibility:** what TalkBack gets from each wheel (the value, adjust actions, the label), measured from the
   accessibility tree; anything missing goes in the report as a gap.
5. **Recycling** resets the wheel state fully.
6. **Docs:** `picker.md` and `date-picker.md` (the "No wheel on Android" limits go, the Android columns and the
   measured boxes change), the README usage blocks if they mention it, a minor changeset, and stories showing both
   wheels. Retake `picker-android.png` or `date-picker-android.png` only if the story's first screen changes.

adb `-s <serial>` on your own leased emulator is approved for screenshots. Undo `adb reverse` and the debug-host
preference afterwards, and restore any setting you change (read it first; never `cmd uimode`, not even to read).

## Tests, each shown red first

- Harness, Android: each wheel sizes from a poisoned fallback; a programmatic scroll to another row settles to one
  event with the right index or time (red if events fire per row passed); a refused value snaps back; disabled sends
  nothing; recycling from `wheel` to `menu` (and back) resets; the DatePicker `date` wheel still draws the calendar.
- Real input, Android: a fling on each wheel ends in exactly one event for the settled value, and the value shown
  equals the value reported.
- iOS: unchanged; both iOS gates stay green.

**Bench:** `mount.picker` with `variant="wheel"` on Android against the current menu, numbers in the report.

## Not in scope

iOS changes, a date wheel on Android, and anything else, which goes as one FOLLOWUPS line.

## Gates

`check`, both `harness:*` and both `real-input:*`, then `need --for review`. Report at
`docs/tasks/G29-android-wheels.report.md`, with the measured boxes at the top. Export the ledger with
`gate.mjs export --task G29`.
