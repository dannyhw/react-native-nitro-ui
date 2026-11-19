---
'react-native-nitro-ui': patch
---

iOS: a `BottomSheet` that UIKit silently refused to present, because another presentation was
starting or ending at that moment, no longer stays closed for the rest of that mount. It reports
`onIsPresentedChange(false)` with no `onDismiss`, and the next `isPresented={true}` presents it.
