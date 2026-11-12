# X30 — Merge bar and ledger tooling: stop paying for re-runs nothing needs

**Worktree / branch:** named in your delegation message (`task/X30-merge-bar-and-ledger-tooling`). **Round cap:** 1
round, plus at most 2 fix rounds (D19). **Devices:** none. Tooling and unit tests only; never acquire a lease or touch
a device.

## The problems (all from FOLLOWUPS, 2026-11-09 to 11-12)

1. **A tooling-only commit on `main` voids every branch's device gates.** The merge bar matches device runs on the
   whole code tree, so a commit touching only the check-only tooling list (`scripts/__tests__/…`, `scripts/gate*.mjs`,
   `scripts/lease*.mjs`, `.changeset/`, …) makes every branch gated on the older `main` owe all four device gates
   again (G29+X27 paid a full ~2.5 h re-run for a test-fixture fix). Review already matches each device gate on its
   own platform half; merge should match device gates on the platform halves too, and keep `check` on the whole tree.
2. **`gate.mjs export --task <ID>` rewrites the task's ledger** from the current branch's lines only, dropping
   earlier rounds' and sibling branches' lines; every fix round and merge round has had to restore them by hand.
   Export should merge: keep existing lines, add new ones, never duplicate (a line's identity is its timestamp +
   gate + tree), and keep failure excerpts that already exist.
3. **A device gate's real-input log can't say which test a `--background` typo hit:** `gate.mjs <gate> -- --background`
   passes `--background` to jest and records a red run. Treat `--background` after `--` as a usage error before
   anything runs.
4. **`task-ready` names the report after the branch** (`task/X29-fix2` → `X29-fix2.report.md`), so fix-round and
   merge-round branches need `--task <ID>`. Derive the task ID from the branch's leading `<ID>` (letters + digits) and
   use the report that exists.

## Do

Fix all four in `scripts/gate*.mjs` / `scripts/task-ready*` (or wherever they live), each with unit tests shown red
first. For item 1, the rule must stay sound: a change in either platform half still voids that half's device gates;
`check` still matches the whole tree; anything outside the known prefixes still counts as both halves; and say in
AGENTS.md exactly what a merge now needs.

## Gates

`check`, then `need --for review`. Report at `docs/tasks/X30-merge-bar-and-ledger-tooling.report.md`. Export the
ledger with the fixed `gate.mjs export --task X30`.
