---
'react-native-nitro-ui': patch
---

Fix a recycled `DatePicker` keeping the previous owner's sizing policy on Android, which stretched a `compact` field to its parent's width. `sizingPolicy` lives on the host, not the model, and the `variant` setter that moves it compares against the model's variant — which `prepareForRecycle` has already put back to `compact`, so the next mount saw "no change" and never restored it. An app reached it by unmounting an `inline` (or `wheel`) picker and mounting a field afterwards in the same screen, with React Native's view recycling on. `Picker` and `Progress`, and iOS's `DatePicker`, already reset the line; only Android's `DatePicker` was missing it.
