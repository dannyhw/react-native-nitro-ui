---
'react-native-nitro-ui': patch
---

An Android `BottomSheet` drag that starts while the sheet is still rising is no longer dropped. When such a drag ends the sheet settles at the detent the drag asked for, and a drag back down closes it with the usual slide out. Before, a drag begun on the sheet's own content — header, body or grabber — before the opening animation came to rest moved nothing: the sheet finished rising and rested at the detent it opened at.
