# Committed benchmark baselines

**Status: `maintainer-mac-1` has both files; `maintainer-mac-2` has Android only.** On
`maintainer-mac-1`, `--check` gates both platforms. On `maintainer-mac-2` Android gates
and iOS refuses until that machine mints its own (`--exclusive`, idle, overnight — see
`docs/tasks/RECOVERY.md` and the iOS paragraph below). The numbers below are what
`maintainer-mac-1`'s two runs recorded.

## Layout

    bench/baselines/
      maintainer-mac-1/
        ios27-sim-iphone17.json      # iPhone 17 simulator, iOS 27
        android35-emu-pixel9.json    # API 35 Pixel 9 emulator, ART speed-profile
      maintainer-mac-2/
        android35-emu-pixel9.json    # same device class, 10-core M1 Max host
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
- **The device key is the hardware class, never the local name.** iOS takes it from
  `simctl`'s `deviceTypeIdentifier` (`…SimDeviceType.iPhone-17` -> `iphone17`) and
  Android from the AVD's hardware profile, because the lease pool's simulators are
  named `nitro-ui A` and `nitro-ui B`; keying on a name would mint
  `ios27-sim-nitrouia.json`, a file no canonical run gates against. The name stays in
  the results file as `deviceName`, where it is only descriptive.
- A file whose `machine.hostname` disagrees with the directory it sits in was copied
  or moved, and `--check` refuses it.

Resolution and every refusal live in `scripts/bench/baseline.mjs`, which `run.mjs`
and `report.mjs` both call, so the live run and a re-report of its results file agree
on the file. Each message names the fix; the exit code is per row:

| Situation                                        | What happens                                                                                                                                                  | Exit                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| no label, or `unlabelled`                        | Refused. `--update-baseline` refuses **before the run starts**, next to the R4 load check, so an unlabelled machine does not spend three hours and then fail. | 2                                     |
| label is not one safe path segment               | Refused, both flags, before the run starts.                                                                                                                   | 2                                     |
| `--check` on a file that records another machine | Refused — use `--compare <ref>`, or mint this machine's own.                                                                                                  | 2                                     |
| no baseline for this machine                     | `--check` says so and names the per-machine path to create.                                                                                                   | 2 in `run.mjs`, **1** in `report.mjs` |

That last row is the one asymmetry: `report.mjs` has always exited 1 when it had
nothing to check against, and `run.mjs` has always exited 2, so both keep their
history — the code did not change it here. Read against `docs/architecture/benchmarks.md`
("Exit codes"), a 1 from `report.mjs --check` on a machine with no baseline means
"nothing was judged", not "a regression was found"; the message says which.

`--force` overrides the load, cleanliness and plan guards in the list below. It does
**not** override a label refusal: those guards judge the quality of a measurement, and
a missing or unusable label means there is no path to write the result to.

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

`maintainer-mac-2/android35-emu-pixel9.json` comes from one clean
`--plan full --launches 8` run on that machine's canonical API 35 Pixel 9 AVD at
`9cf95f3` — 1848/1848 launches (49 cells x 5 implementations x 8; the `nitro-ui-host`
arm is Android-only), no problems, ART `speed-profile` on the first attempt, and
whole-run sampling as quiet as it gets: 2475 samples, median 1.47 against that machine's
ceiling of 5.0 (10 cores, so 0.5 x cores is 5.0 there, not 7.0), p90 2.11, max 3.81, and
**none** of them over it. `--check` on Android gates there: 166 nitro-ui rows within
tolerance, 27 suppressed by their own within-run spread, 7 `new arm` (the leak cells,
which store no slope), 0 failures — and halving one quiet `presented` ratio, in both
`ratio` and all eight `launchRatios`, makes it exit 1.

