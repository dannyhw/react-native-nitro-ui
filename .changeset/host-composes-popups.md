---
'react-native-nitro-ui': minor
---

`<Host>` now composes every control the library ships: `SegmentedControl`, `Picker` and `DatePicker` join `Switch`, `Slider`, `Progress` and `Button` on Android. Each keeps its own documented sizing rule inside the shared composition; a hosted `Picker`'s menu and a hosted `DatePicker`'s dialog are windows of the Host's own composition, anchored to the row the Host drew and closed by the same outside tap, back gesture or row that has always closed them. A React Native `Modal` child is still refused: that window belongs to React Native, not to the composition.
