# FIX13 — Items in an iOS `text` ButtonGroup holding a toggle are spaced evenly

**Branch:** `task/FIX13-button-group-text-spacing` (from `main` at `81dc4d62`) · **Round:** 1 of up to 3 ·
**Lease:** `FIX13-33j1y` (iPhone Air, iOS 27.0 / Metro `8293`)

## Summary

`CheckedFootprint` is now `BorderedFootprint`: generic over the label it reserves, and carrying a
`reserves` flag instead of its own style. `ButtonGroupContent` applies it to every item of a `text`
row that holds a toggle — action items included — inside `.controlSize`, so every item of such a row
is measured at the size of the capsule a checked toggle takes and draws its own label centred inside
it. An action item is no longer measured about 26 pt narrower than the toggle beside it, and the room
between two neighbours no longer depends on which of them is the toggle. The row is still measured
once per configuration, so checking a toggle repaints and moves nothing; a `text` group with no
toggle keeps the size of a label; every other variant takes `reserves: false`.

What the test measures needs judging, because the room between two items is only visible where their
drawings end: a `text` label is drawn inside the room it was measured at, so its box is not its ink.
The row probe therefore answers one more field, `ink=` — the point ranges across the box that were
drawing something, sampled in the same pass as the existing `drawing=` shares — and the test turns
those ranges into gaps. A checked capsule fills the room it was measured at while a label leaves a
padding at each side, so a pair is only comparable with a pair whose drawings have the same kind of
edge. The test reads `[action, on, off]` and `[action, action, off]` — a capsule between two
labels, then three labels — with one title repeated across each row so a gap carries the room and
not the shape of a word, and asserts that a row's pairs leave the same room, within a point.

Equal *rooms*, not equal whitespace in every order: in a row whose first pair is a capsule and a
label, the capsule's edge is the room's edge, so that pair shows one padding less than two labels do
— the price of a row that never resizes, and what the brief's `Decided already` accepted.

`harness:android` was not run: this task's lease is iOS-only, and releasing it to lease both
platforms, boot a cold emulator and build Android did not fit the 2 h budget. The harness file is
shared, so the run is owed before review: `node scripts/gate.mjs harness:android` on this tree.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2178 tests / 96 suites | `85cf285d0ecf` | 1 m 02 s | start 10.3 / med 12.0 / max 13.1 |
| `harness:ios` | **PASS** | 611 tests / 30 suites + isolated 6 tests / 3 suites | `85cf285d0ecf` (harness:ios digest) | 14 m 26 s | start 11.2 / med 5.8 / max 11.2 |
| `harness:android` | **PASS** | 669 tests / 31 suites + isolated 6 tests / 3 suites | `85cf285d0ecf` (harness:android digest) | 18 m 13 s | start 11.2 / med 6.0 / max 13.3 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | **PASS** (completed: 1 of 52 units re-run, attempt 1; from `merge/FIX7`) | 5 tests / 1 suites | `ed152743d4c7` (real-input:android digest) | 11 m 31 s + full run 38 m 51 s | start 45.2 / med 9.1 / max 45.2 |
| `harness:ios:ButtonGroup` | **PASS** | 13 tests / 1 suites | `85cf285d0ecf` (harness:ios digest) | 23.3 s | start 10.8 / med 12.6 / max 12.8 |

`need --for review`: `need: review is satisfied on this code tree.`

## Red proofs

- `leaves the same room between every pair of items in a text group holding a toggle` -> the layout
  fix reverted, so the footprint is reserved only by a toggle whose state style is `.borderless`
  (today's drawing) -> `the "action+on+off" row leaves 9.00 pt and 21.00 pt between its drawings,
  12.00 pt apart, so an item is drawn in less room than its neighbour takes.` — the 12 pt the page
  documented, and the run's own read was `ink=42.00~78.00|87.00~149.33|170.33~206.33`: a 36 pt label,
  a 62.33 pt capsule, a 36 pt label.

## Files changed

- `ios/components/ButtonGroup/HybridNitroUiButtonGroup.swift`: the footprint modifier generic over its
  label with a `reserves` flag; every item of a `text` row holding a toggle takes it; the row probe
  publishes the drawn ranges as `ink=`.
- `example/__tests__/ButtonGroup.harness.tsx`: the even-gap read over two mixed rows of one title.
- `docs/components/button-group.md`: the Sizing paragraph says what a `text` group holding a toggle
  reserves, and no longer claims a wider gap beside an unchecked toggle.
- `docs/tasks/FOLLOWUPS.md`: the line this task was opened for is gone.
- `.changeset/button-group-text-group-even-item-spacing.md`: patch.

## Follow-ups

- ButtonGroup: a capsule draws to the edge of the room it was measured at, so the whitespace between
  a `checked` item and its neighbour stays one padding narrower than between two labels.
- ButtonGroup: every item of such a row now composes the hidden `.bordered` copy of its label, not
  only the toggles — the same cost as before, on more items, in one variant.
- ButtonGroup: the padding an item reserves is not its tap area, for an action item as for an
  unchecked toggle's before it; no accessibility read covers it.
- ButtonGroup: the local screenshot of this row is `medium` only, and crops a capsule's top and
  bottom.

## Fix round 1

An action item's footprint sat outside its own `.controlSize`, so the hidden `.bordered` copy
measuring it took the ambient size: in a `text` group at `small` an action item reserved a wider
capsule than its neighbour's. `.controlSize` now wraps the footprint, as it wraps a toggle's,
and the gap read runs at every `size` the group takes, each row in a well wide enough for it.

The changeset and the Sizing paragraph say what such a row leaves visible: every item reserves the
same room, a checked capsule fills it while a label leaves its padding, so the space beside
a checked item is narrower than between two unchecked ones. Overflow says such a row reaches the menu
at a wider box. `BorderedFootprint`'s comment is three lines, and `harness:android` ran, round one's
debt. The table under `Gates` is this round's.

- `leaves the same room between every pair of items in a text group holding a toggle, at every size`
  -> footprint left outside `.controlSize` (`e37345a`) -> `the "small" row of action+on+off
  leaves 23.00 pt and 19.00 pt between its drawings, 4.00 pt apart, so an item is drawn in less room
  than its neighbour takes.`
