---
'react-native-nitro-ui': minor
---

Both wheels are the platform's own now. `Picker` with `variant="wheel"`, and `DatePicker` with `variant="wheel"` and `mode="time"`, draw Material 3 1.5's wheel widgets on Android, where they were a menu and the inline calendar.

- **A drum, not a dropdown.** `Picker variant="wheel"` draws `ScrollField` — Material's own pager — with the same `options`, `selectedIndex`, `disabled`, `tintColor` and `accessibilityLabel`, so the variant that used to be iOS-only is one control on both platforms. `tintColor` paints the selected row and the centre band; the rows that are not selected keep Material's own content colour, which is the one thing on a wheel it cannot reach.
- **One event per settled roll.** A drum reports the row nearest its centre line as it turns, so both wheels read the value at a _rest_: a roll across four rows is one `onChange`, and the index or instant it carries is the row the drum came to rest on. Rolling to the row already shown reports nothing, a value the parent refuses rolls back, and a disabled wheel sends nothing at all.
- **`DatePicker`'s wheel is a time wheel.** `mode="time"` gets `TimeScroll`, in the device's own 24- or 12-hour form; `mode="date"` and `"datetime"` stay the inline calendar, because Material 3 has no wheel calendar and a drum of days would be a control of ours with Material's paint on it. It is the one place `variant` does not mean the same thing on both platforms, and `docs/components/date-picker.md` says so.
- **Sizes are the widget's own, measured on the device.** Each wheel reports what it laid out at, under a sizing key of its own, and a variant change remounts rather than reuses — a wheel and a menu are different widgets with different boxes, and a size carried from one to the other was never measured.
- **Recycling resets the drum.** A host that goes from wheel to menu, or comes back as a wheel, leaves no scroll position, no provisional row and no pending report behind.
