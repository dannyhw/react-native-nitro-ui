# FIX7 — ButtonGroup overflow rows show their icons, and iOS toggles follow `variant`

**Kind:** bugfix · **Devices:** both ·
**Budget:** 4 h for round one (FIX6's round one, a two-platform Form fix, took about 3.5 h)

## Goal

An item that moves into a ButtonGroup's overflow menu keeps its icon on Android, and an iOS
toggle item is drawn in the group's `variant` like an action item beside it.

## Why

Two `docs/tasks/FOLLOWUPS.md` lines ("ButtonGroup's overflow rows should pass their items' icons",
"an iOS toggle item ignores `variant`"). Android's menu row draws icons for `Menu`, but the group
never passes one; the iOS toggle gets `.toggleStyle(.button)` and the tint, never the variant.

## Behaviour

1. Android: an overflowed item with an `androidIcon` shows that icon in its menu row, at the
   size and colour a `Menu` row's icon has; an item with none shows no icon and no gap.
   `labelStyle="titleOnly"` keeps menu rows icon-free as it keeps the row's items.
2. iOS `standard`: a toggle item is drawn in the same style family as an action item of the same
   `variant` (prominent, bordered or borderless), in both states, with the on state still
   telling apart from off. The `connected` group is unchanged.
3. Taps, events and accessibility of toggles and overflow rows are unchanged on both platforms.
4. `docs/components/button-group.md` says what an overflow row draws and how a toggle maps each
   `variant` on iOS, and no sentence about either is false.

## Proof

- A harness test that reads the overflow rows' icons on Android (present for an item with an
  icon, absent without, absent under `titleOnly`) and goes red with the icon argument removed.
- A harness test on iOS that tells the toggle's style apart per variant (a measured read, not a
  mirror of the mapping table) and goes red with the variant ignored again.
- Both harness gates, `check` and `need --for review` clean; a patch changeset.
- Screenshots kept local (not committed): an Android overflow menu with icons, and iOS toggles
  on and off for each of the five variants beside an action item. Give their absolute paths in
  your final message.

## Out of scope

- Other ButtonGroup and Menu lines in FOLLOWUPS, the connected iOS group, Android's toggle
  buttons, and `Button` itself.
- `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/`, and the shared e2e helpers (`support.ts`,
  `os-tree.ts`, `reader.ts`, `keyboard.ts`, `device-read.ts`, `press-feedback.ts`).

## Decided already

- Android reuses `Menu`'s row icon path (`MenuRow`'s `icon`/`onIconTint`); no new row drawing.
- iOS uses SwiftUI's own styles. If a `Toggle` cannot take a variant's look, draw it as a
  `Button` whose style follows `variant` and keep the toggle's accessibility (a toggle that
  reports its state); write in the report what each variant ends up as.
- A `text` toggle may still need a visible on state: if `.borderless` cannot show one, keep the
  bordered look for it and say so in the doc.

## Context

`android/.../HybridNitroUiButtonGroup.kt` (`menuContent` → `MenuRow`, `iconContent`),
`MenuRows.kt` (`MenuRow`, `MenuRowIcons`), `HybridNitroUiButtonGroup.swift` (`itemControl`,
`ItemButtonStyle`), `example/__tests__/ButtonGroup.harness.tsx`, `docs/components/button-group.md`.
