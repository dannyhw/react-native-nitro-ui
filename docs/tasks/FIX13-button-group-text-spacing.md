# FIX13 — Items in an iOS `text` ButtonGroup holding a toggle are spaced evenly

**Kind:** bugfix · **Devices:** ios ·
**Budget:** 2 h for round one (a small iOS layout change; FIX7 round 2 built the code it extends)

## Goal

In an iOS `text` ButtonGroup that holds a toggle, the gaps between items are even, whatever mix of
action items and toggles it has and whatever their state.

## Why

`docs/tasks/FOLLOWUPS.md` "ButtonGroup, open after overflow-row icons and iOS toggle styles", first
line. To keep a `text` group's size fixed when a toggle is checked, an unchecked toggle reserves the
checked capsule's footprint (`CheckedFootprint` in `HybridNitroUiButtonGroup.swift`), and an action
item does not, so the gap beside an unchecked toggle is about 12 pt wider than between two action
items. The ButtonGroup page documents the uneven gap.

## Behaviour

1. Every item in an iOS `text` group that holds a toggle reserves the same bordered footprint, so
   the gaps between adjacent items are equal (within a point) for action items, unchecked toggles
   and checked toggles alike.
2. The group's size still does not change when a toggle is checked or unchecked, and a `text` group
   with no toggle keeps the size it has today.
3. Every other variant, the connected group, overflow, `size`, `labelStyle` and Android are
   unchanged.
4. `docs/components/button-group.md` no longer says the gap beside an unchecked toggle is wider, and
   says what a `text` group holding a toggle reserves.

## Proof

- A harness read on iOS of the gaps between the drawn items of a `text` group with an action item,
  a checked toggle and an unchecked toggle, red against today's drawing (gaps differing by more than
  a point), plus the existing size-stability read still green.
- `harness:ios` and `harness:android` green (the harness file is shared), `check` and
  `need --for review` clean; a patch changeset.
- A local screenshot (not committed) of that group; give its absolute path in your final message.

## Out of scope

- The other ButtonGroup lines in FOLLOWUPS; `Button`; the README screenshots unless this changes
  what they show.
- `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/`, and the shared e2e helpers (`support.ts`,
  `os-tree.ts`, `reader.ts`, `keyboard.ts`, `device-read.ts`, `press-feedback.ts`).

## Decided already

- Make the footprint modifier generic over its label and apply it to every item of a `text` group
  that holds a toggle, inside `.controlSize`, as FIX7's third review suggested.
- The extra width is the price of a fixed size; equal gaps matter more than a tighter row.

## Context

`ios/components/ButtonGroup/HybridNitroUiButtonGroup.swift` (`CheckedFootprint`, `itemControl`),
`example/__tests__/ButtonGroup.harness.tsx` (the `text`-group box test), `docs/components/button-group.md`.
