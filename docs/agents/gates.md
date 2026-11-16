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
- `--background` and `--rerun-failed` are `gate.mjs`'s own flags and go before the `--`. After
  the separator the arguments go to the gate, and `--background` there is refused.

## Completing a red run

`node scripts/gate.mjs <harness|real-input>:<platform> --rerun-failed` completes the newest full
run of that gate that is red on the current digest. It re-runs only the units that did not
pass: real-input controls (a control's own tree check is part of it), harness test files, and
any unit that never ran. The outcome is recorded under the full gate's name.

- It is green only if every re-run unit passed, every check that runs on every real-input run
  passed, and the gate's digest was the same at the red run, at the start and at the end.
- It refuses, saying why and recording nothing, when there is no red run on this digest, when
  the digest moved, or when the failure is not a unit a filter can name: a build failure, a
  failed isolated harness suite (only a full run starts that app instance), or a real-input
  check that rides every run while every control passed.
- A crash before the first unit:
  - `harness:<p>`: no test file reported, so it refuses.
  - `real-input:ios`: a build or install failure, or an `xcodebuild` run that reports no case,
    ends the run before its report, so there are no per-control results and it refuses.
  - `real-input:android`: a failure before the e2e run starts (the build, the install, Metro)
    ends it before its report, and it refuses. An e2e run that starts and dies before its first
    test still writes the report, with every control not run, so the completion re-runs every
    control: `completed: N of N units re-run`, a full run under the completion's name.
- When a unit failed and the run also failed as a whole (an e2e exit code, a cleanup error),
  only the failed units are re-run. The completion judges its own run's whole-run checks, not
  the red run's.
- `table` and `status` show it as `completed: N of M units re-run, attempt K`, and the duration
  as the completion's plus the full run's. A red completion can be completed again; the tool
  records every attempt and caps none. The `flake` skill says how many are reasonable.
- An ordinary filtered run still satisfies nothing.

## Running two gates at once

One lease taken for both platforms runs an iOS gate and an Android gate at the same time, from
one worktree. Each gate starts its own Metro, so the lease exports one Metro port per platform:
`METRO_PORT_IOS` (the pair's `metroPort`) and `METRO_PORT_ANDROID` (the pair's
`androidMetroPort`, or `metroPort + 1000` when `devices.json` names none). A device gate runs
on its own platform's port and says so in its output; `METRO_PORT` stays the iOS port, for a
runner started by hand. The other pair stays free for other work.

```sh
node scripts/lease.mjs acquire --task <ID> --boot --out <env file>   # both platforms
set -a; source <env file>; set +a
node scripts/build-app.mjs --platform ios
node scripts/build-app.mjs --platform android
node scripts/gate.mjs real-input:ios --background
node scripts/gate.mjs harness:android --background
```

What the two runs still share, and so must not do:

- **Build both apps first.** A `build-app.mjs` run or a pod install during the other gate's run
  can move the code tree, and a run during which the tree moved never reads green.
- **One harness run at a time.** Two harness runs share `example/harness-run/state.json`, so
  `harness:ios` and `harness:android` run one after the other; a harness gate beside a
  real-input gate is fine.
- The ledger takes one appended line per run, and each platform has its own
  `.real-input/<platform>/`, build directory and build stamp, so these are safe to share.

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

- **Review:** `check`, and `harness:<platform>` when the diff touches a file that harness run
  reads.
- **Merge:** `check` on the whole code tree, and each of `harness:ios`, `harness:android`,
  `real-input:ios` and `real-input:android` on its own digest.
- Each device gate has a digest of its own: its platform's half of the tree, less the paths
  only the other suite reads (`GATE_DIGEST_EXCLUSIONS` in `scripts/gate-core.mjs`). The harness
  digests leave out `scripts/real-input/`, `example/e2e/` and the example screens, but keep
  every file the harness Jest `testMatch` selects wherever it sits; the
  real-input digests leave out the harness tests and configs, and each leaves out the other
  platform's real-input files. `scripts/__tests__/gate-digests.test.js` walks every run's
  imports and fails when a run reaches a path its digest leaves out. A path that cannot be
  proved stays in both suites' digests.
- A line recorded before these digests existed is compared on its platform half. A fix round
  re-runs only the gates its diff moved. That saving is within a branch: the ledger is per
  branch, so a fresh branch owes all four device gates at merge, whatever it touched.
- Shared code (`src/`, `cpp/`) counts as both platforms. So does any path the mapping does not
  claim: unknown is expensive, never free.
- `status` and `need` print the platform halves and the four gate digests.
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
