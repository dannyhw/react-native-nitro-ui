MERGE

# FIX8 review, fix round 2 (branch `task/FIX8-text-field-caret-and-suggestions` at e6bab47c)

This round closes both Ms. No path left on the single-line field or SearchField lets a person
reach an open claim. One path that rests on unobserved UIKit behaviour remains on the
multi-line field (N1). It is cheap to close by hand. `check` was run here once (no lease was in
`real-input:ios`): PASS, 18 passed, 65.5 s. `need --for review` is satisfied on this tree.

## Re-review items

**M3: closed.** No claim opens at the end of the kept text (`NitroUiTextEditing.swift:331`).
Without a claim, the cut-tail sequence leaves nothing to act on. The claim now ends on a focus
change (`HybridNitroUiTextField.swift:738`, `HybridNitroUiSearchField.swift:449`), on `syncText`
when it writes (`NitroUiTextEditing.swift:291`), on a `maxLength` set (TextField `:585`,
SearchField `:359`), on the next `userEdited` (`:303`), and on recycle (both views). The red
proof matches its mutation. On the unfixed tree the claim is (5, 7]. `q` lands at 6, is pulled
back to 5, and `r` goes in before it: `abcdxrq` at `TextField.harness.tsx:705`.

**M4: closed.** The changeset (`:11-12`), `docs/components/text-field.md:180-182`, the test
comments (`:634-635`, `:650-651`) and the report now all say "one past the part that was kept",
and "at 4, not at 5". That matches the round-1 red proofs: 6 for caret 5, and 5 for caret 4.

**N1 (repeated text): done.** **N3 (KDoc): done and true.** A secure field gets
`autoCorrectEnabled = model.autoCorrect && !secure` (`.kt:534`), so its options never change. The
interceptor reads `model.autoCorrect` when the connection is built (`.kt:452-460`).

## Answers

1. **Single-line field and SearchField (both `UITextField`): no reachable path.** The round-1 red
   proof (6, not 5, with the caret written only in the commit callback) shows that UIKit writes
   one past our caret after every `unmarkText()` commit. `caret < keptUnits` keeps that offset
   inside the text. The window (`upTo` >= caret + 1) always covers it, so the claim ends a few
   milliseconds after it opens. Select-all, a selection starting before the caret, the clear
   button and the `-1` read at resign end it without moving the caret; a paste or undo goes
   through `userEdited`; JS has no selection API and its changes arrive after the late write;
   recycle resets `owedCaret` and `markedStart`.
   - A second composition, dictation, or a hardware or candidate commit through `insertText`
     instead of `unmarkText()` has no observed late write. This is N1.
2. **Dropping the two tests is sound for `UITextField`.** The late write above ends the claim
   before any JS-driven blur, value write or `maxLength` change can arrive. A resign also reads
   `-1` (`NitroUiTextEditing.swift:137-138`), and that ends the claim without restoring. Neither
   test can go red there, so neither can be kept. A form that could go red is the same pair on
   the multi-line field, if `UITextView` writes no late caret. That needs a caret-seat seam for
   `UITextView` (`nuiTestPaste` is single-line only, `HybridNitroUiTextField.swift:822-824`). It is
   the open question in N1 and the first review's N2.
3. **The capture is correct.** UIKit's `offset(from:to:)` counts UTF-16 on both controls. The
   last composing step wins, so a marked range replaced several times uses its latest start. The
   anchor is taken back to a grapheme boundary (`NitroUiTextLimit.swift:100-105`). An anchor
   earlier than the real edit cannot change the text: the shared text it re-inserts is the head
   of the insertion, and `fitting` keeps the head. Only the caret could move, and only inside a
   repeated run. The red proof is consistent with its fixture. Without the anchor, the edit is
   found at 7 (`aaa····` shared), one space is kept, and the caret is 8. With the anchor it is
   5 + 1 = 6 (`:745`).
4. **No assertion was loosened.** The round's test diff only adds code and rewords comments.
   `timeout: 5000` is the file's usual value. The fixtures do not coincide with the answer: 6 is
   neither the seat (5), UIKit's position (7) nor the diff's answer (8), and `abcdxqr`/7 differs
   from the bug's `abcdxrq`/6.
5. **The docs are true.** The changeset, the docs page and the KDoc are written for an app
   developer. The comments follow AGENTS.md "Comments", with no history and no references.
6. **Perf is fine.** With no claim open, a selection change costs one `if let`, and a keystroke
   costs one nil store. `nuiMarkedStart` is read only while composing, and the anchor loop runs
   only on a cut. Everything stays on main, with no timers and no hops.
7. **Scope is clean.** The round touches the nine files of its items only, and nothing under
   `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/` or the shared e2e helpers. There is one
   author address, and no AI or agent mention, home path, email, hostname or personal device
   name.

## New findings

**N1. The multi-line field reports a keystroke's selection before its edit, so the "next edit"
closer comes too late there.**
- React Native's own adapter works around this ordering:
  `node_modules/react-native/Libraries/Text/TextInput/RCTBackedTextInputDelegateAdapter.mm:341-348`
  runs `textViewDidChange` from inside `textViewDidChangeSelection`.
- The effect: a keystroke's selection change in a `NitroUiMultiLineField` (`:356`) reaches
  `nuiSettleCaret` (`NitroUiTextEditing.swift:169-177`) while the claim is still open. If the
  caret is within (caret, upTo], it is pulled back. This is M3's reversed-keys failure, in the
  middle of the field.
- When it can happen: only if a claim outlives UIKit's late write. That would be on a
  `UITextView` with no late write after `unmarkText()` (never observed), or on any control whose
  commit comes through `insertText`. A second composition started in the same turn as a commit
  (an IME committing one segment and marking the rest) could also have its caret moved while
  marked text is open, whatever the callback order. It is an M if a multi-line cut case shows no late write.
- Hand fix, about five lines: add the kept text's UTF-16 length to `NitroUiOwedCaret`; in
  `nuiSettleCaret` restore only when `!nuiComposing` and the length still equals it, else
  discard. UIKit's late write changes no text, so the proven paths keep working.

**N2. The N1 red-proof line names no mutation** (`FIX8.report.md:134`). It should read
"`edit` without `anchoredAt`". The fixture's arithmetic gives 8, so the claim itself holds. The
report also does not mention the dropped mid-field `maxLength` case (commit `eb443c17`).

**N3. The bound for a refused replacement does not count the deletion** (CodeRabbit 4620003091).
`upTo = caret + committed - kept` is caret + 1 when the cut restores a deleted unit.
CodeRabbit's example (`abQ cdef` → `😀`) assumes UIKit lands after the whole insertion, which the
round-1 red proof disproves; under the observed caret + 1 the bound covers it. Not valid on the
evidence, and a wider bound would widen N1's window. **CodeRabbit (newer than the re-review):**
4620003082 (clear the claim on a `value` write) is fixed by `syncText`'s discard (`:291`), which
also covers the held-back write (`:355-357`); 4620003091 is N3.
