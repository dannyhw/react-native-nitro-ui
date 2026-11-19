---
'react-native-nitro-ui': patch
---

iOS: a `BottomSheet` whose presentation UIKit refused — the silent kind, with no completion and
no presenter for the sheet's controller — no longer stays closed for the rest of that mount. The
controller is let go, `onIsPresentedChange(false)` is reported once with no `onDismiss` (nothing
was on screen to go), and the next `isPresented={true}` presents.
