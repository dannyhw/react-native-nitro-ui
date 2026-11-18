# FIX7 — ButtonGroup overflow rows show their icons, and iOS toggles follow `variant`

**Branch:** `task/FIX7-button-group-overflow-icons-toggle-variant` (from `main` at `9e4974df`) ·
**Round:** 1 of up to 3 ·
**Lease:** `FIX7-wd6s5` (`nitroui_b` / `emulator-5570`, iPhone Air; Metro 9293 android / 8293 ios)

## Summary

An overflowed item hands its resolved glyph to `MenuRow`, so its menu row carries the same
`androidIcon` as its row button — Material's leading-icon size, in the row's own content colour,
drawn by the same code `Menu` uses. `NitroUiIconContent.Absent` reaches Material as a `null` leading
slot, so an item without an icon keeps its title at the plain leading edge (measured in a captured
menu: 467 px for a title without a glyph, 540 px where a glyph's slot indents the next one).
`labelStyle="titleOnly"` costs the rows their glyphs as it costs the row's items theirs. What each
row painted goes back into the state report as `overflowIcons=<id>#<RRGGBB>`: the colour comes from
the device's dynamic palette, so a test has to ask the row rather than trust the argument.

On iOS a `Toggle` with `.toggleStyle(.button)` ignores `buttonStyle`, so a toggle item is drawn by a
style that puts the variant's `ItemButtonStyle` on a `Button` and states the value with
`.isSelected`. It stays a `Toggle` for accessibility — the existing probe still reads
`[Checkbox, … desc=Bold` — and the connected row is untouched, a connected group with a toggle never
having used `ControlGroup`. Each variant keeps its own style family in both of a toggle's states:
`filled` and `elevated` `.borderedProminent` with a grey capsule unchecked, `tonal` and `outlined`
`.bordered` and `text` `.borderless` with a tinted label checked and the secondary label colour
unchecked. `text` needed no bordered fallback, and the doc says what each variant ends up as.

The iOS read is measured rather than looked up: the row probe samples the host's rendered layer over
white and publishes `drawing=size,fill=<%>,tint=<%>`. A test compares a checked toggle's shares with
the action item of the same variant, the unchecked one's tint with nothing, the two states' fill with
each other, and `text`'s fill with "no background painted".

One thing to read before the diff: the `titleOnly` half of the Android test was first written as a
rerender of the group that had just drawn glyphs, and stayed green with the guard removed — a row
records a glyph only as it composes, and a rerender leaves an open popup composed. It is now a group
mounted under `titleOnly` whose popup is opened once, which is what the second and third red proofs
are about.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2154 tests / 94 suites | `89e4650472b1` | 1 m 03 s | start 8.6 / med 23.1 / max 29.4 |
| `harness:ios` | **PASS** | 604 tests / 30 suites + isolated 6 tests / 3 suites | `89e4650472b1` (harness:ios digest) | 16 m 33 s | start 8.1 / med 12.2 / max 29.0 |
| `harness:android` | **PASS** | 662 tests / 31 suites + isolated 6 tests / 3 suites | `89e4650472b1` (harness:android digest) | 18 m 27 s | start 8.1 / med 11.4 / max 29.0 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:android:ButtonGroup` | stale | 2 failed of 11 tests / 1 suites | b22f756d6414 (not this tree) | 19.3 s | start 16.2 / med 15.9 / max 16.2 |
| `harness:android:Scratchphoto` | stale | 2 tests / 1 suites | b05c5a6b47e4 (not this tree) | 30.9 s | start 7.0 / med 12.6 / max 15.1 |
| `harness:ios:ButtonGroup` | stale | 2 failed of 11 tests / 1 suites | dff543baa82d (not this tree) | 20.5 s | start 11.4 / med 9.8 / max 11.4 |
| `harness:ios:Scratchphoto` | stale | 2 tests / 1 suites | 57c01335fa3a (not this tree) | 31.7 s | start 58.0 / med 56.1 / max 58.0 |


`need --for review`: need: review is satisfied on this code tree.

The two `Scratchphoto` rows are filtered runs of a scratch harness file that held a screen open long
enough to photograph it; the file is not in the tree, so those rows stay stale.

One incident: two harness gates were started at 11:19 while `TRAIN` held `real-input:ios`, and were
stopped 20 seconds in, before their first test. Every run in the table above started after that lease
went idle.

## Red proofs

- `ButtonGroup · the overflow row glyphs (G21, Android) › draws an overflowed item its glyph, and
  nothing for an item without one` -> `icon = NitroUiIconContent.Absent` for every overflow row ->
  `no overflow row drew a glyph while the menu was open - it reports "…;menu=open;overflowIcons=-;…".`
- the same test, and `› keeps menu rows glyph-free under labelStyle="titleOnly"` ->
  `icon = model.iconContent(3)`, one item's star pasted into every row ->
  `the overflow row for "month" has no androidIcon and drew a glyph in "40434B" anyway.` and
  `with labelStyle="titleOnly" an overflow row still drew a glyph: "…overflowIcons=month#40434B,`
  `quarter#40434B,year#40434B,all#40434B…".`
- the `titleOnly` case alone -> `icon = model.iconContent(index)` unconditionally, the
  `labelStyle.showsGlyph` guard removed ->
  `with labelStyle="titleOnly" an overflow row still drew a glyph: "…overflowIcons=quarter#40434B,`
  `all#40434B…".`
  This is the mutation that showed the case as first written was vacuous: it read a popup a rerender
  had left composed, and a row records a glyph only as it composes.
- `ButtonGroup · the toggle variant drawing (G20, iOS) › draws a toggle item in the group variant,
  like the action item of it` -> `.toggleStyle(.button)` and the old tint modifier, so `variant` is
  ignored again -> `a checked "filled" toggle painted 4% of its box in the tint against the "filled"
  action item's 47%. filled: action={"fill":49,"tint":47} on={"fill":53,"tint":4} off={"fill":5,`
  `"tint":3}; … text: action={"fill":8,"tint":6} on={"fill":53,"tint":4} …`

## Files changed

- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiButtonGroup.kt`: the overflow row's
  icon, the colour it drew it with, the `overflowIcons` field, and the reset of both.
- `ios/components/ButtonGroup/HybridNitroUiButtonGroup.swift`: `ItemToggleStyle`, and the
  rendered-layer sample behind the report's `drawing` field.
- `example/__tests__/ButtonGroup.harness.tsx`: the two Android overflow-glyph cases and the iOS
  measured toggle drawing.
- `android/src/test/java/com/margelo/nitro/nitroui/ButtonGroupModelTest.kt`: the reset report string
  now carries `overflowIcons=-`.
- `docs/components/button-group.md`, `.changeset/button-group-overflow-glyphs-and-ios-toggle-variant.md`.

## Follow-ups

- `harness:ios` crashed once with a `worklets::cleanupRuntimeAware` SIGSEGV at runtime teardown,
  blamed on `Popover.harness.tsx`; the same stack sits in `task/M4-cleanup-train` logs from before
  this branch, and `--rerun-failed` turned the unit green.
- An iOS toggle item that overflows is a `Toggle` inside the group's `Menu`, so it draws SwiftUI's
  checkmark and no glyph: unchanged by this task, and documented as such.
- The overflow row's glyph colour is Material's row content colour, not `tintColor` — the same thing
  `Menu` does, and what the doc claims.
