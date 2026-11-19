---
'react-native-nitro-ui': patch
---

`Form` on Android: `keyboardAvoidance={false}` now also stops the Form's own scroll view scrolling a row into view, so a keyboard coming up over a Form that opted out leaves its scroll offset where it was. The platform carries a request to show the focused row to that scroll view whatever the Form itself answers, so the opt-out had one path it did not close
