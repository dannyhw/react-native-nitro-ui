# FIX5 — An Android Menu closes on the first dismissal after a tap on a disabled row

**Kind:** bugfix · **Devices:** android ·
**Budget:** 4 h for round one (an estimate; no finished one-platform Menu fix to take a median from)

## Goal

After tapping a disabled row in an open Android `Menu`, one Back or one outside tap closes it,
and a screen reader is told the row is disabled.

## Why

Two open `docs/tasks/FOLLOWUPS.md` lines ("Menu Android dismissal after a **disabled-row** tap",
"Menu Android a11y: a disabled `DropdownMenuItem`"), measured on material3 1.4; the library is on
1.5, so reproduce each first. `menu.e2e.ts` still allows three Backs after the disabled-row tap.

## Behaviour

1. A real tap on a disabled row reports no `onSelect` and leaves the menu open.
2. After that tap, one system Back closes the menu and `onClose` fires once. In a separate open,
   one tap outside does the same.
3. A disabled row's node in the accessibility tree reads as disabled, and an enabled row's as
   enabled.
4. `docs/components/menu.md` says what a tap on a disabled row does and how the row is
   announced, and no longer says the row reports `enabled="true"`.

## Proof

- `menu.e2e.ts` closes with exactly one Back after the disabled-row tap (no retry loop on that
  path), has a second case that closes with one outside tap, and reads the disabled row's
  enabled state. `node scripts/gate.mjs real-input:android -- --control menu` is green.
- Each new assertion is shown red once: revert the fix, or where nothing needed fixing, mutate
  what it guards (a row passed `enabled = true`; a dismissal handler that ignores its first
  call). One line each in the report.
- A patch changeset, if library code changed. `node scripts/gate.mjs check` passes and
  `node scripts/gate.mjs need --for review` prints nothing missing.

## Out of scope

- iOS, `menuAnchor`, and ContextMenu, Picker, ButtonGroup overflow and the split button beyond
  what a fix in the shared row code changes for them (say in the report what changed for each).
- `scripts/`, and the shared e2e helpers (`support.ts`, `os-tree.ts`, `reader.ts`,
  `device-read.ts`, `keyboard.ts`, `press-feedback.ts`). If the proof cannot be written without
  changing one, stop and ask.

## Decided already

- A disabled row does nothing when tapped and the menu stays open. That is what Material's own
  `DropdownMenuItem(enabled = false)` and a disabled iOS menu row do.
- The test hook (`choose` → `applyPick`) closes the popup on a disabled row; a real tap does
  not. Make it match if the harness changes stay under an hour, else one follow-up line.
- The row keeps Material's own element: add semantics, do not hand-build a row.
- A cause inside material3 that cannot be fixed here: stop with the reproduction and options.
- A line that already holds on 1.5 still gets its test; report how often the defect was tried.

## Context

`android/src/main/java/com/margelo/nitro/nitroui/MenuRows.kt` (the row), `HybridNitroUiMenu.kt`
(`applyPick`, `setOpen`, `onDismissRequest`), `example/e2e/real-input/menu.e2e.ts`
(`dismissPopup`), `example/__tests__/Menu.harness.tsx`, `docs/components/menu.md`.