`maintainer-mac-2` has **no iOS file yet, and a retry would not produce one.** Its one
attempt (`--plan full --launches 8`, 1568/1568 launches, `problems: []`, clean tree,
4 h 24 min) was refused for one reason, and it was not load: `mount.date-picker` at N=200
presented on 55 of 160 measured iterations on `expo-ui-host-per-control` and 87 of 160 on
`expo-ui-shared-host`, and the completeness rule will not mint a ratio table with a
survivor-biased metric in it. That run's samples were 2096 strong with median 2.19 against
the 5.0 ceiling and 11 over (0.5 %). `maintainer-mac-1`'s file has both cells with
`missingPresented: 0` and a 0.5 % spread, so this is a per-machine frame-probe gap on that
simulator rather than a plan defect, and closing it is `docs/tasks/FOLLOWUPS.md`'s before
that machine mints iOS. Details in `docs/tasks/A3-baselines-mac2.report.md`.

Components added after a baseline was recorded have no entries in it yet: `Picker` on
both platforms and `DatePicker` on Android. `--check` reports their cells as
`new arm` until the next refresh. That is `maintainer-mac-1`'s situation only —
`maintainer-mac-2`'s Android file recorded every scenario for every component the plan has
on Android, so nothing is `new arm` there but the `leak` cells, which store no slope.

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
- **Every metric the table gates on is actually measured** - and since A4 that is
  scoped by arm. A metric with too few samples (`over 10 %` missing, `MAX_MISSING_SAMPLE_RATIO`)
  is `n/a`, and:
  - on `nitro-ui` (the gated arm) or `rn-core` (every ratio's denominator) that **refuses
    the mint** - a survivor-biased verdict is not baseline material;
  - on a comparison arm (`expo-ui-host-per-control`, `expo-ui-shared-host` - measured,
    reported, never gated, **and not our code**) it costs **that cell** its row: the file
    leaves it out and records it under
    `skippedCells` with the metric, its sample counts and the reasons that were recorded,
    and the mint prints one line per cell left out. `nitro-ui-host` is not a comparison
    arm for this purpose even though it is never gated: it is nitro-ui's own runtime, so a
    lost signal there is a fact about the library and refuses the mint, like `nitro-ui`
    does. Before A4 the same defect refused the
    whole table, which is how one machine went without a baseline over two reference
    arms' frame probe (see the `maintainer-mac-2` status below).
    Either way the reason is in the file, not in someone's memory: every iteration that
    gets no `mountedNs`/`presentedNs` records a reason code (`probe-timeout` with the
    timeout and how long the wait ran, `not-awaited`, `probe-error` with the message), so
    a refusal says "48 probe-timeout (asked 2000 ms, waited up to 2000.4 ms)" rather than
    "45 missing". See `docs/DECISIONS.md` D9 (A4 amendments).
- **Minted under the default waiting rule.** `presented` waits 8 000 ms and `mounted`
  1 500 ms unless a run asks otherwise (`--timeout-presented`, `--timeout-mount`), and a
  run that asks for longer is a diagnostic: the samples that arrive keep their values,
  but _which_ arrive changes the median. Such a run is refused, and every baseline
  records the rule it was made under in its `timeouts` block.

  The 8 s is A4's measurement, not a habit (`docs/tasks/A4-ios-baseline-mac2.report.md`).
  It does not make the baselines minted under 2 s incomparable: a longer wait changes only
  the cells that were losing samples, and a committed baseline has none of those — every
  cell in it answered inside the shorter wait, so it answers identically under the longer
  one. The cells that would have moved are the ones the completeness rule already kept out
  of the file. `maintainer-mac-2`'s iOS file is the first minted under the new rule.

- **Machine + device key** — the label rules are above, and `--force` does not get
  around them. The load ceiling belongs to the _measuring_ machine: 7.0 on
  `maintainer-mac-1` (14 cores), 5.0 on `maintainer-mac-2` (10). Two files can share a
  `deviceKey` while their hosts are different hardware, and `machine.cpuModel` is what
  says which (`Apple M4 Pro` / `Apple M1 Max`) — as well as why one machine's `presented`
  column can sit on a 16 ms frame floor while the other's spans three frames. Load-sample
  medians across machines are not comparable numbers, and neither are ratios whose control
  arm moved. A runtime change is a comparability break, so it gets a new file. Anything
  that is not the canonical device on its own machine uses same-run ratio tables and
  `--compare <ref>`, never `--check`.
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
