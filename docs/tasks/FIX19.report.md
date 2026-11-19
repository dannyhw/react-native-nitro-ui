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
| `check` | **PASS** | 2191 tests / 97 suites | `886163f83e3c` | 1 m 04 s | start 4.3 / med 8.3 / max 11.7 |
| `harness:ios` | **PASS** | 622 tests / 30 suites + isolated 6 tests / 3 suites | `886163f83e3c` (harness:ios digest) | 14 m 28 s | start 5.7 / med 5.5 / max 34.1 |
| `harness:android` | **PASS** | 680 tests / 31 suites + isolated 6 tests / 3 suites | `886163f83e3c` (harness:android digest) | 18 m 11 s | start 5.5 / med 5.6 / max 34.1 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:ios:--silent%3Dfalse:Chip` | stale | 1 failed of 21 tests / 1 suites | 8f3c06184ee4 (not this tree) | 21.1 s | start 7.0 / med 6.9 / max 7.0 |
| `harness:ios:--silent%3Dfalse:Chip.harness:-t:lays%20the%20dimmed%20fill` | stale | 1 failed of 21 tests / 1 suites | af486e89d846 (not this tree) | 11.3 s | start 4.2 / med 4.6 / max 5.0 |
| `harness:ios:Chip` | stale | 1 failed of 20 tests / 1 suites | eb1dead5597d (not this tree) | 21.2 s | start 4.7 / med 4.7 / max 4.7 |
| `harness:ios:Chip.harness` | stale | 21 tests / 1 suites | 7df5e9df4714 (not this tree) | 21.3 s | start 11.9 / med 10.9 / max 11.9 |
| `harness:ios:Chip.harness:--silent%3Dfalse:-t:the%20selected%20fill` | stale | 1 failed of 21 tests / 1 suites | af486e89d846 (not this tree) | 11.0 s | start 7.9 / med 8.1 / max 8.3 |
| `harness:ios:Chip.harness:-t:keeps%20the%20label%20of%20a%20disabled%20selected%20chip` | stale | 1 failed of 21 tests / 1 suites | f1260db01880 (not this tree) | 10.3 s | start 4.3 / med 4.4 / max 4.5 |
| `harness:ios:Chip.harness:-t:lays%20the%20dimmed%20fill` | stale | 1 failed of 21 tests / 1 suites | 5e543bcb8378 (not this tree) | 11.3 s | start 4.7 / med 5.0 / max 5.3 |
| `harness:ios:Chip.harness:-t:measures%20one%20size%7Cdraws%20the%20imported%20glyph` | stale | 2 failed of 21 tests / 1 suites | 74b489128303 (not this tree) | 18.5 s | start 4.4 / med 16.1 / max 19.0 |
| `harness:ios:Chip.harness:-t:the%20selected%20fill` | stale | 1 failed of 21 tests / 1 suites | 510bb7ecbbe7 (not this tree) | 11.3 s | start 9.7 / med 9.4 / max 9.7 |


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
- ios: the fit read has never run at an accessibility text size. Nothing moves an app's content
  size category under test: the simulator's larger-text settings and an `-AppleTextSize` launch
  argument both left the chip at `UICTContentSizeCategoryL`.
- ios: a chip's sizing key carries no native-side variation: under a mutation that gave a disabled
  chip another control size, the enabled twin was laid out at the disabled chip's box.
- ios: a probe posted just before a recycle still publishes into the cleared model, so the reused
  chip answers `n=1` with the previous chip's pixels.
- ios: the fit read tolerates 3 columns at the cap because `Capsule()` is a true semicircle and the
  bordered style's capsule is not; if the style's curve changes, that residual moves with it.

## Hygiene

- One incident: a leftover `simctl launch --console-pty` process from a manual screenshot run was
  stopped with `pkill -f`, a pattern kill. Nothing else was stopped by pattern, and no device was
  shut down, wiped or restarted.

## Fix round 1

M1. The README pair and the light and dark four-state shots are redrawn from this tree. Sampled:
light enabled selected `#D1EAFF`, dimmed On `#E0E9F3`, dimmed Off `#E9E9EB`; dark `#001A2E`,
`#17212A`, `#262629`; the committed `docs/images/components/chip-ios.png` carries the same three
light values. None is FIX9's `#DFECF7` / `#101D28`; one stroke reads `#C1C1C4` over grey and
`#BAC1CB` over the fill, and no ghost shows.

M2. The edge read is red against the constant it replaces, 16 columns outside the capsule. On the
shipped inset it is green at the control's own size, 1 pt at the cap turn, and a run with the
control at `.regular` matched the unselected chip's painted edge on every row. The accessibility
half did not run: the chip answered `UICTContentSizeCategoryL` at 62.00x28.00 with the simulator's
larger-text settings written and with an `-AppleTextSize` launch argument.

N1. The ink budget is 24 — two of the 12 that one glyph over the fill sits from the same glyph
over the container. A wash over half a label keeps 21 % of its ink.

N2. Both named tests are red once below; `## Gates` holds the regenerated table. Doc comments are
one to three lines.

### Red proofs, fix round 1

- `lays the dimmed fill exactly inside the capsule the unselected chip draws` -> the fill laid at
  the `-6`/`-12` it replaces -> `the dimmed selected chip paints outside the capsule its unselected
  twin draws: at row 0 the one paints columns 23-162 where the other paints columns 39-146, 16
  columns apart against a tolerance of 4. fill=#DFE8F0 container=#E8E8E9 apart=16 box=62.00x28.00
  rows=84/84 shape=16@0 covered=13@0 stray=0`
- `keeps the label of a disabled selected chip as strong as an unselected one` -> the same fill
  laid over the label's first 20 pt -> `a disabled selected chip paints 217 pixels at the #C2C2C4
  its unselected twin paints 1028 of - 21% - so its label is faded or redrawn, not merely sitting
  on a dimmed fill. off=#C2C2C4 on=#BCC3CB areaOff=1028 areaOn=217`
- `measures one size whether or not it is disabled` -> a disabled chip drawn at the larger control
  size -> `testID "on" (on) never reached 62.00x28.00 - last box 70.33x34.33, control measured
  62.00x28.00.`
- `draws the imported glyph in the slot, and leaves nothing else in its colour` -> iOS answering
  `androidIcon` by dimming the label -> `iOS painted the chip with `androidIcon` at #E1E7ED and the
  one without it at #D9E4EE: the prop drew something on a platform that ignores it.`
