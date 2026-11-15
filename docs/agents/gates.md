# Gates

Reference for `scripts/gate.mjs`. `AGENTS.md` has the rules. CONTRIBUTING's "Recording a gate run"
is the tutorial.

## Running a gate

- Run `node scripts/gate.mjs <gate>`, not the `bun run` form. The gate names are in the script's
  header. Every run is recorded in `.gates/<branch>.jsonl` against a hash of the code tree.
- `gate.mjs status` says what is green, red or missing for the tree in front of you.
- A filtered run is recorded under its own name and satisfies nothing else:
  `gate.mjs harness:android -- ColdSizing` is `harness:android:ColdSizing`. `check` takes no
  arguments.
- `--background` is `gate.mjs`'s own flag and goes before the `--`. After the separator the
  arguments go to the gate, and `--background` there is refused.

## Waiting for a gate

`node scripts/gate.mjs <gate> --background` starts the gate detached and prints its pid and log
path. `node scripts/gate.mjs wait --gate <gate> [--timeout-minutes N]` blocks, prints one progress
line a minute, and exits with the gate's own code, or `13` when it is still running at the
timeout. Never wait with a `sleep` or `tail` loop.

`wait` and `status` follow the background gate started from your worktree, not the newest run of
that gate elsewhere in the clone.

## What a stage needs

`gate.mjs need --for review` and `gate.mjs need --for merge` exit non-zero and list what is
missing.

- **Review:** `check`, and `harness:<platform>` for each platform the diff touches.
- **Merge:** `check` on the whole code tree; `harness:ios` and `real-input:ios` on the current iOS
  half of the tree; `harness:android` and `real-input:android` on the current Android half.
- A device run is keyed to its platform's half of the tree. A fix round re-runs only the
  platforms its diff touched.
- Shared code (`src/`, `cpp/`) counts as both platforms. So does any path the mapping does not
  claim: unknown is expensive, never free.
- Paths on the check-only tooling list in `scripts/gate-core.mjs` (`scripts/gate*.mjs`,
  `scripts/__tests__`, `eslint-rules/` and its `eslint.config.mjs`, `etc/`, `.changeset/`) touch
  no platform half. `check` proves them, and a tooling-only commit on `main` re-owns `check`
  only.
- Editing that list is the exception. A path that moves on or off it can change which half owns
  it, which changes that half's hash. Every branch in flight then owes that platform's device
  gates once, after merging the change. `gate.mjs status` shows whether a change does this.
- Benches are never required by `need`.

## Reports and the ledger

- `gate.mjs table` prints the gate table for a report.
- The per-branch ledger `.gates/<branch>.jsonl` is local evidence and is never committed. A
  report carries the table, and its red proofs as lines of its own.
- The ledger is removed with its worktree, after "Cleanup" below has copied it.

## Logs

- A run's log is written to `<git-common-dir>/nitro-ui-gates/<branch>/<gate>-<started-at>.log`.
  Every worktree of the clone shares that store, and `git worktree remove` does not delete it.
  Deleting the clone does.
- `gate.mjs logs [--branch b] [--failed] [--all]` lists the logs, from any worktree.
- Logs are kept for 35 days, then capped at 64 MiB, oldest first. A log written in the last two
  hours is never removed.
- Logs are not committed. A report cites a failed run by its gate and start time.

## Cleanup

`node scripts/worktrees.mjs --prune` removes the worktrees that are safe to remove. Before it
removes one, it copies that worktree's `.gates/` records, except `logs/`, to
`~/.nitro-ui/gate-archive/<branch>-<time>/`.

`node scripts/task-records.mjs --archive` copies a merged task's records to
`~/.nitro-ui/task-archive/<ID>/` and stages their removal from `docs/tasks`.
