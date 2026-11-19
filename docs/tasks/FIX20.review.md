MERGE

# FIX20 review — `task/FIX20-search-field-no-suggestions` at `be8ddb86`

`check` run once in the foreground here (no lease in use for real-input:ios): PASS, 18 steps,
2191 tests, tree `6ae776d73d1b`; the worktree stayed clean afterwards, so codegen and the
manifest match. There are no CodeRabbit comments on PR #113.

## Answers

1. Interceptor on SearchField. `NitroUiAutoCorrect.kt:27-30` lets the inner request fill
   `outAttributes` and then only ORs one bit into `inputType`. `imeOptions` (Search), hint
   locales, capitalization and keyboard class are left alone. `nuiApplyAutoCorrect`
   (`HybridNitroUiTextField.kt:319`) returns non-text classes unchanged, and nothing else is
   touched. It runs once per `startInputMethod`/`createInputConnection`, not per keystroke, and
   `remember(model)` keeps one interceptor for the host's life (`HybridNitroUiSearchField.kt:140`).
   A focused toggle adds no new restart: `autoCorrectEnabled` was already in `KeyboardOptions`
   (`:250`), so Compose restarted the session on this prop before the fix too. Text lives in
   `TextFieldState`, not in the session. The setter (`:430-435`) still only stores and bumps
   the stamp.
2. TextField. `git diff` shows a pure move: same body, `private` becomes `internal`, and three
   imports are dropped. TextField's `tells the keyboard what autoCorrect asked for` and its
   phone-keyboard case (`TextField.harness.tsx:1066-1115`) still guard the shared code.
3. `suggestions` is a field on the test-state struct, not a prop, so the optional-prop rule does
   not apply. It is a non-optional `string`, as in TextField's spec. iOS answers from
   `autocorrectionType` through the existing `nuiSuggestionsOffered`, and `'unknown'` when there
   is no control; the JSDoc says so (`SearchField.nitro.ts:77-83`). The `nitrogen/generated`
   files match the generator (check left the tree unchanged).
4. The red proof matches its mutation. With the wrapper removed, `suggestionsOf` sees no
   `NO_SUGGESTIONS`, which gives `"suggestions":"offered"` next to `"autoCorrect":false`, as
   quoted. The fixtures are the prop, but the answer is decoded from `EditorInfo`, so they do
   not coincide. No existing assertion was loosened.
5. The changeset and the doc are true for an app developer. Nothing was changed under
   `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/` or the shared e2e helpers. There is one
   author (the repo identity) and nothing personal.

## Findings

N1 `example/__tests__/SearchField.harness.tsx:305-313` — step 2 cannot catch a missing IME
restart. The probe calls `onCreateInputConnection` fresh, and the interceptor reads
`model.autoCorrect` live, so `'refused'` shows up even if Compose never restarts the session.
The restart is guarded only by step 3's `offered.autoCorrect === true` (the AUTO_CORRECT bit
comes from the session's captured options). The report's sentence about "that step" is
accurate. The test comment could say that step 3 is what proves the keyboard was restarted.

N2 `SearchField.harness.tsx:310,324` — 8000 ms waits. The file default is 5000 ms, TextField's
identical case uses the default, and there is no comment explaining why SearchField needs more.

N3 There is no SearchField number or phone keyboard case for "text keyboards only". That claim
rests on `nuiApplyAutoCorrect`, which is shared and guarded by TextField's phone case, so this
is acceptable as it stands.

N4 `docs/components/search-field.md:145-146` — "iOS gets `autocorrectionType = .no`" leaves out
`spellCheckingType = .no`, which SearchField also sets (`HybridNitroUiSearchField.swift:81`,
`NitroUiTextEditing.swift:86`). `text-field.md:68` names both.

N5 `NitroUiAutoCorrect.kt:18-20` — the shared KDoc keeps the secure-field paragraph, which only
applies to TextField (SearchField has no secure entry). It now reads as if it covered both
fields. One clause ("TextField's secure field is the exception") would fix it.

N6 `search-field.md:147` and the changeset say `NO_SUGGESTIONS` is what "actually stops" the
strip. The flag is a request, and some third-party IMEs ignore it. The wording matches
`text-field.md`, so any change belongs to both pages.
