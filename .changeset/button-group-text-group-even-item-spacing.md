---
'react-native-nitro-ui': patch
---

`ButtonGroup`: on iOS, every item of a `text` group that holds a toggle is measured at the size of
the capsule a checked toggle takes, so an action item is no longer drawn in less room than a toggle
beside it and the items are evenly spaced whatever mix of them the group holds. The row still does
not change size when a toggle is checked or unchecked, and a `text` group with no toggle keeps the
size it had.
