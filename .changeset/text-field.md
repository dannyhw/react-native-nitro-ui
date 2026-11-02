---
'react-native-nitro-ui': minor
---

Add `TextField`: a single- or multi-line text field with React Native `TextInput`'s prop names, on `UITextField` (a `UITextView` when `multiline`) on iOS and Compose `BasicTextField(TextFieldState)` on Android. The text is controlled through the event-count handshake, a `value` written while an IME composition is open is dropped rather than applied over it, `maxLength` counts UTF-16 code units without splitting an emoji, a multi-line field grows with its text, and `ref` gives `focus()` and `blur()`. `docs/components/text-field.md` lists the props and the platform differences.
