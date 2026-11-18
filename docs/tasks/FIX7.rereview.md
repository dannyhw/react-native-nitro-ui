MERGE WITH FIXES

# FIX7 re-review: fix round 1

Reviewed `task/FIX7-button-group-overflow-icons-toggle-variant` at `ba71c3e3`. The round is
`678a007d..HEAD`. `node scripts/gate.mjs check` was run once in the worktree, because no lease was
`in use (real-input:ios)`: PASS, 18 passed, 59 s. Android, `scripts/`, `.claude/`, `AGENTS.md`,
`docs/agents/` and `example/e2e/` are untouched in this round. Every commit has one author address.
There is no AI or agent mention, home path, email or hostname. The screenshots are ignored
(`.gitignore:133`) and none is tracked.

## M1: closed

- Code (`HybridNitroUiButtonGroup.swift:565-573, 601-611`): `ItemStyle(variant:)` followed by
  `state(isOn)` gives filled/elevated `.bordered`→`.borderedProminent`, tonal/outlined
  `.bordered`→`.borderedProminent` and text `.borderless`→`.bordered`. That is the decided mapping
  in every cell. `OptionalItemTint(color: tint)` is applied in both states. With no `tintColor` the
  item falls back to the accent colour, which is not grey.
- Screenshot (`FIX7-round1-ios-variants-all.png`): each row shows the mapping. Unchecked `Italic`
  is a red label on a pink capsule (a bare red label for `text`). Checked `Bold` is a solid red
  capsule (a pink capsule for `text`). Disabled `Dim` is a grey label on a grey capsule (a bare grey
  label for `text`). Off differs from on and from disabled in all five rows.
- Harness (`ButtonGroup.harness.tsx:1021-1177`): every cell is measured in its own one-item group
  and compared against measured items: the tonal action item (`quiet`), the filled action item
  (`loud`), the variant's own action item for `text`, and a disabled toggle and a disabled action
  item. I checked by hand that the test fails for each defect it guards:
  - a grey off state: `off.tint < 3`;
  - a tint applied only while checked: off is then the accent colour, `tint` measures 0, so it fails
    too. The second red proof shows it.
  - a variant-blind mapping: the `text` off state against the `text` action item, or a filled off
    state against `quiet`;
  - tonal or outlined collapsed into the borderless family: a filled off state (always `.bordered`)
    against `quiet`. This also answers CodeRabbit's "compare the bordered variants with the
    borderless variant" comment on the round-one code. Its "check the unchecked text toggle for a
    background" comment is answered by `sameDrawing(off, action)` for `text`.
- Nothing was loosened: the old 10 and 12 point margins are now 6 (`SAME_DRAWING`), and no timeout
  or retry was added. The reference drawings are measured, not constants. The off-state tint rule
  was inverted, which is what M1 asked for.
- Both red proofs print numbers consistent with their mutations.

## M2: closed

- `assertToggleElement` (`RealInputTests.swift:2369-2402`) checks three things: the element type is
  `.switch` (40), `nativeItemState` reads the 0/1 value, and `isSelected` is false. It runs on Bold
  and Italic before any tap (`:2480-2481`) and on Italic after each of the two real taps
  (`:2522`, `:2544`).
- `nativeItemState` returns "on" for `isSelected` before it reads the value. A value-less element
  that carried the trait would therefore pass the state check, but the `XCTAssertFalse(isSelected)`
  beside it fails such an element. Together the three checks require one signal: the value.
- Red proof: putting `.isSelected` back on a checked item makes `isSelected` true for "Bold", and
  the assertion reports at the caller's line 2480 with the `said` string format. That matches the
  quoted output.
- The filtered `--control button-group` and `--a11y button-group` runs are green on this tree.
- What a VoiceOver user gets: the element is a switch with the value on or off, read once. Not
  measured: the actual speech, and the variants other than the real-input screen's own. The style
  is the same code path for every variant, so the element should be identical.

## N1 (round one): closed

`button-group.md:110, 112` now read "ignored (a group with a toggle: as `standard`)", and the
`tintColor` cell is true.

## New findings

**M1. `docs/components/button-group.md:128-131`: the prose contradicts the table for `filled` and
`elevated`.**
- The text says: "A toggle item starts from that same style and moves one step up in it while
  checked".
- For `filled`/`elevated`, the unchecked toggle is `.bordered`, not the variant's
  `.borderedProminent`, and the checked one does not move up. The table (`:133-139`) and the
  paragraph at `:141-144` are right; this sentence is not.
- Fix: one sentence, for example "A toggle item is the quiet `.bordered` or `.borderless` look while
  unchecked and one step louder while checked, always in `tintColor`".

**M2. `docs/components/button-group.md:214`: the Accessibility table says an iOS toggle item is
`Toggle(…).toggleStyle(.button)`.**
- It no longer is: it is a `Toggle` with the library's own `ToggleStyle`. This task made the cell
  false, and it describes code rather than what VoiceOver gets.
- Fix: state what the round measured, for example "a switch with its on/off value, said once".

**N1.** `RealInputTests.swift:2340-2341`: the doc comment still says a toggle item is
"a `Toggle(.button)`". It is a test comment and does not ship.

**N2.** A disabled checked toggle is neither measured nor in the screenshot (`Dim` is unchecked).
- In `filled`, `elevated`, `tonal` and `outlined` it is a disabled `.borderedProminent` next to the
  unchecked toggle's disabled `.bordered`. SwiftUI may draw these two near-identically, so a
  disabled group could hide which toggles are on.
- The `text` row differs (capsule against no capsule). Round one drew both states in one style, so
  this is no regression. It is a follow-up only.

**N3.** `ButtonGroup.harness.tsx:1156`: the off-versus-disabled margin is thin for `tonal` and
`outlined`. A bordered item measures about 4% in the tint (round one's red proof:
`tonal: action={"fill":53,"tint":4}`), and the rule needs `off.tint > disabled.tint + 3`, so it
passes by one point. If it ever flakes, compare against `disabled.fill` or the label's tint count
rather than lowering `TINT_SEEN`.

**N4.** CodeRabbit's other comments on PR #98:
- The two Android test-seam comments (`overflowIcons` across reopenings, a `Pending` glyph's tint)
  concern code this round was not told to touch. Each describes a stale test report, not a drawing
  a user sees: at most a follow-up.
- Its `systemGray` on/off clash and its report claim no longer apply.

Carried over as before: round one's N3 to N5 stay follow-ups.

## Checked and clean

- Perf contract: no hosting view is rebuilt, setters are unchanged, and the style is a value type
  chosen per render. `toggleBinding` and the event-count handshake are untouched.
- The `ControlGroup` path is untouched (`:328-329`).
- Changeset: a patch, true on both platforms, nothing internal.
- Code comments describe constraints and cite nothing internal.
