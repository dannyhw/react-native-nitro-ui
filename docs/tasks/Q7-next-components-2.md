# Q7 — The next components after ContextMenu, and their designs

**Type:** research and design. Read-only on code, no devices. **Round cap:** 1 round, plus at most 1 fix round.
**Output:** `docs/tasks/Q7-next-components-2.report.md`.

## Why

Q5's ranked list is built or building through ContextMenu (dialogs, BottomSheet, Chip, TextField, Checkbox,
ContextMenu). Its remainder — Stepper, Toast/Snackbar, Tooltip/Popover, Gauge, ColorPicker, Form/List/Section — and
Q5's note that RadioGroup belongs to Picker (an Android `variant="radio"`) have only a paragraph each. The owner's
priority is new components; this picks the next three to five and designs them so builds can start.

## Read first

`docs/tasks/Q5-next-components.report.md` (Appendix A ranking, Appendix D paragraphs), `docs/DECISIONS.md` (D14,
D17, D29, D32–D37), AGENTS.md (perf contract; README rule D4; README is for end users), the docs of the components
built since (`docs/components/{dialog,bottom-sheet,chip,text-field,checkbox,context-menu}.md` where present on
main), and Q1's format. Expo UI's current component set from a read-only reference clone if one exists, otherwise its
public docs.

## Do

1. **Re-rank** the remaining candidates plus anything strong that is missing (e.g. Picker `variant="radio"`,
   SearchField, Toggle-group/MultiChoiceSegmented, Rating, Badge, Divider/Section headers), with Q5's scoring. Account
   for what now exists to reuse: the presented-window children mechanism (BottomSheet), in-place children and
   gesture arbitration (ContextMenu), the dialog presentation helper, Chip/Checkbox inline patterns. Platform-only
   candidates: say whether we ship one platform natively plus a documented fallback, or skip.
2. **Recommend an order** for the next three to five and say which can build in parallel (two machines).
3. **Full designs (Q1 depth) for the top two;** for any cheap inline one (a Switch/Chip-class control), a short
   build-ready design is enough: API, native mapping and OS floors, sizing, a11y, tests.
4. For anything risky, name the spike questions and go/no-go criteria.
5. Decisions that are the owner's go under "Questions for orchestrator" with options and a recommendation; keep them
   few — the owner prefers the orchestrator to decide what it can.

## Not in scope

Code changes. Anything needing a human device pass.
