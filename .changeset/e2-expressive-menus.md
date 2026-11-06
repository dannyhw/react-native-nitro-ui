---
'react-native-nitro-ui': minor
---

Menus on Material 3 Expressive, and two new row props. On Android, `Menu` and `ContextMenu` open Expressive's menu: each section, each submenu and each run of top-level actions is its own rounded group instead of being split by dividers, and `Picker`'s dropdown takes the same container and draws its selected row as selected, with a check. Every menu row (`MenuAction`) gains `subtitle` (a second line: `UIAction.subtitle` on iOS, supporting text on Android) and `checked` (a check: a menu toggle on iOS, a selected row with a leading check on Android). A checked row still reports a pick through `onSelect`; the app flips its own state.
