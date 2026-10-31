---
'react-native-nitro-ui': patch
---

Android: a hosted control whose mount has ended no longer measures or lays itself out. It now waits until it is attached for a new mount, which is the first moment it has a window and a composition strategy again. Before this, a control dropped while it was still attached would answer a measure by building a composition with nothing left to dispose it.
