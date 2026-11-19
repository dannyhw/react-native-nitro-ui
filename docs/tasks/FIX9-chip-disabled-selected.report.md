# FIX9 — A disabled, selected iOS Chip still looks selected

**Branch:** `task/FIX9-chip-disabled-selected` (from `main` at `52aa4c52`) · **Round:** 1 of up to 3 ·
**Lease:** `FIX9-lhrpx` (iPhone Air / iOS 27 + `emulator-5570` / Metro 8293 and 9293)

## Summary

A filter `Chip` that is `selected` and `disabled` on iOS now draws its selected fill, dimmed.
`ChipDisabledFill` wraps the filter `Toggle`, which keeps SwiftUI's `.button` toggle style, and for
`selected && disabled` only lays a wash over the control: the system background colour at `0.55`
and `.tint` at `0.09`, cut out where the label draws. Enabled chips, assist chips, sizes, the
leading glyph, the check slot, hit testing, `isEnabled` and the announced value are SwiftUI's,
untouched.

Three decisions worth reading before the diff. The wash goes **over** the control, not behind it:
SwiftUI's disabled bordered style paints an opaque grey container, so a wash behind it never
reaches the screen (measured: a wash behind reads back as grey `#CCCCCD`). It stops at the label: a
wash pulls a fill and its text toward one colour, so a wash that dims the fill always faints the
label past the strength of an unselected chip's, and no fade/tint pair satisfies the fill relations
and leaves the label its strength (the best pair that keeps the label's ink no lighter is 4 short
of the fill bounds). The strength sits on the shapes rather than in `.colorMultiply` or
`Color.accentColor.opacity(_:)` because both were wrong on this host: the multiply lightened the
chip (`#F9F9F9`) and the colour reached the sampler without its hue. A custom `ToggleStyle` that
draws the capsule was tried and dropped — it moved the enabled chip's look and split the control
into separate accessibility elements.

`Chip.harness.tsx` gained a suite that reads the screen: five chips share one label, and each one's
own box is sampled through `nuiTestPixelProbe` / `nuiTestPixelReport`. iOS draws a bordered
selection pale, so no threshold quotes an absolute colour: the enabled pair of the same run is the
yardstick, the twin says what the read costs in noise, and the disabled pair has to keep a third of
the enabled pair's separation, stay apart from the enabled chip, and be separated by a dimmer
version of the selected colour. The label is read as ink rather than as a box mean, which a fainter
label only lightens: the darkest pixel each disabled chip draws, and how much of its box is painted
at that strength. One test also pins that a disabled chip measures what an enabled one does, on both
platforms. The iOS `androidIcon` case from the first commit asserted that the probe refuses to
sample iOS; iOS samples now, so it compares the drawn colour with and without `androidIcon`.

`docs/components/chip.md` drops the limit and says what a disabled selected chip draws; the
FOLLOWUPS line is gone; a patch changeset ships with it.

**Screenshots:** the README's iOS pair (`docs/images/components/chip-ios.png`) and the brief's
local four-state side-by-side are both shot; see Fix round 2 for the paths of the uncommitted one.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2178 tests / 96 suites | `cc9f51065fec` | 1 m 01 s | start 6.5 / med 10.2 / max 11.1 |
| `harness:ios` | **PASS** | 604 tests / 30 suites + isolated 6 tests / 3 suites | `cc9f51065fec` (harness:ios digest) | 14 m 21 s | start 7.7 / med 6.7 / max 12.7 |
| `harness:android` | **PASS** | 662 tests / 31 suites + isolated 6 tests / 3 suites | `cc9f51065fec` (harness:android digest) | 18 m 02 s | start 5.6 / med 6.1 / max 11.9 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:ios:--json:Chip` | stale | 19 tests / 1 suites | 788f1c731e92 (not this tree) | 21.8 s | start 4.5 / med 5.2 / max 5.4 |
| `harness:ios:--silent%3Dfalse:Chip` | **PASS** | 20 tests / 1 suites | `cc9f51065fec` (harness:ios digest) | 23.4 s | start 10.9 / med 10.3 / max 10.9 |
| `harness:ios:--verbose:Chip` | stale | 19 tests / 1 suites | 788f1c731e92 (not this tree) | 21.9 s | start 4.8 / med 4.7 / max 4.8 |
| `harness:ios:Chip` | stale | 1 failed of 19 tests / 1 suites | e3bde55126b2 (not this tree) | 22.9 s | start 6.3 / med 5.3 / max 6.3 |


`need --for review`: need: review is satisfied on this code tree. The two `real-input` gates are
left for merge, where `RealInputTests.testRealInputChip` re-checks the disabled chip's iOS role and
state.

## Red proofs

- `Chip.harness.tsx` > `Chip · the selected fill in every state (G12)` > `paints a disabled selected
  chip apart from an unselected one and from itself` -> `git checkout --` the Swift file, so the chip
  is SwiftUI's disabled bordered style alone -> `a disabled chip paints #E8E8E9 selected and #E8E8E9
  unselected, only 0 apart against an enabled pair 38 apart: the selection does not reach the screen
  once the chip is disabled. on=#C5E3FF twin=#C5E3FF off=#D9E3ED disabledOn=#E8E8E9
  disabledOff=#E8E8E9` (the same run keeps the size test and the other 17 green).

