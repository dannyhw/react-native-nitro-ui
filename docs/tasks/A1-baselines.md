# A1 — Phase A: committed bench baselines

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/A1` (branch `task/A1-baselines`, from `main`).
**Devices / env:** assigned in the delegation message. **Round cap:** one round. Do not push.

Mint the first committed ratio baselines, per `bench/baselines/README.md` and
`docs/architecture/benchmarks.md` (D9, D18):

1. iOS on the canonical iPhone 17: `bun bench --platform ios --plan full --launches 8 --update-baseline`
   from a **clean tree** (commit nothing before the run).
2. Android on the assigned AVD with ART primed to `speed-profile` (D18):
   `bun bench --platform android --plan full --launches 8 --update-baseline`.
3. The idle-machine rule is load1 ≤ 0.5 × cores. Another project's thread may be building on this
   machine: before each platform's run check `uptime`; if over the limit, wait in 5-minute steps
   for at most 60 minutes, then try once. If the runner refuses (busy, broken, dirty), record the
   refusal verbatim and stop for that platform — no retry loops, no `--force`.
4. Commit the baseline JSON(s), update `bench/baselines/README.md` "Status" and the README
   Performance section's pointer if it says no baselines exist. Run `--check` against the new
   baseline once from the same build to show it reads back (and show it can fail: e.g. a doctored
   copy of the baseline with one ratio halved goes red).

Report: per-platform outcome (minted / refused + why), load at run time, the headline ratio table
from the full runs vs `expo-ui-shared-host`, and anything that differs materially from R2's quick
runs.
