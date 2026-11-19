# FIX12 — Finish the Android BottomSheet's rising-sheet drag, and prove it

**Kind:** bugfix · **Devices:** android ·
**Budget:** 3 h for round one (FIX11's rounds each took about 3 h on the same code)

## Goal

On Android, a drag on a `BottomSheet` that is still rising is followed like a drag on a settled
sheet, and the full `real-input:android` run passes with the drag case in it.

## Why

FIX11 (this branch's history, PR #102) found the cause of a flake seen three times in merge runs
(`bottom-sheet.e2e.ts` "a drag up on the two-detent header", `moved from 1391 to 1391`): Material
turns its drag on only once the opening animation has settled. Its two fix rounds put the fix in
(the sheet root measures a rising-sheet drag in `dispatchTouchEvent`, takes only the drag Material
would take, and ends it through Material's own state calls), but three of its new real-input cases
are red for test reasons, and one run showed a possible real defect. Read
`docs/tasks/FIX11-bottom-sheet-drag-ignored.report.md` (both fix rounds, the measurements and the
questions) and `docs/tasks/FIX11.review.md` first.

## Behaviour

1. A drag up on a rising two-detent sheet expands it; a drag down on a rising sheet slides it out
   and reports the dismissal; a sticky sheet stays up; a sideways drag on content inside a rising
   sheet neither expands nor dismisses it. The next ordinary open reports exactly the events it
   did before FIX11.
2. After a drag expands a rising sheet, one Back steps it down a detent and a second closes it, as
   for a settled sheet. FIX11 saw the first Back close the sheet in two of three runs: find why and
   fix it.
3. Every settled-sheet behaviour is unchanged.

## Proof

- `node scripts/gate.mjs real-input:android -- --control bottom-sheet` green twice in a row on the
  final tree, then one full `node scripts/gate.mjs real-input:android` green.
- Each FIX11 case shown red once with the mutation it guards (the leaked detent flag, the one-frame
  dismissal, a sideways drag taken), and the Back case red against its cause. One line each.
- `check`, `harness:android` and `need --for review` clean.

## Out of scope

- iOS; other BottomSheet lines in FOLLOWUPS; the drag on the sheet's own ScrollView while rising.
- `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/`, and the shared e2e helpers (`support.ts`,
  `os-tree.ts`, `reader.ts`, `keyboard.ts`, `device-read.ts`, `press-feedback.ts`).

## Decided already (FIX11's questions)

- Slide-out case: at least one box read on the way down plus the reported dismissal is the proof;
  zero boxes is the vanish it guards against.
- Detent-report case: close the reopened sheet before the log read and assert both closes.
- Sideways case: the expected log includes the dismissal a close reports.
- No other assertion is loosened, no wait lengthened and no retry added.

## Context

`android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiBottomSheet.kt`,
`example/e2e/real-input/bottom-sheet.e2e.ts`, the FIX11 report and review in `docs/tasks/`.
