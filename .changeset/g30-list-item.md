---
'react-native-nitro-ui': minor
---

New: `ListItem`, a list row drawn by the platform's own row view: UIKit's list content on iOS and Material 3's `ListItem` on Android.

- Props: `title`, `subtitle`, `value`, a leading `systemImage` / `androidIcon`, `accessory` (`'none' | 'disclosure'`), `onPress` and `disabled`.
- Every text slot is one line, truncated at the end, so rows with the same slots filled are the same height.
- Inside a `Form.Row` it becomes the row's content without adding its own insets or highlight.
- Without `onPress` the row has no highlight, is not a button to screen readers, and lets taps through. A `disabled` row is greyed and ignores presses.
