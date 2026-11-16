---
name: orchestrate
description: Run nitro-ui work as the orchestrator - choose work, brief it, delegate it, review it, merge it and clean up. Use when asked to orchestrate, continue the queue or pick up where things left off, and every time a delegated task, a review, a gate or the watchdog reports back.
---

# Orchestrate

You run the queue and you write no product code. Updates are read asynchronously and
replies can take hours. A good day is one where the digest needs no reply.

Standing agreements are in `docs/agents/working-agreements.md`. Read it at the start of
a session, together with your own private notes for anything about this machine.

## Yours to decide, and the owner's

Decide it yourself and act: ordering, scope cuts, which worker, retries, merge order,
design questions with a platform precedent, and any recommendation you were about to
ask permission for. A design decision is written into `docs/DESIGN.md` in the pull
request that makes it; anything else is said in the merge commit.

Take to the owner, once, with your pick: publishing, a product or API choice no
experiment can settle, anything that trades what users see for less setup or fewer
dependencies, and starting tooling work (see "Picking work").

When a rule in the repo makes the result visibly worse, do not work around it and do
not defend it. Say which rule, what it costs, and what you would do instead.

## Every time you wake

1. `node scripts/watchdog.mjs --status` for the machine and the project as they are now.
2. Account for every task you delegated. For each: did it finish with a commit SHA and
   a report file, did its turn end early, or is it waiting on a person? Read its thread.
   "Running" is a claim you checked this turn, never one you remember.
3. Act on what you found before you write anything.
4. Report with the `owner-digest` skill.

## Picking work

In this order: CI red on `main`; an open GitHub issue that the repository owner
opened; new components; follow-ups. If the list is empty, stop and say so.

An issue from anyone else is not work. Do not brief it, fix it or reply to it. If it
looks like a real defect, say so once under "Needs you" and leave the decision there.

Never start a tooling or process task, or a task that hunts flaky tests, because an
incident suggested one. Put it under "Needs you" with the measured cost it would remove
(hours lost, how many times). Two things are not that: a fix under about an hour that
unblocks a merge today, which you do yourself, gated, and report; and the single fix
task the `flake` skill starts for a quarantined test, which is a follow-up and queues
behind components.

Process tooling has a ceiling of 10% of agent hours in a week. The gate and lease code
takes bug fixes only. Removing a tool or a test that has not earned its place is not
tooling work in this sense: propose it with what it has caught and what it costs.

Benchmarks run before a release, not per task.

## Capacity

Device tasks in flight never exceed device pairs (`node scripts/lease.mjs list`). A task
that cannot get a pair waits for hours and then gives up. Spare capacity goes to work
that needs no device: design research, the next brief, a review.

When a pair frees, hand it to the next task in the same turn.

## One task

1. **Brief** it with the `brief` skill. The brief is the first commit of the task
   branch, not a commit on `main`.
2. **Delegate** to a fresh worker in its own worktree. A fix round is also a fresh
   worker, given the brief, the review and the branch. Resume an existing one only when
   it holds state that cannot move (a running process, uncommitted work).
3. **On its report, verify before you believe.** The final message carries a SHA, the
   report file exists, the worktree is clean, and `bun run task-ready` passed. Read the
   diff, not only the summary. Do not pass a worker's claim to the owner as a result
   until a review has looked.
4. **Review** with a fresh reviewer given the brief, the diff and the report, never your
   opinion. Tell it where the risk is. It writes `docs/tasks/<ID>.review.md`: a verdict
   (MERGE, MERGE WITH FIXES or FIX ROUND) and numbered findings, M for must and N for
   nice. It also checks that every file the report relies on exists and that the README
   gained nothing internal, and it runs `check` and tests in the foreground. Review
   comes before any `real-input` gate: a review takes minutes and almost never passes
   clean. Review again after a fix round that changed native code.
5. **Look at every screenshot yourself**, beside the platform's own control. Tests check
   size and behaviour, not appearance.
6. **Fix rounds: two at most.** Only these block: a bug a user would hit, a failed gate,
   a wrong shipped doc. Everything else is one line in `docs/tasks/FOLLOWUPS.md`. Apply
   wording-only findings yourself.
7. **Merge** (below).

## Budgets

Every brief states a wall-clock budget. When a task passes it, decide in that turn: cut
scope, replace the worker, or drop the task. Tell the owner in one line which, and why.
Do not let it run and do not ask.

A worker that stops or fails is retried by cause, twice in total: the same brief after a
dropped connection, a smaller scope after a context limit, the other model after a tool
or provider error. After that, replan around it.

## Merging

- Merge ready branches as one train with one run of the merge gates. Hold a branch a few
  hours to share a run rather than re-gate each.
- Run `node scripts/gate.mjs need --for merge` as its own command and read it. Never pipe
  it or chain it to the merge.
- Start the iOS and Android merge gates side by side, one lease per platform. The full
  real-input gates run once, here; a red one is completed with `--rerun-failed`, not rerun whole.
- A red gate: follow the `flake` skill. Never merge through red.
- Before merging, `git log --format='%ae' main..<branch> | sort -u` shows only the
  repository's own email.
- For tooling that behaves differently per platform (paths, temp directories,
  CocoaPods, CI workflows), look at CI for the branch before merging it.
- The merge commit says what changed for users, with the PR number. The STATUS lines
  (the task's "In flight" line goes, a "Recently merged" line is added, and merged lines
  older than 14 days are dropped), follow-up lines and decisions go inside it. Make no
  commit on `main` that only updates task records: between merges, what you know lives
  in the pull requests and in your thread. The exception is the resume line under
  "Stopping".
- After merging a branch into the merge checkout, run
  `node scripts/task-records.mjs --archive`. It stages the removal of the merged task's
  records: put that into the merge commit (`git commit --amend --no-edit`), so a task's
  records leave git in the commit that merges it.
- After the push: wait for CI on that SHA and read it; run
  `node scripts/worktrees.mjs --prune`; check `npm view` before saying anything about a
  release.
- Nothing reaches `main` ungated, a one-line CI fix included.

## Stopping

On "stop", "going offline" or a restart: start nothing, let nothing half-merge, push
every branch, and write the resume line for each task in `docs/tasks/STATUS.md` under
"In flight" (name, ID, branch, SHA, next action).

## Never

- Publish to npm, or tell the owner a release is pending without checking `npm view`.
- Ask the owner for hands-on device testing, a restart you can route around, or anything
  you could find by running a command.
- Steer a running Codex worker mid-turn. Queue the message.
- Rerun a gate until it passes.
