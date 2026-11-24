# FIX31 — The typing round-trip cases hold on a slow machine

**Kind:** bugfix · **Devices:** both ·
**Budget:** 2 h for round one (two harness cases plus a decision on one handshake read; the
recent test-read tasks took 1.5–3 h)

## Goal

The Android "round-trips typed text to JS, one event per keystroke" cases for TextField and
SearchField pass whenever JS is slow to answer. If either one turns out to hide a real
controlled-value problem, that problem is fixed instead.

## Why

GitHub-hosted CI on main a91d84d3 (run 45457383757), Android harness:
- `example/__tests__/SearchField.harness.tsx` about line 467: `expect(state.jsEvents).toBe(3)` read
  2. The case waits until the native text reads `abc`, then reads the count of JS echoes at once.
  That is the read-too-early shape.
- `example/__tests__/TextField.harness.tsx` about line 378: after it waited for `jsEvents === 3`,
  `state.lastWrite` read `stale` where the case expects `none`. On a slow machine an echo can
  reach native after a later keystroke, and the event-count handshake (`docs/DESIGN.md` 3.5) then
  calls that write stale. Whether `stale` is correct as the last write once all three echoes are
  in has to be decided from the handshake, not guessed.

## Behaviour

1. SearchField: the case waits for the native report to hold all three JS echoes before it reads
   them, then asserts what it asserts today.
2. TextField: decide from the handshake code and a measurement whether a final `lastWrite` of
   `stale`, with all echoes in and the field showing `abc`, is correct:
   - If it is correct, the case waits for the final write the handshake takes and asserts that,
     so it no longer assumes each echo lands before the next keystroke. The comment says why.
   - If it is wrong, so that a controlled field can end on a value JS did not ask for or skip a
     write it should take, fix the library and keep the assertion.
3. Nothing else changes.

## Proof

- Reproduce on demand by slowing the test's own controlled wrapper: delay each echo, e.g. set
  state after a timeout in that case's fixture. Show each case red on main's code with the delay,
  and green after the change with the same delay. Then remove the delay.
- If the library changes, give a red proof that mutates the handshake.
- `harness:android` and `harness:ios` green; `check` and `need --for review` clean.

## Out of scope

- Other TextField or SearchField cases, iOS behaviour, the other CI reds (Form E2 band, Picker,
  Menu). `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/`, shared e2e helpers.

## Decided already

- Wait only for a real signal: no fixed sleep, no longer timeout, no retry, no loosened
  assertion.
- The test-only delay is a proof tool. It is not committed.

## Context

`docs/DESIGN.md` 3.5; `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiTextField.kt`
(`lastWrite`, about lines 85, 158, 195 and 806) and the SearchField equivalent; the two harness
files above.
