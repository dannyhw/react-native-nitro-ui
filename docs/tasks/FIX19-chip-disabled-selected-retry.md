# FIX19 — A disabled, selected iOS Chip still looks selected (second attempt)

**Kind:** bugfix · **Devices:** ios ·
**Budget:** 3 h for round one (FIX9's rounds on the same drawing took about 3 h each)

## Goal

A filter `Chip` that is both `selected` and `disabled` on iOS draws a dimmed selected fill, so it can
be told from a disabled unselected chip, as on Android, with its label exactly as legible as the
disabled unselected chip's.

## Why

`docs/tasks/FOLLOWUPS.md` "G12 Chip (iOS): a disabled selected chip draws as unselected", and the
Chip page's Limits say so. FIX9 (branch `task/FIX9-chip-disabled-selected`, PR #101, parked) got
the fill right in light and dark but drew it as a layer over the chip, which washed the label; its
second round cut the label out of that layer using a second copy of the label, which drew at a
different size, so the cut missed the letters. Read its report and three reviews
(`git show origin/task/FIX9-chip-disabled-selected:docs/tasks/<file>` for `FIX9-chip-disabled-selected.report.md`,
`FIX9.review.md`, `FIX9.rereview.md`, `FIX9.review3.md`): they hold the measured colours, the bounds
that worked and why each approach failed.

## Behaviour

1. iOS: a disabled selected filter chip's fill is lighter and less saturated than the enabled
   selected chip's and clearly apart from the disabled unselected chip's, in light and dark.
2. Its label and glyph are drawn by the chip's own label (not a copy) and are as legible as the
   disabled unselected chip's, at every size and Dynamic Type size.
3. Enabled chips, the assist chip, sizes, the check slot, hit testing, `isEnabled`, the announced
   value and the chip's size key are unchanged; Android is unchanged.
4. `docs/components/chip.md` drops the limit and says what a disabled selected chip draws; the
   README iOS Chip screenshot is retaken per CONTRIBUTING "README screenshots".

## Proof

- An iOS harness read of the drawn pixels: the three fill relations against the run's own enabled
  pair (FIX9's measured bounds are a starting point), and label ink compared between the two
  disabled chips, measured on the label's own pixels with a bound near full coverage, not a quarter.
  Each red once against today's drawing and against FIX9's washed drawing.
- `harness:ios` and `harness:android` green (the harness file is shared), `check`,
  `need --for review`; a patch changeset; local light and dark four-state screenshots (not
  committed), absolute paths in your final message.

## Out of scope

- Other Chip lines in FOLLOWUPS; `Button`, `ButtonGroup`.
- `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/`, and the shared e2e helpers.

## Decided already

- Put the fill under the label, never over it: for the disabled selected state only, draw the
  chip's background yourself (for example a `ButtonStyle` or background applied only in that state)
  behind `configuration.label`, so the label is SwiftUI's own. One view identity across states, so
  VoiceOver focus survives a chip becoming disabled.
- Use the tint the bordered style fills with, not `Color.accentColor`.

## Context

`ios/components/Chip/HybridNitroUiChip.swift` (`ChipContent`), `example/__tests__/Chip.harness.tsx`,
`docs/components/chip.md`, the FIX9 branch's records named above.
