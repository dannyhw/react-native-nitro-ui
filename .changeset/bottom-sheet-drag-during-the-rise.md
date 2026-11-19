---
'react-native-nitro-ui': patch
---

An Android `BottomSheet` drag that starts while the sheet is still rising is now followed, when the sheet owns the gesture — one on the header, on the sheet's own body space, or on the grabber. When such a drag ends the sheet settles at the detent the drag asked for, and a drag back down closes it with the usual slide out. Content that takes its own touches keeps them during the rise as it does after it: a scroller, a text field, or a control that claims the gesture. Before, a drag the sheet owned and began before the opening animation came to rest moved nothing: the sheet finished rising and rested at the detent it opened at.
