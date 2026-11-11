# X27 — Examples: the caption above the control, and every README screenshot retaken to match

**Worktree / branch:** named in your delegation message (`task/X27-showcase-caption-above`). **Round cap:** 1 round,
plus at most 2 fix rounds (D19). **Devices:** your lease (`node scripts/lease.mjs acquire --task X27 --boot`), for the
screenshots. Export the lease's environment before any device run.

## The problem (owner, 2026-11-11)

The README screenshots of several components look broken because the shared story helper `Row`
(`example/src/stories/showcase.tsx`) puts a caption and its controls **side by side**: a long caption squeezes or
pushes the control (Stepper), and a row of several controls stacks them vertically beside the caption (IconButton's
"each one disabled" and "toggle form" rows). Slider and ButtonGroup look right because their captions sit on their
own line above the control. The owner wants that layout everywhere.

## Do

1. **Change the layout once, in `showcase.tsx`:** `Row` puts its caption on its own line above its controls, with the
   controls laid out horizontally (wrapping when they don't fit) and consistent spacing, the way `Column` and the
   Slider/ButtonGroup stories already read. Keep `Column` and `Frame` as they are, or fold them in if that's simpler.
   Don't change any component code.
2. **Fix any story that worked around the old layout** (for example the Stepper story's caption column from X24, if it
   has landed on `main` when you start or when you merge) so every story uses the shared helper.
3. **Retake every README screenshot whose story changes** (`docs/images/components/<kebab>-{ios,android}.png`, iOS
   804 px, Android 720 px, light, from Storybook, per CONTRIBUTING's "README screenshots"), with the same story state on
   both platforms. Expected: at least Stepper, IconButton, Button, Picker, Menu, Switch, SegmentedControl, DatePicker,
   Progress, SearchField and ContextMenu; check each one.
4. **Look at every screenshot you retake** at full size before committing, and list in the report anything still
   wrong (clipping, overlap, uneven spacing, a control that looks broken). Fix story-level problems; report component
   bugs as one FOLLOWUPS line each.
5. The README's alt text for each image should still describe what the image shows.

adb `-s <serial>` on your own leased emulator is approved for screenshots. Undo `adb reverse` and the debug-host
preference afterwards, and restore any setting you change (read it first; never `cmd uimode`, not even to read).

## Gates

`check`. The harness and real-input suites don't use the showcase helpers. If `need --for review` still asks for device
gates because `example/src/stories/` is outside the known prefixes, run both `harness:*`, and say so. Report at
`docs/tasks/X27-showcase-caption-above.report.md` with a before/after strip of the retaken images. Export the ledger
with `gate.mjs export --task X27`.
