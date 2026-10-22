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
