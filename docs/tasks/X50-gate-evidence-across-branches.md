# X50 — a green gate counts wherever the same files are checked out

**Kind:** tooling · **Devices:** both · **Budget:** 3 h for round one (the per-gate digest task ran 2 h plus a 1 h fix round)

## Goal

A contributor does not re-run a device gate at merge that a branch already passed on identical
files, and can run the two harness gates at the same time.

## Why

Owner request to cut gate waiting. The ledger is per branch, so a merge branch owes all five
gates even when a task branch, or the previous merge run, passed a gate on a digest that is
byte-for-byte the same. The two harness gates cannot share a machine only because they share
one run-state file.

## Behaviour

1. `need`, `status` and `table` accept a green run of a gate recorded by any worktree of this
   clone when that run's digest for the gate equals the current one. The row names the branch
   the run came from. A run whose tree moved while it ran, a filtered run, and a red run never
   count; a completed run counts and still shows as completed.
2. The evidence outlives the worktree that produced it: removing or pruning a worktree does
   not lose a run that another branch could use.
3. A run recorded on this branch still wins over one from elsewhere, and a red run on this
   branch for the current digest is not hidden by a green one from another branch.
4. `--rerun-failed` only ever completes a run of the branch it is called on.
5. `harness:ios` and `harness:android` run at the same time from one worktree under one lease
   for both platforms, and both record correctly.
6. Ledger lines written before this change keep working.

## Proof

- `node scripts/gate.mjs check` passes; `node scripts/gate.mjs need --for review` prints nothing
  missing.
- Unit and CLI tests for 1 to 4 and 6, each shown red once. Required mutations: accept a run
  whose digest differs; accept a filtered run; accept a run whose tree moved; let another
  branch's green hide this branch's red; lose the evidence when its worktree is removed.
- On devices, for 5: build both apps, then start `harness:ios` and `harness:android` within a
  minute of each other; both green; quote both table rows and the wall-clock time against the
  two durations added together. This is also what `need --for review` asks of this task if it
  touches a harness file, so it is the only device run.
- The report shows `need --for merge` on a scratch branch at the same commit as a branch that
  has green runs: what it asks for before and after.

## Out of scope

- Evidence from another clone or another machine, and from CI.
- Running a real-input gate beside anything: `real-input:ios` runs alone.
- The lease store beyond what 5 needs; benches; build stamps.

## Decided already

- The shared record lives in the clone's common git directory, beside the gate logs, so every
  worktree reads the same one. Each worktree keeps writing its own `.gates/<branch>.jsonl`.
- Digest equality is the whole test. Nothing is inferred from branch ancestry or commit ids.
- `check` is keyed to the full tree and follows the same rule.
- Docs in this branch: `docs/agents/gates.md`, CONTRIBUTING "Recording a gate run", and the
  merge lines of `AGENTS.md` and the `orchestrate` skill.

## Context

`scripts/gate-core.mjs` (`gateStateFor`, `gateRowFor`, `decideNeed`, the per-gate digests and
the completion plan), `scripts/gate.mjs` (`readLedger`, `appendLedgerLine`, `otherBranchLedgers`,
the log store under the common git directory), `scripts/worktrees-core.mjs` (what pruning
copies), `scripts/harness-run-state.js` and `example/metro.config.js` (the shared run-state
file), `scripts/__tests__/gate-digests.test.js`, `gate-rerun.test.js`, `gate.test.js`.
