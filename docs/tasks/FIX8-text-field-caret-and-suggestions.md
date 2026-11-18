# FIX8 — TextField keeps the caret after a `maxLength` cut, and `autoCorrect={false}` hides suggestions

**Kind:** bugfix · **Devices:** both ·
**Budget:** 4 h for round one (FIX7, a two-platform fix with harness reads, took about 4 h)

## Goal

Typing into the middle of a full `TextField` on iOS leaves the caret where the person was typing,
and an Android `TextField` with `autoCorrect={false}` shows no suggestion strip, as `TextInput` does.

## Why

Two `docs/tasks/FOLLOWUPS.md` lines (the iOS backstop's caret, Android `autoCorrect=false`). The iOS
backstop writes `text`, which puts the caret at the end; Compose sets no
`TYPE_TEXT_FLAG_NO_SUGGESTIONS`, which React Native's `TextInput` sets for `autoCorrect={false}`.

## Behaviour

1. iOS: when `maxLength` cuts an edit made in the middle of the field (a composition's commit, a
   paste, `insertText`), the caret ends right after the part of the edit that was kept, and the
   text around it is unchanged. An edit at the end leaves the caret at the end, as today.
2. Android: with `autoCorrect={false}` the keyboard is told no suggestions and no autocorrect, the
   flags `TextInput` sends; with the default it is told what it is told today. A secure field and
   the non-text keyboards are unchanged. A change to the prop on a focused field reaches the
   keyboard.
3. `onChangeText`, the event-count handshake and composition behave as before on both platforms.
4. `docs/components/text-field.md` says what `autoCorrect={false}` does on each platform and where
   the caret goes after a cut.

## Proof

- A harness test on iOS that cuts a mid-field edit through the backstop (a seam the harness already
  has, such as `nuiTestPaste` or a marked-text commit) and reads the caret offset; red with the cut
  left as a plain `text` write.
- A harness test on Android that reads the input type the keyboard is given (`EditorInfo` flags)
  with `autoCorrect` false and true, on a text field and on one other keyboard type; red with the
  flag left off. Both harness gates, `check` and `need --for review` clean; a patch changeset.

## Out of scope

- The other TextField and SearchField lines in FOLLOWUPS (the Android `observe`/`settle` order,
  SearchField's shared bodies, its default prompt), unless the same code path forces a change; say
  so in the report.
- `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/`, and the shared e2e helpers (`support.ts`,
  `os-tree.ts`, `reader.ts`, `keyboard.ts`, `device-read.ts`, `press-feedback.ts`).

## Decided already

- Android does what React Native does for `autoCorrect={false}`: no autocorrect and no suggestions.
- Keep Compose's own text field. If the flag cannot reach the keyboard without hand-building the
  input connection, stop with the options and a recommendation.
- SearchField shares the iOS editing code: if the caret fix lands in shared code, SearchField gets
  it too, and its harness gate is the same one.

## Context

`ios/components/TextField/NitroUiTextEditing.swift` (the backstop), `HybridNitroUiTextField.swift`
(`nuiSetText`, `nuiSetCaret`), `NitroUiTextLimit.swift`, `HybridNitroUiTextField.kt`
(`keyboardOptions`, `autoCorrectOf`), `example/__tests__/TextField.harness.tsx`,
`docs/components/text-field.md`.
