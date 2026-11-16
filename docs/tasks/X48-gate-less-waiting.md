# X48 — device gates re-run only what a change or a failure calls for

**Kind:** tooling · **Devices:** both · **Budget:** 3 h for round one (gate-tool tasks have run 2 to 4 h)

## Goal

A contributor waits for a device run only when that run can tell them something new.

## Why

Owner request. One piece of test-only work cost about six hours of waiting: an edit to an Android
test file made all four device gates owe a fresh run, one failed control out of 28 cost a full
50-minute rerun, and the five merge gates ran one after another.

## Behaviour

1. **Each device gate is keyed to the files its own run reads.** `harness:<p>` and
   `real-input:<p>` each get a digest: the platform's half of the tree minus the paths only the
   other suite reads. An edit under `example/e2e/` or to an Android-only file in
   `scripts/real-input/` makes `real-input:android` stale and nothing else. An edit to a harness
   test file makes the harness gates stale and no real-input gate. `status`, `need` and `table`
   all use these digests, and `need --for review` asks for a harness gate only when the diff
   touches that gate's files.
2. **A path leaves a gate's digest only with proof, and `check` keeps the proof true.** For every
   exclusion there is a test in `scripts/__tests__` that fails when a file the gate does read
   starts importing from the excluded path. A path you cannot prove stays in both suites' digests.
3. **A red full run can be completed.** `node scripts/gate.mjs <gate> --rerun-failed` works for
   `real-input:<p>` and `harness:<p>`. It finds the newest full run of that gate that is red on
   the current digest, re-runs only the units that did not pass (controls, harness suites, and
   anything not run), and records the outcome under the full gate's name. The gate is green only
   if every re-run unit passed and the digest is the same before and after. It refuses, saying
   why, when there is no such red run, when the digest has moved, or when the failure was not a
   unit a filter can name (a build failure, a crash before the first unit).
4. **A completed run never reads as a clean one.** `table` and `status` show it as such, with how
   many units were re-run and how many attempts it took. An ordinary filtered run still satisfies
   nothing.
5. **An iOS gate and an Android gate run at the same time from one worktree** and both record
   correctly: under one lease that covers both platforms if one Metro can serve both, otherwise
   under two leases. Find out what stops this today (Metro port, run-state files, the tree-moved
   check) and remove it, or show that it already works. Say which form works.
6. Ledger lines written before this change still count: a line with no per-gate digest is compared
   on the platform half, as now.

## Proof

- `node scripts/gate.mjs check` passes; `node scripts/gate.mjs need --for review` prints nothing missing.
- Unit tests for 1 to 4 and 6, each shown red once. Required mutations: put `example/e2e/` back
  into a harness digest; let `--rerun-failed` complete a run whose digest moved; let it skip a
  unit that was never run; render a completed row as a plain pass.
- For 2: add an import of the excluded path to a file the gate reads, and quote the failing line.
- On devices, one session that proves 3 and 5 together. Make the Form control fail on iOS without
  editing the tree: on your leased simulator,
  `xcrun simctl spawn <udid> defaults write com.apple.keyboard.preferences AutomaticMinimizationEnabled -bool YES`.
  Start the full `real-input:ios` and, within a minute, `harness:android`. Expect the first red
  on Form only and the second green. Set the preference back to `NO`, run
  `node scripts/gate.mjs real-input:ios --rerun-failed`, and quote the table rows and wall-clock
  times. This is the only full real-input run the task makes.
- The report states the digest each of these edits moves: one e2e test file, one harness test
  file, one example screen, `src/`, `scripts/real-input/android-tree-checks.mjs`.

## Out of scope

- Per-control digests, test selection from a diff, and any change to what a gate asserts.
- The lease store, CI workflows, benches, build stamps (`scripts/app-stamp*.mjs`).
- Making the suites themselves faster.

## Decided already

- The platform halves keep their meaning and their hashes. The per-gate digests are added beside
  them, so no branch in flight owes a run because of this change.
- Whether example screens (`example/src/`) leave the harness digests depends on evidence: does a
  harness run load `example/src/App.tsx`? Show it from the served bundle or the entry swap. If it
  does, they stay.
- The tool does not cap completion attempts. It records every one; the `flake` skill sets policy.
- Docs in this branch: `docs/agents/gates.md`, CONTRIBUTING "Recording a gate run", and one line
  each in `AGENTS.md`, the `brief` skill and the `orchestrate` skill: a task that changes
  real-input tests proves them with a filtered run naming the controls it touched, the full
  real-input gates run once at merge, and the merge run starts the two platforms side by side.

## Context

`docs/tasks/X48/context.md`.
