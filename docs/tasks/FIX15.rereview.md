MERGE

# FIX15 re-review, fix round 1 (e749cbb2, round d51dc954..HEAD, base 4cf99e54)

I ran `check` once here: PASS, 18 steps, 124 s. No lease was running real-input:ios. FIX14's note
lists it as a later step. `need --for review` is satisfied. No device runs. PR #106: CodeRabbit's
review was still processing, with no inline comments.

## Earlier findings

- **M1 closed.** `git diff main...HEAD -- src` prints nothing. `expectShownOnRequest(false)`
  (`Form.harness.tsx:2820`) now guards against the switch coming back.
- **M2 closed.** `.changeset/lucky-views-arrive.md` is empty, which is right: only test-seam
  Kotlin, docs and the harness change. Nothing ships that a user would see.
- N3 closed: FOLLOWUPS now says the cause is unknown. N4 closed: the case parks at 700 dp and
  takes its baseline after settling.

## Answers

- Harness cases. Each of the five red proofs matches a distinct guard: opted-out `contentH`,
  opted-out `scroll`, the control's lift, the control's `contentH` and `rect` while opted out. The
  premises are asserted (`focus=8`, `keyboard=`, `ime≈300`, `rectBelow=1`). The baselines are
  measured, not 0, and nothing is loosened. The fixed waits back "nothing moved" claims, which the
  mutations show would have moved inside them. The opt-in `rect` case keeps its round-1 proof.
- `focusedRowIndex()` is cheap: it follows the `findFocus` chain and walks the tree once. It runs
  only from `buildFormReport`, which only `nuiTestFormReport` calls. Its index order matches
  `rows=`. It is correct for every Form the harness mounts. See N1 for a nested Form.
- `form.md:194-201` is true on both platforms. Opted out, iOS removes its keyboard observers and
  Android gates the padding and the reveal. Neither stops ordinary scroll-view focus scrolling, and
  the text now says so. The promise of an unchanged offset is gone, and so is "scroll the row
  yourself", which no API allowed. The prop doc equals `main` and is true.
- Scope and hygiene are clean: nothing under `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/`
  or `example/e2e`, one author and nothing personal. `(FIX15)` in test titles follows the
  harness's existing practice (`(E1)`, `(R3)`).

## New findings (no M)

- **N1.** `HybridNitroUiForm.kt:378-388`: the KDoc says -1 means nothing below has focus. For a
  field in a Form nested inside a row, the walk stops at the inner row. `collect` does not descend
  into the outer row (`:479`), so the outer Form reports -1 while focus is in its tree. This is
  test-only: fix the wording, or stop at the outermost row below `this`.
- **N2.** `Form.harness.tsx:564,2680` call `FOCUSED_ROW = 8` (`:556`) "the eighth row". It is a
  0-based index, so the field is in the ninth row.
- **N3.** PR #106's title and body still describe the withdrawn change: "keeps an Android Form's
  scroll offset", the scroll view's setting "now follows `keyboardAvoidance`", and focus scrolling
  stopping for d-pad, Tab and TalkBack. The orchestrator should rewrite them before merge.
- **N4.** `FIX15.report.md` "Fix round 1" is 272 words. The limit is 200.
- **N5.** `FOLLOWUPS.md:43-44` says the repeats during the original task had the same symptoms.
  The old entry said only that the case "failed repeatedly". Drop the clause.
