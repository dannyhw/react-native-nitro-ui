---
'react-native-nitro-ui': minor
---

Add `BottomSheet`: a modal sheet whose content is React Native, laid out at the sheet's width and mounted only while it is up. iOS presents UIKit's sheet (`UISheetPresentationController`) in the screen's own chain, and from a window of its own when a React Native `Modal` is on top, so closing that `Modal` cannot strand it; Android shows Material 3's `ModalBottomSheet`. Detents use SwiftUI's names (`'fit'` - the default, which follows the content - `'medium'`, `'large'`, `{ height }`, `{ fraction }`); Android's sheet has two rest positions. `isPresented` is controlled through the event-count handshake, `onDetentChange` reports a drag to another detent, and `onDismiss` fires once the sheet has gone.
