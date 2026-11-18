# FIX9 — A disabled, selected iOS Chip still looks selected

**Kind:** bugfix · **Devices:** both ·
**Budget:** 3 h for round one (one iOS drawing fix with a harness read; FIX7's iOS toggle style is
the nearest finished work)

## Goal

A filter `Chip` that is both `selected` and `disabled` on iOS draws its selected fill, dimmed, so a
person can still tell a disabled selected chip from a disabled unselected one, as on Android.

## Why

`docs/tasks/FOLLOWUPS.md` "G12 Chip (iOS): a disabled selected chip draws as unselected", and
`docs/components/chip.md` Limits says the same: SwiftUI's disabled `.bordered` button style drops the
selected fill, so the "Disabled" row of the README screenshot shows two identical chips.

## Behaviour

1. iOS: a disabled filter chip draws a visibly different fill selected and unselected, both dimmed
   the way a disabled control is, and neither looks like an enabled chip.
2. iOS: enabled chips, the assist chip, sizes, the leading glyph and the check slot are unchanged,
   and a disabled chip of either state still takes no tap and reports `isEnabled == false` and its
   selected state to accessibility, as today.
3. Android is unchanged; it already draws this.
4. `docs/components/chip.md` no longer lists the limit, and says what a disabled selected chip draws.
   The README's Chip screenshot for iOS is retaken if its "Disabled" row changes.

## Proof

- A harness test on iOS that reads the drawn chip (a measured pixel read, not a mirror of the code)
  for disabled-selected against disabled-unselected and against enabled-selected, and goes red with
  the old drawing.
- Android harness unchanged and green. Both harness gates, `check` and `need --for review` clean;
  a patch changeset.
- A local screenshot (not committed) of the four iOS states side by side: enabled and disabled,
  selected and unselected. Give its absolute path in your final message.

## Out of scope

- The other Chip lines in FOLLOWUPS (bench arms, `<Host>`, `tintColor`, input and suggestion chips).
- ButtonGroup's toggle style, and `Button`.
- `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/`, and the shared e2e helpers (`support.ts`,
  `os-tree.ts`, `reader.ts`, `keyboard.ts`, `device-read.ts`, `press-feedback.ts`).

## Decided already

- Use SwiftUI's own styles. A custom `ToggleStyle` that draws the bordered look itself and dims
  while disabled is fine, as long as the chip stays a toggle to VoiceOver with its value.
- Match Material's idea of disabled: the selected container stays, at reduced strength.
- Keep the chip's size identical in every state; it is part of the sizing key.

## Context

`ios/components/Chip/HybridNitroUiChip.swift` (`ChipContent`), `example/__tests__/Chip.harness.tsx`,
`docs/components/chip.md` (Limits), CONTRIBUTING "README screenshots".
