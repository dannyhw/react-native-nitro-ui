---
'react-native-nitro-ui': minor
---

Add `Checkbox`: Material 3 `Checkbox`, and `TriStateCheckbox` while `indeterminate`, on Android, and SwiftUI `Toggle(isOn:)` with the switch style on iOS — which has no checkbox, so this is what Expo's universal `Checkbox` renders there too. `checked` is a controlled value on Switch's event-count handshake, `defaultChecked` starts an uncontrolled one, and `label` is part of the control and of its size on both platforms, with the whole row tappable. `indeterminate` is a display and Android-only: a press reports the opposite of what the box shows, so a _checked_ third-state box reports `false` and Android callers clear `indeterminate` in `onCheckedChange`, while iOS reads the third state as off and reports `!checked`.
