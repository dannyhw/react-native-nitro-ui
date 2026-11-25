# FIX37 — The in-Form ListItem press case counts only its own press

**Kind:** bugfix (test) · **Devices:** both (a harness test file changes) ·
**Budget:** 1 h for round one (a single test case; the smallest recent harness fixes ran about 1 h)

## Goal

The Android check that a `ListItem` inside a `Form.Row` gets exactly one press from a row
activation keeps proving that, and stops failing on slow runners for a press it did not make.

## Why

`example/__tests__/ListItem.harness.tsx`, "draws no insets, container or highlight of its own
inside a Form.Row", failed on GitHub-hosted CI on 2026-11-24 and again on 2026-11-25. The second
time it failed in the first pass and in the isolated rerun. Both times the error was at line 1035:
`expected [ Array(2) ] to deeply equal [ 'form-item:press' ]` after one `clickRow('form-row')`.
It is green on every local run. The log does not show the two events.

The ranked suspect, not yet confirmed: earlier in the case, `pressItem('bare-item')` sends a
press, and the case waits only for the bare item to *paint* (native state), not for its
`bare-item:press` to reach JS. On a slow runner that event can land after `from = events.length`
is taken for the row click, which makes two events. The other candidate is a real double
`form-item:press` from one row activation. That would be a library bug, and must not be hidden.

## Behaviour

1. When the case fails, its message names every event it saw, not `Array(2)`.
2. The case decides between the two candidates by evidence. Delay the JS delivery of the bare
   item's press (a test-only delay in its handler, not committed) and see whether it reproduces
   the failure on the current test.
3. If the late bare-item press is the cause: the case waits for `bare-item:press` before it
   takes its count for the row click. It still requires exactly one `form-item:press` from one
   row activation, with the same quiet period after it.
4. If it reproduces as a double `form-item:press`: stop. Report the reading and make no change
   that would hide it.

## Proof

- Red proof of the cause: the timing variant from item 2 reds the current test and is green
  with the change (`test -> mutation -> the line that went red`).
- The surplus-event guard still bites: make the row activation fire the item's press twice
  (temporarily) and see the case go red naming both events.
- Filtered `harness:android -- ListItem` and `harness:ios -- ListItem` green.
  `node scripts/gate.mjs check` passes. `need --for review` prints nothing missing.

## Out of scope

- Any library change. Other cases in the file, and other files.
- `scripts/`, `.claude/`, `AGENTS.md`, `docs/agents/`, shared e2e helpers.

## Decided already

- No longer timeouts, no retries, no loosened equality (AGENTS.md).

## Context

`example/__tests__/ListItem.harness.tsx` (`pressItem`, `clickRow`, `waitForEvents`, the case at
about lines 940-1040), `.claude/skills/flake/SKILL.md`.
