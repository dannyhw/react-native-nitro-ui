MERGE WITH FIXES

# FIX7 review 3: fix round 2

Reviewed `task/FIX7-button-group-overflow-icons-toggle-variant` at `c39ec29e`. The round is
`01703886..HEAD`. `node scripts/gate.mjs check` was run once in the worktree (no lease in use):
PASS, 18 passed, 60.6 s. CodeRabbit has left no comment on PR #98 since 14:49Z, so none is cited.

## Item 1: closed (the clipping), with M1 for the part of the decision left out

- `HybridNitroUiButtonGroup.swift:623-642`: an unchecked `text` toggle is a `ZStack` of a hidden
  `.bordered` copy of its label and the `.borderless` drawing. The ZStack takes the larger size,
  which is the checked size, so a flip changes neither the width nor the height. `.controlSize` is
  applied outside the `Toggle` (`:449`), so the hidden copy is measured at every `size`.
- Overflow: the reserved width is used in `ViewThatFits`'s width test too, so a flip cannot change
  which candidate fits. A toggle in the overflow `Menu` is a plain `Toggle` and is untouched.
- The connected group with a toggle draws the standard row, so it gets the same footprint. The
  connected group with no toggle (`ControlGroup`) is unchanged. The iOS 15 `clippedRow` is the same
  `row()`. Every API used (`.bordered`, `.hidden()`, a custom `ToggleStyle`) exists on iOS 15.
- A `text` group with no toggle never reaches `ItemToggleStyle`, so it keeps the label height.
- Test (`ButtonGroup.harness.tsx:1274-1393`): it reads the measured height, the laid-out height
  and the sampled box. These must agree before the test reads anything. It fails without the
  fix: the red proof's 20.33 pt against 34.33 pt is the label height against the `medium` capsule
  height.
- Perf contract: the modifier is a value type, and no hosting view or `rootView` is rebuilt.

## The ink measure

- `tintOfInk` is `tint / fill` of one box, so it does not depend on the box's size. The margin
  constants are unchanged (`TINT_SEEN` 3, `SAME_DRAWING` 6), the harness gained no timeout or
  retry (the real-input poll is N1), and the tonal off-versus-disabled margin grew from 1 to 5.
- Each defect still goes red:
  - grey off (round one's `.secondaryLabel`) measures 0;
  - tint applied only while checked: off is the accent colour, which measures 0;
  - off drawn like disabled measures 0, below `disabled + 3`;
  - a mapping that ignores the variant is caught by `sameDrawing`, which is unchanged: a capsule's
    fill of about 53 against the label's fill of about 5 to 10.
- The new `tintOfInk(on)` check is the only one that catches a checked `text` item without the
  tint: 53/0 sits within 6 of quiet's 53/4.
- The four harness red proofs match their mutations (the disabled-action one would also trip the
  older `disabledAction.tint > 6` check, which runs after it).

## Findings

**M1. Only toggles take the bordered footprint, not every item, so the spacing in an iOS `text`
group is uneven.** `HybridNitroUiButtonGroup.swift:452-458` (the action `Button`) and `:628`.
- The decision said every item in a `text` group holding a toggle lays out at the bordered size,
  with its drawing centred. The code gives only toggles that footprint.
- The unchecked toggle carries the capsule's invisible side padding, about 12 pt on each side, and
  the action item carries none.
- In the screenshot, the gap from `Copy` to `Bold`'s capsule is about 8 pt. The gap from the
  capsule to `Italic`'s label is about 21 pt.
- Label to label it is about 21 pt from `Copy` to `Bold` and 33 pt from `Bold` to `Italic`, and it
  stays like that when every toggle is unchecked. A developer building a text toolbar will see it.
  It is not something the decision required.
- Second effect: once the row is narrow enough that every toggle moves into the overflow `Menu`,
  the visible candidate is label height, so the row's height then depends on its width.
  - A bounds change re-measures (`NitroSwiftUIHost.swift:127-139`), so it heals.
  - But the changeset ("the height of a capsule in either state") and `button-group.md:167-171`
    overclaim for that case.
  - Giving action items the footprint keeps every candidate (k ≥ 1) at capsule height.
- Hand-fixable:
  - make `CheckedFootprint` generic over its label view;
  - apply it to the action `Button` when `ItemStyle(variant:) == .borderless` and
    `model.items.contains(where: \.toggle)`;
  - put it inside `.controlSize`, so the hidden copy gets the size;
  - make the doc sentence say "every item".
  - About 15 lines and one `harness:ios` re-run; no test reads spacing, so confirm by screenshot.
  - If the orchestrator accepts the uneven gaps instead, the doc should say that only toggles
    reserve the capsule.

**N1.** `RealInputTests.swift:2406-2411`: `assertToggleElement` now polls the state for 3 s. This
does not weaken the test: an immediate `nativeItemState` assertion precedes every call
(`:2527`, `:2569`, `:2591`). But it duplicates `waitForItemState` (`:2318`).

**N2.** `ButtonGroup.harness.tsx:1183`: `disabled.tint > SAME_DRAWING` is still a share of the box.
For `text`, with a fill of about 5, it can never fire. `tintOfInk` would make it hold at any box
size. This predates the round, and the new off-versus-disabled comparisons cover it.

**N3.** `tintOfInk` is coarse at a small fill: one tinted point of a `text` label's 5 is 20%.
Today's readings (60 against 0) leave a wide margin.

**N4.** The hidden footprint copy (`:629-634`) has no accessibility read for `text`, because the
real-input screen is `filled`. The report lists this as a follow-up. `.hidden()` already drops it
from the tree.

**N5.** `FIX7.report.md` red proof 3 ("the same modifier skipped while unchecked") does not say the
skip was limited to `text`. Skipped for every variant, it would go red on `filled` first, not on the
quoted `text` line.

## Checked and clean

- Items 2a-2d and 3 done as asked: `size` cells (`button-group.md:47`, `:111`), checked tint,
  disabled-action comparison, one actionable element per title (`RealInputTests.swift:2381-2397`,
  red proof at `:2531`), comment at `:2340`.
- Docs and changeset true on both platforms and for an app developer, apart from M1's sentence.
  Comments cite no task, review or history.
- Scope: nothing under `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/` or the shared helpers;
  one author address; no AI/agent mention, home path, email or hostname; no tracked png.
