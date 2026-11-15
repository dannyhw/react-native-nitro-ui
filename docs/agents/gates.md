# Gates: the ledger, what a stage needs, and where the evidence goes

Reference for `scripts/gate.mjs`. `AGENTS.md` has the rules; this file has the detail that used to
sit beside them, in its original wording. CONTRIBUTING's "Recording a gate run" is the tutorial.

## Waiting for a gate

**Wait for a gate with `gate.mjs`, never a `sleep`/`tail` loop:** `node scripts/gate.mjs <gate>
--background` starts it detached and prints its pid and log path; `node scripts/gate.mjs wait
--gate <gate> [--timeout-minutes N]` blocks, prints one progress line a minute, and leaves with the
gate's own exit code (or `13` for "still running" at the timeout). A backgrounded run writes its
ledger line through the same code path as a foreground one.

## Running and reading gates

Run gates through `node scripts/gate.mjs <gate>` (see its header for the names) rather than the
`bun run` form. Every run lands in `.gates/<branch>.jsonl` keyed to the code tree, and:

- `gate.mjs status` says what is green, red or missing for the code in front of you;
- `gate.mjs need --for review` / `--for merge` exits non-zero with what the stage still needs, so
  a round checks its own bar instead of claiming one. **What a merge needs** (X30): `check` on the
  **whole** code tree, plus `harness:ios` + `real-input:ios` whose **iOS half** (`trees.ios`)
  matches and `harness:android` + `real-input:android` whose **Android half** matches — a device
  run is keyed to its platform's half at *both* stages, so a fix round re-runs only the platforms
  its diff touched and a tooling-only commit on `main` re-owns nobody's device gates (it re-owns
  `check`, the one run that reads both platforms and the docs). Shared code (`src/`, `cpp/`) moves
  both halves and re-owns both platforms, and so does any code path the mapping does not claim:
  unknown is expensive, never free. Benches are never required by `need` (they belong to the bench
  host), and neither is anything under the check-only tooling list in `scripts/gate-core.mjs`
  (`scripts/gate*.mjs`, `scripts/__tests__`, `eslint-rules/` and its `eslint.config.mjs`,
  `etc/`, `.changeset/`): those touch
  no platform half, so `check` proves them. **Editing that list is the exception** to "tooling is
  free": the list is an input to the mapping, so a path that moves on or off it can change which
  half owns it and re-key that half's tree hash — every branch already in flight then reads its
  own device rows as stale and owes them once, after merging the change. (A path that only moves
  between the list and *unmapped* code leaves both hashes where they are and changes only what
  `need` demands of a diff that touches it — `gate.mjs status` says which case you are in, and
  X30's listing commit is the commit to run it against rather than to assume about);
- a filtered run records under its own name (`gate.mjs harness:android -- ColdSizing` is
  `harness:android:ColdSizing`), and satisfies nothing else; `check` takes no arguments at all;
  `--background` is `gate.mjs`'s own flag and belongs before the `--` — past the separator the
  arguments go to the gate, and that typo is now refused before a run instead of recorded as a
  red one (X30);
- `gate.mjs table` renders the report's gate table, and `gate.mjs export --task <ID>` commits the
  ledger to `docs/tasks/<ID>/gates.jsonl` beside it **by merging** (X30): what is already in the
  file stays byte-for-byte, this branch's lines are appended, and a line already there (same ts +
  gate + code tree) is not written twice — so a fix round adds its runs instead of erasing
  round 1's.
- **Every failure leaves evidence.** A run's log goes in the clone's gate log store —
  `<git-common-dir>/nitro-ui-gates/<branch>/<gate>-<started-at>.log` — which every worktree of the
  clone shares and `git worktree remove` never deletes; `gate.mjs logs [--branch b] [--failed]
  [--all]` lists it. The store is kept to 35 days by mtime and then 64 MiB, oldest first, and never
  touches a log written in the last two hours. Logs are not committed: `gate.mjs export` writes the
  ledger only, and a failed run's log is read from the store (`gate.mjs logs --failed`).

## The merge step

5. Merge (`git merge --no-ff task/<ID>-…`), run `bun run check` on the
   merged tree, push, and update `STATUS.md` / `RECOVERY.md` in the same push.

## Logs and cleanup (X12)

**Cleanup needs no archiving (X12).** Gate logs and the background-gate records live in the clone's
gate log store — `<git-common-dir>/nitro-ui-gates/<branch>/` — which `git worktree remove` does not
touch, so removing a merged worktree no longer loses the evidence a later diagnosis needs. Read them
from any surviving worktree with `node scripts/gate.mjs logs --all` (or `--branch <b> --failed` —
the branch is read from the log's whole path, and pass or fail from the store's own record, so both
work once the worktree and its ledger are gone); they are kept for 35 days, then capped at 64 MiB.
Each record also names the worktree that started the run, so `wait` and `status` follow *your*
background gate rather than the newest run of that gate somewhere else in the store — which matters
because several tasks run `check --background` at once. The per-branch ledger `.gates/<branch>.jsonl`
*is* removed with its worktree, so export it before cleanup (`gate.mjs export --task <ID>` commits
the ledger). Deleting the *clone* deletes its store: archive a store only
when you are about to do that. The orchestrator's own scripts log under `~/.nitro-ui/orchestrator-logs/`,
not `/tmp`.

`node scripts/worktrees.mjs --prune` is the cleanup command. Before it removes a worktree it
copies everything under that worktree's `.gates/` except `logs/` (which the shared store already
holds) to `~/.nitro-ui/gate-archive/<branch>-<time>/`, so a ledger that was never exported is not
lost with the directory. Export it anyway: the archive is a safety net on one machine, and the
committed export is what a reviewer reads.
