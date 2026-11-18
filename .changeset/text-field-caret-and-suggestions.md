---
'react-native-nitro-ui': patch
---

fix(text-field): the caret stays where a `maxLength` cut was made, and `autoCorrect={false}` takes the suggestions away

Typing into the middle of a full `TextField` on iOS cut the edit in the right
place and then moved the caret to the end of the field, because writing the cut
text back into a UIKit control puts the caret there. The caret now ends just
after the part of the edit that was kept - after a paste, after a composition's
commit (UIKit puts its own insertion point after the whole insertion when it ends
one, and the caret goes in again after that), and after a cut as long as the text
that follows it.

On Android `autoCorrect={false}` now sends the keyboard `TYPE_TEXT_FLAG_NO_SUGGESTIONS`
as well as no autocorrect flag, which is what actually stops it drawing a suggestion
strip over the word at the caret, and what React Native's `TextInput` sends. Text
keyboards only: a number or phone keyboard, and a secure field that keeps
`autoCorrect` on, are sent what they were sent before.
