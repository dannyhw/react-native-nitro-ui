FIX ROUND

# FIX8 review (branch `task/FIX8-text-field-caret-and-suggestions` at 899288ad)

The Android half is sound and meets Behaviour 2. The iOS composition commit, one of the three
paths Behaviour 1 names, still leaves the caret in the wrong place. The test that should catch
this was loosened until it passed. `check` was run here once and passed (18/18).

## Must fix

**M1. The caret after a cut composition commit misses Behaviour 1, and its assertion was loosened
to get green.**
- `example/__tests__/TextField.harness.tsx:627`: commit 3e95e1db asserted `expect(cut.caret).toBe(5)`.
  Commit 6bc56e0b changed it to `toBeGreaterThanOrEqual(5)`. AGENTS.md says "Never loosen an
  assertion ... to reach green."
- The fixture inserts `xyz` at 3 and keeps `xy`, so the right caret is 5. `[5, 8)` also accepts 6
  (after the space) and 7 (between `c` and `d`), both wrong. It only fails for the old bug, a
  caret at the end. The red proof (`expected 8 to be less than 8`) is real, but it is the only
  wrong caret the test can catch.
- UIKit quirk or early write? Evidence says early write. The test commits via
  `nuiSetMarkedText('')` -> `input.unmarkText()` (`NitroUiTextEditing.swift:186`); the backstop
  runs inside the `editingChanged` / `textViewDidChange` UIKit fires from within that call
  (`:274-275`). The report's "one further" is 6 = 3 + 3, the end of the whole marked insertion:
  UIKit setting its selection after the commit, over the backstop's 5. All three controls are our
  subclasses and none overrides `unmarkText()` (grep), so nothing re-applies the caret once UIKit
  is done. Applying a pending caret after `super.unmarkText()` (or a hop sequenced after UIKit's
  update, with a comment saying why it is not redundant) should land it exactly; the report shows
  no attempt. With a one-unit cut, "one further" and "end of the whole insertion" coincide.
- Fix: re-apply the caret after UIKit finishes the commit, in shared code (SearchField too);
  restore `toBe(5)`; add a case cutting two or more units where the readings differ and neither
  is the end, e.g. `ab··cdef`, limit 9, compose `wxyz`: kept `w`, caret 4, UIKit's would be 7.
