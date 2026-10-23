# T02 — Benchmark app, BenchProbe, runner and report

**Branch:** `task/T02-bench` **Devices:** iOS `iPhone Air` sim (API 27.0), AVD
`nitroui_t02` (API 35, arm64). Release builds, no Metro.

Everything in `docs/research/setup-decisions.md` §6 is implemented and has been
run for real on both platforms. The `nitro-ui` arm exists, is listed in every
table, and self-skips with a reason until T10 exports a component.

## Gates

| Gate                                    | Result                                                                       |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| `bun run check`                         | green — tsc, bench tsc, eslint (0 warnings), prettier, 47 Jest tests, nitrogen no-drift, bob, publint, manifest (43 files) |
| `bun run bench:typecheck`               | green — `bench/tsconfig.json` + `tsconfig.android.json`                      |
| `bun bench --platform ios --plan quick` | green — 48 launches, `problems: none`, 355-392 s                             |
| `bun bench --platform android --plan quick` | green — 48 launches, `problems: none`; 554 s on `e39db3c`, 472 s on `927b0dc` |
| `bun run perf:renders`                  | wired and proven (see below); passes loudly with nothing to measure yet      |
| `bench.yml`                             | written, not run (brief: "write, don't run")                                 |

The bench app itself is `bench/` (Expo SDK 58, CNG, native dirs gitignored) with
a private Nitro module in `bench/modules/bench-probe` that has its own
`nitro.json` + committed nitrogen output and is never generated into or shipped
with the library — `bun run probe:nitrogen` regenerates it, `manifest:check`
confirms the published tarball is unchanged at 43 files.

## Results — iOS (`iPhone Air` simulator)

Quick plan, 4 launches ABBA, 5 warmup + 20 measured, median of medians. Absolute
medians; `nitro-ui` is skipped until a component registers.

| Scenario     | Implementation           | presented | mounted | JS commit | JS CPU/op | UI CPU/op | bytes/inst |
| ------------ | ------------------------ | --------- | ------- | --------- | --------- | --------- | ---------- |
| mount N=50   | rn-core                  | 32.64 ms  | 11.37 ms | 1.88 ms  | 3.09 ms   | 16.45 ms  | n/a        |
| mount N=50   | expo-ui-host-per-control | 182.86 ms | 21.52 ms | 2.58 ms  | 4.59 ms   | 208.58 ms | n/a        |
| mount N=50   | expo-ui-shared-host      | 171.71 ms | 7.86 ms  | 1.69 ms  | 2.99 ms   | 170.41 ms | n/a        |
| mount N=50   | nitro-ui                 | skipped: no exported Switch yet (T10) | | | | | |
| update N=50  | rn-core                  | 32.75 ms  | 6.45 ms  | 1.56 ms  | 1.82 ms   | 6.60 ms   | n/a        |
| update N=50  | expo-ui-host-per-control | 32.75 ms  | 5.89 ms  | 3.13 ms  | 3.29 ms   | 19.06 ms  | n/a        |
| update N=50  | expo-ui-shared-host      | 32.75 ms  | 4.10 ms  | 1.52 ms  | 1.93 ms   | 18.13 ms  | n/a        |
| update N=50  | nitro-ui                 | skipped   |         |          |           |           |            |
| memory N=200 | rn-core                  | n/a       | n/a      | n/a      | n/a       | n/a       | 109.2 KiB  |
| memory N=200 | expo-ui-host-per-control | n/a       | n/a      | n/a      | n/a       | n/a       | 366.5 KiB  |
| memory N=200 | expo-ui-shared-host      | n/a       | n/a      | n/a      | n/a       | n/a       | 330.8 KiB  |

Ratio to `rn-core` (what the gate actually looks at):

| Scenario     | Implementation           | presented | mounted | JS commit | JS CPU/op | UI CPU/op | bytes/inst |
| ------------ | ------------------------ | --------- | ------- | --------- | --------- | --------- | ---------- |
| mount N=50   | expo-ui-host-per-control | 6.22x     | 2.13x   | 1.33x     | 1.38x     | 13.32x    | 3.36x      |
| mount N=50   | expo-ui-shared-host      | 5.29x     | 0.67x   | 0.79x     | 0.90x     | 10.25x    | 3.03x      |
| update N=50  | expo-ui-host-per-control | 1.00x     | 0.92x   | 2.04x     | 1.81x     | 2.84x     | n/a        |
| update N=50  | expo-ui-shared-host      | 1.00x     | 0.65x   | 1.02x     | 0.98x     | 2.49x     | n/a        |

Read: one hosting view per control costs ~13x the UI-thread work of an RN
`Switch` per mount and ~3.4x the memory; a shared host removes most of the
mount cost (`mounted` 0.67x) but `presented` stays ~5x because the whole batch
still waits on one SwiftUI pass. `update` is where Expo UI is close to parity
(1.00x presented) while still paying 2-3x UI-thread CPU per flip.

## Results — Android (AVD `nitroui_t02`, API 35)

