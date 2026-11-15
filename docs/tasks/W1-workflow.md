# W1 — a workflow that runs without being watched

**Kind:** tooling · **Devices:** none · **Budget:** one sitting, one round

## Goal

The orchestrator can run for days unattended: its digest is short, it asks only for the decisions
that are the owner's, and a stall is noticed by something other than a person.

## Why

An adversarial review of eighteen days of orchestrated work (2026-10-27 to 11-14), and a request
to build its recommendations. What the review measured:

- 3,359 gate runs over 409 hours, half of them red; 185 of 385 red full device runs were on code
  that later passed unchanged.
- 61 % of delegated agent time came after a task's first round.
- Process tooling took 45 % of agent time in its first week, and `scripts/` grew faster than the
  library.
- 95 of 442 hours with nothing running, including stalls of 39 h and 34 h that nothing in the
  system noticed. The 34 h one was a disk filled by 47 worktrees nobody removed.

## Behaviour

1. A device gate does not start when the disk is too full to finish it, and says how to free space.
2. One command lists the clone's worktrees with the reason each is kept, and removes only those
   nothing can be lost from.
3. One command reports what changed on the machine and the project since it last ran, is silent
   when nothing did, and reminds while an alert stays unresolved.
4. An hourly check runs outside the orchestrator's conversation and can tell that the conversation
   itself has stalled.
5. `AGENTS.md` holds only the rules that are easy to break; reference text lives where it is used.
6. The orchestrator's loop, briefs, status messages and flake handling are skills loaded on demand,
   and they change the loop: review before `real-input` gates, device tasks never above device
   pairs, a wall-clock budget per task, a blocking bar for findings, one rerun, quarantine on the
   second sighting, no self-started tooling tasks.
7. The project's working agreements are in the repo, in the project's voice; nothing personal or
   machine-specific is.
8. Every rule is listed with what enforces it and the incident behind it.

## Proof

- `node scripts/gate.mjs check` passes; `need --for review` asks for nothing more (tooling only).
- Each new guard is shown red by a mutation, one line each in the report.
- `scripts/worktrees.mjs --prune` is exercised end to end against a throwaway clone.

## Out of scope

- Changing what `need --for review` or `--for merge` demand.
- Removing or rewriting existing tooling, CONTRIBUTING, or DECISIONS.
- Interrupting or restarting a stalled orchestrator automatically: the watchdog reports it.
- A disk check in `lease.mjs acquire`: every device run already passes through `gate.mjs`.

## Decided already

- pstack and mattpocock/skills were read for ideas and neither is installed. Taken: a named proof
  in every brief, a blocking bar, fresh worker per round, retry by cause, a silent audit tick,
  rule-to-enforcer bookkeeping, a short rules file. Left out: anything that tells an agent to
  build tooling for itself or to keep going past a plateau.
