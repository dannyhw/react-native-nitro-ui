MERGE

# FIX13 re-review (fix round 1): `task/FIX13-button-group-text-spacing` at `6904f794`

`check` was run once in the worktree (no lease held or noted `real-input:ios`): PASS, 18 of 18.
`gate.mjs status` puts HEAD at code tree `85cf285d0ecf`, and the report's table shows `check`,
`harness:ios` and `harness:android` green on that tree (each on its own digest).
`need --for review` is satisfied.

## M1: closed

`HybridNitroUiButtonGroup.swift:476-485`: an action item is now `ItemButtonStyle`, then
`BorderedFootprint`, then `.controlSize(model.scale.controlSize)`. The hidden `.bordered` copy is
inside the ZStack the footprint builds, so it gets the group's size. A toggle's copy is drawn in
`ItemToggleStyle.makeBody` (`:639`) under the Toggle's `.controlSize` (`:469`), so both kinds of
item now measure at the same `ControlSize` at all five sizes (`xlarge` and `xxlarge` share
`.extraLarge`). Only the modifier order changed. The visible `Button` is still under the same
`.controlSize`, `ItemButtonStyle`, tint and `.disabled`, so it looks the same. The hit area is
still the content's (`.allowsHitTesting(false)` on the copy), and accessibility is unchanged
(`.hidden()` and `.accessibilityHidden(true)`).

The gap read (`ButtonGroup.harness.tsx:1395-1405`, `:1449-1509`) now runs both rows at every
`size`. The wells are 260, 260, 300, 350 and 350 pt, and each row still asserts `visible === '3'`
and three ink runs. So a well that was too narrow fails loudly and is never skipped, and the green
`harness:ios` on this tree shows every well fits. `EVEN_GAP` is still 1. The red proof matches the
mutation. At `e37345a` (new test, old modifier order), the `small` row of `action+on+off` reads
23 pt and 19 pt. The action item reserves a regular capsule around a small-font label, so the gap
beside it is wider. The quoted line is word for word the assertion at `:1501-1505`. `medium` could
not have caught this (ambient is `.regular`), and the new rows close that hole.

## M2: closed

The changeset (`.changeset/button-group-text-group-even-item-spacing.md:5-12`) now promises the
same *room* and says plainly that the space beside a checked capsule is narrower. Both are true of
the drawing. Its overflow sentence is also true: action items now reserve a capsule, so the
all-items candidate is wider. `docs/components/button-group.md:175-178` adds the capsule and
padding paragraph, and `:184-185` adds the overflow clause, which also settles round one's N2.
Both are written for an app developer and say nothing internal. It is a patch changeset.

## New findings

None at M level.

N1. `docs/components/button-group.md:176`: "between a checked item and its neighbour is that
padding narrower" is exact when the neighbour is a label. When two checked capsules are adjacent,
the gap is narrower by two paddings. "narrower" alone, as the changeset has it, would be exact in
both cases. This is wording, not a false claim about what a user will see.

N2. CodeRabbit left three inline comments on PR #103, all on round-one code. The missing
`harness:android` is now green. "Apply `controlSize` after the footprint" was M1 and is fixed.
"Unequal gaps when a checked toggle is at an end" (`[on, action, off]`) is valid as a measurement.
It is the drawn-whitespace point of round one's M2. Read literally, brief Behaviour 1 ("gaps
between adjacent items are equal") is still not met for the visible whitespace. The first review
accepted "equal room" as what "Decided already" settles, and the docs now say exactly that. The
orchestrator should confirm that reading of the brief at merge.

N3. Comments: `BorderedFootprint` (`:645-647`) is now three lines, which closes round one's N6, and
the new two-line comment at `:482-483` records an ordering constraint. Both follow AGENTS.md
"Comments".

Scope: nothing under `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/` or the shared e2e
helpers. The whole-task diff also removes the one finished line from `docs/tasks/FOLLOWUPS.md`.
Every commit has the same single author address, and nothing personal was added by this round.
