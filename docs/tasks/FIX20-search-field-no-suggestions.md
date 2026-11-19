# FIX20 — An Android SearchField with `autoCorrect={false}` shows no suggestion strip

**Kind:** bugfix · **Devices:** android ·
**Budget:** 1.5 h for round one (it reuses TextField's merged fix; FIX14, a small Android fix, took 1.5 h)

## Goal

On Android, a `SearchField` with `autoCorrect={false}` tells the keyboard to offer no suggestions,
as `TextField` and React Native's `TextInput` do.

## Why

`docs/tasks/FOLLOWUPS.md` "SearchField Android: `autoCorrect={false}` still sends no
`TYPE_TEXT_FLAG_NO_SUGGESTIONS`". Checked against `main`: `HybridNitroUiSearchField.kt` passes only
`autoCorrectEnabled = model.autoCorrect` (line ~247), while `HybridNitroUiTextField.kt` wraps its
field in `InterceptPlatformTextInput` with `NitroUiAutoCorrectInterceptor`, which adds the flag. An
app that turns autocorrect off on a search box still sees the suggestion strip.

## Behaviour

1. With `autoCorrect={false}` the SearchField's keyboard is told no autocorrect and no suggestions;
   with the default it is told what it is told today. A change to the prop on a focused field
   reaches the keyboard.
2. iOS, and everything else about the SearchField, are unchanged.
3. `docs/components/search-field.md` says what `autoCorrect={false}` does on Android.

## Proof

- A harness case on Android reading the flags the keyboard is given (`EditorInfo`, through the
  read-back the SearchField already has), with `autoCorrect` false and true; red with the flag left
  off.
- `harness:android` and `harness:ios` green (the harness file is shared), `check` and
  `need --for review` clean; a patch changeset.

## Out of scope

- The other SearchField lines in FOLLOWUPS (strings, `InputField`, shared `focusMoved` bodies).
- `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/`, and the shared e2e helpers.

## Decided already

- Share TextField's interceptor rather than copying it: move it where both fields can use it, with
  no change to TextField's behaviour (its existing harness cases stay green).

## Context

`android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiSearchField.kt`,
`HybridNitroUiTextField.kt` (`NitroUiAutoCorrectInterceptor`), `example/__tests__/SearchField.harness.tsx`,
`example/__tests__/TextField.harness.tsx`, `docs/components/search-field.md`.