| Scenario     | Implementation           | presented | mounted | JS commit | JS CPU/op | UI CPU/op | bytes/inst |
| ------------ | ------------------------ | --------- | ------- | --------- | --------- | --------- | ---------- |
| mount N=50   | rn-core                  | 84.57 ms  | 58.15 ms | 5.99 ms  | 10.00 ms  | 35.75 ms  | n/a        |
| mount N=50   | expo-ui-host-per-control | 211.35 ms | 156.85 ms | 59.78 ms | 63.25 ms  | 126.75 ms | n/a        |
| mount N=50   | expo-ui-shared-host      | 97.34 ms  | 66.09 ms | 7.23 ms  | 10.25 ms  | 46.50 ms  | n/a        |
| mount N=50   | nitro-ui                 | skipped: no exported Switch yet (T10) | | | | | |
| update N=50  | rn-core                  | 83.72 ms  | 26.79 ms | 6.21 ms  | 6.50 ms   | 10.25 ms  | n/a        |
| update N=50  | expo-ui-host-per-control | 72.83 ms  | 36.92 ms | 17.42 ms | 18.25 ms  | 62.75 ms  | n/a        |
| update N=50  | expo-ui-shared-host      | 61.61 ms  | 32.54 ms | 11.46 ms | 10.00 ms  | 39.75 ms  | n/a        |
| update N=50  | nitro-ui                 | skipped   |         |          |           |           |            |
| memory N=200 | rn-core                  | n/a       | n/a      | n/a      | n/a       | n/a       | 52.6 KiB   |
| memory N=200 | expo-ui-host-per-control | n/a       | n/a      | n/a      | n/a       | n/a       | 36.7 KiB   |
| memory N=200 | expo-ui-shared-host      | n/a       | n/a      | n/a      | n/a       | n/a       | 48.8 KiB   |

Ratio to `rn-core`:

| Scenario     | Implementation           | presented | mounted | JS commit | JS CPU/op | UI CPU/op | bytes/inst |
| ------------ | ------------------------ | --------- | ------- | --------- | --------- | --------- | ---------- |
| mount N=50   | expo-ui-host-per-control | 2.86x     | 2.84x   | 10.79x    | 6.48x     | 3.88x     | 0.71x      |
| mount N=50   | expo-ui-shared-host      | 1.26x     | 1.31x   | 1.16x     | 1.03x     | 1.24x     | 0.93x      |
| update N=50  | expo-ui-host-per-control | 0.87x     | 1.36x   | 2.90x     | 2.50x     | 5.14x     | n/a        |
| update N=50  | expo-ui-shared-host      | 0.68x     | 1.25x   | 1.83x     | 1.12x     | 3.99x     | n/a        |

Read: the pattern is the same as iOS but flatter — a shared `Host` is nearly
free (1.26x presented), while one host per control costs ~11x the JS commit time
and ~4x the UI CPU. Android per-instance memory for the Expo arms came out
*below* `rn-core`; that is `smaps_rollup` PSS attribution on an emulator, so
treat the direction as "no leak", not as a 30 % saving.

### Cross-check: same matrix re-run on the final commit

The whole Android matrix was run again on the last commit (`927b0dc`, 48
launches, `problems: none`) while the machine was still ~3x busier than idle.
Absolute times were up to 2.6x worse than the quiet run — as expected — so what
matters is whether the *ratios* came back the same. Head/base of the second run
against the first, by metric:

| Metric      | host-per-control, mount | shared-host, mount | host-per-control, update | Reproducible? |
| ----------- | ----------------------- | ------------------ | ------------------------ | ------------- |
| JS commit   | 10.79x -> 10.89x        | 1.16x -> 1.38x     | 2.90x -> 3.40x           | yes           |
| presented   | 2.86x -> 3.00x          | 1.26x -> 1.05x     | 0.87x -> 1.20x           | roughly       |
| mounted     | 2.84x -> 3.80x          | 1.31x -> 0.91x     | 1.36x -> 1.65x           | loosely       |
| JS CPU/op   | 6.48x -> 7.51x          | 1.03x -> 1.29x     | 2.50x -> 2.91x           | loosely       |
| UI CPU/op   | 3.88x -> 3.88x          | 1.24x -> 1.44x     | 5.14x -> 14.38x          | no (update)   |
| bytes/inst  | 0.71x -> 0.58x          | 0.93x -> 1.24x     | n/a                      | no            |

So component tasks can trust `JS commit` and `mount presented` to be stable to
about 10 %, `mounted`/`JS CPU/op` to maybe 30 %, and must treat `update UI
CPU/op` and `bytes/inst` as leads rather than measurements. `--check` on that
run flagged one memory ratio as conclusive (1.33x, CI 1.17x-1.83x) and the
control-drift guard suppressed it to a non-failure, which is the designed
outcome; the label now prints as `fail (suppressed: noisy run)`.

## Noise level (rn-core control, two consecutive runs, same build)

| Platform | Metric pairs | Control range | Control within 10% | All arms range | Conclusive gate failures |
| -------- | ------------ | ------------- | ------------------ | -------------- | ------------------------ |
| iOS      | 33           | 0.90x-1.09x   | 10/11              | 0.77x-1.24x    | 0                        |
| Android  | 33           | 0.88x-1.43x   | 4/11               | 0.66x-1.51x    | 0                        |

- **iOS: about plus/minus 5-10 %.** Ten of eleven control metrics moved under
  10 %; the one that did not was `mount` UI CPU at 0.90x, which tripped the
  control-drift check and made the verdict **"noisy, inconclusive"**.
- **Android: 10-45 % on a loaded machine.** Only 4/11 control metrics stayed
  inside 10 %; the worst was `mount` UI CPU at 1.43x.
- **Zero conclusive failures across two builds of identical code** — the gate
  never reported a regression that was not there, which is the property that
  matters. It reports the movement as `warn` with a bootstrap CI that includes
  1.0, and reserves failure for a ratio over 1.20 whose 95 % CI excludes 1.05.
- `presented` is frame-quantised, so an `update` cell reads exactly 32.75 ms on
  iOS in every run — that column is a floor, not a measurement, below one frame.
- Android thread-CPU quantises to the 100 Hz tick, so short ops read as 0 or
  10 ms; it is a diagnostic, not a gate input.

Consequence for every component task: **gate on ratios to `rn-core`, never on
absolute milliseconds**, and read the drift line before believing anything.

## Adding `nitro-ui` to the matrix (one file)

