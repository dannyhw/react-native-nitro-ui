---
'react-native-nitro-ui': minor
---

`Picker` gained `variant="radio"`: every option on screen at once instead of behind a menu.

- **Android shows a Material radio group** — one 48 dp row per option, the whole row tappable, one accessibility element per row carrying its own selected state. `label` names the group for a screen reader and is not drawn; `tintColor` paints the selected dot.
- **iOS shows the menu**, because SwiftUI has no radio-group picker style. If an iOS layout needs every choice visible, `SegmentedControl` is the control for up to about five options.
- **Nothing else moved.** The value is still an index, and `onChange`, `label`, `disabled` and `tintColor` keep their meanings. Tapping the row already chosen reports nothing, and a disabled group reports nothing.
