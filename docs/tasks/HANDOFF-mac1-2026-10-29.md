# Work for maintainer-mac-1 (2026-10-29): autonomous, PR-based

The owner is away. maintainer-mac-1 works through this queue **on its own**, and maintainer-mac-2's
orchestrator reviews and merges the results. mac-2 meanwhile runs F1, X13 and X4.

## Queue (in order)

1. **G7a** Menu: `docs/tasks/G7a-menu.md` (context pack `docs/tasks/G7a/context.md`).
2. **F2** follow-ups sweep: `docs/tasks/F2-followups-sweep.md`. Start it while G7a is in review if a
   device pair is free.

## How

- Setup: `git pull` on `main`, `node scripts/doctor.mjs`, `export NITRO_UI_MACHINE_LABEL=maintainer-mac-1`,
  and one worktree per task (`git worktree add ../nitro-ui-worktrees/<ID> -b task/<ID>-<slug> main`).
- Implementers: Codex Apex (`codex_callstack`, `reasoningEffort: xhigh`, full-access), using the
  ORCHESTRATOR template. Tell them to commit after each item.
- Review: a blind Claude Opus review, with checks run in the foreground. Fix rounds go to the same
  implementer thread, within the D19 cap.
- **When a task passes review**:
  1. Run `gate.mjs export --task <ID>`, commit, and push the task branch.
  2. Open a PR against `main` with `gh pr create`. Use a title in the conventional-commit style. The
     body is the report's summary plus the gate table, and says it ran on maintainer-mac-1. Describe
     the change only; never say who or what wrote it.
  3. Don't merge. maintainer-mac-2 merges PRs (it re-runs gates on its own devices first).
- If review needs an owner decision, or the round cap runs out with open M items, still open the PR,
  marked **draft**, with the open questions at the top of the body.
- Don't edit STATUS, RECOVERY, PLAN or DECISIONS on mac-1; mac-2 keeps them.
- Leases: acquire with `--boot`, leave devices warm, and never touch `emulator-5560`.
