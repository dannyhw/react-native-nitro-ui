---
'react-native-nitro-ui': minor
---

Add `ContextMenu`: a `View` that opens a menu on a long press, with Menu's `group` as its items. On iOS it is a `UIContextMenuInteraction` with the system's lifted preview; on Android a Material 3 `DropdownMenu` opened at the finger. The children stay in place and keep their own gestures, a hold that opens the menu cancels their touch, and `onOpen`/`onClose` fire on both platforms.
