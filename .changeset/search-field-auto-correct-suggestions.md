---
'react-native-nitro-ui': patch
---

fix(search-field): `autoCorrect={false}` asks the Android keyboard for no suggestions

An Android `SearchField` with `autoCorrect={false}` asked for no autocorrection and still drew the
keyboard's suggestion strip: Compose reads `autoCorrectEnabled = false` as "send no autocorrect
flag" and stops there. The field now sends `TYPE_TEXT_FLAG_NO_SUGGESTIONS` as well, which asks the
keyboard to offer no suggestions (most keyboards honour it). It is what `TextField` and React
Native's `TextInput` send, and it goes through the same interceptor `TextField` uses. Text keyboards only: a number or phone
keyboard is sent what it was sent before. iOS is unchanged.
