---
'react-native-nitro-ui': minor
---

`<Host>` now composes every control the library ships. `Slider`, `Progress` and `Button` join `Switch` (H2a), and `SegmentedControl`, `Picker` and `DatePicker` join them (H2b) — each keeping its own documented sizing rule inside the shared composition, and each popup or dialog still anchored to the row the Host drew and closed by the same outside tap, back gesture or row that has always closed it. A React Native `Modal` child is still refused: that window belongs to React Native, not to the composition.
