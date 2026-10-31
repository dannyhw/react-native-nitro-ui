---
'react-native-nitro-ui': patch
---

Fix a recycled `DatePicker` keeping the previous owner's sizing policy on Android, which stretched a `compact` field to its parent's width. An app reached it by unmounting an `inline` (or `wheel`) picker and mounting a field afterwards in the same screen, with React Native's view recycling on.
