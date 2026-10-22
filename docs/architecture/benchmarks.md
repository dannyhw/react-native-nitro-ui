# Benchmarks

The perf guardrail every component task runs. It answers one question: **did this
component make mounting, updating or memory worse than the same thing built on RN
core?** Absolute milliseconds are not comparable between machines, so every gate
is a **ratio against `rn-core` measured in the same run**.

Implements `docs/research/setup-decisions.md` §6.

## Layout

```
bench/                       Expo app, release builds only (CNG: bench/ios and
                             bench/android are generated and gitignored)
bench/src/                   plan parsing, scenarios, implementations registry, NDJSON emit
bench/modules/bench-probe/   private Nitro module (Swift/ObjC++ + Kotlin + C++)
bench/results/               <sha>-<platform>.{json,md} written by each run (gitignored)
bench/baselines/             committed baselines + render-count baseline (committed)
scripts/bench/               build.mjs run.mjs report.mjs devices.mjs lib.mjs
scripts/perf/renders.mjs     Reassure render-count gate
```

`BenchProbe` is **private and local**: it is never published, its nitrogen output
lives inside `bench/modules/bench-probe/nitrogen/`, and the library's own
`nitrogen` run never scans it. Regenerate it with `bun run probe:nitrogen`.

## Running

```sh
bun bench --platform ios     --plan quick     # a few minutes
bun bench --platform android --plan quick
bun bench --platform ios     --plan full      # every N, plus the leak slope
```

The device comes from the environment, exactly like the Harness config:

| Variable         | Meaning                                                            |
| ---------------- | ------------------------------------------------------------------ |
| `IOS_SIM_UDID`   | Simulator UDID from your task brief (boots it if needed)           |
| `ANDROID_AVD`    | AVD name — the runner resolves the serial from the running AVD     |
| `ANDROID_SERIAL` | Fallback when there is no AVD name (physical device)               |
| `BENCH_ABIS`     | Android ABIs to build (`arm64-v8a` locally, `x86_64` on CI)           |
| `BENCH_LAUNCH_TIMEOUT_S` | Wall-clock budget per launch; raise it on a busy machine |

`ANDROID_AVD` is preferred over `ANDROID_SERIAL`: console ports are allocated by
availability, so a serial from a brief goes stale as soon as another emulator
boots or dies. Matching on the AVD name is what keeps a run on its own device.

There is **no Metro**: release builds embed the bundle, which is also what makes
numbers mean something (Hermes bytecode, R8, no dev tools). `METRO_PORT` is
unused by the bench app.

Useful flags:

| Flag                  | Effect                                                          |
| --------------------- | --------------------------------------------------------------- |
| `--only <impl,impl>`  | Restrict the implementation dimension                           |
| `--launches N`        | Overrides the 4 launches per cell (for a fast smoke test)        |
| `--skip-build`        | Reuse the installed release artifact instead of rebuilding        |
| `--prebuild`          | Force `expo prebuild --clean` first                              |
| `--compare <ref\|file>` | head/base ratios against another commit or results file       |
| `--check`             | Compare against the committed baseline, ratios only              |
| `--update-baseline`   | Record this run as the baseline (dedicated PR only)              |

`bun run bench:report <sha|file> [--compare <ref>] [--check] [--update-baseline]`
re-renders an existing results file without touching a device.

## What is measured

| Metric                 | Source                                                          |
| ---------------------- | --------------------------------------------------------------- |
| `jsCommitNs`           | probe clock around the JS commit (state set → commit returned)  |
| `mountedNs`            | native mount observer (Fabric), relative to the same `t0`       |
| `presentedNs`          | next frame timestamp from the display driver (vsync/Choreographer) |
| `cpu.jsNsPerUpdate`    | JS/Hermes thread CPU time per update                            |
| `cpu.mainNsPerUpdate`  | UI/main thread CPU time per update                              |
| `memory.bytesPerInstance` | footprint(full) − footprint(empty), divided by N             |
| `memory.leakSlopeBytesPerCycle` | slope across mount/unmount cycles in the `leak` scenario |

Protocol per `(scenario, implementation, N)` cell: **fresh process**, 1 s settle,
5 warmup + 20 measured iterations, **4 launches** interleaved ABBA so no
implementation always runs last, and the reported number is the **median of
launch medians ± MAD** (p95 for `presentedNs`). Results come back as NDJSON
written inside the app container (`Documents/bench.ndjson` on iOS, external
files dir on Android) and echoed to the system log under `NITRO_BENCH` as a
fallback.

Scenarios: `mount` (N = 1/50/200), `update` (N = 1/50, K flips awaited per
frame), `memory` (N = 200, after GC), `leak` (repeated mount/unmount of N = 200).
Plans: `quick` = `mount:50`, `update:50`, `memory:200`; `full` adds N = 1/200 and
the leak slope.

## Reading the numbers honestly

- **`presentedNs` is frame-quantised.** It is the next vsync boundary, so it
  lands on multiples of the refresh period (~16.7 ms at 60 Hz, often ~33 ms
  because the commit lands just after a vsync). A real 2 ms regression is
  invisible in it, and it is the noisiest column. `mountedNs` and the CPU
  columns are the sensitive signals; `presentedNs` is there to catch "a frame got
  dropped" regressions.
- **Android main-thread CPU is coarse.** It comes from `/proc/self/task/<tid>/stat`
  in 100 Hz ticks, so samples quantise to ~10 ms and a short update can read as
  exactly 0. Treat it as a diagnostic, not a gate. The JS thread number is fine
  because the JS thread is busy long enough to cross the tick boundary.
- **`profilerTotalMs` is 0 in release.** `React.Profiler` needs `__PROFILE__`,
  which a release bundle does not set. JS cost comes from `cpu.jsNsPerUpdate`.
