FIX ROUND

# FIX19 review: task/FIX19-chip-disabled-selected-retry at 1232613d

`check` was run once here: PASS, 18 steps (`lease.mjs list` showed no lease at all). `need --for review`
is satisfied on code tree `46cf2290cd40`. PR #111 has no CodeRabbit inline comments. Scope is clean:
nothing under `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/` or the shared e2e helpers, and no
Android file. One author address, nothing personal.

## Findings

M1. The screenshots and the committed README image show FIX9's parked drawing, not this branch's.
`docs/images/components/chip-ios.png`, `/tmp/fix19-chip-states-light.png` and `-dark.png` read a
disabled "On" fill of `#DFECF7` (light) and `#101D28` (dark). Those are FIX9 round 2's numbers exactly
(FIX9.review3: `#DFECF7`, `#101D28`, from fade 0.55). This branch fades 0.45 (`HybridNitroUiChip.swift:210`).
Container `#E9E9EB`, then white at 0.45, then tint `#0088FF` at 0.09 gives `#DDE9F5`. In dark,
`#262629` gives about `#13202B`. Those are the values FIX9 round 1 measured at 0.45. The label also
carries FIX9's mask-cut ghost, which this code cannot draw because it has no mask. Light 3x, "O" left
stroke, row 777, x=252-258: `E7EAEE E9E9EB E3E3E5 C2C2C5 C4C7CB CFDCE7 D1DEE9`. That is half the stroke
washed blue and a grey hole beside it, where the Off chip's stroke is `E3E3E5 C2C2C5 C2C2C5 C2C2C5 C6C6C9`.
The "O" keeps 62 % of the Off chip's ink pixels (budget 30) or 68 % (budget 48). At 4x zoom the dark
image shows a doubled "On". The screenshots were taken at 19:06, seven minutes after the 18:59 run
that checked out FIX9's Swift for the red proof, so they most likely came from that build. The shipped
image therefore shows a defect, and the docs claim at `chip.md:162` is unshown. It also means
question 2 cannot be answered from any image: this branch's drawing has not been photographed. Fix:
rebuild from HEAD and retake the README image and the light and dark four-state shots. Then confirm
three things in the crops: the fill reads about `#DDE9F5` / `#13202B`, the label strokes match the
Off chip's pixel for pixel, and no grey ghost shows.

M2. The inset has not been shown to fit the capsule, and its constant predicts that it does not.
`nitroUiChipContentInset` (`:206`) is a fixed -6 / -12 pt. It was found by growing the fill until the
box mean stopped changing (report summary; the 18:52 log's `fillA`/`fillB`/`fillC`). A box mean cannot
tell an exact fit from an overshoot. The harness sampler reads only inside the host's bounds, and the
dimmed fill makes the mean bluer, so overshoot only helps it pass. The arithmetic: the README label is
SF at 15 pt (the "O" is 11 pt tall at 3x), so its line is 20 pt and the chip is 28 pt. The bordered
`.small` vertical padding is then 4 pt, not 6. Unless SwiftUI clips the label to the capsule, the
fill is a 32 pt pill on a 28 pt chip. That paints 2 pt above and below the chip, and its flatter ends
(radius 16 against 14) fill about 6 pt of each corner outside the capsule. The constant comes from
one iOS 27 device at the default text size. At an accessibility size the label grows with the font,
and if SwiftUI scales its padding the -6 / -12 falls short and leaves a grey ring. None of this has
been looked at, because the only images show FIX9's overlay, which is sized to the control (M1).
Leading glyph, right-to-left and truncation are fine by construction: the background covers the
whole `Label`, the insets are symmetric, and it follows the truncated label's frame. iOS draws no
check slot. Fix: a row-by-row edge comparison of the disabled On chip against the Off chip at the
default size and at AX3, with a leading glyph and with a truncated title. If the fit is exact
(SwiftUI clips), this closes with no code change. If not, derive the inset from the measured content
size minus the label's size instead of from a constant.

N1. The iOS budget of 48 is wider than needed (`:495`). It was 30 in `3cc85ec9` and became 48 in the
fix commit `d9764087`, after this drawing read 86 % ink coverage at 30 (18:52 log, `fillB`). It
still catches FIX9's half-washed label (505 of 1038 pixels, 49 %, red at 48). But any partial wash
that lightens strokes by up to 16 per channel now passes the area floor. Only the darkest-pixel
check (`LABEL_INK`, `Chip.harness.tsx:1354`) limits a uniform wash. Translucent ink over the
`#DDE9F5` fill shifts a core pixel by about 17-19 against the grey container, which fits inside 30,
so the width comes from the anti-aliased edges. Log `areaOn`/`areaOff` at both budgets, or derive the
budget from the measured `dimOn`-`dimOff` fill distance, and record the ratio in the report.

N2. Missing red proofs. `measures one size whether or not it is disabled` (`:1431`, runs on both
platforms) and the iOS `androidIcon` paint comparison (`:1126-1151`) were never shown to fail, which
AGENTS.md requires of every new test. Both can fail. One way to show it: give `asset` a different
label and confirm `apart > NOISE_PAINT` goes red.

N3. Comment length. `ChipDisabledFill` (`HybridNitroUiChip.swift:183-187`) and
`nitroUiSampleChipDrawing` (`:497-501`) have five-line doc comments, and the harness ink test has
two four-line comments (`Chip.harness.tsx:1537-1540`, `:1562-1565`). AGENTS.md "Comments" asks for
one to three lines.

N4. A probe posted with `main.async` just before a recycle still publishes into the cleared model
(the reused chip reports `n=1` with old pixels). Test-only; a Follow-ups line.

N5. The report says the dark relations "rest on the screenshot"; given M1 they rest on nothing yet.
Dark appearance and VoiceOver focus across a disable stay unmeasured (carried over).

N6. Hygiene incident: the report records stopping a `simctl launch --console-pty` process with
`pkill -f`. AGENTS.md bans pattern kills; it should have been stopped by its recorded PID.

## Checked, no finding

- Identity: the `if` is inside `.background {}` on `label` (`:160-166`), so the `Toggle` and label
  keep one structure in every state; a background does not change layout, so sizes and the size key
  hold. The fill is hit-test- and accessibility-hidden; `isEnabled` and the value come from the
  untouched `Toggle`. Gated on `.filter && displayed && disabled`: enabled and assist chips draw as on
  `main`. The label is SwiftUI's own (no copy); its legibility is unproven only while M1 stands.
- Probe: test-only (`@internal`), no cost until called, no hop when on main, never blocks JS, reset
  by `clearReports()`. Fill-relation bounds match FIX9's, not loosened; red proofs for today's
  drawing (0 apart) and FIX9's (49 %) check out against the 18:51 and 18:59 logs.
- Docs and changeset are true of the code; FOLLOWUPS line removed; README image 804 px, light, iOS
  only (its content is M1).
