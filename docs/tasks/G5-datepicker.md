# G5 — DatePicker

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/G5` (branch `task/G5-datepicker`, from `main`)
**Devices / env:** assigned in the delegation message (D13).
**Depends on:** T10, T02, T11 merged; G4 merged (popup/dialog lifecycle lessons). Follow
`docs/architecture/core.md` and `docs/architecture/sizing.md`. Read `docs/DECISIONS.md`.

## Goal

Native date/time selection: SwiftUI `DatePicker` (`.compact`, `.graphical`, `.wheel`) on iOS;
Material 3 `DatePicker`/`TimePicker` on Android — inline (`DatePicker` in a container) and the
dialog form (`DatePickerDialog` / `TimePickerDialog`) behind a compact field that opens it.

## Public API (JS)

```ts
<DatePicker
  value?: Date                      // controlled (wire as ms since epoch: number)
  defaultValue?: Date
  onChange?: (date: Date) => void
  mode?: 'date' | 'time' | 'datetime'          // default 'date'
  variant?: 'compact' | 'inline' | 'wheel'     // default 'compact'
  minimumDate?: Date
  maximumDate?: Date
  disabled?: boolean
  tintColor?: ColorValue
  style, testID, accessibilityLabel
/>
```
Mapping and gaps must be documented per platform (e.g. Android has no wheel: render the dialog
pickers / inline picker and say so; `datetime` on Android = date then time dialog).
Dates cross the bridge as `number` (ms, UTC); no optional view props (D7): use NaN or sentinel
values for "no min/max" per core.md rules and document. Locale/timezone come from the device.

## Requirements

- Controlled value via the event-count handshake; clamp to min/max natively and in JS.
- Sizing: `compact` = intrinsic (key includes mode + the formatted value? — no: the field width
  depends on locale formatting, which is environment; decide and justify in the report, with a
  test); `inline`/graphical = `fillWidth` with platform height; `wheel` = `fillWidth`.
- Dialogs/popovers close and do not leak when the view is recycled, dropped or the screen unmounts
  while open; the app's back gesture/button dismisses them on Android.
- Timezone/DST: a value round-trips unchanged across a DST boundary (test).
- Accessibility per platform defaults; announced value is localised.

## Deliverables

- Spec, wrapper, iOS + Android implementations, sizing entry, docs page
  `docs/components/date-picker.md` with a per-platform variant/mode matrix.
- Example screen: each mode × variant, min/max, disabled, tinted, controlled with external reset.
- Harness tests: render each variant, value change event, controlled rejection, min/max clamp,
  DST round-trip, dialog dismiss on unmount, recycling-safe.
- Reassure scenario per D9. Bench arm + scenario (mount N=1/50; update K value changes) vs
  `@expo/ui` DateTimePicker (both host configs) and an `rn-core` control (`Text` showing the
  formatted date). Quick-plan tables for both platforms.
- Smoke `App.tsx` line and api-extractor report.

## Acceptance

`bun run check` green; harness green on both platforms; bench tables; screenshots (iOS + Android,
light + dark, each variant, dialog open) in `docs/tasks/G5-datepicker/`.

## 0.2 additions (orchestrator, 2026-10-25)

- **Round cap (D19):** 1 + 2 fix rounds. Read `docs/tasks/G6-picker.md` "Lessons (G1–G4, B1, C1)" —
  they apply here too, especially: popups/dialogs must not register anything per mount that
  survives drop (B1), and over-wide `compact` content fits its box on Android (C1).
- Add **Storybook stories** (Playground with every prop + showcase) per S1's layout, a real-input
  case (open the picker, pick a date) on both platforms, and the smoke per-control layout check (A2).
- Run the harness under Node 24 with an absolute `HARNESS_APP_PATH`.
