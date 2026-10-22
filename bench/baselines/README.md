# Committed benchmark baselines

One JSON per canonical device, produced by a run the `--check` flag can read:

    bun bench --platform ios --plan full --launches 8 --update-baseline

Rules (docs/DECISIONS.md D9, enforced by `baselineBlockers()` in
`scripts/bench/lib.mjs`, overridable only with `--force`):

- **Ratio-only.** A baseline stores, per `(scenario, N, metric)`, the median
  launch-paired ratio to `rn-core` plus the within-run spread of that ratio. No
  absolute nanoseconds: those belong in CI artifacts, where the machine is
  recorded. Absolute control drift is what made round 1's `--check` unable to
  ever fail.
- **Clean tree only.** A run from a dirty worktree is named `<sha>-dirty-...json`
  and cannot become a `--compare` base or a baseline.
- **Idle machine.** `os.loadavg()[0]` must be at or under 0.5 x the core count,
  and is recorded in the file. Load is the largest single source of ratio noise
  on this host.
- **`--plan full` with 8 launches**, no `problems`, on the canonical device.
  `--plan quick` numbers are local feedback, not baseline material.
- **Device key = platform + OS runtime + class** (`ios27-sim-iphoneair`,
  `android35-emu-pixel9`). A runtime change is a comparability break, so it gets
  a new file. Anything that is not the canonical device uses same-run ratio
  tables and `--compare <ref>`, never `--check`.
- **One dedicated commit** per refresh, so the diff is only this directory.

`--update-baseline` prints every reason it refused.

## renders.json

`scripts/perf/renders.mjs` keeps its own baseline here for JS wrapper render
counts. That one is a hard gate inside `bun run check`, and it is exact equality
rather than a ratio: a redundant re-render is a defect, not a latency.
