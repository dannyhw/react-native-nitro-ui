# Work for maintainer-mac-1 (2026-10-28)

maintainer-mac-2's orchestrator runs X10, X11 and A4 on that machine. These two tasks run on
maintainer-mac-1 in parallel, and touch nothing those three touch:

- **T18** TextField spike: `docs/tasks/T18-textfield-spike.md`
- **F3** fixes visible to 0.3.x: `docs/tasks/F3-visible-fixes.md`

Setup on mac-1:
1. `git pull` on `main`, then `node scripts/doctor.mjs` (fix anything it reports; `--setup` if the
   device pairs are missing). `export NITRO_UI_MACHINE_LABEL=maintainer-mac-1`.
2. One worktree per task: `git worktree add ../nitro-ui-worktrees/T18 -b task/T18-textfield-spike main`
   and `git worktree add ../nitro-ui-worktrees/F3 -b task/F3-visible-fixes main`.
3. Delegate each to Apex (`variant: xhigh`) using the template in `docs/tasks/ORCHESTRATOR.md`. Both
   can run at once: mac-1 has 14 cores and two device pairs.

When each finishes, mac-1's orchestrator pushes **only that task branch** (as T16/T17 were) and does
not merge. maintainer-mac-2's orchestrator reviews and merges, and keeps STATUS/RECOVERY. mac-1 does
not edit STATUS, RECOVERY, PLAN or DECISIONS.
