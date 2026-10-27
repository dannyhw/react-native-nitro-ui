# Committed benchmark baselines

**Status: `maintainer-mac-1` has both files; `maintainer-mac-2` has none yet.** On
`maintainer-mac-1`, `--check` gates both platforms. On `maintainer-mac-2` it refuses
until that machine mints its own (`--exclusive`, idle, overnight — see
`docs/tasks/RECOVERY.md`). The numbers below are what `maintainer-mac-1`'s two runs
recorded.

## Layout

    bench/baselines/
      maintainer-mac-1/
        ios27-sim-iphone17.json      # iPhone 17 simulator, iOS 27
        android35-emu-pixel9.json    # API 35 Pixel 9 emulator, ART speed-profile
      <machine-label>/<deviceKey>.json   # the rule
      renders.json                   # JS render counts (machine-independent)
      README.md

A baseline is keyed by **machine and device**: `deviceKey` is platform + OS runtime +
device class (D9), and the directory above it is the machine that measured it. The
key is a pair because a baseline stores ratios to `rn-core` measured in the same run,
and pairing cancels drift **inside** one machine — between two machines it explains
nothing, since a simulator or emulator runs on its host's CPU and GPU
(`docs/tasks/PROCESS-review-2026-10-26.md` §5). So:

- **A machine gates only its own baselines.** The lookup is the run's own
  `machine.hostname`, and there is no fallback: not to another machine's directory,
  and not to a top-level `bench/baselines/<deviceKey>.json`, which is not a path any
  tool reads. Two machines minting the same device class write different files
  instead of overwriting each other.
- **The label is `NITRO_UI_MACHINE_LABEL`, never `os.hostname()`** (D25 — these files
  are committed to a public repo). It has to be one safe path segment:
  `^[a-z0-9][a-z0-9-]{0,62}$`, e.g. `maintainer-mac-1`.
- A file whose `machine.hostname` disagrees with the directory it sits in was copied
  or moved, and `--check` refuses it.

Resolution and every refusal live in `scripts/bench/baseline.mjs`, which `run.mjs`
and `report.mjs` both call, so the live run and a re-report of its results file agree
on the file. The refusals, each exit 2 with a message that names the fix:

| Situation                                        | What happens                                                                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| no label, or `unlabelled`                        | Refused. `--update-baseline` refuses **before the run starts**, next to the R4 load check, so an unlabelled machine does not spend three hours and then fail. |
| label is not one safe path segment               | Refused, both flags, before the run starts.                                                                                                                   |
| `--check` on a file that records another machine | Refused — use `--compare <ref>`, or mint this machine's own.                                                                                                  |
| no baseline for this machine                     | `--check` says so and names the per-machine path to create.                                                                                                   |

Gating another machine's numbers is still possible, just not as a baseline: run the
same SHA on both and compare with `--compare <ref>`.

## Status

`maintainer-mac-1/android35-emu-pixel9.json` comes from one clean
`--plan full --launches 8` run on the canonical API 35 Pixel 9 emulator at `3533d64` —
1120/1120 launches, no problems, ART `speed-profile`, load average 2.39 over 14 cores
(`quiet: true`) — so `--check` on Android gates: 90 nitro-ui rows within tolerance, 44
suppressed by their own within-run spread, 0 failures.

`maintainer-mac-1/ios27-sim-iphone17.json` comes from one clean
`--plan full --launches 8` run on the canonical iPhone 17 (iOS 27) simulator at
`c9548f6` — 1344/1344 launches (42 cells x 4 implementations x 8, the `full` plan now
includes DatePicker), no problems, and a quiet run rather than a quiet last minute:
1740 load samples, median 2.93 against the 7.0 ceiling, p90 4.24, 59 of them (3.4 %)
over it. `--check` on iOS gates: 59 nitro-ui rows within tolerance, 107 suppressed by
their own within-run spread, 6 `new arm` (the leak cells, which recorded no slope), 0
failures — and halving one quiet `presented` ratio, in both `ratio` and all eight
`launchRatios`, makes it exit 1. It took three attempts: the first two each completed
problem-free and were refused by the single end-of-run sample (10.50 and 7.60 against
7.0). Judging load over the whole run is what let this one through, and its `max` of
75.64 shows why one sample was never enough.

