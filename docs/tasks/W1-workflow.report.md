# W1 — a workflow that runs without being watched

**Branch:** `task/W1-workflow` (rebased on `main` at `23136b9d`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** none (no device used)

## Summary

Three things changed: two guards and a watchdog in `scripts/`, the agent rules, and how the
orchestrator's loop is written down.

**Scripts.** `gate.mjs` refuses a device gate below 10 GB of free disk and names the command that
frees space. `scripts/worktrees.mjs` lists the clone's worktrees with the reason each is kept;
`--prune` removes only a task worktree that is clean, merged into `main` with work of its own, not
leased, not running a process, and idle six hours. `scripts/watchdog.mjs` reports what changed on
the machine and project since its last run and is otherwise silent. All four new files are listed
as check-only tooling.

**Rules.** `AGENTS.md` goes from 15 kB to about 8 kB. Its gate reference moved to
`docs/agents/gates.md`. `docs/agents/rules.md` lists each rule with its enforcer and the incident
behind it, and `docs/agents/working-agreements.md` records how work is run.

**Loop.** `docs/tasks/ORCHESTRATOR.md` is now a pointer to five skills under `.claude/skills/`:
`orchestrate`, `brief`, `owner-digest`, `flake`, `watchdog`. They change the loop as the brief
lists.

Two decisions a reviewer should read first:

1. **The removal rule was rewritten after an independent review of the first version**, which
   found it would remove a task in review (pushed, unmerged), a task that had just started (no
   commits, so its head is a commit of `main`), and a clean checkout with a build running in it.
   The rule is in `scripts/worktrees-core.mjs`; the end-to-end cases in
   `scripts/__tests__/worktrees.test.js` are those scenarios. The same review found 15 other
   items; all are addressed in this round.
2. **The watchdog reports and does nothing else.** It does not prune, and it does not interrupt a
   stalled orchestrator. An hourly schedule that runs it lives outside the repository.

The disk floor is not in `lease.mjs acquire`: every device run already passes through `gate.mjs`.

**Incident.** While rebuilding this branch's history a `git reflog expire --all` was run in the
shared clone, which emptied every branch's reflog. No ref, commit or file changed. The one stash
entry was restored, and the 284 commits that lost reflog protection are pinned under
`refs/recovered/2026-11-15/`.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2221 tests / 91 suites | `cc2665c48066` | 2 m 50 s | start 3.4 / med 12.1 / max 20.7 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

`need --for review`: review is satisfied on this code tree (the code diff is check-only tooling).
The four device gates are for the merge, and this diff touches neither platform half.

## Red proofs

26 mutations, all red, recorded in `docs/tasks/W1/mutations.json`. One per guard:

- `refuses a leased device gate, runs nothing and records nothing` -> drop `deviceGateDiskBlock` from the preflight -> `expect(run.status).toBe(1)`
- `` `CI=false` is a shell, not a runner `` -> `isCiRunner` returns `Boolean(env.CI)` -> `expect(shell.status).toBe(1)`
- `outside a test, reads the measured value and lets nothing raise it` -> remove the `JEST_WORKER_ID` line -> `expected 123, received null`
- `keeps a branch that is pushed but not merged` -> remove the `!merged` line -> `expected "keep", received "remove"`
- `keeps a worktree nothing was committed in` -> remove the `!branchMoved` line -> `expected "keep", received "remove"`
- `keeps a merged, clean, idle worktree while a process is running in it` -> `countInside` returns 0 -> `expected verdict "keep"`
- `keeps every worktree that still holds work…` -> drop `--untracked-files=all` -> the hidden untracked file's worktree reads `remove`
- `removes a merged task worktree…` -> drop `--no-optional-locks` -> second listing reads `keep` ("used 1 min ago")
- `speaks when the level moves and the state string does not` -> compare state only -> `expected ["ALERT children: 2 waiting"], received []`
- `repeats an alert after the reminder interval, and not before` -> interval ×100 -> the reminder line expected, `[]` received
- `ci: a cancelled or skipped run is not a verdict` -> add `cancelled` to the red list -> `expected level "ok"`
- `nothing a device run starts imports the worktree lister or the watchdog` -> search for the bare word `watchdog` -> two native probe files listed as readers

## Files changed

- `scripts/gate.mjs`, `scripts/doctor-core.mjs` — the disk floor.
- `scripts/worktrees.mjs`, `scripts/worktrees-core.mjs` — the lister.
- `scripts/watchdog.mjs`, `scripts/watchdog-core.mjs` — the watchdog.
- `scripts/gate-core.mjs` — four entries on the tooling list.
- `scripts/__tests__/` — `worktrees.test.js`, `watchdog.test.js`, and cases added to
  `gate-lease-required.test.js` and `gate-check.test.js`.
- `AGENTS.md`, `CONTRIBUTING.md`, `docs/agents/`, `docs/tasks/ORCHESTRATOR.md`,
  `docs/tasks/FOLLOWUPS.md`, `.claude/skills/`.

## Follow-ups

- `worktrees.mjs --prune` removes ignored files other than `.gates/` records with the worktree; a task that leaves evidence in another ignored directory must commit or export it first.
- A `--fact` the caller stops passing keeps its last state in the watchdog's file; nothing clears it.
- `scripts/gate-core.mjs:3298` and `scripts/harness-suite-timing.mjs:25` carry two lint warnings that predate this branch.
- The four skills state rules that are prose only (`docs/agents/rules.md`, "Prose only"); the first candidates for an enforcer are the device-task limit and `need --for merge` read alone.

## Questions for orchestrator

- Should the watchdog be allowed to interrupt an orchestrator run that has been stalled for hours? It reports only today. Recommendation: keep it report-only until it has been seen to classify a stall correctly once.
