# FIX18 — Disabling an iOS ButtonGroup does not change which items fit in its row

**Kind:** bugfix · **Devices:** ios ·
**Budget:** 2 h for round one (a small iOS layout fix; FIX13's iOS ButtonGroup fix took 2 h)

## Goal

An iOS ButtonGroup that is disabled shows the same items in its row, and the same overflow control,
as the same group enabled; only their look and their response change.

## Why

`docs/tasks/FOLLOWUPS.md` "G20: disabling a group on iOS refits more items into the row". In
`ios/components/ButtonGroup/HybridNitroUiButtonGroup.swift`, `candidate` leaves the overflow `Menu`
out of a disabled row ("a disabled group must not own a live popup"), so every `ViewThatFits`
candidate that would hold the menu measures narrower when disabled, and a disabled row can fit more
items than the enabled one. A group that grows by an item when an app disables it, and shrinks back
when enabled, moves its items under the person's eyes.

## Behaviour

1. For the same items, width and props, an iOS ButtonGroup shows the same number of row items
   disabled as enabled, and draws an overflow control in the same place, dimmed while disabled.
2. A disabled group's overflow control does not open a menu and takes no tap; no item fires an
   event; accessibility reports it disabled, as it does the items.
3. `disabled` arriving while the menu is open still closes it (`docs/components/button-group.md`
   Overflow). The connected group, iOS 15's clipped row and Android are unchanged.
4. The docs say a disabled group keeps its row.

## Proof

- A harness read on iOS of the row's visible item count and whether an overflow control was drawn,
  for one group at a width that overflows, enabled then disabled then enabled again; red against
  today's code (the disabled count is larger).
- `harness:ios` and `harness:android` green (the harness file is shared), `check` and
  `need --for review` clean; a patch changeset.
- A local screenshot (not committed) of the group enabled and disabled at that width; give its
  absolute path in your final message.

## Out of scope

- The other ButtonGroup lines in FOLLOWUPS, Android's overflow, and `Menu` itself.
- `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/`, and the shared e2e helpers.

## Decided already

- Keep the overflow control's size in a disabled row: the `Menu` with `.disabled(true)`, or a
  same-label placeholder that cannot present, whichever cannot own a popup. The row's item count
  must never depend on `disabled`.

## Context

`ios/components/ButtonGroup/HybridNitroUiButtonGroup.swift` (`overflowingRow`, `candidate`,
`overflowMenu`, `recordPlacement`), `example/__tests__/ButtonGroup.harness.tsx` (the overflow cases),
`docs/components/button-group.md` (Overflow).
