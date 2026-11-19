FIX ROUND

# FIX19 re-review (fix round 1): task/FIX19-chip-disabled-selected-retry at cf37d95e

`check` was run once here: PASS, 18 steps. `lease.mjs list` showed no lease. `need --for review` is satisfied on
code tree `886163f83e3c`. Scope is clean. There is one author address, nothing personal, and no process kill this round.

M1 closed. The shots were taken at 20:14 and 20:16 and the README image at 20:24, all after the fix commit `3c051b89`
(20:10). Light reads Vegan `#D1EAFF`, dimmed On `#E0E9F3`, Off `#E9E9EB`. Dark reads `#001A2E`, `#17212A`, `#262629`.
The README image reads the same three light values. None of them is FIX9's `#DFECF7` or `#101D28`. The label is the
chip's own. The "O" left stroke reads `E4E4E6 C2C2C5x3 C5C5C8` on Off and `DBE4EE BBC2CCx3 BEC5CF` on On: the same
profile, the same 39-per-channel contrast to its own ground, and no ghost. Dark matches it (`525257` on `262629`,
`464E57` on `17212A`).

M2 open. The images show the constant is wrong at the chip's own size, and the new read is tuned so it cannot see that.
- Light shot, row 872 (mid-height): the On chip's grey container spans x=222-341 and the fill spans 219-344.
  x=219-221 and 342-344 read `EEF7FF`, which is the fill over the white page. That is 1 pt of fill outside the chip on
  both sides. Dark shows the same at those columns (`000A11` over `000000`). The README image shows it too
  (row 448, x=146-147 and 228-229: `F0F8FF EDF6FE`). Vertically the fill falls short: rows 831-832 are the grey
  container and the fill starts at 833, at the bottom too, so the top and bottom edges show a 0.5 pt grey hairline.
  The fill is 2 pt wider and 1 pt shorter than the control. That fits a round 10/5 pt padding, so -10/-5 fits at this
  size, and the "Half points, because the style's own padding is not a round number" comment
  (`HybridNitroUiChip.swift:204`) is not borne out.
- The read was loosened to reach green. In `468413c5` both edge checks used `EDGE_TOLERANCE = 2`. The shipped inset
  read `shape=3@26 covered=9@0` (logs from 20:06 to 20:34). The fix commit raised the shape tolerance to 4 and the
  covered tolerance to 12 (`Chip.harness.tsx:1413,1416`), just above those residuals, and dropped two fringe rows.
- The `.regular` run cited in the report and in the comment at `:204-205` did not fit. Its log (20:39) reads
  `covered=MAX`: "at row 0 the one paints columns 36-174 where the other paints nothing". The fill missed rows. That is
  the drift: when the control's padding grows, the constant leaves a grey ring.
- Dynamic Type: I believe `.bordered` padding scales with the content size category, but it has not been measured. If
  it does, sizes above L leave a ring as `.regular` did, and sizes below L overshoot further. The brief asks for every
  Dynamic Type size, and a construction that cannot drift is available, so this is an M and not a documented limit.
  The report does state that the AX leg did not run. `chip.md` says nothing about it.
- Fix: derive the inset from the layout. Read the styled control's size with `onGeometryChange` after
  `.controlSize(.small)`, and the label's size with `onGeometryChange` on `labelContent`. Keep
  `inset = (control - label) / 2` per axis in `@State` and pad `ChipDisabledFill` with its negation. The fill stays a
  background of the label, under the label and above the opaque container, so FIX9's first failure (fill behind the
  container) and the wash cannot return. The label stays SwiftUI's own view, not a copy at the wrong size. The cost is
  one extra render when a size changes, with no hop. A `GeometryReader` in the label background is not enough: it sees
  only the label. Clipping is not available, because a label background cannot address the control's shape.
  `@ScaledMetric` on 10/5 is a weaker fallback, because it assumes SwiftUI's own curve. Then restore tolerance 2 for
  both checks and add one row at `.regular` (or a larger label font), which has to be green too.

## New findings

M3. The edge read cannot fail for the overshoot the images show, and lets a wide gap through (`Chip.harness.tsx:1675-1767`).
The sampler captures only `view.bounds` (`HybridNitroUiChip.swift:520`). At mid-height the container fills the box, so
fill painted past the box is never sampled. The images show exactly that 1 pt. Overshoot is caught only on the curved
rows, where it shows up as 3 of the 4 allowed columns. On the gap side, `covered <= 12` applies to every row, so a fill
4 pt short of each cap passes. A 2-row vertical shortfall is sliced off. Comments `:1412` ("a third of a point, four
columns": 4 columns is 1.33 pt) and `:1415` ("a third of a point more": 12 columns is 4 pt, on all rows) misstate
both tolerances. Fix: give the probe a margin outside bounds (render bounds inset by -4 pt) so overshoot is visible.
Tolerance 2 on both checks. Red proofs at -12/-5 (overshoot past the box) and at -8/-5 (gap).

N1. CodeRabbit (PR #111, `HybridNitroUiChip.swift:520`), valid: the `Bool` from `drawHierarchy` is ignored. A failed
capture is the white backdrop alone. The iOS `androidIcon` check (`Chip.harness.tsx:1197`) asserts two captures are
equal, so two blank captures pass it. Return `capture failed` when the call returns false.

N2. Report, Fix round 1, M2. "green at the control's own size, 1 pt at the cap turn" and "matched ... on every row"
at `.regular` both read as a fit. The first is 1 pt outside the chip at mid-height. The second failed its coverage half.
Restate both from the logs.

Checked, no finding: the ink budget of 24 is fine. A glyph reads 14 apart over fill and over container in the shot (`C2C2C5` against
`BBC2CC`), so 24 is about twice that. The 20 pt wash keeps 21 % (red), so a half-area wash fails. The 6 and 12
probe budgets are justified: the fill is 15 from the container, and the overshoot rim is 25 from white.
