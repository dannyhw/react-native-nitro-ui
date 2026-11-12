---
'react-native-nitro-ui': minor
---

`ConfirmationDialog`'s actions on Android now use Material 3 Expressive's segmented rows, and disabled actions are properly disabled.

- On Android the actions draw as one grouped card inside the sheet, with Expressive press feedback.
- A disabled action ignores presses, is announced as disabled by TalkBack, and is drawn disabled, including a `destructive` or `tintColor` action.
- Action order, `dismissible`, `titleVisibility` and `AlertDialog` are unchanged. iOS is unchanged.
