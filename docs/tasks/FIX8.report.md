**Branch:** `task/FIX8-text-field-caret-and-suggestions` (from `main` at `978ace33`) ·
**Round:** 1 of up to 3 · **Lease:** `FIX8-94ulr` (iPhone Air sim + `emulator-5570` / Metro 8293, 9293)

## Summary

Two `FOLLOWUPS.md` lines about `TextField`'s editing, one per platform.

**iOS.** The `maxLength` backstop already cut the right part of the edit, then wrote the cut text
back into the UIKit control - which moves the caret to the end of what it wrote. Typing into the
middle of a full field therefore threw the caret to the end of the field. `NitroUiCommitDelta.clamp`
now answers with the caret as well as the text: the offset just after the part of the edit that was
kept. `userEdited` puts it there, an edit refused whole goes back where it was asked for, and an
edit at the end still leaves the caret at the end. UIKit finishes a composition's own insertion
after that and puts its own insertion point after the whole insertion, after the callback that
reported the edit, so a cut inside a commit owes its caret until `unmarkText()` has returned.
The editing code is `TextField`'s and `SearchField`'s shared half, so a search field gets the
caret too.

**Android.** Compose reads `autoCorrectEnabled = false` as "send no `TYPE_TEXT_FLAG_AUTO_CORRECT`"
and stops there, and a keyboard that was merely not asked for autocorrection keeps drawing its
suggestion strip over the word at the caret. React Native's `TextInput` also sends
`TYPE_TEXT_FLAG_NO_SUGGESTIONS`, which is the flag a keyboard actually reads. Compose's own field
stays: `InterceptPlatformTextInput` - Compose's own way to reach the `EditorInfo` - wraps the
request the field hands the IME and adds the flag - to a text `inputType` only, since it is one of
Android's text-class flags and means nothing to a phone or number keyboard. A field that keeps the default, a secure field that keeps
`autoCorrect` on, and the non-text keyboards are sent what they were sent before. A change on a
focused field reaches the keyboard that is up: Compose restarts the input session on its changed
`KeyboardOptions`, and the same interceptor answers the new request.

Both proofs read the platform rather than the props, so two fields were added to the test state:
`caret`, and `suggestions` - what the keyboard was told (iOS: the field's own
`autocorrectionType`; Android: the `EditorInfo` a focused field hands the IME, read once per
keyboard configuration and `unknown` before that). The distinction is the bug: the state already
answered `autoCorrect: false` while the keyboard was sent nothing that closes its suggestion strip.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2178 tests / 96 suites | `8ddf9a9da29d` | 55.3 s | start 14.3 / med 14.3 / max 15.8 |
| `harness:ios` | **PASS** | 604 tests / 30 suites + isolated 6 tests / 3 suites | `8ddf9a9da29d` (harness:ios digest) | 14 m 19 s | start 6.0 / med 9.5 / max 35.5 |
| `harness:android` | **PASS** | 662 tests / 31 suites + isolated 6 tests / 3 suites | `8ddf9a9da29d` (harness:android digest) | 18 m 23 s | start 6.0 / med 9.5 / max 33.0 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:android:TextField.harness` | **PASS** | 19 tests / 1 suites | `8ddf9a9da29d` (harness:android digest) | 26.2 s | start 8.7 / med 11.6 / max 13.2 |
| `harness:ios:TextField.harness` | **PASS** | 19 tests / 1 suites | `8ddf9a9da29d` (harness:ios digest) | 29.5 s | start 8.7 / med 11.1 / max 13.2 |

## Red proofs

Both are `node scripts/gate.mjs harness:<platform> -- TextField.harness` on a tree with the fix
taken back out, against the same suite that passes on the real tree.

- iOS: `TextField keeps the caret after the part of a mid-field edit the backstop keeps` ->
  `userEdited` writes the cut text and skips `nuiSetCaret` -> `expected 8 to be less than 8` at
  `expect(cut.caret).toBeLessThan(cut.text.length)`
  (`example/__tests__/TextField.harness.tsx:628`): the caret is back at the end of the field.
  That run: 1 failed, 18 passed.
- Android: `TextField tells the keyboard what autoCorrect asked for` -> `nuiApplyAutoCorrect`
  returns `inputType` unchanged, so no suggestions flag is sent -> `the keyboard to be told no
  suggestions never happened; last report {"autoCorrect":false, ..., "suggestions":"offered"}`:
  the state already answers that the prop is off, which is exactly why the keyboard had to be
  asked. That run: 1 failed, 13 passed, 5 skipped.

## Files changed

- `ios/components/TextField/NitroUiTextLimit.swift`: `Clamp` - the kept text and the caret after
  it; `clamped` stays as its text, which is what the host-side test reads.
- `ios/components/TextField/NitroUiTextEditing.swift`: the backstop puts the caret back after
  writing the cut text; `nuiCaret` / `nuiSuggestionsOffered` on the shared control protocol.
- `ios/components/TextField/HybridNitroUiTextField.swift`: both fields in the published state and
  in the snapshot a recycled field answers with until it publishes again.
- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiTextField.kt`:
  `nuiApplyAutoCorrect`, the input-method interceptor that carries the flag, and the `EditorInfo`
  read-back behind `suggestions`.
- `src/components/TextField/TextField.nitro.ts`,
  `nitrogen/generated/ios/swift/NitroUiTextFieldTestState.swift` and its Android and C++ siblings,
  `etc/react-native-nitro-ui.api.md`: `caret` and `suggestions` in the test state.
- `example/__tests__/TextField.harness.tsx`: the cut-caret cases, and the keyboard case.
- `docs/components/text-field.md`, `.changeset/text-field-caret-and-suggestions.md`,
  `docs/tasks/FOLLOWUPS.md`.

## Follow-ups

- SearchField Android: `autoCorrect={false}` still sends no `TYPE_TEXT_FLAG_NO_SUGGESTIONS`; the
  interceptor here could be shared, and the field then wants the same read-back. Noted in
  `FOLLOWUPS.md`.
- Android read-back: `currentEditorInfo()` now exists in both
  `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiSearchField.kt` (which predates
  this task) and `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiTextField.kt`, and
  could become one internal helper.
- A secure field that keeps `autoCorrect` on reads `offered`, and a change to `autoCorrect` on a
  focused secure field does not restart its input session, so the flag reaches that keyboard only
  when the field is next focused.
- `BottomSheet.harness` (iOS) lost one chunk to "the native app crashed during test execution",
  with no crash log to print, on an earlier run of this tree taken while the machine was busy with
  another task's run; a later full run of the same tree passed all 30 suites. An app death the
  harness cannot show a log for is worth a look when it next appears.

