# X49 — the Android real-input suite stops scrolling from the top for every control

**Kind:** tooling · **Devices:** android · **Budget:** 3 h for round one (the three tasks that moved checks into this suite ran 2.5 to 4.5 h)

## Goal

A contributor waits minutes less for every Android real-input run.

## Why

Owner request to cut gate waiting. The e2e phase of `real-input:android` takes 31 minutes for 70
tests. A test for a control near the bottom of a screen first rewinds the page to the top and then
drags down to it, about 100 s a time on the Picker and Host screens.

## Behaviour

1. Bringing a control into the tappable band starts from where the page is and travels towards
   the control. It rewinds to the top only when it cannot tell which way the control lies.
2. A control that is already in the band costs no drag.
3. Every assertion in the suite is unchanged, and so is what counts as "in the band".
4. The e2e phase of a full run is shorter, by a number the report states: per test file, before
   and after, from the run's JSON report.

## Proof

- `node scripts/gate.mjs check` passes.
- Before any edit, take the per-file durations of one full run from the newest
  `real-input:android` log of branch `task/M10-real-input-e2e-train`
  (`node scripts/gate.mjs logs --branch task/M10-real-input-e2e-train`); do not make a baseline
  run of your own.
- While working, filtered runs only: `node scripts/gate.mjs real-input:android -- --control <id>`.
- Then one full `node scripts/gate.mjs real-input:android`, green on the final tree. This task
  changes how every test scrolls, so the full run is its proof. If it goes red on a control,
  read the failure, fix it, and complete the run with `--rerun-failed` only when the tree did
  not change; otherwise run it once more.
- Red proof for 1: a unit test or an e2e test that fails when a control above the current
  position is looked for only downwards.
- `node scripts/gate.mjs need --for review` prints nothing missing.

## Out of scope

- The accessibility sweep and `scripts/real-input/android-tree-checks.mjs`.
- Relaunching the app less often, running files in parallel, or more than one worker.
- Any timeout, retry or `RUN_MAX_MS`.

## Decided already

- If the measured saving on the full run is under three minutes, stop, revert, and report the
  measurements: where the time goes instead is then the result.
- A test that passes only because of where the previous test left the page is a bug: each test
  still opens its own screen.
- No iOS gate and no harness gate is owed by an edit under `example/e2e/`.

## Context

`example/e2e/real-input/support.ts` (`reveal`, `rewindToTop`, `liftIntoBand`, `settleIntoBand`,
the tap band), `example/e2e/README.md`, `docs/agents/gates.md`.
