# FIX27 — A tinted outlined IconButton dims its border when disabled

**Kind:** bugfix · **Devices:** android ·
**Budget:** 1.5 h for round one (median of the recent one-function Android fixes with a
pixel-probe proof)

## Goal

On Android, an `outlined` IconButton with a `tintColor` draws its border the way Material
draws an outlined icon button: dimmed while disabled, and absent on a toggle that is on.

## Why

A follow-up from the IconButton review: with a tint set, the outlined border is built in the
full tint whatever the state (`outlinedBorder` in
`android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiIconButton.kt`, about line 521;
only Material's width is kept). So a disabled tinted button keeps a full-strength outline and
reads as enabled, and a checked tinted toggle gains an outline Material's own toggle does not
draw. Without a tint the control already follows Material.

## Behaviour

1. Enabled and not checked, with a tint: the border is in the tint, as today.
2. Disabled, with a tint: the border is drawn at Material's disabled strength, not the full
   tint; a harness pixel read of the border tells the two apart.
3. A toggle that is on, with a tint: no border, as Material's outlined toggle when checked.
4. No tint: unchanged. No other variant, no iOS code, no size or layout changes.

## Proof

- A harness case (`example/__tests__/IconButton.harness.tsx`, the file's pixel probe) reads the
  border of a tinted outlined button enabled and disabled, and of a tinted outlined toggle on.
  Red once each: build the border in the full tint while disabled; draw it while checked.
- `harness:android` green; `harness:ios` green (the harness file changes); `check` and
  `need --for review` clean.

## Out of scope

- iOS's outlined hairline stroke (if it has the same gap, one line under Follow-ups).
- Other IconButton follow-ups (Dynamic Type, missing-glyph warning, 44 pt floor);
  `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/`, shared e2e helpers.

## Decided already

- Follow Material for each state: read Material's own disabled and checked answers (the
  border `IconButtonDefaults` returns for the state, its colour's alpha) rather than inventing
  an alpha. Note the current calls pass a `disabled` flag where Material's parameter order may
  expect `enabled`; check the 1.5 signatures.
- No new prop. The changeset is a patch.

## Context

`HybridNitroUiIconButton.kt` (`outlinedBorder` and its two callers, about lines 628 and 713);
`docs/components/icon-button.md` (variants table); `docs/DESIGN.md` for the perf contract.
