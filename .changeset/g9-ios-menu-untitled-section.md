---
'react-native-nitro-ui': patch
---

The iOS `Menu` now draws the rows of a section that has no `title`. Such a section was rendered as a SwiftUI `Section` with a `Divider()` header, and SwiftUI built that as an empty group, so every row in it (a destructive "Delete" under a bare divider, say) was missing from the menu on iOS while Android showed it. An untitled section is now a `Section` with no header: its rows appear, in their own group, set off from the rows above by the system's separator. Android is unchanged.
