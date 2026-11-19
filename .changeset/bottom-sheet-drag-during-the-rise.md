---
'react-native-nitro-ui': patch
---

An Android `BottomSheet` drag that starts while the sheet is still rising is followed instead of dropped. Before, a drag begun on the sheet's own content before the opening animation came to rest moved nothing: the sheet finished rising and rested at the detent it opened at
