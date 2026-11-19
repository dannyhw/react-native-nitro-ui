# FIX20 — An Android SearchField with `autoCorrect={false}` shows no suggestion strip

**Branch:** `task/FIX20-search-field-no-suggestions` (from `main` at `fd0ba959`) · **Round:** 1 of up to 3 ·
**Lease:** `FIX20-2635m` (`emulator-5570` + `iPhone Air` simulator / Metro `9293` and `8293`)

## Summary

`HybridNitroUiSearchField` now wraps its Compose field in `InterceptPlatformTextInput`, so the
`EditorInfo` an Android `SearchField` hands the IME carries `TYPE_TEXT_FLAG_NO_SUGGESTIONS` when
`autoCorrect={false}` — the flag that actually takes a keyboard's suggestions away, as `TextField`
and React Native's `TextInput` send. With `autoCorrect` on, or on a keyboard outside Android's text
input class, the field is sent what it was sent before. iOS is unchanged.

The interceptor is `TextField`'s, moved whole into `android/src/main/java/com/margelo/nitro/nitroui/NitroUiAutoCorrect.kt`
as `internal`. Both fields build their input on the shared `TextFieldModel`, so the interceptor
needed no generalisation and `TextField`'s behaviour did not move.

The test state gains `suggestions`, and the reason is worth reading before the diff: the existing
`autoCorrect` read-back decodes a text `EditorInfo` as `false` whenever the autocorrect flag is
absent, which is what Compose sends with `autoCorrect={false}` *with or without* this fix. It
cannot distinguish a refused keyboard from one left its suggestions, so it cannot be the proof.
`suggestions` decodes `TYPE_TEXT_FLAG_NO_SUGGESTIONS` alone — `NitroUiKeyboardNames.suggestionsOf`,
which `TextField` already reports — and says `unknown` where nothing has been read: Android while
the field is unfocused or its `EditorInfo` is not yet probed, iOS before its control exists. iOS
answers from the control's `autocorrectionType`, the trait UIKit gives the keyboard. Android folds
it into the existing one-probe-per-`EditorInfo` read-back: asking a field for an `EditorInfo` closes
the connection the keyboard is using, so it is not done twice per keystroke.

The harness case reads `suggestions`, never the prop, and turns `autoCorrect` back on without the
field losing focus — that step is what proves a change reaches the keyboard that is already up.

`docs/components/search-field.md` says what `autoCorrect={false}` does on each platform. A patch
changeset covers the fix; the new published Kotlin source is recorded in
`etc/package-files.txt`.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2191 tests / 97 suites | `6ae776d73d1b` | 1 m 01 s | start 6.5 / med 7.3 / max 8.9 |
| `harness:ios` | **PASS** | 619 tests / 30 suites + isolated 6 tests / 3 suites | `13854ece8c31` (harness:ios digest) | 16 m 45 s | start 6.3 / med 6.2 / max 31.4 |
| `harness:android` | **PASS** | 677 tests / 31 suites + isolated 6 tests / 3 suites | `13854ece8c31` (harness:android digest) | 18 m 19 s | start 19.3 / med 6.0 / max 23.9 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:android:SearchField.harness:-t:tells%20the%20keyboard%20what%20autoCorrect` | stale | 1 failed of 17 tests / 1 suites | 3e7714af0b55 (not this tree) | 21.0 s | start 21.3 / med 19.0 / max 21.3 |

`need --for review`: `need: review is satisfied on this code tree.` The real-input gates are
deliberately left for merge.

## Red proofs

- `SearchField > tells the keyboard what autoCorrect asked for` -> delete the
  `InterceptPlatformTextInput(remember(model) { NitroUiAutoCorrectInterceptor(model) })` wrapper in
  `SearchFieldHost.Component`, so the field is handed no `TYPE_TEXT_FLAG_NO_SUGGESTIONS` and nothing
  else changes -> `SearchField keyboard: the keyboard to be told no suggestions never happened; last
  report {…, "autoCorrect":false, "suggestions":"offered"}` — the read-back that cannot see the flag
  still said `false`, which is why `suggestions` exists.

## Files changed

- `android/src/main/java/com/margelo/nitro/nitroui/NitroUiAutoCorrect.kt`: the interceptor both
  fields use, moved out of `HybridNitroUiTextField.kt`.
- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiSearchField.kt:140`: wrap the field;
  `suggestions` in the keyboard read-back, the snapshot and the refresh that compares it.
- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiTextField.kt`: the interceptor moved
  out; no behaviour change.
- `ios/components/SearchField/HybridNitroUiSearchField.swift:541`: `suggestions` from the control's
  autocorrection trait.
- `src/components/SearchField/SearchField.nitro.ts`, `src/components/SearchField/SearchField.tsx`,
  `nitrogen/generated/**`, `etc/react-native-nitro-ui.api.md`, `etc/package-files.txt`: the new
  test-state field and the new published source.
- `example/__tests__/SearchField.harness.tsx:840`: the new case, and `suggestions` on its state type.
- `docs/components/search-field.md`, `.changeset/search-field-auto-correct-suggestions.md`.

## Follow-ups

- `check`: one run of `test:tooling` read `nitrogen/generated/**` paths another step is
  regenerating — 3 `ENOENT` failures, green on the next run of the same code tree.
- `NitroUiKeyboardNames.autoCorrectOf` still answers a text `EditorInfo` by the autocorrect flag, so
  `autoCorrect` in either field's test state reports `false` for a keyboard that was left its
  suggestions; `suggestions` is the only field that can tell.
