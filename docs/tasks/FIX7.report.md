# FIX7 — ButtonGroup overflow rows show their icons, and iOS toggles follow `variant`

**Branch:** `task/FIX7-button-group-overflow-icons-toggle-variant` (from `main` at `9e4974df`) ·
**Round:** 2 of up to 3 ·
**Lease:** round 1 `FIX7-wd6s5`, round 2 `FIX7-cn3bt` (pair-a: `nitro-ui A` iPhone 17 and
`nitroui_a` / `emulator-5574`; Metro 8295 ios / 9295 android)

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
style that puts the variant's `ItemButtonStyle` on a `Button`. The connected row is untouched, a
connected group with a toggle never having used `ControlGroup`. That style is round one's: it
tinted an unchecked item grey, and the accessibility claim below it was Android's. Round 1 redrew
the states and measured the toggle's own element on iOS — see "Fix round 1".

The iOS read is measured rather than looked up: the row probe samples the host's rendered layer over
white and publishes `drawing=size,fill=<%>,tint=<%>`. A test compares a checked toggle's shares with
the action item of the same variant, the unchecked one's with that variant's quiet action item, a
disabled item's with nothing, and the three families' drawings with each other — every claim is one
measured drawing against another, none against a constant.

One thing to read before the diff: the `titleOnly` half of the Android test was first written as a
rerender of the group that had just drawn glyphs, and stayed green with the guard removed — a row
records a glyph only as it composes, and a rerender leaves an open popup composed. It is now a group
mounted under `titleOnly` whose popup is opened once, which is what the second and third red proofs
are about.

## Gates

The generated table is the one under "Fix round 2" below. A report carries one table, with the
ledger's current numbers, so round 1's own runs are not repeated here.

One incident: two harness gates were started at 11:19 while `TRAIN` held `real-input:ios`, and
were stopped 20 seconds in, before their first test. Every run in the table below started after that
lease went idle.


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

## Fix round 1

M1. An unchecked iOS toggle keeps the group's own colour. `ItemStyle` names the three iOS style
families and gives a toggle one step per state: unchecked is the variant's style without a `filled`
or `elevated` group's prominent fill; checked is `.borderedProminent`, or `.bordered` where the
variant is `text`. The read compares every cell with an action item's drawing — the quiet one and the
loud one — and reads a disabled toggle and a disabled action item too, so grey is only ever what a
disabled item measures.

M2. The style draws and says nothing. The item's element is the `Toggle`'s own switch, already
carrying value 1, so the `selected` trait the style added had a reader hear the state twice; it is
gone, and `testRealInputButtonGroup` asks each toggle item for its type, its value and one state
signal before any tap and after each of two real taps. The Summary sentence that offered Android's
probe as iOS evidence is corrected above.

N1. The doc's two "ignored" cells now name the connected group that is not ignored, and the toggle
table and the changeset say what each state draws.

### Gates

The generated table is the one under "Fix round 2": a report carries one table, with the
ledger's current numbers, so round one's own rows are not repeated here.

`need --for review`: need: review is satisfied on this code tree.

The `Scratchphoto` and `ButtonGroupPhoto` rows are filtered runs of scratch screens that held a
mount open to be photographed; no such file is in the tree, so those rows stay stale.

### Red proofs