## Files changed

- `ios/components/Chip/HybridNitroUiChip.swift`: `ChipDisabledFill`, and the pixel read the suite
  samples through.
- `example/__tests__/Chip.harness.tsx`: the five-state read, the enabled-pair yardstick, the
  `androidIcon` case against the sampler.
- `src/components/Chip/Chip.nitro.ts`: what `nuiTestPixelReport` says on iOS.
- `docs/components/chip.md`, `docs/tasks/FOLLOWUPS.md`, `.changeset/chip-disabled-selected-fill.md`.

## Follow-ups

- ios: dark appearance is not measured. `nitroUiSampleChipDrawing` composites over white and the
  harness runs in light appearance, so the disabled fill's dark relations rest on a screenshot.
- ios: the sampler `nitroUiSampleChipDrawing` is now in `Chip` and `SegmentedControl`; it belongs in
  `ios/core` beside `NitroUiPixelProbe.kt`.
- example: `ListItem.harness.tsx` > `a fast press reverts: the row settles back, reports the new
  press count` went red once in an iOS run at load1 5.04 on a tree that touches no ListItem file;
  the harness:ios run above has it green.

## Fix round 1

M1/M3: no accent over the disabled container. `ChipDisabledFill` lays the page's own fade
(`systemBackground` 0.45) plus a little of the bordered style's tint (`.tint` 0.09) over the chip —
lighter and paler than the enabled chip, never its disabled grey. N1: both capsules stay mounted and
only opacity moves, so a chip that turns disabled keeps its view identity and VoiceOver focus. N2:
`.tint`, not `Color.accentColor`. M2: `docs/components/chip.md`, the changeset and the Swift comment
quote no strength the code lacks. M4: the README iOS image is retaken — Chip States story, light,
804 px; its "Disabled" row fills `#dde9f5` against `#e9e9eb`. Four-state pair (light, dark) taken,
uncommitted.

The suite logs its colours; a green run prints none, so from a filtered run:
`on=#C5E3FF twin=#C5E3FF off=#D9E3ED disabledOn=#DEE9F4 disabledOff=#E8E8E9` — 20 lighter, 36 paler,
22 clear of `disabledOff`, bounds 13. Gate table: regenerated above.

Red proof: `Chip.harness.tsx` > `paints a disabled selected chip apart from an unselected one, and
dimmer than an enabled one` -> round one's Swift restored -> `the dimmed chip is -38 lighter and has to
be at least 13 lighter` (`#BED6ED` vs `#C5E3FF`); also 11 paler where 13 is asked. N3-N6 stay follow-ups.

## Fix round 2

M5: the fade stops at the label. `ChipDisabledFill` masks its capsules with the label's own shape
(`destinationOut`, accessibility-hidden), so one view draws the control and its text keeps
strength: both disabled chips now read `#C2C2C4` at their darkest, where round one read
`#C9D6E1` beside `#C2C2C4`. The rereview's (b) cannot work - the best fade/tint pair leaving the ink
alone is 4 short of the fill bounds. The read is ink, not a box mean a fainter label only lightens;
its ink-area floor, a quarter of the unselected chip's, is what the cut's anti-aliased fringe leaves
(a half floor went red: 505 of 1038). M6: `chip.md`, the changeset and the Swift comment now
say the fade goes toward the system background colour; Limits adds the off-surface case. N2 is
corrected above; the README iOS image is retaken, local pair
`/tmp/fix9r2-chip-states-light-dark.png`. N1 stays a follow-up. Hygiene: the round's first two
harness gates ran beside FIX8's `real-input:ios`.

Red proof: `Chip.harness.tsx` > `keeps the label of a disabled selected chip as strong as an unselected
one` -> round one's Swift restored -> `the dimmed fill is 56 fainter than 6 and washes the text it
paints. off=#C2C2C4 on=#C9D6E1 areaOff=1038 areaOn=0`.
