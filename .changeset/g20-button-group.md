---
'react-native-nitro-ui': minor
---

New: `ButtonGroup`, a row of commands (_Copy | Paste | Share_) or independent toggles (_Bold | Italic | Underline_) that moves items it cannot fit into an overflow menu.

- Items are data: `{ id, title, systemImage, androidIcon, disabled, toggle, checked, defaultChecked }`. The group calls `onPress(id)` for an action and `onCheckedChange(id, checked)` for a toggle (controlled with `checked`, or uncontrolled with `defaultChecked`) from the row or the overflow menu alike.
- `appearance: 'connected'` uses Material's connected button group on Android and SwiftUI's `ControlGroup` on iOS. A connected iOS group ignores `variant`, `size` and `tintColor`, and falls back to the standard row if it contains a toggle.
- `overflowAccessibilityLabel` names the overflow button. Overflow on iOS needs iOS 16; on iOS 15 the row clips.
