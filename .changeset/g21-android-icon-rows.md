---
'react-native-nitro-ui': minor
---

`androidIcon` now works on `Menu` and `ContextMenu` action rows and on `Chip`.

- It takes the same values as `Button`'s `androidIcon`: a `require()`d vector drawable or a drawable name. iOS keeps using `systemImage`, so a row that wants a glyph on both platforms passes both, with no `Platform.select`.
- On Android the glyph uses Material's own leading-icon slot, size and colour, and dims with the row when it is disabled. On a `checked` menu row the check mark takes the slot instead.
- A selected filter `Chip` shows its check mark in place of the glyph.
- Submenu labels do not take a glyph on either platform.