Components added after a baseline was recorded have no entries in it yet: `Picker` on
both platforms and `DatePicker` on Android. `--check` reports their cells as
`new arm` until the next refresh.

The one Android baseline committed before this one (`bb41d00`) was recorded while
nitro-ui self-skipped: all seven of its nitro-ui cells carry a `skipReason` and zero
metrics, so every `--check` against it degraded to `new-arm` and could never fail. It
measured Android `presented` through the Android frame-probe bug that was fixed
afterwards. Deleting it was honest; the replacement above comes from one clean
`--plan full --launches 8` run on an idle canonical device per the rules below — never
from a quick run.

## Minting

One JSON per machine and canonical device, produced by a run the `--check` flag can
read:

    NITRO_UI_MACHINE_LABEL=maintainer-mac-2 \
      bun bench --platform ios --plan full --launches 8 --update-baseline

Rules (docs/DECISIONS.md D9, enforced by `baselineBlockers()` in
`scripts/bench/lib.mjs`, overridable only with `--force`):

- **Ratio-only.** A baseline stores, per `(scenario, N, metric)`, the median
  launch-paired ratio to `rn-core` plus the within-run spread of that ratio. No
  absolute nanoseconds: those belong in the per-run results files
  (`bench/results/`, gitignored), where the machine is recorded. Absolute control
  drift is what made round 1's `--check` unable to ever fail.
- **Clean tree only.** A run from a dirty worktree is named `<sha>-dirty-...json`
  and cannot become a `--compare` base or a baseline.
- **Idle machine, judged over the whole run.** The runner samples
  `os.loadavg()[0]` every 30 s and at every launch boundary, and records the summary
  as `machine.loadSamples`: `{ count, ceiling, median, p90, max, over,
overFraction }`. A run is refused when its **median** sample is over the ceiling of
  0.5 x the core count, or when **more than 10 %** of its samples are. (Any run with
  a median over the ceiling necessarily has at least half its samples over it, so the
  10 % share is the clause that binds; the median is stated as the intent.) A sample
  exactly _on_ the ceiling does not count as over it. The `--update-baseline` command
  also refuses **before starting** when `loadavg1` is already over the ceiling - a
  baseline run costs hours and cannot recover from a machine that is busy when it
  begins. `loadavg1`/`loadavg5` stay in the file as the end-of-run instant, and a
  results file with no `loadSamples` (anything recorded before R4) is still judged by
  that single sample, because that is all it has. Load is the largest single source of
  ratio noise on a shared development machine.
- **`--plan full` with 8 launches**, no `problems`, on the canonical device.
  `--plan quick` numbers are local feedback, not baseline material.
- **Machine + device key** — the label rules are above. A runtime change is a
  comparability break, so it gets a new file. Anything that is not the canonical
  device on its own machine uses same-run ratio tables and `--compare <ref>`, never
  `--check`.
- **One dedicated commit** per refresh, so the diff is only this directory.
- **Prettier-clean.** The runner writes 2-space JSON with one `launchRatios`
  entry per line, and `bun run check` runs `prettier --check .`, which rejects that
  shape. Since A1b the mint formats its own output (`scripts/bench/format.mjs`), so
  this is automatic; the pass changes bytes only, and `--check` still reads the file
  back (seen on `android35-emu-pixel9.json`, 244017 -> 216717 bytes).

`--update-baseline` prints every reason it refused.

## renders.json

`scripts/perf/renders.mjs` keeps its own baseline here for JS wrapper render counts.
That one is a hard gate inside `bun run check`, and it is exact equality rather than a
ratio: a redundant re-render is a defect, not a latency. It counts React renders of
the JS wrappers, so it does not depend on whose hardware ran it — which is why it has
no machine directory.
