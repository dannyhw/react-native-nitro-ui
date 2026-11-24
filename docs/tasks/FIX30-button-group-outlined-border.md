# FIX30 — ButtonGroup's outlined toggles draw Material's outline

**Kind:** bugfix · **Devices:** android ·
**Budget:** 1.5 h for round one (FIX27, the same border fix on IconButton, took 1.5 h plus one
fix round)

## Goal

On Android, a ButtonGroup toggle item in the `outlined` variant draws the outline Material draws
for its state, with or without a `tintColor`, and a `text` item draws none.

## Why

From the IconButton border fix's review (#124). `toggleOutlinedBorder` in
`android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiButtonGroup.kt` (about line 533,
caller about line 483) gives `OutlinedToggleButton` an explicit `border`:
- With no tint, it returns `null`, which replaces Material's default. So an untinted `outlined`
  toggle draws no outline at all: the default look is wrong.
- With a tint, it is the full tint in every state: still full strength while disabled, and a ring
  on a toggle that is on, where Material draws none.
- A tinted `text` item gets a ring that the `text` variant should not have.

## Behaviour

1. `outlined`, no tint: the outline is Material's own for the state (on and off, enabled and
   disabled).
2. `outlined` with a tint: Material's width and strength for the state, with the tint as the
   colour. No outline where Material draws none.
3. `text`, with or without a tint: no outline.
4. Other variants, sizes, layout and icons are unchanged.

## Proof

- A harness case (`example/__tests__/ButtonGroup.harness.tsx`, using or extending the file's
  probes) reads the outline of untinted and tinted `outlined` toggles enabled, disabled, off and on,
  and of a tinted `text` item. Compare state against state, never against a hard-coded colour.
- Red once each:
  - main's untinted `null`;
  - full tint while disabled;
  - a ring while on;
  - a ring on `text`.
  One mutation may cover two of these if it really does.
- `harness:android` and `harness:ios` green (the harness file changes); `check` and
  `need --for review` clean. Add a patch changeset in app-developer terms.

## Out of scope

- iOS ButtonGroup; IconButton; the untinted IconButton ring in dark mode; other ButtonGroup
  follow-ups. `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/`, shared e2e helpers.

## Decided already

- Follow Material for each state the way `outlinedBorder` in `HybridNitroUiIconButton.kt` now does:
  take Material's border for the state, keep its width and its colour's alpha, and replace only
  the hue. When Material returns `null`, return `null`.
- Untinted means passing Material's own default, not `null`.

## Context

`HybridNitroUiButtonGroup.kt` (`toggleOutlinedBorder` and its caller), `HybridNitroUiIconButton.kt`
(`outlinedBorder`, the pattern to follow), `docs/components/button-group.md`.
