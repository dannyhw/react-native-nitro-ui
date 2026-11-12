---
'react-native-nitro-ui': minor
---

`SearchField` now takes `keyboardType`, `autoCapitalize` and `autoCorrect`.

- They accept the same values as on `TextField`. The defaults match the old fixed behaviour (`'default'`, `'none'`, autocorrect on), so existing fields are unchanged.
- The Return key is still Search and still the only key that submits.
- Changing a keyboard prop while the field is focused updates the open keyboard: iOS reloads it, and Android now restarts the keyboard.
- On iOS, `'number-pad'` and `'decimal-pad'` have no Return key, so the field cannot be submitted from the keyboard.
