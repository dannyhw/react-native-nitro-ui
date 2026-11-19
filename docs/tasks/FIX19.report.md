# FIX19 — A disabled, selected iOS Chip still looks selected

**Branch:** `task/FIX19-chip-disabled-selected-retry` (from `main` at `fd0ba959`) ·
**Round:** 1 of up to 3 ·
**Lease:** `FIX19-w98lt` (iPhone 17 / iOS 27 + `emulator-5574` / Metro 8295 and 9295)

## Summary

A filter `Chip` that is both `selected` and `disabled` on iOS now draws a dimmed version of its
selected fill — the bordered style's tint, faded toward the system background colour — under its
label. Enabled chips, assist chips, sizes, the check slot, hit testing, `isEnabled`, the announced
value and the sizing key are untouched; Android is untouched.

Read one decision before the diff: **where the fill goes**. SwiftUI's disabled bordered style
paints an opaque container, so nothing behind the control reaches the screen — a red capsule laid
behind a dimmed selected chip read back as that chip's own grey, `#E8E8E9` — and FIX9 measured
that nothing over the label survives either. What is left is between them: the fill is the
**label's own background**, pushed out to the chip's box by an inset measured rather than read off
a metric — the same tint laid at the label's own frame read 7 away from a dimmed unselected chip,
laid 12 pt across and 6 pt further it read 26 away, and 20 pt further changed that by 2 more. The
control stays the system's `Toggle` in one view, so VoiceOver focus survives a chip becoming
disabled, and the label stays SwiftUI's own: its font, its Dynamic Type, its dimming. A custom
`ToggleStyle` was measured and dropped — `configuration.label` came back at the environment font (a
78.67 pt box against the system chip's 71.33 pt for one label) and undimmed, `#070707` where the
dimmed chip beside it read `#C3C3C5` — so the box and the dimming would have been invented rather
than inherited.

`Chip.harness.tsx` gained the read. iOS's `nuiTestPixelProbe` used to count calls and answer
`no pixels`; it now samples the chip's own box over a fixed white backdrop and answers with the
fields Android's probe prints, so the three fill relations are measured against the run's own
enabled pair — the twin says what the read costs in noise, and the disabled pair keeps a third of
the enabled separation — never against a colour this file could not know. The label is read as
ink: the darkest pixel each disabled chip paints, and how much of its box is painted within the
probe's reach of the *other* disabled chip's ink, with a floor of nine tenths. That floor needs a
wider budget than Android's 30 — iOS uses 48 — because a dimmed chip's label is translucent over
its fill, so two chips differing only in that fill read one shared glyph a little apart. The iOS
`androidIcon` case now compares what the two chips paint instead of expecting a refusal.

Docs drop the limit and say what a dimmed selected chip draws; the Limits keep what is still true:
the fade runs toward the system background colour, not the surface under the chip. The README iOS
pair is retaken.

## Gates

<!-- pasted from `node scripts/gate.mjs table` -->

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2191 tests / 97 suites | `46cf2290cd40` | 55.4 s | start 4.4 / med 6.7 / max 7.9 |
| `harness:ios` | **PASS** | 621 tests / 30 suites + isolated 6 tests / 3 suites | `46cf2290cd40` (harness:ios digest) | 14 m 34 s | start 9.4 / med 7.9 / max 59.8 |
| `harness:android` | **PASS** | 679 tests / 31 suites + isolated 6 tests / 3 suites | `46cf2290cd40` (harness:android digest) | 18 m 19 s | start 52.6 / med 6.2 / max 52.6 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:ios:--silent%3Dfalse:Chip` | stale | 1 failed of 21 tests / 1 suites | 8f3c06184ee4 (not this tree) | 21.1 s | start 7.0 / med 6.9 / max 7.0 |
| `harness:ios:Chip` | stale | 1 failed of 20 tests / 1 suites | eb1dead5597d (not this tree) | 21.2 s | start 4.7 / med 4.7 / max 4.7 |


## Red proofs

- `Chip.harness.tsx` > `Chip · the selected fill in every state (G12)` > `paints a disabled
  selected chip apart from an unselected one, and dimmer than an enabled one` -> the pixel sampler
  with today's drawing, so the chip is SwiftUI's disabled bordered style alone -> `a disabled chip
  paints #E8E8E9 selected and #E8E8E9 unselected, only 0 apart against an enabled pair 38 apart:
  the selection does not reach the screen once the chip is disabled. on=#C5E3FF twin=#C5E3FF
  off=#D9E3ED disabledOn=#E8E8E9 disabledOff=#E8E8E9`
- Same suite > `keeps the label of a disabled selected chip as strong as an unselected one` ->
  FIX9's parked drawing checked out over this suite
  (`git checkout origin/task/FIX9-chip-disabled-selected -- ios/components/Chip/HybridNitroUiChip.swift`)
  -> `a disabled selected chip paints 505 pixels at the #C2C2C4 its unselected twin paints 1038 of
  - 49% - so its label is faded or redrawn, not merely sitting on a dimmed fill. off=#C2C2C4
  on=#C2C2C4 areaOff=1038 areaOn=505` — the label half washed, at the same darkest pixel, which is
  what its quarter floor let through.
- A dimmed fill that only adds tint and does not fade: same suite, first test -> `the dimmed chip
  is -3 lighter and has to be at least 13 lighter` (`#D8E1EB` against the enabled `#C5E3FF`), so
  the "dimmer than the enabled chip" bound bites in both directions.
- Not mutated: the size pin in this suite, and the iOS `androidIcon` paint comparison. The first
  measures a behaviour none of the three drawings breaks; the second replaces an assertion that
  iOS refuses to sample, and no mutation of it was run.

## Files changed

- `ios/components/Chip/HybridNitroUiChip.swift`: `ChipDisabledFill`, laid as the label's own
  background, and the iOS pixel read the suite samples through.
- `example/__tests__/Chip.harness.tsx`: the pixel helpers shared with the glyph suite, the
  five-chip fill and label-ink read, the `androidIcon` iOS case against the sampler.
- `src/components/Chip/Chip.nitro.ts`: what `nuiTestPixelProbe` answers on iOS.
- `docs/components/chip.md`, `docs/tasks/FOLLOWUPS.md`,
  `.changeset/chip-disabled-selected-fill.md`, `docs/images/components/chip-ios.png`.

## Follow-ups

- ios: the dimmed fill's dark-appearance relations rest on the screenshot, not a test — the sampler
  composites over white and the harness runs in light appearance.
- ios: `nitroUiSampleChipDrawing` is now the second whole-box sampler in the repo, beside
  SegmentedControl's; the two belong in `ios/core` next to Android's `NitroUiPixelProbe.kt`.
- example: the ink-area comparison is noisy at the few-per-cent level between chips with *different*
  labels; the suite compares two chips that share one label, and a future case should keep that.

## Hygiene

- One incident: a leftover `simctl launch --console-pty` process from a manual screenshot run was
  stopped with `pkill -f`, a pattern kill. Nothing else was stopped by pattern, and no device was
  shut down, wiped or restarted.
