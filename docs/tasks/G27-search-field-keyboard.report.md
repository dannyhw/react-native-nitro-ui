# G27 — SearchField v2: keyboard props

**Branch:** `task/G27-search-field-keyboard` (from `main` at `48a55871`, rebased onto `d798bee9`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `G27-ul745` (`iPhone Air` / iOS 27 + `emulator-5570` / API 35 · Metro 8293)

## Summary

`SearchField` takes `keyboardType`, `autoCapitalize` and `autoCorrect`: TextField's props, values, mapping and
resolver. `src/core/keyboard.ts` holds the shared vocabulary (both unions, both value lists,
`resolveKeyboardOption`); `TextField` re-exports it, so its public names are unchanged. The props are `T | null` on the
Nitro spec, always passed (nitro#1184), with v1's defaults (`'default'`, `'none'`, autocorrection on), so a field whose
app passes nothing is configured as before, byte for byte in the IME's own record. The Return key stays Search.

**iOS** writes the four traits in `nuiApply()` through `NitroUiTextTraits.Resolved` (TextField's resolver) and calls
`reloadInputViews()` when one moved, so a prop changed while focused reaches the open keyboard.

**Android** uses material3 1.5's stateful `SearchBarDefaults.InputField(textFieldState, searchBarState, …,
keyboardOptions, …)` in a plain `Surface` with the bar's shape and colours (G17's review line). Box, colours, glyph,
clear, submit, `Back` and recycling are unchanged and asserted, so no screenshot was retaken. One correction to that
line: `DisableSoftKeyboard` belongs to material3's *new* `SearchBar(state, …)`; the deprecated `DockedSearchBar` v1
used never intercepted input. What changed is which `InputField` supplies the field. A prop changed while focused
rebuilds the `EditorInfo` but Compose restarts no running session, so `search-field.md` says what happens instead
(the open keyboard keeps its layout until the next focus) and the harness asks Android by refocusing.

`nuiTestState()` reports the keyboard read back off the control (iOS traits, Android's live `EditorInfo`), and
`real-input` grades the same claim from the IME's own `mInputEditorInfo` record.

**Take-over round.** The first implementer stopped mid-task; its work is commit `db686519`. On that tree
`harness:android` was flaky in two SearchField submit cases that are unchanged from `main`: the new on-read refresh
ran a full `publishState()`, so a poll could see a cleared query or a blur before its event reached JS. The refresh
now updates the three keyboard fields only (`3fd47005`). The branch was rebased onto `main` for X22, whose
context-menu a11y fix is what `real-input:ios` needs: on the old base it failed on the ContextMenu sweep and its
stale exemption, neither of them SearchField's.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1996 tests / 84 suites | `1c37ba278d06` | 3 m 54 s | start 28.6 / med 49.0 / max 87.4 |
| `harness:ios` | **PASS** | 565 tests / 30 suites + isolated 6 tests / 3 suites | `1c37ba278d06` (ios tree) | 16 m 26 s | start 62.7 / med 12.4 / max 189.8 |
| `harness:android` | **FAIL** | 1 failed of 621 tests / 30 suites + isolated 6 tests / 3 suites | `1c37ba278d06` (android tree) | 17 m 49 s | start 6.3 / med 6.1 / max 11.8 |
| `real-input:ios` | **FAIL** | — | `1c37ba278d06` (ios tree) | 39 m 44 s | start 4.7 / med 5.9 / max 34.3 |
| `real-input:android` | **PASS** | — | `1c37ba278d06` (android tree) | 59 m 06 s | start 20.0 / med 7.0 / max 118.2 |
| `harness:android:(SearchField%7CForm).harness` | **FAIL** | 1 failed of 30 tests / 2 suites | `1c37ba278d06` (android tree) | 31.9 s | start 7.6 / med 6.3 / max 7.6 |
| `harness:android:(SearchField%7CForm).harness:--runInBand` | **FAIL** | — | `1c37ba278d06` (android tree) | 0.9 s | start 7.6 / med 7.6 / max 7.6 |
| `harness:android:(Switch%7CForm).harness` | **FAIL** | 1 failed of 29 tests / 2 suites | `1c37ba278d06` (android tree) | 23.8 s | start 4.6 / med 5.3 / max 5.9 |
| `harness:android:(TextField%7CForm).harness` | **FAIL** | 1 failed of 30 tests / 2 suites | `1c37ba278d06` (android tree) | 34.4 s | start 5.2 / med 4.9 / max 5.3 |
| `harness:android:Form.harness` | **PASS** | 14 tests / 1 suites | `1c37ba278d06` (android tree) | 18.0 s | start 8.9 / med 8.5 / max 8.9 |
| `harness:android:SearchField` | stale | 16 tests / 1 suites | 68338fd3c9e8 (not this tree) | 28.9 s | start 15.0 / med 17.7 / max 17.9 |
| `harness:android:SearchField:--background` | stale | — | fad47ba31d17 (not this tree) | 1.6 s | start 5.1 / med 5.1 / max 5.1 |
| `harness:ios:SearchField` | stale | 1 failed of 16 tests / 1 suites | 6169b090dcca (not this tree) | 38.8 s | start 30.2 / med 26.0 / max 30.2 |
| `real-input:android:--control:search-field` | stale | — | ac7859f9a6ab (not this tree) | 11 m 54 s | start 3.7 / med 5.0 / max 13.5 |
| `real-input:ios:--control:search-field` | stale | — | 6169b090dcca (not this tree) | 11 m 31 s | start 20.5 / med 10.0 / max 47.0 |

`need --for review`: `✗ harness:android — red` (`need: 1 gate(s) missing for review: harness:android`); `check` and
`harness:ios` green.

**Both reds are outside SearchField, and every SearchField case is green in them.**

- `harness:android`: one failure, `Form (G24) › starts a recycled Form at the top of its own content` (`expected 200 to
  be less than or equal to 1`), on two full runs of this tree (at load 6, and at ~20). The filtered rows above are the
  diagnosis: `Form.harness` alone passes, and Form after *any* suite fails, `Switch` included, so it is an order
  dependency in G24's recycled-Form case, not this diff. G25/G26 runs fail the same case. SearchField's 16 cases pass in both full runs.
- `real-input:ios`: only `a11y:context-menu` and its debt row `a11y:ios-debt` fail, the X22 sweep red G26's report
  also records on every run; X22's fix round is not on `main` yet. `testRealInputSearchField` passed (74.9 s), and so did the
  `a11y:search-field` sweep.

## Red proofs

Recorded as data in `docs/tasks/G27/mutations.json`.

- `KeyboardNamesTest.kt` -> decode the variation before the class -> `expected:<number-pad> but was:<url>` (2 of 7)
- `real-input-ime-frame.test.js` -> scrape `mCurEditorInfo` (the reader's pre-device cut) -> `expect(received).not.toBeNull() — Received: null`
- `SearchField.harness.tsx` (Android) -> `keyboardOptions = KeyboardOptions(imeAction = Search)` -> `the number-pad keyboard to reach the field never happened`
- `real-input:android` search-field -> same mutation -> `expected class=number … saw class=text … action=search`
- `SearchField.harness.tsx` (iOS) -> keyboard trait pinned to `.default` -> `a focused field to reload its own keyboard never happened`
- `RealInputTests.testRealInputSearchField` -> same mutation -> `keyboardType="number-pad" should open a number keyboard, not the 35 keys …`
- `SearchField.harness.tsx` submit cases (Android) -> full `publishState()` on each read -> `expected [ 'change:' ] to deeply equal []` (2 of 4 runs red; 0 of 6 after the fix)
- **Not a proof:** the recycle reset (keep the last owner's keyboard in `reset()`) stays green, because every prop is always passed and the next owner's values land on mount. The recycle assertions document the invariant; no JS read sits between `reset()` and the first prop write.

## Files changed

- `src/core/keyboard.ts` (new); `src/components/TextField/TextField.tsx` re-exports it.
- `src/components/SearchField/*`, `nitrogen/generated/**`: the three props, config and test-state fields.
- `ios/components/SearchField/HybridNitroUiSearchField.swift`, `ios/components/TextField/NitroUiTextEditing.swift`.
- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiSearchField.kt` (stateful `InputField` in a `Surface`, `EditorInfo` read-back),
  `HybridNitroUiTextField.kt` (shared `NitroUiKeyboardNames` decode).
- Tests: `android/src/test/java/com/margelo/nitro/nitroui/KeyboardNamesTest.kt`, `scripts/__tests__/real-input-ime-frame.test.js`,
  `example/__tests__/SearchField.harness.tsx`, `example/ios/NitroUiExampleUITests/RealInputTests.swift`,
  `scripts/real-input/{android,controls,ime-frame,screens}.mjs`, `example/src/SearchFieldScreen.tsx`.
- `README.md`, `docs/components/search-field.md`, `.changeset/search-field-keyboard.md`.

## Follow-ups

- Form harness: `starts a recycled Form at the top of its own content` fails on Android in full runs (also in G25/G26 runs); not SearchField's.
- `real-input:android --control <id>` still runs the whole a11y sweep; a `--section` filter would cheapen red-proof rounds.
- Android: a `restartInput` nudge would let a prop changed while focused restyle the open keyboard, as iOS does.
- iOS `.numberPad`/`.decimalPad` have no Return key, so such a SearchField cannot submit from the keyboard (documented only).
- The pool keeps `show_ime_with_hard_keyboard=0`; a CONTRIBUTING line on `withFullSoftwareKeyboard` would save the next task a red run.
- `check` skips `test:native:android` silently-green when `ANDROID_HOME` is unset; it should fail or mark the step skipped in the gate line.
- SearchField still has no `returnKeyType`, `autoFocus`, `selection`, `submitBehavior`, `multiline` or `secureTextEntry` (out of brief).

## Questions for orchestrator

- **`harness:android` is red only on G24's Form order dependency.** Options: (a) accept G27 for review on the green
  SearchField evidence and route the Form case to its own task (recommended: it reproduces with `Switch` before Form,
  so no G27 change can turn it green); (b) hold G27 until that is fixed on `main`, then re-run `harness:android` only.
  `real-input:ios` waits on X22's fix round the same way, and is not a review gate.
