---
'react-native-nitro-ui': minor
---

New: `Form`, `Form.Section` and `Form.Row` for grouped, settings-style lists whose rows are ordinary React Native views.

- iOS draws an inset grouped list; Android draws Material 3 Expressive's segmented-list shapes. Any view can be a row, and a nitro-ui control inside one behaves as it does anywhere else.
- `Form.Section` takes a `title` and a `footer`. `Form.Row` adds `onPress`, `accessory` (`'none' | 'disclosure' | 'checkmark'`) and `selected`.
- A focused field stays above the keyboard on both platforms; pass `keyboardAvoidance={false}` to opt out.
- Limitations: no virtualisation, so very long lists should use FlashList or Legend List. On iOS, VoiceOver can still reach a pressable row's content as separate elements.
