# Work for maintainer-mac-1 (2026-10-29)

maintainer-mac-2 is running F1 (tap delivery and flaky tests) and X13 (the release lock refresh). On
maintainer-mac-1:

- **G7a** Menu: `docs/tasks/G7a-menu.md`, with context pack `docs/tasks/G7a/context.md`.

Setup: `git pull` on `main` (it now has X11's warm device pool, so acquire with `--boot` and leave
devices warm), `node scripts/doctor.mjs`, `export NITRO_UI_MACHINE_LABEL=maintainer-mac-1`,
`git worktree add ../nitro-ui-worktrees/G7a -b task/G7a-menu main`. Delegate to Codex Apex
(`codex_callstack`, `reasoningEffort: xhigh`) using the ORCHESTRATOR template. Have it reviewed blind
by Claude Opus, with the reviewer running checks in the foreground. When review passes, push only the
task branch and tell maintainer-mac-2, which merges and keeps STATUS/RECOVERY.
