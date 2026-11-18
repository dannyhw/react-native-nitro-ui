FIX ROUND

# FIX8 re-review, fix round 1 (branch `task/FIX8-text-field-caret-and-suggestions` at 54ab5556)

The mid-field fix works and its tests are honest. Two problems remain. The cut's claim on the caret
never ends at the end of the field, and the shipped text explains UIKit's part with a claim the
branch's own red proof disproves. `check` was run here once, with no lease in use: PASS, 18 passed,
60.5 s.

## First review

**M1: closed for the case it names.** `toBe(5)` is back (`TextField.harness.tsx:624`), and a
four-unit case reads `toBe(4)` (`:661`). Both drive a real commit: `nuiSetMarkedText(text)` calls
`setMarkedText`, then `''` calls `unmarkText()` on the control through the new override
(`NitroUiTextEditing.swift:209-223`). The red proofs match the round's mutation, which writes the
caret only in the commit callback: 6 at :624 and 5 at :661. SearchField and the multi-line field
get the same override and delegate body. Recycle clears the claim on both views
(`HybridNitroUiTextField.swift:710`, `HybridNitroUiSearchField.swift:485`).

**M2: closed.** On iOS the first snapshot is `'unknown'` (`HybridNitroUiTextField.swift:464`).
After that it is the trait, or `'offered'` when there is no control (`:761`). On Android it is
`'unknown'` unless the field is focused and the read-back for the current configuration is in
(`.kt:913-918`). The comment at `TextField.nitro.ts:98-103` now says exactly this.

## Must fix

**M3. At the end of the field the claim never closes, and it later moves the person's caret.**
- Only `nuiSettleCaret` closes it, and only when it sees a caret other than `owed.caret`
  (`NitroUiTextEditing.swift:159-164`). Blur, a JS `value` write (`syncText`), a `maxLength`
  change and the next edit all leave it open. Only recycle clears it.
- A cut at the end sets `owed.caret` to the end of the text (`NitroUiTextLimit.swift:154-157`).
  So does an edit there that is refused whole (`:144`). In both cases `upTo` is past the end
  (`NitroUiTextEditing.swift:304-305`). UIKit's late write cannot land past the end, so nothing
  ever closes the claim. The test `leaves the caret at the end when the cut is at the end` passes
  in exactly this state. If any settle had seen a caret other than 5 in that 5-unit text, nothing
  would have restored it and `toBe(cut.text.length)` would fail. So the claim is still open when
  that test ends.
- How a person hits it: `abcd`, `maxLength={5}`, compose `xyz` at the end and commit. That leaves
  `abcdx` with caret 5 and the window (5, 7]. The app then raises `maxLength`, and the person types
  `q`. The caret moves to 6, the window catches it and puts it back to 5 (`:161-162`), so `r` lands
  before `q` and the field reads `abcdxrq`. A JS `value` write longer than 5 while focused is
  pulled back the same way.
- The cut at the end is the most common commit, and with IME input a full field opens a new claim
  on every refused commit at the end.
- Fix: no forward caret exists for UIKit to write, so open no claim when `caret` is the kept
  text's length. Close any claim on focus change, `syncText` and the next `userEdited`.
- Test (none today would catch a claim moving a later caret): extend `cut-tail`. Rerender with
  `maxLength={10}`, `typeText('qr')`, and expect `abcdxqr` with caret 7. Today it reads
  `abcdxrq`.

**M4. The shipped explanation of UIKit's write is false by the round's own red proof.**
- `.changeset/text-field-caret-and-suggestions.md:11-12` says "UIKit puts its own insertion point
  after the whole insertion". `docs/components/text-field.md:180-182` says the same, and adds "at
  4, not at 7".
- The second red proof, with no rewrite, reads **5**, not 7 (report, Fix round 1). So UIKit lands
  one past the kept part, not after the whole `wxyz`. The first case cannot tell the two apart:
  6 is both.
- The report and the test comments (`:634-635`, `:650-651`, "7 (after the whole insertion)") repeat the claim.
- Fix: drop the mechanism clause, or say "one past the kept part". The caret values themselves
  are right.

## Nice to have

**N1. CodeRabbit (valid): repeated characters lose the location.** With `aaaa` and limit 5,
committing `aa` at offset 1 reads, to the diff, as an insertion at 4
(`NitroUiTextLimit.swift:83-104`). The caret goes to 5, the end, where 2 is right. The text is
unaffected because the characters are the same. The fix is to carry the marked range's start into
`clamp`. The diff is older than this round, but the caret derived from it is new in this task.

**N2. No cut-caret case for the multi-line field or SearchField.** Only `UITextField`'s late write
is observed. Nothing shows that `UITextView` writes one after `unmarkText()` returns. If it does
not, a mid-field claim stays open there with its window inside the text, which is M3's failure in
the middle of the field.

**N3. CodeRabbit (valid, internal comment):** the KDoc at `HybridNitroUiTextField.kt:443-445`
still says a change to `autoCorrect` always restarts the session. It does not on a secure field
(first review N2; the shipped doc is now narrowed).

## Checked and fine

- **Masking.** `applyingCut` covers only the cut's own `nuiSetText` / `nuiSetCaret`. It is reset
  on the same stack frame, and the recursive settle from the restore finds the claim already nil.
  It cannot loop.
- **Paste and plain `insertText`.** Neither opens a claim (`compositionEnded` is false).
- **Threading and cost.** All work runs in UIKit callbacks on main, with no timers or hops. With
  no claim open, a selection change costs one `if let` and the existing `publishState`.
- **Docs.** The paste case (5) matches the delegate's `range.location + fitting`. A cut at least as
  long as the text after it, in mid-field (`ab|cd`, 5, `xyzw` -> 3), restores: UIKit's 4 is inside
  (3, 6].
- **Scope and hygiene.** The round touches only its eight files. Nothing under `scripts/`,
  `.claude/`, `AGENTS.md`, `docs/agents/` or the shared e2e helpers. One author address, and no AI
  or agent mention, home path, email or hostname. The new comments follow AGENTS.md.
- **CodeRabbit.** Two inline comments, both newer than the first review: N1 and N3.
