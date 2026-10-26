# A1c — final iOS bench baseline attempt (overnight)

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/A1c` (branch `task/A1c-baselines`, from `main` at `6e9e22a`).
**Device:** iPhone 17 `F08675D3-A32B-4F88-BC81-02D7E0CB797E` (iOS 27, canonical) only. No Android.
**Round cap: one attempt, no fix rounds, no `--force`.** Do not push. CI stays off.

This is the **last** iOS baseline attempt (A1 refused at load 10.50, A1b at 7.60 from one end-of-run
sample). R4 merged: the guard now judges the whole run (`machine.loadSamples`).

1. Set up the worktree (`bun install`; iOS pods with plain `pod install`, not `bundle exec`; Node 24
   via `fnm exec --using 24 --` where the tooling needs it). Release build, no Metro (D9).
2. From a **clean tree**: `bun bench --platform ios --plan full --launches 8 --update-baseline`.
   Run it once. If the runner refuses (busy at start or over the whole run), do not retry and do
   not `--force`: record the refusal message verbatim plus the `machine.loadSamples` summary
   (`count`, `ceiling`, `median`, `p90`, `max`, `over`) in the report.
3. If minted: show `--check` reads it back green and a doctored copy (one ratio ×2) goes red;
   prettier-format the JSON; commit the baseline in its own commit; update the "Status" section
   of `bench/baselines/README.md` (and the README Performance baseline pointer if it says iOS has
   none).
4. If refused: add a FOLLOWUPS line "iOS baseline not minted after A1/A1b/A1c; iOS stays on
   `--compare`" with the numbers.
5. Report in `docs/tasks/A1c-baselines.report.md`: result, run file, duration, launches,
   problems, load-sample summary, and the iOS ratio table (5 components × presented / UI CPU /
   memory vs `expo-ui-shared-host`, with the runner's verdict labels, no "n/v" upgraded).

Constraints: the human may be using the machine; don't kill or touch any process you didn't start,
don't touch other simulators (the `RNSB …` ones belong to another thread) or any Android emulator
(never `emulator-5560`), no `pkill`/`killall` by name. `bun run check` green
before committing.
