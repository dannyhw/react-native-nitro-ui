# Committed benchmark baselines

**Status (A1c): both canonical devices are committed.**
`android35-emu-pixel9.json` comes from one clean `--plan full --launches 8` run
on the canonical API 35 Pixel 9 emulator at `3533d64` — 1120/1120 launches, no
problems, ART `speed-profile`, load average 2.39 over 14 cores (`quiet: true`) —
so `--check` on Android gates: 90 nitro-ui rows within tolerance, 44 suppressed
by their own within-run spread, 0 failures.

`ios27-sim-iphone17.json` comes from one clean `--plan full --launches 8` run on
the canonical iPhone 17 (iOS 27) simulator at `c9548f6` — 1344/1344 launches
(42 cells x 4 implementations x 8, the `full` plan now includes DatePicker), no
problems, and a quiet run rather than a quiet last minute: 1740 load samples,
median 2.93 against the 7.0 ceiling, p90 4.24, 59 of them (3.4 %) over it.
`--check` on iOS gates: 59 nitro-ui rows within tolerance, 107 suppressed by
their own within-run spread, 6 `new arm` (the leak cells, which recorded no
slope), 0 failures — and halving one quiet `presented` ratio, in both `ratio`
and all eight `launchRatios`, makes it exit 1. It took three attempts: A1 and
A1b each completed problem-free and were refused by the single end-of-run
sample (10.50 and 7.60 against 7.0). R4's whole-run judgement is what let this
one through, and its `max` of 75.64 shows why one sample was never enough.

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
- **Idle machine, judged over the whole run (R4).** The runner samples
  `os.loadavg()[0]` every 30 s and at every launch boundary, and records the
  summary as `machine.loadSamples`: `{ count, ceiling, median, p90, max, over,
overFraction }`. A run is refused when its **median** sample is over the
  ceiling of 0.5 x the core count, or when **more than 10 %** of its samples
  are. (Any run with a median over the ceiling necessarily has at least half its
  samples over it, so the 10 % share is the clause that binds; the median is
  stated as the intent.) A sample exactly _on_ the ceiling does not count as
  over it. The `--update-baseline` command also refuses **before starting** when
  `loadavg1` is already over the ceiling - a baseline run costs hours and cannot
  recover from a machine that is busy when it begins. `loadavg1`/`loadavg5` stay
  in the file as the end-of-run instant, and a results file with no
  `loadSamples` (anything recorded before R4) is still judged by that single
  sample, because that is all it has. Load is the largest single source of ratio
  noise on this host.
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
