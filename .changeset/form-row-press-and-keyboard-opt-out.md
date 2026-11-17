---
'react-native-nitro-ui': patch
---

`Form.Row` with `onPress` no longer presses when a tap lands on what nitro-ui draws itself inside it — the control answers, and the row answers the taps that land beside it and the ones that land on a component that only holds its children — and `keyboardAvoidance={false}` now leaves the Form's content size alone while the keyboard is up