- Shipped text wrong today: `.changeset/...md:10` ("The caret now ends just after the part of the
  edit that was kept") is false for compositions by the branch's own doc.
  `docs/components/text-field.md:175` ("Either way the caret stays where the person was typing")
  contradicts 177-180, and 180 ("does not ... go to the end of the field") is false by 177-179's
  own mechanism when the cut is at least as long as the text after it (`ab|cd`, limit 5, compose
  `xyzw`: 2 + 4 = 6 in a 5-unit text). Once fixed, both can simply state Behaviour 1.

**M2. The shipped doc comment for `suggestions` describes values the code never returns.**
- `src/components/TextField/TextField.nitro.ts:99-101` says Android "answers `'pending'` until
  that has been read, and reports what the props ask for while no keyboard is up".
- `HybridNitroUiTextField.kt:913-918` answers `'unknown'` in both cases. It never says `pending`
  and never echoes the props.
- iOS answers `'offered'` when there is no control (`HybridNitroUiTextField.swift:739`), not
  `'unknown'`.
- The type is in the published declarations (`etc/react-native-nitro-ui.api.md:1051-1052`).
  Rewrite it to what the code does. The harness's own comment
  (`TextField.harness.tsx:69`, `'offered' | 'refused' | 'unknown'`) is already right.

## Nice to have

**N1. The Android read-back cannot show that a prop change reaches the keyboard.**
- The interceptor reads `model.autoCorrect` live as each connection is built (`.kt:455`). The probe
  builds a fresh `EditorInfo` through that same interceptor (`currentEditorInfo`, `.kt:950-966`).
- So `refused` after the rerender (`harness:987`) would read the same even if Compose never
  restarted the session. It proves the flag arithmetic, not delivery.
- The behaviour itself holds. I checked Compose foundation-android 1.12.1 bytecode:
  `TextFieldDecoratorModifierNode.updateNode` calls `startInputSession` when the focused field's
  `KeyboardOptions` differ. That restart keeps the text and selection, which live in
  `TextFieldState`.
- Soften the test comment "the change reaches the keyboard that is up" (`harness:996`), or read
  the input type from the live session (for example, what `InputMethodManager` was last given).

**N2. On a secure field the restart does not happen.**
- `autoCorrectEnabled = model.autoCorrect && !secure` (`.kt:530`) leaves `KeyboardOptions` equal
  when `autoCorrect` changes on a focused secure field. No session restarts, and the interceptor's
  new flag only reaches the IME at the next focus.
- `docs/components/text-field.md:73-74` ("restarts its input session") is not true there. User
  impact is close to nil, since password keyboards draw no strip. Narrow the sentence.

**N3. The iOS secure-field assertion was dropped to a log (`harness:1026-1041`).**
- fcbda70c asserted `iOS ? 'refused' : 'offered'`; 6bc56e0b kept only the Android half.
- The iOS read is the trait this code sets from the prop (`.default` for `autoCorrect` true,
  `NitroUiTextEditing.swift:83`), so it is deterministically `'offered'`. The comment "iOS decides
  for itself ... so the answer there is only logged" describes something the seam does not read.
- Assert `'offered'` on both. No brief promise is left untested (Behaviour 2's secure clause is
  Android-only), but it is the same loosening pattern as M1.

**N4. Path coverage.**
- The test drives only the composition commit. Paste goes through the delegate's partial insert,
  which already set the caret on main (`main:NitroUiTextEditing.swift:142`), so using
  `nuiTestPaste('', 3)` only to position the caret is fine.
- The `insertText` backstop (what `typeText` uses, `harness:563`) and the new "refused whole ->
  caret at `change.location`" branch (`NitroUiTextLimit.swift`, the `fitting == nil` return) have
  no caret assertion.
- `Clamp.caret` is a pure function with no case in `scripts/native-tests/text-limit.test.swift`,
  where cut-text cases already live.

**N5. A per-keystroke allocation in production.**
- `suggestionsReport()` (`.kt:913-914`) evaluates `probedConfig == keyboardConfig()`, so every
  `publishState` (every edit) builds a five-part string, even though `probedConfig` is always
  `null` outside tests. Test `probedConfig != null` first. (iOS's `nuiCaret` read is negligible.)

**N6. Report accuracy.**
- The file is `docs/tasks/FIX8-text-field-caret-and-suggestions.report.md`, not the
  `docs/tasks/FIX8.report.md` that AGENTS.md "Report" names.
- Its follow-up "`autoCorrect={false}` on a secure field sends no `TYPE_TEXT_FLAG_NO_SUGGESTIONS`"
  is the opposite of the code. `nuiApplyAutoCorrect` adds the flag to a password input type (text
  class) when the prop is false. It is the default secure field that reads `offered`.

## Checked and fine

- **Android flag.** Set only for `TYPE_CLASS_TEXT` (`.kt:322-331`): number, decimal,
  `NumberPassword` and phone untouched; text, email, url, password and multi-line get it, as RN
  does. The interceptor only ORs `inputType` after `createInputConnection` fills `outAttributes`,
  so `imeOptions`, capitalization and hint locales survive; `PlatformTextInputMethodRequest`
  (ui-android 1.12.1, javap) has one member, so the lambda drops nothing. Cost: once per input
  session, never per keystroke; `remember(model)` keeps one interceptor per host.
- **Test seam.** iOS reads `selectedTextRange` and the `autocorrectionType` trait; Android reads
  `TextFieldState.selection` and an `EditorInfo` the focused view builds. The probe runs only from
  `nuiTestState` (tests only), once per keyboard configuration, reset in `prepareForRecycle`.
- **Red proofs** match their mutations (8 at `:628`; `offered`, never `refused`). No timeout or
  retry added; both harness gates ran on the final digest.
- **Scope and hygiene.** SearchField gets the iOS change via the shared `userEdited`; nothing under
  `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/` or the shared e2e helpers; one author
  address; no AI/agent mention, home path, email or hostname; FOLLOWUPS swaps the two lines for the
  SearchField Android one; comments follow AGENTS.md.
- **CodeRabbit.** PR #100 has no inline comments, only the summary.
- **Gates.** `check`, run once here with no `real-input:ios` lease in use: PASS, 18 passed, 63.5 s.