- `ButtonGroup · the toggle variant drawing (G20, iOS) › draws an unchecked toggle in the group
  tint, one step below the checked one` -> the unchecked state drawn as round one drew it, left in
  SwiftUI's grey -> `an unchecked "filled" toggle drew only 0% of its box in the group's tint, so it
  reads as a disabled item rather than as an unchecked one. filled: action={"fill":49,"tint":47}
  on={"fill":49,"tint":47} off={"fill":49,"tint":0} disabled={"fill":53,"tint":0}; … tonal:
  action={"fill":53,"tint":4} off={"fill":52,"tint":0}; … text: action={"fill":8,"tint":6}
  off={"fill":8,"tint":0}`
- the same test -> `tintColor` applied only while checked, as round one did, so the unchecked item
  measured exactly the disabled item beside it -> `an unchecked "filled" toggle drew only 0% of its
  box in the group's tint … filled: action={"fill":49,"tint":47} on={"fill":49,"tint":47}
  off={"fill":53,"tint":0} disabled={"fill":53,"tint":0} disabledAction={"fill":53,"tint":0}`
- the filtered real-input run `real-input:ios -- --control button-group` -> the style's
  `.accessibilityAddTraits(.isSelected)` put back on a toggle item -> at
  `example/ios/NitroUiExampleUITests/RealInputTests.swift:2480`: `the toggle item "Bold" also
  reports itself selected, so a reader hears its state twice: "Bold" type=40 value=Optional(1)
  selected=true`. The same run passes with the trait gone, on the element's own
  `"Bold" type=40 value=Optional(1) selected=false`.

## Fix round 2

A `text` group that holds a toggle is measured at the height of a capsule in both states: an
unchecked toggle keeps the footprint of its own label in `.bordered` — the style it takes once
checked — and draws that label centred in it (`CheckedFootprint`), so checking a toggle, which
re-measures nothing, can no longer draw a capsule outside a box measured while every item was
unchecked. A `text` group with no toggle keeps the height of a label. The doc, the changeset and the
new iOS read say so.

The other four: the `buttonGroupItem` comment no longer calls a toggle item a `Toggle(.button)`;
both `size` cells limit "ignored" to a connected iOS group with no toggle; the toggle read now
requires a checked item to carry the group's tint and an unchecked one to sit apart from the
*disabled action* item by the margin it already kept from a disabled toggle; and
`assertToggleElement` reads type, value and selected from the one actionable element carrying the
item's title, and fails the group that offers two.

The taller box moved that read: `fill` and `tint` are shares of the sampled box, and an unchecked
`text` toggle's tint fell from 6% of a label box to 3% of a capsule's. It compares the share of the
*ink* in the group's colour instead — 60% for a tinted label, 8% for a capsule's, 0% for grey — the
same claim at any box size. `XCUIElement.ElementType` has no image-button case, so the filter names
the eight shapes an item can arrive as.

### Gates

All on pair-a (`nitro-ui A` iPhone 17, `nitroui_a` / `emulator-5574`, Metro 8295) on the final tree:
`check`, `harness:ios`, `harness:android` and the filtered `real-input:ios -- --control
button-group`, green after the red run below. `real-input:android` is not asked for at review and
runs at merge. A local screenshot of a `text` group holding an action item, a checked toggle and an
unchecked toggle was taken on the final tree and, like every screenshot, stays out of the branch: it
shows one row whose unchecked items are labels centred at the height of the checked one's capsule.
It was held open by a scratch harness that the runner timed out at its own 30 s cap, after the screen
was taken.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2178 tests / 96 suites | `76566461bc3f` | 59.4 s | start 7.4 / med 9.2 / max 10.0 |
| `harness:ios` | **PASS** | 605 tests / 30 suites + isolated 6 tests / 3 suites | `76566461bc3f` (harness:ios digest) | 14 m 18 s | start 8.0 / med 12.5 / max 65.0 |
| `harness:android` | **PASS** | 663 tests / 31 suites + isolated 6 tests / 3 suites | `76566461bc3f` (harness:android digest) | 18 m 47 s | start 6.0 / med 7.2 / max 29.5 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:android:ButtonGroup` | stale | 2 failed of 11 tests / 1 suites | b22f756d6414 (not this tree) | 19.3 s | start 16.2 / med 15.9 / max 16.2 |
| `harness:android:Scratchphoto` | stale | 2 tests / 1 suites | b05c5a6b47e4 (not this tree) | 30.9 s | start 7.0 / med 12.6 / max 15.1 |
| `harness:ios:ButtonGroup` | stale | 1 failed of 12 tests / 1 suites | e175a0a9cee4 (not this tree) | 20.6 s | start 10.6 / med 9.4 / max 10.6 |
| `harness:ios:ButtonGroupPhoto` | stale | 1 tests / 1 suites | c67f7c955d2e (not this tree) | 34.6 s | start 13.4 / med 10.7 / max 13.4 |
| `harness:ios:Fix7photo` | stale | 1 failed of 1 tests / 1 suites | e0bda946700b (not this tree) | 42.0 s | start 12.8 / med 10.3 / max 12.8 |
| `harness:ios:Scratchphoto` | stale | 2 tests / 1 suites | 57c01335fa3a (not this tree) | 31.7 s | start 58.0 / med 56.1 / max 58.0 |
| `real-input:ios:--a11y:button-group` | stale | — | aa7fe1899806 (not this tree) | 1 m 13 s | start 7.2 / med 10.0 / max 11.5 |
| `real-input:ios:--control:button-group` | **PASS** | — | `76566461bc3f` (real-input:ios digest) | 3 m 04 s | start 8.0 / med 9.7 / max 30.8 |

`need --for review`: `need: review is satisfied on this code tree.` The filtered `ButtonGroup` and `Fix7photo` rows are the mutation and photo runs named below; the same files pass inside the full runs above. One `harness:android` run went red first: the emulator lost its adb bridge 100 tests in and 58 suites never ran, and the green row is a fresh run of the same tree.

### Red proofs

- the new box test -> `CheckedFootprint` removed (that file at `eaefa0da`) -> `a "text" group
  holding a toggle measured 20.333… pt high with its toggle unchecked against the 34.333… pt the
  same label measures inside a capsule, so the taller state has nowhere to be drawn.`
- the checked `text` tint check -> `OptionalItemTint` skipped for a checked `text` toggle ->
  `a checked "text" toggle drew only 0% of the ink it draws in the group's tint, so a checked item
  of any colour would match {"fill":53,"tint":4}.` with `on={"fill":53,"tint":0}`.
- the unchecked tint floor -> the same modifier skipped while unchecked -> `an unchecked "text"
  toggle drew only 0% of the ink it draws in the group's tint, so it reads as a disabled item
  rather than as an unchecked one.` with `off={"fill":5,"tint":0}`.
- the disabled-action comparison -> `.disabled(model.disabled || item.disabled)` reduced to
  `.disabled(model.disabled)` on an action item -> `an unchecked "filled" toggle
  ({"fill":53,"tint":4}) draws like the disabled action item beside it ({"fill":49,"tint":47}).`
- `real-input:ios -- --control button-group` -> a second `Button` overlaid on a toggle item -> at
  `RealInputTests.swift:2531`: `("2") is not equal to ("1") - the group
  "real-input-button-group-toggles" offers 2 elements to a reader for the toggle item "Bold", which
  hears that item that many times and cannot say which one a tap reaches`.

Each filtered run was 1 failed and 11 passed beside the box test's own 1 of 12; the same files are
green on the final tree, on both platforms.

### Follow-ups

- The `.bordered` label that reserves the footprint is `.hidden()` and `.accessibilityHidden(true)`;
  no gate reads the accessibility tree of a `text` toggle item, so that attribute is unproven — the
  real-input check covers that screen's own (default) variant.
- Reserving the footprint widens a `text` group's toggle slot to the capsule's width in both states,
  which is what makes the flip size-neutral; at a width the row was already tight at it can move an
  item into the overflow earlier than before.
- Round one's N2 to N5 and CodeRabbit's two Android test-seam notes stay follow-ups.

### Questions for orchestrator

None.
