---
'react-native-nitro-ui': minor
---

Wheel pickers on Android now draw real wheels. `Picker` with `variant="wheel"`, and `DatePicker` with `variant="wheel"` and `mode="time"`, use Material 3's `ScrollField` drums, where they previously showed a menu and the inline calendar.

- `Picker variant="wheel"` takes the same `options`, `selectedIndex`, `disabled`, `tintColor` and `accessibilityLabel` on both platforms.
- A wheel reports one `onChange` when it comes to rest, not one per row it passes.
- `DatePicker`'s time wheel has a drum for hours and minutes, plus AM/PM on a 12-hour device.
- `mode="date"` and `"datetime"` with `variant="wheel"` still show the inline calendar on Android, because Material 3 has no date wheel.
