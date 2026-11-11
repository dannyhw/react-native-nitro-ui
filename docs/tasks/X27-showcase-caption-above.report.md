# X27 — Examples: the caption above the control, and every README screenshot retaken to match

**Branch:** `task/X27-showcase-caption-above` (from `main` at `619e3af6`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `LEASE_ID` (`PAIR` / Metro `METRO`)

## Summary

`Row` in `example/src/stories/showcase.tsx` laid a caption and its controls out side by side, so
the README pictures of half the library looked broken: Stepper's longest caption ran into the
control and pushed it off the right margin, IconButton's "each one disabled" and "toggle form" rows
turned a strip of four buttons into a column beside the label, and Picker's wheel and Menu's
trigger sat behind the text that described them. `Row` now puts the caption on its own line and the
controls in a wrapping row underneath — the reading `Column`, `Frame` and the Slider and
ButtonGroup stories already had. That is the whole code change: 18 added lines and 12 removed in
one file, no component code.

`Row`, `Column` and `Frame` now share one captioned container (`gap: 6`), and only their controls
differ — `Row` wraps them across the line, `Column` keeps the stack. A `fillWidth` control
(Progress, Slider, TextField, SearchField, ButtonGroup) is measured against the line's width, so a
`Row` holding one still fills the page as it did beside the caption; nothing needed a per-story
width to keep it that way. No story had worked around the old layout (X24's Stepper caption column
has not landed on `main`), so no story needed unwinding.

The pairs that change are exactly the ones whose photographed story contains a `Row`. Reading each
component's story against its README alt text, that is seven pairs: Button (`Variants`), IconButton
(`Variants`), Stepper (`States`), Switch (`States`), Progress (`States`), Picker (`Variants`) and
Menu (`RowDetails`). The other fifteen pairs come from stories built only from `Column`, `Frame`
and `Note`, which this change does not touch: Slider's `Steps`, ButtonGroup's `Appearances`,
SearchField's `States`, SegmentedControl's `OptionSets`, DatePicker's `Variants` and ContextMenu's
`Conversation`, plus the Chip, Checkbox, TextField, Form, Tooltip, Popover and Dialog stories,
whose files never import `Row` at all. Those fifteen stay as they are.

<!-- FINALISE: retake list, still-wrong list, gate table, strip -->

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |

`need --for review`: GATE_NEED_LINE

## Files changed

## Follow-ups

## Questions for orchestrator
