---
'react-native-nitro-ui': patch
---

`SegmentedControl`'s `tintColor` documentation now says why iOS ignores it, and the behaviour is checked rather than asserted in prose. Nothing changes for an app: the prop paints the selected segment's container and border on Android and does nothing on iOS, as before. What changed is the reason given — the earlier text said the knob was unreachable from SwiftUI, which turned out not to be true. The hosted control is reachable, and setting its `selectedSegmentTintColor` does paint the segment, but iOS 27 drops the colour from the screen the first time the selection moves while the property keeps reporting the colour that was written, and taking it back off leaves the old colour behind. A tint that survives until the first tap is worse than a prop that never did anything, so the row stays a documented Android-only prop — and a new on-device pixel probe fails the suite on either platform if that sentence ever stops being true.