- **Both clocks are relative to process load** (`CLOCK_UPTIME_RAW` on iOS,
  `System.nanoTime()` on Android, which is the same base Choreographer reports
  frame times on). Absolute values around 1e17 ns would lose precision as JS
  doubles, so everything is offset.
- **iOS hooks the presenter, not the observer protocol.** `RCTSurfacePresenter`
  forwards `mountingManager:didMountComponentsWithRootTag:` to its
  `RCTSurfacePresenterObserver`s, and registering as one needs a `RCTBridgeProxy`
  that bridgeless mode does not give us. The probe installs its own `IMP` on that
  method — same instant, no bridge required.
- **Bytes per instance is the noisiest metric here.** It comes from two
  `smaps_rollup` samples and has only one value per launch, so a loaded
  emulator's GC state moves it 30% between runs. Treat a memory ratio as a
  lead to chase, not a verdict, and prefer the `full` plan on a quiet machine.
- **Emulator numbers are not device numbers.** They are comparable to each other
  within a run, which is all the gates use.

## Baselines and gating

`bench/baselines/<deviceKey>.json` (`ios-iphone-air-sim.json`,
`android-api35-emu.json`) is the trend record. The device key already names the
platform: numbers from one device are meaningless on another, so each has its
own file. Because absolute times move with OS and runner images, `--check`
compares **ratios to `rn-core`**, not absolute times.

- PR gate (`--compare <base>`): fail when a `head/base` ratio is over **1.20**
  *and* the bootstrap 95 % CI of that ratio excludes **1.05**, for any metric ×
  scenario.
- Control drift: if `rn-core` itself moved more than **10 %** between the two
  runs, the verdict is **"noisy, inconclusive"** instead of a failure. Re-run on
  a quieter machine rather than believing it.
- Update baselines in a dedicated PR: `bun bench --platform ios --plan full
  --update-baseline`, review the diff, never as part of a feature PR.

## Render counts (hard gate)

`bun run perf:renders` runs Reassure over `src/**/*.perf-test.tsx` and fails if
any wrapper renders a different number of times than
`bench/baselines/renders.json`. Reassure measures **JS renders only** — it is
here to stop memoisation and re-render regressions in the wrappers, not to
measure anything native. Record a new baseline with
`bun run perf:renders -- --update-baseline` and review the diff. Until a
component adds a `*.perf-test.tsx`, the gate passes loudly and measures nothing.

What Reassure 1.6 gives you is `measureRenders`, `measureFunction`,
`measureAsyncFunction` and `measurePerformance` — there is **no**
`measureRerenders`. `measureRenders(<Switch value />)` counts the renders of one
mount, and the gate compares the **median of the 10 runs** for exact equality.
A `useEffect` that sets state escapes the measured window and can flush after
Jest tears the environment down, so count mount renders here and use
`measureFunction` / `measurePerformance` when a specific update path needs a
number.

## Adding a component to the matrix

1. Add the implementation in `bench/src/implementations/` and register it in
   `bench/src/implementations/index.ts` (`{ name, available, skipReason, List }`).
   Pass **every** prop explicitly — never `undefined` (nitro#1184).
2. Run the quick plan on both platforms:
   `bun bench --platform ios --plan quick` and `--platform android`.
3. Paste both summary tables (and the ratio table) into your task report, plus
   the run-to-run noise from the `rn-core` column.
4. Add `src/<Component>.perf-test.tsx` with `measureRenders(<Component />)` and
   commit the recorded render baseline.
5. Do not gate on absolute milliseconds. Report and compare ratios to `rn-core`.

The `nitro-ui` arm is a one-file change: `bench/src/implementations/nitroUi.tsx`
says exactly what to edit when the first real component is exported. The runner
lists `nitro-ui` unconditionally and reports it as *skipped* with a reason until
then, so nobody benchmarks a stub by accident.

## CI

`.github/workflows/bench.yml` is **report-only**: an on-demand `bench` label or
`/bench` comment builds base and head in the same job, runs them interleaved on
one runner, and comments the ratio table. It never fails a PR — hosted runners
are too noisy for that, which is why the hard gates are static (lint, nitrogen
drift, API report, manifest, Jest, Reassure render counts).

## Troubleshooting

| Symptom                                   | Cause / fix                                                                 |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| `ClassNotFoundException: HybridBenchProbe` | R8 renamed a class Nitro looks up by name via JNI. Keep rules live in `bench/modules/bench-probe/android/proguard-rules.pro` (consumer rules). |
| `new com.margelo.nitro.nitroui.<word>()` in `PackageList.java` | autolinking regex-matches the ReactPackage declaration in `android/src/main/.../NitroUiPackage.kt`; prose that reads like a class declaration gets picked up. Delete the generated `bench/android` (`--prebuild`) after fixing the wording. |
| `cmd: Can't find service: settings` right after boot | The runner retries; if it persists, the emulator is still booting. |
| `mount` crashes on iOS with a promise mutex abort | A freed frame-context; contexts are `shared_ptr` captured by both the display-link and fallback timers. |
| Stale native code despite editing sources | `build.mjs` rebuilds when any source is newer than the artifact; `--prebuild` forces a full CNG regen. |
| Emulator vanished mid-run (`device not found`) | qemu aborts occasionally on macOS. Re-run the same command: each cell is independent and results are per-file. |
| `no end sentinel within 180s`, cells report 0 iterations | The device was starved by other work on the machine (another emulator, a concurrent gradle/Xcode build) and did not finish a launch inside its budget. Re-run when the machine is quieter, or pass `BENCH_LAUNCH_TIMEOUT_S=600`. |
| Numbers 3× worse than yesterday | Something else is using the machine (another emulator, a gradle build). Re-run; the control-drift check exists for this. |
