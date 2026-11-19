# FIX16 — Prove the Android rising-sheet drag fix and get its gates green

**Kind:** bugfix (proof only) · **Devices:** android, then ios ·
**Budget:** 2 h for round one (a test re-aim and gate runs on finished code)

## Goal

The rising-sheet drag fix on this branch (FIX11 and FIX12, PR #104) is proven and green, so it can
merge.

## Why

FIX12's last fix round fixed its review's M1 (the drag is measured on the screen) and M2 (the
check for content that scrolls under the finger), with red proofs for two guards. It left: one case
red without any mutation, because its drag starts from a box read that lags the rising sheet and so
lands below the field it means to drag (`example/e2e/real-input/bottom-sheet.e2e.ts`, the case that
leaves an editable child to itself mid-rise); no red proof for M1; the claimed-by-child mutation;
and the gates. Read `docs/tasks/FIX12.report.md` (its `## Fix round 2`) and `docs/tasks/FIX12.review.md`.

## Behaviour

1. No library change, unless a run shows a defect a person could hit; then the smallest fix, said
   in the report.
2. The red case aims its drag where the field is when the drag starts, read from a witness that
   does not lag the rise (for example the sheet root's own box at the moment of the down, or a
   point fixed relative to the sheet's top), and passes for the right reason.
3. M1's fix is shown red once: a press held still on the rising header, with the screen-space
   measurement reverted to view-local, closes the sheet; with the fix it does not. If no injected
   press can land inside the rise, say so with the timings measured and use the closest
   deterministic witness the existing cases allow.
4. The claimed-by-child guard is shown red once by removing only that guard.

## Proof

- `node scripts/gate.mjs real-input:android -- --control bottom-sheet` green twice in a row.
- `harness:android`, `check`, then one full `node scripts/gate.mjs real-input:android` green, then
  `node scripts/gate.mjs real-input:ios -- --control bottom-sheet` green (the example screen changed
  for both platforms; it needs a quiet machine).
- One line per red proof in the report. No assertion loosened, no wait lengthened, no retry added.

## Out of scope

- Anything not listed above, including the other notes in `docs/tasks/FIX12.review.md`.
- `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/`, and the shared e2e helpers (`support.ts`,
  `os-tree.ts`, `reader.ts`, `keyboard.ts`, `device-read.ts`, `press-feedback.ts`).

## Decided already

- This task gets one implementation round and no fix round: at the budget, report what is and is
  not proven.
- Kill only processes this task started and recorded, never one by its look.

## Context

`android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiBottomSheet.kt`
(`RisingDragMeasurement`, `scrollsUnderneath`), `example/e2e/real-input/bottom-sheet.e2e.ts`,
`example/src/BottomSheetScreen.tsx`, and the FIX11/FIX12 reports and reviews in `docs/tasks/`.
