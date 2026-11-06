---
'react-native-nitro-ui': minor
---

Add `Tooltip`: a tooltip the app opens next to its own views, with a message, an
optional title and up to two actions. Material 3's `PlainTooltip` / `RichTooltip`
on Android and a popover with SwiftUI content on iOS. It is controlled
(`isPresented` / `onIsPresentedChange`), never times out, reports an action
before the close it causes, and follows its anchor through layout changes and
scrolls.
