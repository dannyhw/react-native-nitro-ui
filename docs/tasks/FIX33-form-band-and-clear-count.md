# FIX33 — The Android Form section draws into a layer as tall as itself; the clear case waits for its count

**Kind:** bugfix · **Devices:** both ·
**Budget:** 2.5 h for round one (a CI-only layout bug to reproduce plus a one-line test read;
median of the recent Android one-cause fixes, 2 h, plus 0.5 h)

## Goal

On Android, a `Form.Section` with a header and footer draws its header and footer layer exactly as
tall as the section on every device configuration CI uses. Separately, the iOS SearchField clear
case reads its native event count only once that count has arrived.

## Why

1. `example/__tests__/Form.harness.tsx` "Form section drawing (E2, Android) › reserves a band with
   its padding and draws into a layer as tall as its section" (about line 2311). It failed once
   locally (2026-11-20, in a full run, green alone), then on four GitHub-hosted CI rounds on
   2026-11-24, each time with the same numbers: the layer 288.4 dp against a 296.4 dp section,
   8.0 dp short. Steady numbers point at the device's configuration, not a race. CI's emulator is
   `pixel_9`, API 35 (`example/rn-harness.config.mjs`, `androidEmulator(...)`). By the flake rules
   this is a bug. If the layer really is short, a section's footer band is clipped for users on
   such a device.
2. `example/__tests__/SearchField.harness.tsx` "reports the clear button as one empty edit and keeps
   the focus" (iOS, CI run 45483759347): the log wait now passes, then
   `expect(cleared.nativeEvents).toBe(typed.nativeEvents + 1)` reads 2 where 3 is expected.
   `cleared` is the report from the moment the text first read empty, and the clear's native event
   is counted a moment later.

## Behaviour

1. The Form section's drawing layer equals the section's height on the CI device configuration and
   on this machine's. If the layer only lags the section and then catches up, the case waits for
   the settled pair and asserts it as today, and the report shows the lag with evidence.
2. The SearchField clear case waits until the report shows the clear's native event as well as the
   empty text, then asserts exactly what it does today. A clear that never counts an event still
   fails, and the message names it.
3. Nothing else changes.

## Proof

- Form: reproduce the 8 dp first by matching CI's device configuration on your leased emulator:
  `pixel_9` metrics, density and font scale from `adb shell wm` and `settings`. Restore every
  setting you change before you release the lease, and write them in the report. Then rank the
  causes and fix the best survivor. Show the case red on main's code under the reproduced
  configuration and green after the fix. If the 8 dp cannot be reproduced in 30 minutes and two
  device runs, say so and fix from evidence (`.claude/skills/flake/SKILL.md`).
- SearchField: red once with the clear's native count held back, then green.
- `harness:android` and `harness:ios` green; `check` and `need --for review` clean.

## Out of scope

- Other Form cases, other CI reds (Menu split trigger, Picker), iOS Form.
- `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/`, shared e2e helpers; creating or deleting AVDs.

## Decided already

- Wait only for real signals: no fixed sleeps, no longer timeouts, no loosened tolerance (the case's
  1 dp stays).
- A library fix keeps the perf contract.

## Context

`android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiForm*.kt` (the section's layer and
how its height is reported); the two harness files; `docs/DESIGN.md` on Form and sizing.
