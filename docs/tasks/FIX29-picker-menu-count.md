# FIX29 — A hosted Android Picker's closed menu stays closed

**Kind:** bugfix · **Devices:** android ·
**Budget:** 2 h for round one (a flake-shaped bug: 30 min to reproduce, then a fix from evidence;
median of the recent Android one-cause fixes)

## Goal

On Android, a Picker inside a `<Host>` whose menu has closed does not get a menu window back by
itself, whether the app re-enables the picker or another popup owner in the same Host opens.

## Why

GitHub-hosted CI on main 2ae64754 (run 45383576823), Android `example/__tests__/HostPopups.harness.tsx`:
- "closes when the control is disabled while the menu is open" (about line 843). The case waits
  until the report reads `expanded=0` and `live=0`. It then re-enables the picker and, after
  `settle(300)`, reads `live=1`.
- "opens two popup owners in one Host, one after the other" (about line 910) waits for `live=0`
  after a pick. Once the date picker's dialog is up, it reads the picker's `live` as 1.
`live` is a live read of `PickerModel.liveMenus` (`HybridNitroUiPicker.kt`, `MenuWitness`), which
counts process-wide the menu popups in composition. So a 1 after a 0 means a menu popup composed
again, unless something else in the process counts. Both cases pass on this machine's emulator.

## Behaviour

1. Once a hosted picker's menu has closed, `live` stays 0 through a re-enable, and through another
   popup owner in the Host presenting, until something opens the menu again.
2. If the cause turns out to be the test (for example, another control's menu counted in the
   process-wide number), the case reads what it means to read, and no library code changes.
   The report says which, from evidence.

## Proof

- First try to reproduce, within 30 minutes and two device runs at most (`.claude/skills/flake/SKILL.md`).
  Then write three to five ranked causes, each with what the existing reads would show. Fix the best
  survivor.
- Red once: a mutation of the code the fix guards turns one of the two cases (or a new, sharper
  case) red, and the line goes in the report. If the race is never reproduced, say so plainly.
- `harness:android` and `harness:ios` green (the harness file may change); `check` and
  `need --for review` clean.

## Out of scope

- Other HostPopups cases, other CI reds (SearchField, Form, iOS Menu), the iOS picker.
- `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/`, shared e2e helpers.

## Decided already

- No fixed sleep, longer timeout or retry. A wait is only for a signal the library really gives.
- A library fix keeps the perf contract (setters store and mark dirty; apply in `afterUpdate()`).

## Context

`android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiPicker.kt` (`MenuWitness`,
`readMenuReport`, how `expanded` is cleared on dispose and on `disabled`), the two cases above, and
`docs/DESIGN.md` for Host and the perf contract.
