---
'react-native-nitro-ui': minor
---

`Checkbox` on iOS now draws a checkmark instead of a switch. **This changes the default look on iOS.**

- The new default is Apple's checklist circle, as in Reminders, with the label beside it.
- `iosStyle: 'circle' | 'square' | 'switch'` picks the look. Use `'switch'` to keep the previous appearance. Android ignores the prop.
- `indeterminate` now draws a dash on iOS too. Screen readers announce the state as "mixed" on iOS and "Partially checked" on Android. If `checked` is also true, the checkmark wins.
- Tapping the label toggles the box as well as tapping the glyph.
