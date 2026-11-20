# FIX24 — The Android ContextMenu bottom-edge case reads the popup it opened, once

**Kind:** bugfix (tests only, unless a run shows a library fault) · **Devices:** android ·
**Budget:** 2.5 h for round one (one test case and its helper; three filtered runs)

## Goal

`example/e2e/real-input/context-menu.e2e.ts` "at the bottom edge the menu opens above the finger"
passes on slower machines when the menu works, and a real fault (two popups, or a hold that never
opens the menu) fails it with a message that says which.

## Why

It failed in 2 of 3 GitHub-hosted CI jobs of run 44653752776, and once locally (merge gate
2026-11-17 21:38 UTC). Triage of the CI artifacts:
- **Ambiguous read (line ~389):** `popupBox` (about line 138) waits for `getByText("Bottom one")`
  straight after the hold. The read 51 ms after the hold returned held two identical popup subtrees
  and no page nodes; a read 200-400 ms later held one popup, the screenshot shows one menu, and the
  page echo says `bottom=1`. It reads like a tree taken during the window-focus change.
- **Never opened (line ~139):** the hold point is 73 px above the screen's bottom edge, beside the
  system gesture handle; `bottom=0`, so `onOpen` never fired.

## Behaviour

1. The case waits for the popup by the windows the device reports (`popupsReach(1)`, which the file
   already has) before it reads any text, and takes the popup's frame from a read that cannot see a
   transition, then asserts exactly what it asserts today (above the finger, one open, one close).
2. If the device reports two popup windows, the case fails saying so (a library fault, to report, not
   to hide).
3. The hold point is inside the row and clear of the system gesture area, still low enough that the
   menu must open above the finger; the case asserts that premise (the menu could not fit below).
4. No library code changes unless a run shows the library at fault; then stop and report.

## Proof

- `node scripts/gate.mjs real-input:android -- --control context-menu` green three times in a row.
- Red once each: a mutation that makes the menu open below the finger, and one that opens no popup.
- `check` and `need --for review` clean.

## Out of scope

- Other ContextMenu cases; the shared e2e helpers (`support.ts`, `os-tree.ts`, `reader.ts`,
  `keyboard.ts`, `device-read.ts`, `press-feedback.ts`), `scripts/`, `.claude/`, `AGENTS.md`,
  `docs/agents/`. If the double read is the driver's and needs a helper change, stop and report it.

## Decided already

- Wait for real signals (window count, the page echo); never a fixed sleep, a longer timeout or a
  retry. Do not run `bun install` or `bun run nitrogen` while this worktree's `check` is running.

## Context

`example/e2e/real-input/context-menu.e2e.ts` (`popupBox`, `popupsReach`, `holdAt`, the bottom-edge
case), `example/src/ContextMenuScreen.tsx`, `device-read.ts` (`popupWindowCount`, read only).
