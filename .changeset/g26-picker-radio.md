---
'react-native-nitro-ui': minor
---

`Picker` now has `variant="radio"`, which shows every option at once instead of behind a menu.

- Android shows a Material 3 radio group, one tappable row per option. `label` names the group for screen readers and is not drawn; `tintColor` colours the selected option.
- iOS falls back to the menu, because SwiftUI has no radio-group style. Use `SegmentedControl` if you need every choice visible on iOS.
- The value is still an index, and `onChange`, `label`, `disabled` and `tintColor` mean what they did.
