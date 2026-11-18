---
'react-native-nitro-ui': patch
---

`ButtonGroup`: an item that moves into the overflow menu keeps its `androidIcon` in its menu row,
and an iOS toggle item is drawn in the group's `variant` like the action item beside it — in the
group's colour in both states, one style step apart, so an unchecked toggle is not drawn the way a
disabled item is.
