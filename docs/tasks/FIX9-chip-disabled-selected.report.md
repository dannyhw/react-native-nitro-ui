# FIX9 — A disabled, selected iOS Chip still looks selected

**Branch:** `task/FIX9-chip-disabled-selected` (from `main` at `52aa4c52`) · **Round:** 1 of up to 3 ·
**Lease:** `FIX9-lhrpx` (iPhone Air / iOS 27 + `emulator-5570` / Metro 8293 and 9293)

## Summary

A filter `Chip` that is `selected` and `disabled` on iOS now draws its selected fill, dimmed.
`ChipDisabledFill` wraps the filter `Toggle`, which keeps SwiftUI's `.button` toggle style, and for
`selected && disabled` only lays a capsule of `Color.accentColor` over the control at
`opacity(0.2)`. Enabled chips, assist chips, sizes, the leading glyph, the check slot, hit testing,
`isEnabled` and the announced value are SwiftUI's, untouched.

Two decisions worth reading before the diff. The capsule goes **over** the control, not behind it:
SwiftUI's disabled bordered style paints an opaque grey container, so a wash behind it never
reaches the screen (measured: a wash behind reads back as grey `#CCCCCD`). A dimmed selection laid
over the control, label included, is also what iOS itself means by it. The strength sits on the
shape rather than in `.colorMultiply` or `Color.accentColor.opacity(_:)` because both were wrong on
this host: the multiply lightened the chip (`#F9F9F9`) and the colour reached the sampler without
its hue. A custom `ToggleStyle` that draws the capsule was tried and dropped — it moved the enabled
chip's look and split the control into separate accessibility elements.

`Chip.harness.tsx` gained a suite that reads the screen: five chips share one label, and each one's
own box is sampled through `nuiTestPixelProbe` / `nuiTestPixelReport`. iOS draws a bordered
selection pale, so no threshold quotes an absolute colour: the enabled pair of the same run is the
yardstick, the twin says what the read costs in noise, and the disabled pair has to keep a third of
the enabled pair's separation, stay apart from the enabled chip, and be separated by a dimmer
version of the selected colour. One test also pins that a disabled chip measures what an enabled one
does, on both platforms. The iOS `androidIcon` case from the first commit asserted that the probe
refuses to sample iOS; iOS samples now, so it compares the drawn colour with and without
`androidIcon`.

`docs/components/chip.md` drops the limit and says what a disabled selected chip draws; the
FOLLOWUPS line is gone; a patch changeset ships with it.

**Not done:** the two screenshots. The README's iOS pair (`docs/images/components/chip-ios.png`)
has a changed "Disabled" row and needs the documented retake, and the brief's local four-state
side-by-side was never shot — the device budget went into the first Android app build in this
worktree and the two full harness gates.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2178 tests / 96 suites | `42beba59414a` | 1 m 11 s | start 6.3 / med 12.1 / max 15.5 |
| `harness:ios` | **PASS** | 603 tests / 30 suites + isolated 6 tests / 3 suites | `42beba59414a` (harness:ios digest) | 14 m 26 s | start 9.4 / med 6.4 / max 15.3 |
| `harness:android` | **PASS** | 661 tests / 31 suites + isolated 6 tests / 3 suites | `42beba59414a` (harness:android digest) | 18 m 21 s | start 6.1 / med 5.6 / max 14.6 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:ios:Chip` | **PASS** | 19 tests / 1 suites | `42beba59414a` (harness:ios digest) | 22.9 s | start 10.0 / med 8.8 / max 10.0 |

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

- ios: the sampler `nitroUiSampleChipDrawing` is now in `Chip` and `SegmentedControl`; it belongs in
  `ios/core` beside `NitroUiPixelProbe.kt`.
- example: the iOS README Chip screenshot needs its documented retake — the "Disabled" row of
  `docs/images/components/chip-ios.png` is stale as of this change.
- example: `ListItem.harness.tsx` > `a fast press reverts: the row settles back, reports the new
  press count` went red once in an iOS run at load1 5.04 on a tree that touches no ListItem file;
  the 14 m 26 s run above has it green.
