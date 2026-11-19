---
'react-native-nitro-ui': patch
---

`Chip`: on iOS a filter chip that is both selected and disabled keeps a dimmed version of its selected fill. SwiftUI's disabled bordered style drops a toggle's selected fill, so a dimmed filter chip drew exactly the same selected or not and the selection looked withdrawn. The chip now lays the bordered style's tint back for that state, faded toward the system background colour and drawn under the label, so the label stays SwiftUI's own and is as legible as an unselected dimmed chip's. Android is unchanged.
