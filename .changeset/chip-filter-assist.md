---
'react-native-nitro-ui': minor
---

Add `Chip`, a label-sized control in two kinds. A filter chip has a selection: SwiftUI `Toggle` with the button style on iOS, Material 3 `FilterChip` on Android. Its `selected` is controlled through the event-count handshake, so a toggle the app refuses snaps back, and an uncontrolled chip takes `defaultSelected`. An assist chip is an action: a bordered capsule `Button` on iOS, Material 3 `AssistChip` on Android, with `onPress`. Both measure themselves from their label, take `disabled`, and on iOS can show a leading SF Symbol with `systemImage`.
