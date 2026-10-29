# Work for maintainer-mac-1 (2026-10-29, second queue): autonomous, PR-based

The owner is away. maintainer-mac-1 works through this queue **on its own**, and maintainer-mac-2's
orchestrator reviews and merges the results. G7a and F2 are merged; mac-2 meanwhile runs X4 and F7.

## Queue

1. **G7b** Menu finish: `docs/tasks/G7b-menu-finish.md`. Menu (G7a) is merged on `main`; read D32 in
   `docs/DECISIONS.md` first. Item 7 (X4's conformance tables) applies only if X4 has merged when you start:
   `git log --oneline main | grep -i "X4"`.

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
