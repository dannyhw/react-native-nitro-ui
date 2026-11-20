# FIX23 — The iOS split Menu test waits for the action instead of a fixed 400 ms

**Kind:** bugfix (tests only) · **Devices:** ios ·
**Budget:** 1 h for round one (one wait change in one harness case, with a red proof)

## Goal

"Menu · Split trigger (E3) › is two halves, and each one does only its own job" passes on a slow
machine when the split Menu works, and fails only when a tap on it does not run its primary action.

## Why

It failed twice: locally on 2026-11-15 and in GitHub-hosted CI run 44628184641, both with
`expected [] to deeply equal ['split:action']` (`docs/tasks/FOLLOWUPS.md` "Flaky tests"). In
`example/__tests__/Menu.harness.tsx` (about line 2030) the iOS branch presses the trigger, waits a
fixed `settle(400)`, then reads `primaryLog`. On a slow machine the action can arrive after 400 ms.
Because iOS reports no `onOpen`, the test cannot tell a slow action from a tap that opened the menu,
so whether this is the test or the library is not settled by the logs.

## Behaviour

1. The iOS branch waits, with the file's usual timeout, until `primaryLog` has an entry, then asserts
   exactly what it asserts today: `primaryLog` is `['split:action']`, `stateLog` is `[]`, and the
   split fields answer as before.
2. If the wait times out, the failure says the tap ran no primary action, so a library fault reads as
   a clear failure, not as a timing flake.
3. Nothing else in the file changes, and no library code changes.

## Proof

- Red once with the primary action never called (for example `primaryAction` not passed to SwiftUI's
  `Menu` for that one run): the new wait fails with that message. One line in the report.
- `harness:ios` and `harness:android` green (the file is shared), `check` and `need --for review`.

## Out of scope

- An iOS "menu presented" witness, other Menu cases, real-input tests; list anything else found.
- `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/`, and the shared e2e helpers.

## Decided already

- Poll for the signal; never a longer fixed sleep, a longer timeout or a retry.

## Context

`example/__tests__/Menu.harness.tsx` (the Split trigger case), `ios/components/Menu/HybridNitroUiMenu.swift`
around `primaryAction`.
