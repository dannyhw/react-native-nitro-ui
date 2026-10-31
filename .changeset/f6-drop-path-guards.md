---
'react-native-nitro-ui': patch
---

Android: a control whose view was unmounted no longer measures or lays itself out until it is attached for a new mount. Before this, a control that was dropped while still attached could answer a measure by building a user interface with nothing left to dispose it, which is a possible Compose leak when a surface stops.
