# FIX11 — A drag on an Android two-detent BottomSheet's header always moves it

**Kind:** bugfix · **Devices:** android ·
**Budget:** 3 h for round one (a flake investigation with a fix; no finished one to take a median
from)

## Goal

A person who drags up on a freshly opened two-detent Android `BottomSheet` always expands it; no
drag is silently ignored.

## Why

`docs/tasks/FOLLOWUPS.md` "Flaky tests": `bottom-sheet.e2e.ts` "a drag up on the two-detent header
expands the sheet" failed on 2026-11-16 and again on 2026-11-18 (the first test of a full
`real-input:android` run): `the header's top moved from 1391 to 1391: expected 0 to be greater than
463.67`. Both times it passed on `--rerun-failed`. No log shows the driver at fault, so it is
treated as a library bug with a low hit rate. The failing runs' logs are in
`<main checkout>/.git/nitro-ui-gates/` (search the `real-input+android-*.log` files for that line).

## Behaviour

1. The cause is named with evidence: why the sheet sometimes does not follow a real drag that
   starts on its header (for example a drag that starts while the sheet is still settling, while
   its anchors or nested scroll are not ready, or one Material reads as something other than a drag).
2. If the sheet ignores a drag a person could make, the library is fixed so it follows it. If the
   test starts the drag at a moment no person could (before the sheet has finished rising, by a
   read the test should not trust), the test waits for the right signal instead. No assertion is
   loosened, no retry is added and no wait is lengthened to reach green.
3. The case passes in the full `real-input:android` run.

## Proof

- The flake time box (`.claude/skills/flake/SKILL.md`): 30 minutes and two device runs to make it
  happen, for example the case alone in a loop of runs, or right after a cold app start. If it will
  not reproduce, rank three to five causes against what the logs show, fix the best survivor, and
  say plainly that the race was not reproduced.
- A library fix gets a test that fails without it where a cheap mutation exists, shown red once.
- `node scripts/gate.mjs real-input:android -- --control bottom-sheet` green, then `check` and
  `need --for review` clean; a patch changeset if library code changed.

## Out of scope

- iOS, and the other BottomSheet lines in FOLLOWUPS.
- `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/`, and the shared e2e helpers (`support.ts`,
  `os-tree.ts`, `reader.ts`, `keyboard.ts`, `device-read.ts`, `press-feedback.ts`). If the cause is
  in one of those, stop and report it with the evidence.

## Decided already

- A drag a person makes on the header is always followed; a sheet that is still rising may finish
  rising first, but must not drop the drag.

## Context

`android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiBottomSheet.kt`,
`example/e2e/real-input/bottom-sheet.e2e.ts` (`openSheet`, `restingBox`, the two-detent case),
the BottomSheet example screen under `example/src/`, `docs/components/bottom-sheet.md`.
