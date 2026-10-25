# Committed benchmark baselines

**Status (A1b): Android is committed, iOS is not.** `android35-emu-pixel9.json`
comes from one clean `--plan full --launches 8` run on the canonical API 35
Pixel 9 emulator at `3533d64` — 1120/1120 launches, no problems, ART
`speed-profile`, load average 2.39 over 14 cores (`quiet: true`) — so
`--check` on Android gates: 90 nitro-ui rows within tolerance, 44 suppressed by
their own within-run spread, 0 failures. There is still no iPhone 17 baseline
(`ios27-sim-iphone17.json`): two iOS `--plan full` runs have completed
problem-free since (A1 at load 10.50, A1b at 7.60, ceiling 7.0) and both were
refused by the idle-machine guard, so `--check` on iOS still exits with
`no baseline at bench/baselines/<deviceKey>.json` and gates nothing.

The one Android baseline committed before this one (`bb41d00`) was recorded
while nitro-ui self-skipped: all seven of its nitro-ui cells carry a
`skipReason` and zero metrics, so every `--check` against it degraded to
`new-arm` and could never fail. It measured Android `presented` through the
probe bug fixed in round 4 too. Deleting it was honest; the replacement above
comes from one clean `--plan full --launches 8` run on an idle canonical device
per the rules below — never from a quick run.

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
- **Prettier-clean.** The runner writes 2-space JSON with one `launchRatios`
  entry per line, and `bun run check` runs `prettier --check .`, which rejects
  that shape. Run `prettier --write` on a freshly minted file before
  committing. The pass changes bytes only: the parsed file is identical and
  `--check` still reads it back (seen on `android35-emu-pixel9.json`,
  244017 -> 216717 bytes).

`--update-baseline` prints every reason it refused.

## renders.json

`scripts/perf/renders.mjs` keeps its own baseline here for JS wrapper render
counts. That one is a hard gate inside `bun run check`, and it is exact equality
rather than a ratio: a redundant re-render is a defect, not a latency.
