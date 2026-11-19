---
'react-native-nitro-ui': patch
---

`ButtonGroup`: on iOS, every item of a `text` group that holds a toggle is measured at the size of
the capsule a checked toggle takes, so an action item is no longer drawn in less room than a toggle
beside it: whatever mix of them the group holds, two neighbouring items leave the same room. A
checked capsule fills the room it was measured at while a label leaves a padding either side, so the
space you see beside a checked item is narrower than between two unchecked ones. Such a row is
measured wider than the labels it draws, so it moves items into the overflow menu at a wider box.
The row still does not change size when a toggle is checked or unchecked, and a `text` group with no
toggle keeps the size it had.
