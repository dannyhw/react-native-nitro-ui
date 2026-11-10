---
'react-native-nitro-ui': minor
---

`SearchField` takes `keyboardType`, `autoCapitalize` and `autoCorrect`.

- The three props are `TextField`'s, with its values and its platform mapping, so a search field can open the number keypad, an email keyboard or a phone pad. Their defaults are what `SearchField` was always fixed to — `'default'`, `'none'`, autocorrection on — so a field whose app passes no keyboard prop is configured exactly as it was.
- The Return key is still Search, and still the only key that submits: Material 3 merges its own `ImeAction.Search` over whatever keyboard options the field is handed.
- Android now uses Material 3 1.5's stateful `SearchBarDefaults.InputField`, which is what lets a keyboard option reach the field at all; the box around it is a plain `Surface` with the bar's own shape and colours, so the field looks and behaves as it did.
- A keyboard prop changed while the field is focused reaches the open keyboard on both platforms: iOS reloads it, as it does on `TextField`, and Android restarts the field's input session. `docs/components/search-field.md` has both rules, and the one keyboard with no Return key on iOS.