`bench/src/implementations/nitroUi.tsx` is the only file to touch: replace the
placeholder `List` with the real component, keep `available: true`, delete the
`skipReason`. It is registered in `bench/src/implementations/index.ts` already,
so both platforms pick it up with no runner change. Pass **every** prop
explicitly — never `undefined` (nitro#1184). Then run the quick plan on both
platforms and paste both tables into the component's report.

## Render-count gate

`bun run perf:renders` is a hard gate on JS render counts, and each path was
verified with a throwaway perf test (removed afterwards):

| Situation                                | Behaviour                                  |
| ---------------------------------------- | ------------------------------------------ |
| no `*.perf-test.tsx` anywhere            | passes loudly, says it measured nothing     |
| measures, baseline recorded, re-run      | `PASS - 1 wrapper(s) render exactly as...`  |
| count differs from baseline              | `CHANGED (-1)`, exit 1                      |
| new perf test, no baseline entry         | `NEW (no baseline)`, exit 1                 |
| baseline entry with no test              | `REMOVED (stale baseline)`, exit 1          |

Components opt in with `src/<Component>.perf-test.tsx`; T10 should add one for
`Switch` and commit `bench/baselines/renders.json` in the same PR.

## Deviations from the brief

- **ObjC++ probe on iOS, not Swift.** `RCTSurfacePresenter` forwards
  `mountingManager:didMountComponentsWithRootTag:` to its observer protocol, but
  registering as one needs an `RCTBridgeProxy` that bridgeless mode does not
  expose, so the probe installs a guarded `IMP` on that method instead. Same
  instant, no bridge dependency.
- **Two extra spec methods**: `launchPlan()` (hand the launch argument / intent
  extra to JS) and `writeNdjson()` (write results from native, where the file
  paths and permissions are known).
- **Clocks are relative to process load.** Absolute `CLOCK_UPTIME_RAW` /
  `System.nanoTime()` values are around 1e17 ns and lose precision as JS
  doubles. D1's clock choice is unchanged; only the base is offset.
- **Android NDJSON goes to the *external* files dir.** The internal one needs
  `run-as`, which requires a debuggable build, and the bench is release-only.
- **Device keys are `ios-iphone-air-sim` / `android-api35-emu`**, from the
  devices in this brief. The research doc's examples named
  `ios-iphone17-sim` / `android-api36-emu`; baselines are keyed per device, so
  nothing collides.
- **No Metro at all.** The brief mentions `METRO_PORT=8292`; a release build
  embeds its bundle, so the bench never starts or attaches to Metro. That port
  is free for anything else.
- **CI runs base then head sequentially**, not interleaved across two revisions
  (one checkout per runner is far simpler); interleaving still happens across
  the 4 launches inside each run.
- **`check` now also runs `bench:typecheck`**, and the bench app added one root
  devDep (`@testing-library/react-native`, required by Reassure).

## Bugs found and fixed

1. **`android/src/main/java/com/margelo/nitro/nitroui/NitroUiPackage.kt` broke
   Android autolinking for every consumer.** `expo-modules-autolinking`
   regex-matches the ReactPackage declaration in that file's *text*, so the KDoc
   sentence "The class still has to exist:" produced
   `new com.margelo.nitro.nitroui.still()` in `PackageList.java`. Comment-only
   fix plus a warning note; this is library source owned by T10, so it needs a
   merge decision (see below).
2. **`--compare` crashed** (`Object.entries` of `undefined`): the comparison
   helpers read `.cells` directly while `verdict()` passes bare cell maps. Now
   they use the documented `cellsFrom()` helper, which accepts either shape.
3. **Reassure never matched a test**: `testMatch` patterns were `./src/**`, and
   Jest matches those against absolute paths. Fixed to `<rootDir>/src/**`.
4. **The render gate parsed a field that does not exist** (`renderCount`);
   Reassure 1.6 writes `counts`/`meanCount`. It now takes the median of the runs.
5. **Baseline files were double-prefixed** (`ios-ios-iphone-air-sim.json`).
   Device keys already carry the platform, so they are named `<deviceKey>.json`.
6. **`--check` printed ratios as durations** ("1 ns", "0.0 KiB"). Ratios now
   render as ratios under `baseline x rn-core` / `head x rn-core` columns.
7. **R8 renamed classes Nitro resolves by JNI name** →
   `ClassNotFoundException: HybridBenchProbe` in release only. Fixed with
   consumer ProGuard rules in the probe module.
8. **Android memory delta was exactly 0** — `ActivityManager.getProcessMemoryInfo`
   is cached. `footprintBytes()` reads PSS from `/proc/self/smaps_rollup`
   (ActivityManager kept as fallback), which is where the 52.6 KiB/instance comes from.
9. **`UIManagerType` import** for the mount observer lives at
   `com.facebook.react.uimanager.common.UIManagerType` on RN 0.88; the listener
   API needs `@file:OptIn(UnstableReactNativeAPI::class)`.
10. **ObjC++ frame-context use-after-free** — contexts are now `shared_ptr`
    captured by both the display-link and the fallback timer; the `mount`
    scenario no longer aborts on a promise mutex.
11. **Runner hardening**: stale-result guard (every record must match the
    requested cell), tolerant `rm` of the device file (FUSE reports EACCES for a
    missing `Android/data` path), bounded `adb`/`simctl` timeouts, retry on the
    post-boot `Can't find service: settings`, device resolution **from the AVD
    name** (console ports churn), `BENCH_ABIS` honoured by the build, and a
    `BENCH_LAUNCH_TIMEOUT_S` override for starved machines.
12. **A suppressed failure still printed as `FAIL`.** A memory ratio tripped the
    conclusive threshold on a run the control-drift check had already declared
    noisy; the exit code ignored it, but the output contradicted itself. It now
    prints `fail (suppressed: noisy run)`.

## Machine conditions

Much of this task ran on a laptop at load average 80-120 (four emulators, other
tasks' Xcode and Gradle builds, plus interactive apps). One Android attempt died
that way: every launch was starved, cell 1 produced 2 iterations in 8 minutes,
and the runner correctly stopped with a per-launch timeout instead of inventing
numbers. That budget is now `BENCH_LAUNCH_TIMEOUT_S`, and the same 48-cell
sweep completed cleanly at load ~30 in 472 s.

The load is the whole story behind the noise numbers above: iOS moved 0.90-1.09x
on the control, Android 0.88-1.43x. On an idle machine expect the Android figure
to come down towards iOS's; until then, run benches when the machine is quiet
and read the drift line before anything else.

## Questions for orchestrator

1. **T10 owns `android/src/main/java/com/margelo/nitro/nitroui/NitroUiPackage.kt`
   and I changed it (comment-only, `e7fbabd`).** Without it no Android app that
   links the library builds, so the bench could not start. If T10 edits that
   file's KDoc independently, keep the wording clear of anything that reads like
   `The <something> has to <verb>:` — the autolinking regex turns it into a
   constructor call. Worth confirming the fix on the `example/` app too, as the
   other consumer.
2. **Who owns the Reassure render-count contract?** Reassure 1.6.1 exports
   `measureRenders` but **not** `measureRerenders`, and a `useEffect` that sets
   state escapes the measured window (it can flush after Jest tears the
   environment down). The gate therefore measures *mount* renders today. If the
   intended contract is "a Switch must not re-render more than once per prop
   change", that needs `measureFunction` / `measurePerformance`, and T10 will
   otherwise commit a baseline that measures less than `docs/PLAN.md` implies.
3. **`METRO_PORT=8292` in my brief vs release builds.** The bench app embeds its
   bundle and never starts Metro, and `CONTRIBUTING.md` pairs 8292 with T02 in an
   example. Worth rewording so nobody reserves a port that is used by nothing.
4. **Should committed baselines come from CI runners rather than a dev
   machine?** I committed
   `bench/baselines/{ios-iphone-air-sim,android-api35-emu}.json` from local runs
   because they are the only numbers we have. They are ratios to `rn-core`, so
   they should survive a machine change, but a nightly `--update-baseline` on the
   CI image would make a better trend record — and if that is the plan, they may
   not belong in the repo at all.
5. **Device keys are per-task by necessity** (`ios-iphone-air-sim`,
   `android-api35-emu`). Any task on different hardware gets its own baseline
   file and no trend continuity. Do we want one canonical device per platform
   that everyone shares, or are per-device baselines acceptable?
6. **Concurrency warning for T03/T10**: emulator console ports churn on shared
   machines — my AVD moved from 5572 to 5554 when its qemu aborted mid-task. The
   bench runner resolves the serial from the AVD name for exactly this reason; if
   T03's smoke runner pins serials it will fall into the same trap.
7. **How much machine load is acceptable for a "measured" run?** On this laptop
   the control arm moved up to 1.43x between runs, which is larger than the
   regression the gate exists to catch. If component tasks keep benchmarking on
   dev machines, the honest answer is "benchmarks inform review, they do not
   gate" — which is what is built — but `docs/PLAN.md` should say so out loud.

---

# Round 2 — review response

Reviewer verdict on round 1 (`d7f546e`) was CHANGES-REQUIRED: four blocking items,
fourteen should-fix items and eight nits (`docs/tasks/T02-bench.review.md`, now
committed). Round 2 is `8dd6c0f..HEAD` on this branch, rebased on `main`
(D7b, D10-D14 and the Slider/Progress briefs are the only things the rebase
picked up; `bun install` after it changed nothing).

One round-1 commit is gone: the `NitroUiPackage.kt` comment-only fix. T03 fixed
the same autolinking regex better and added `autolinking:check`, so this branch
takes main's file and drops `e7fbabd`. `package.json`'s `check` chain and
CONTRIBUTING's sections were merged by hand rather than taken wholesale.

## Item-by-item

### BLOCKING

| Item | Fix | Where |
| --- | --- | --- |
| B1 gate cannot fail | Absolute control drift no longer vetoes anything. `--check` compares launch-paired ratios with a committed **ratio** baseline; `--compare` gates `head(x/rn-core) / base(x/rn-core)`; noise is measured **within the run** per (scenario, N, metric) from the spread of the paired ratio and suppresses only the cell it was seen on. Control drift is now a "context only" line in the report. | `gate()`, `noiseTable()`, `controlMovement()` in `scripts/bench/lib.mjs` |
| B2 slot does not typecheck | `paths: { "react-native-nitro-ui": ["../src/index.ts"] }` in `bench/tsconfig.json` (TS mirror of Metro's `extraNodeModules`), so `bun run bench:typecheck` typechecks the slot against the library's source. `onValueChange` and `rowStyle` are imported and used; the snippet matches T10's API (`value`, `onValueChange(value)`, `style`, `testID`). `Switch` is resolved at runtime so the arm is live the moment T10 exports one, and until then it emits a `skip` record with the reason instead of measuring a stand-in. | `bench/tsconfig.json`, `bench/src/implementations/nitroUi.tsx` |
| B3 iOS arms unequal | `label` dropped and `modifiers={[labelsHidden()]}` on every Expo `Toggle`, with the modifier array hoisted to module scope. All three arms now render a bare switch. Tables below are re-measured after this. | `bench/src/implementations/expoUi.ios.tsx` |
| B4 merge conflicts | Rebased on `main`; `NitroUiPackage.kt` is main's version, `check` chains and CONTRIBUTING sections merged, `bun install` run. | - |

### SHOULD-FIX (measurement)

| Item | Fix |
| --- | --- |
| S1 JS poll inside the timed region | The probe resolves `awaitMount(timeoutMs)` / `awaitPresented(timeoutMs)` from the native mount hook. The `setTimeout(0)` loop is gone; a slow mount is no longer also charged to JS CPU. |
| S2 `presented` after a JS round trip | Frame capture is armed **natively in the mount turn**: iOS a one-shot `CADisplayLink` inside the mount callback, Android the activity window's `OnFrameMetricsAvailableListener` reporting intended vsync + total duration. Stored as `lastPresentedNs`; `nextFrameNs()` is now pacing only. `presented` is labelled a frame stamp, and every cell prints a sanity line counting `presentedBeforeMount` / `mountBeforeCommit`. |
| S3 100 Hz CPU ticks | `/proc/self/task/<tid>/schedstat` field 0 (ns) with the jiffies `stat` file only as a fallback; the report text about "0 or 10 ms" is corrected. |
| S4 Profiler zeros in release | Dropped rather than aliased: `BenchApp.tsx` has no `Profiler` and the report prints no `React.Profiler 0.00 ms/op` row. (Aliasing `ReactFabric-profiling` would have changed what every arm links against.) |
| S5 mount bracket covered unmount | Separate brackets: `unmountMainNsPerOp` is its own metric, gated and reported (`UI CPU/unmount`). On iOS `mount N=50` rn-core it is 2.67 ms against 8.86 ms for the mount, i.e. ~23 % of the cycle was previously invisible attribution. |
| S6 "median of medians" | `median(launchMedians)` with the MAD **of the launch medians**; the bootstrap is now hierarchical (resample launches, then iterations inside each launch) and reports `hierarchical: true`. |
| S7 clock offset | Removed. Timestamps are absolute `CLOCK_UPTIME_RAW` / `System.nanoTime()` values, directly comparable with `NitroUiCore.now()` and T10's perf marks (D1); the wrong "~1e17 ns" reasoning is gone from the comments. |
| S8 heap / leak | `globalThis.gc?.()` runs before every footprint sample and the result is recorded as `heapCollected`. Android adds `Debug.getNativeHeapAllocatedSize()` and Java-heap-used per phase, surfaced as `nativeBytesPerInstance` / `javaBytesPerInstance` (reported, deliberately not gated). The leak slope is now gated, and only when the climb is monotonic. |
| S9 gate covered reference arms | `GATED_IMPLEMENTATIONS = ['nitro-ui']`. `rn-core` is the control, `expo-ui-*` are labelled "reference arm" in every verdict row. |

### SHOULD-FIX (runner, report, baselines)

| Item | Fix |
| --- | --- |
| S10 unattributable baselines | `baselineBlockers()` refuses: dirty tree, any incomplete launch, no recorded load average, load above 0.5 x cores, and (found this round) a plan other than `full` or fewer than 8 launches. `--force` overrides and is the only way. Machine, load average, OS and emulator image are recorded in the run. Both round-1 baselines are deleted: they claimed `sha: e39db3c` (main) while being recorded from a dirty tree. |
| S11 `report.mjs --compare` ignored `noisy` | One `gate()` in `lib.mjs`, called from the shared `comparisonSections()` in `render.mjs` that both the runner and the reporter use; a unit test asserts the reporter's exit code through the real CLI. |
| S12 results collisions | `<sha>[-dirty]-<platform>-<utc>.json`, with `newestResultsName()` preferring clean runs, so a dirty run can no longer become a `--compare` base under a clean commit's name. |
| S13 perf gate unwired | `perf:renders` runs inside `bun run check` (cheap while nothing is measured, and it passes loudly with "nothing to measure"). |
| S14 bench.yml | `gh pr checkout` for the PR revision; `OWNER/MEMBER/COLLABORATOR` gate on who may start it; anchored `^/bench` trigger plus the `bench` label; concurrency keyed on the PR number; `runs-on: xcode-27` (D2); Android via `reactivecircus/android-emulator-runner` (system image + KVM); `--prebuild` on both base and head; nightly labelled as a noise sample; `benchmarks.md` no longer claims base and head are interleaved. |
| devices.mjs | `--shutdown` powers off only what the run booted; animation scales are restored on every exit path; device keys carry the OS runtime (D9); load average is recorded. |

### Re-render gate (report question 2)

Implemented as proposed: `measureRenders` tests must drive a `scenario`, and the
gate now requires (1) the count equals the baseline, (2) **every** measured run
produced the same count - the median of ten used to hide nondeterminism,
(3) `issues.initialUpdateCount === 0`, (4) `issues.redundantUpdates` empty.
`docs/architecture/benchmarks.md` "Adding a `*.perf-test.tsx`" gives component
tasks the harness pattern (flip the control a few times, then render an unrelated
parent a few times) so "re-renders when told, and only then" is the assertion.
The host-mock prop-churn test the review sketching is T10's to write - the gate
reads whatever `*.perf-test.tsx` exists.

### NITs

Fixed: `pthread_mach_thread_np(pthread_self())` instead of scanning `task_threads`
(and the port rights are deallocated); `stackStyle(n)` memoised per N; the
non-existent `packageExportConditionTranslations` Metro option removed;
`nextFrameNs` on Android gets the same 2 s fallback iOS has; `renders.mjs`
requires all runs to agree; the "0 or 10 ms" report text is corrected. The R8
note about Kotlin `HybridObject`s is T03/T10 territory and left alone.

## Gates

| Command | Result |
| --- | --- |
| `bun run check` | PASS - typecheck, bench:typecheck (both tsconfigs), lint, format, 61 Jest tests, perf:renders, nitrogen drift, autolinking, bob, publint, manifest |
| `bun bench --platform ios --plan quick` | PASS end to end at `cc39202` (230 s) and again at the final tree `e7d4811` (234 s), `problems: none`, 80/80 samples per measured cell, ratios reproduced within 2 % |
| `bun bench --platform android --plan quick --check` | PASS end to end at `cc39202` (225 s) and at `e7d4811` (227 s); the latter gated against the committed Android baseline: "No gated metric exceeded the 1.20x threshold against the baseline", exit 0, `problems: none` |
| `bench:report <iOS run> --check` | `no baseline at bench/baselines/ios27-sim-iphoneair.json. Create it with --update-baseline.`, exit 1 - the honest no-baseline path, re-verified against the `e7d4811` run |
| `bench:report <Android run> --check` | "No gated metric exceeded the 1.20x threshold against the baseline", exit 0; 6 metric cells labelled noisy in that run, the rest conclusive |
| `bun bench --platform android --plan full --launches 8` | see Baselines below |
| negative test - gate can fail | `scripts/__tests__/bench-gate.test.js`: a synthetic run where `nitro-ui` doubles must fail (ratio 2.0, CI low > 1.05) **and** `spawnSync` of `report.mjs --compare` must exit 1; the same file asserts the reference arms can never fail, that control drift neither suppresses nor manufactures a verdict, that a noisy cell is suppressed alone, that a monotonic leak climb gates, and that `--update-baseline` refuses a dirty/broken/busy/quick run |

## Results (both platforms, clean tree at `cc39202`, `--plan quick`)

Both runs report `problems: none`, 80/80 samples in every measured cell, and the
`nitro-ui` arm self-skips with a reason - T10's `Switch` is not in `src/` yet, so
there is nothing to gate on this round. `UI CPU/unmount` is the new teardown
metric. `presented` is a frame stamp: iOS is one frame after the mount, Android
is latched to the next intended vsync, so the honest read is arm-versus-arm
within a platform, never iOS-versus-Android.

### iOS (`iPhone Air` simulator, key `ios27-sim-iphoneair`)

Absolute, `mount N=50`, median of launch medians with MAD on the latency metrics:

| Arm                        | presented           | mounted           | JS commit          | JS CPU/op | UI CPU/op | UI CPU/unmount |
| -------------------------- | ------------------- | ----------------- | ------------------ | --------- | --------- | -------------- |
| rn-core                    | 15.98 ms +/- 21 us  | 12.16 ms +/- 1 ms | 3.36 ms +/- 122 us | 3.45 ms   | 8.86 ms   | 2.67 ms        |
| expo-ui-host-per-control   | 105.94 ms +/- 466 us | 17.25 ms +/-128us | 2.24 ms +/- 7 us   | 2.43 ms   | 72.00 ms  | 18.87 ms       |
| expo-ui-shared-host        | 48.76 ms +/- 1.3 ms | 4.61 ms +/- 81 us | 1.11 ms +/- 33 us  | 1.28 ms   | 30.09 ms  | 29.71 ms       |

Launch-paired ratio to rn-core (rn-core is 1.00x by construction):

| Cell         | Arm                      | presented | mounted | JS commit | JS CPU/op | UI CPU/op | UI CPU/unmount | bytes/inst           |
| ------------ | ------------------------ | --------- | ------- | --------- | --------- | --------- | -------------- | -------------------- |
| mount N=50   | expo-ui-host-per-control | 6.64x     | 1.42x   | 0.67x     | 0.71x     | 7.83x     | 5.57x          | n/a                  |
| mount N=50   | expo-ui-shared-host      | 3.06x     | 0.39x   | 0.34x     | 0.38x     | 3.48x     | 11.13x         | n/a                  |
| update N=50  | expo-ui-host-per-control | 1.00x     | 0.98x   | 1.63x     | 1.30x     | 1.86x     | n/a            | n/a                  |
| update N=50  | expo-ui-shared-host      | 1.00x     | 0.76x   | 0.83x     | 0.71x     | 1.60x     | n/a            | n/a                  |
| memory N=200 | expo-ui-host-per-control | n/a       | n/a     | n/a       | n/a       | n/a       | n/a            | 3.69x (392.6 KiB)    |
| memory N=200 | expo-ui-shared-host      | n/a       | n/a     | n/a       | n/a       | n/a       | n/a            | 2.48x (264.7 KiB)    |

Absolute rn-core baselines those ratios divide by: `update N=50` 16.13 ms
presented / 3.51 ms mounted / 995.64 us commit / 1.33 ms JS CPU / 4.85 ms UI
CPU, and `memory N=200` 106.5 KiB per instance.

Metrics the run flagged as too noisy to carry a verdict (suppressed for that
cell only): iOS mount host-per-control `UI CPU/unmount` (35.0% within-run
spread), iOS mount shared-host `mounted` (10.0%) and `UI CPU/op` (11.2%), and
iOS update `JS commit` on both Expo arms (18.6% / 19.2%).

### Android (AVD `nitroui_t02`, key `android35-emu-pixel9`)

Absolute, `mount N=50`:

| Arm                      | presented           | mounted           | JS commit           | JS CPU/op  | UI CPU/op  | UI CPU/unmount |
| ------------------------ | ------------------- | ----------------- | ------------------- | ---------- | ---------- | -------------- |
| rn-core                  | 48.25 ms +/- 597 us | 19.90 ms +/- 505 us | 1.22 ms +/- 6 us    | 1.52 ms    | 6.33 ms    | 66.28 us       |
| expo-ui-host-per-control | 49.34 ms +/- 276 us | 23.45 ms +/-121 us | 6.22 ms +/- 40 us   | 7.27 ms    | 14.01 ms   | 281.31 us      |
| expo-ui-shared-host      | 49.31 ms +/- 424 us | 19.36 ms +/- 643 us | 1.38 ms +/- 13 us   | 1.80 ms    | 4.76 ms    | 180.39 us      |

### Android ratio to rn-core

| Cell         | Arm                      | presented | mounted | JS commit | JS CPU/op | UI CPU/op | UI CPU/unmount | bytes/inst        |
| ------------ | ------------------------ | --------- | ------- | --------- | --------- | --------- | -------------- | ----------------- |
| mount N=50   | expo-ui-host-per-control | 1.02x     | 1.18x   | 5.41x     | 4.83x     | 2.22x     | 3.58x          | n/a               |
| mount N=50   | expo-ui-shared-host      | 1.02x     | 0.96x   | 1.13x     | 1.17x     | 0.83x     | 3.36x          | n/a               |
| update N=50  | expo-ui-host-per-control | 0.93x     | 0.78x   | 2.27x     | 1.42x     | 4.57x     | n/a            | n/a               |
| update N=50  | expo-ui-shared-host      | 0.95x     | 0.86x   | 1.09x     | 0.91x     | 3.46x     | n/a            | n/a               |
| memory N=200 | expo-ui-host-per-control | n/a       | n/a     | n/a       | n/a       | n/a       | n/a            | 3.55x (191.3 KiB) |
| memory N=200 | expo-ui-shared-host      | n/a       | n/a     | n/a       | n/a       | n/a       | n/a            | 0.86x (46.3 KiB)  |

Absolute rn-core baselines: `update N=50` 48.92 ms presented / 16.19 ms mounted
/ 804.52 us commit / 1.49 ms JS CPU / 2.18 ms UI CPU, and `memory N=200` 53.9
KiB per instance. Noisy this run: Android mount host-per-control
`UI CPU/unmount` (47.2%), Android mount shared-host `UI CPU/op` (16.1%) and
`UI CPU/unmount` (11.3%). No out-of-order samples on either platform.

### What the numbers say now that B3 is fixed

With the label gone from the Expo arms, `presented` on iOS is no longer a text
layout measurement: a control hosted per row costs 6.64x the frames of the
control and a shared host 3.06x, which is the hosting cost the benchmark was
meant to isolate. On Android the same three arms land within 2 % of each other
on `presented` (Compose reaches the same vsync whichever host it is in) and the
cost shows up instead in JS commit, where one Expo view per row is 5.41x the
control. `UI CPU/unmount` also stops being free in the shared-host case (11.13x
on iOS), which is exactly the attribution S5 said round 1 was missing.

### Where the per-instance memory actually is (Android)

PSS per instance was never a view cost on its own, and with the heap breakdown it
stops looking like one. `memory N=200`, bytes per instance, footprint delta after
`globalThis.gc?.()` + a native collect + a 1 s settle:

| Arm | PSS/inst | native heap | Java heap | unattributed |
| --- | --- | --- | --- | --- |
| rn-core | 53.9 KiB | 40.1 KiB | 10.7 KiB | 3.1 KiB |
| expo-ui-host-per-control | 191.3 KiB | 69.9 KiB | 101.6 KiB | 19.8 KiB |
| expo-ui-shared-host | 46.3 KiB | 9.3 KiB | 24.8 KiB | 12.3 KiB |

`rn-core`'s 54 KiB per switch is 94 % runtime heap churn, and the shared-host
Expo arm's footprint grows *less* than `rn-core`'s while holding a Compose tree -
which is exactly the reading the review said was unbelievable without a
breakdown. The Expo host-per-control arm is where the real memory is: 100 KiB of
Java heap per control, i.e. one Compose/View hierarchy's worth of Java objects
per control.

## Noise level (rn-core control, two consecutive runs, same build)

The same `--compare` path the gate uses, head vs base being two runs of the same
code. These are absolute control movements, reported as context, never as a
verdict.

| Platform | Metrics that moved > 10 % | Largest |
| --- | --- | --- |
| iOS (run 1 dirty vs run 2 clean, same app) | 4 of 11 | mount N=50 JS CPU/op 1.22x |
| Android (two clean consecutive runs) | 3 of 11 | update N=50 JS CPU/op 0.78x |

Round 1 recorded 7 of 11 (Android) over 10 % and read that as "the gate can
never run". It is still true that a single control metric can move 20 % between
sessions - which is why the gate is ratio-based and why the *within-run* spread
of the paired ratio decides whether a cell can carry a verdict. In these runs the
runner flagged 5 metrics per run as too noisy to judge, per cell, and left the
rest conclusive. That is the behaviour D9 asks for: the noisy cells go
inconclusive on their own, the run still produces verdicts.

The no-baseline path is honest too: `bench:report <file> --check` currently
prints `--check: no baseline at bench/baselines/ios27-sim-iphoneair.json` and
exits 1 rather than inventing a verdict.

## Baselines

`bench/baselines/android35-emu-pixel9.json` is new and was produced the way D9
requires: clean tree at `7b376f7`, `--plan full`, `--launches 8`, `problems:
none`, load average 3.58 over 14 cores (ceiling 7.0), run duration 1850 s, and
the file records the machine, the OS build and the emulator image. It is
ratio-only: every metric entry carries `ratio`, `launchRatios`, `samples` and
`noise` and nothing else, because an absolute nanosecond or byte count has no
business in a committed baseline. One blemish in its provenance -
`machine.androidApi` is null, recorded from `device.sdkInt` where
`devices.mjs` returns `sdk`, fixed in the commit after it. The AVD really is the
`pixel_9` hardware profile on API 35, so the key matches D9's canonical Android
device; `hw.device.name` beats `ro.product.model` in `devices.mjs` for exactly
that reason.

`bench/baselines/ios27-sim-iphoneair.json` and `android-api35-emu.json` /
`ios-iphone-air-sim.json` are deleted: both round-1 files claimed `sha:
e39db3c`, which is `main`, while being recorded from a dirty tree, and the
absolute-drift guard that consumed them no longer exists.

**No iOS baseline this round, deliberately.** D9 names one canonical device per
platform and the canonical iOS device is an iPhone 17 (`ios27-sim-iphone17`);
T02's brief pins an iPhone Air, and the iPhone 17 simulator on this machine
belongs to another task, so minting an iOS baseline here would either key it to
non-canonical hardware - which D9 says must use `--compare` instead - or touch a
device this task may not touch. The gap closes with one command on whichever
machine owns the canonical device:

    bun bench --platform ios --plan full --launches 8 --update-baseline

Until then `--check` on iOS says `no baseline at bench/baselines/...json` and
exits 1, which is the honest answer. `--compare <ref>` works everywhere and is
what component tasks should use for a pull request.

Verified against the committed baseline, offline:

| Command | Result |
| --- | --- |
| `bench:report <full run> --check` | "No gated metric exceeded the 1.20x threshold against the baseline", exit 0 |
| `bench:report <quick run> --check` | verdicts on every quiet cell; 3 metrics labelled noisy per cell, no whole-run veto |
| `bench:report <real run + a nitro-ui mount N=50 arm synthesised at 2.2x rn-core> --check` | reports `new arm - JS commit 2.20x, mounted 2.20x versus rn-core, nothing to regress against until the baseline is refreshed`, exit 0 - see the note below |
| the same comparison against a baseline that *has* a `nitro-ui` value | `bench-gate.test.js` asserts FAIL plus exit 1 through the real `report.mjs` CLI |

**One thing the reviewer will want to decide.** A `nitro-ui` arm that the
baseline has never seen cannot regress - there is no prior ratio. Round 2 makes
that visible (`new arm`, plus the arm's ratios versus `rn-core`) instead of
silent, but it does not block, because D9's rule is a *regression* whose CI
excludes the threshold, and inventing an absolute ceiling versus `rn-core` is a
policy decision, not an implementation one. The practical consequence: the first
run of a new component establishes its baseline; the second can fail. If the
orchestrator wants "slower than `rn-core` blocks immediately", that is a D9
amendment plus one number.

## Machine conditions

Two device-heavy tasks share this laptop (D13: this task and T10), so every
number here has load recorded with it. The runner records `os.loadavg()` and the
core count in each run and refuses to mint a baseline above 0.5 x cores.

| Run | Load avg (1m / 5m) | Cores | Duration | Problems |
| --- | --- | --- | --- | --- |
| iOS quick (clean, `cc39202`) | 3.53 / 3.50 | 14 | 230 s | none |
| Android quick (clean, `cc39202`) | 3.86 / 4.19 | 14 | 225 s | none |
| Android quick #2 (run-to-run noise) | 2.84 / 3.24 at start | 14 | 226 s | none |
| Android full x8 (baseline, `7b376f7`) | 3.58 / 5.20 | 14 | 1850 s | none |
| `bun run check` | 3.2 - 9.5 across the session (T10 was building during the first attempt) | 14 | ~2 min | - |
| iOS quick re-run (final tree, `e7d4811`) | 3.26 / 3.98 | 14 | 234 s | none |
| Android quick re-run + `--check` (final tree, `e7d4811`) | 6.96 / 4.29 at record time (the run itself is emulator + Metro on 14 cores) | 14 | 227 s | none |

The Android emulator's console port moved again (5572 -> 5554), which is why
`scripts/bench/devices.mjs` resolves the serial from the AVD name instead of
trusting a port. Devices this task started are shut down at the end of the task;
animation scales are restored by the runner on every exit path.

## Questions for orchestrator (round 2)

Round 1's questions 4, 5 and 7 are answered by D9 and are closed: baselines are
ratio-only and gated by `baselineBlockers()`; device keys carry the OS runtime
and non-canonical hardware uses `--compare`; PLAN.md-facing docs now say plainly
that on-device benchmarks inform review and that the deterministic Reassure count
is the gate that blocks. Questions 1, 2, 3 and 6 were addressed inside T03/T10's
scope (`autolinking:check`, the stable-callback contract, `METRO_PORT` removed
from the bench docs, AVD-name resolution).

New, in rough order of consequence:

1. **Canonical iOS device.** D9 names `ios27-sim-iphone17`; T02's brief assigns
   an iPhone Air, and other tasks hold the iPhone 17 sim on this machine. Either
   designate iPhone Air as canonical until CI exists (then one
   `--update-baseline` run closes it), or accept that no one can `--check` iOS
   locally and that only CI mints that file. Right now iOS has ratios and
   `--compare` only.
2. **A `nitro-ui` arm's first run cannot fail** (see the note above): a
   regression needs a prior ratio. Fine as policy, or amend D9 with an absolute
   ceiling versus `rn-core` for gated arms.
3. **The device key cannot distinguish two machines with the same device class.**
   `android35-emu-pixel9` is this desk AVD *and* CI's emulator, and the committed
   baseline is one of them. Ratio-only baselines plus recorded load is what
   mitigates it; `--force` is the only way to write one, and the `sha` inside says
   who produced it.
4. **T10's `Switch` sizing versus the bench.** `style={rowStyle}` fixes a
   44 pt/48 dp row for every arm today, which hides D14's point that iOS 26+
   renders a 61x28 Toggle. The first real `nitro-ui` numbers will be measured
   inside that fixed box. Worth an explicit decision before T10's numbers get
   quoted anywhere.
