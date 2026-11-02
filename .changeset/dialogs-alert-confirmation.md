---
'react-native-nitro-ui': minor
---

Add `AlertDialog` and `ConfirmationDialog`: one native view behind both. iOS presents UIKit's `UIAlertController` (an alert, or an action sheet for a confirmation) from a window of its own, so it works inside and over a React Native `Modal`; Android shows Material 3's `AlertDialog`, and a `ModalBottomSheet` of rows for a confirmation. `isPresented` is controlled through the event-count handshake: every native open or close is reported with `onIsPresentedChange`, a tapped action reports `onAction(id)` before the close, and a dismissal the app refuses presents the dialog again.
