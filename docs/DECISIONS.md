# Decisions log

Running log of orchestrator decisions that tasks must follow. Newest last.

- **D1 (T01)** `NitroUiCore.now()` uses `CLOCK_UPTIME_RAW` (Apple) / `CLOCK_MONOTONIC` (Android,
  same base as `System.nanoTime()` and Choreographer frame times). Bench code must use the same base.
- **D2 (T01)** iOS CI uses the `xcode-27` runner label for now; an older-Xcode row is a later product decision.
- **D3 (T01)** Every brief assigns explicit devices and `METRO_PORT` (default 8291 is reserved for
  ad-hoc use in the main checkout; 8081/8091 are taken by other dev servers on this machine).
- **D4 (T01)** api-extractor report is added in T10 when the public API becomes real.
- **D5 (T01)** Dev-only dependency patches live in `patches/` (bun `patchedDependencies`). They must
  never be needed by consumers and must not ship in the npm package.
- **D6** Single npm package `react-native-nitro-ui`; core lives inside it (no `@nitro-ui/core`).
- **D7** No optional (`?:`) Hybrid View props (nitro#1184); native specs use `T | null` and the JS
  wrapper always passes every prop.
- **D8 (T03)** Supported floor stays **RN >= 0.86** (Expo SDK 57+). Android deps (Compose BOM etc.)
  must be pinned to versions whose AAR metadata works with RN 0.86's default compileSdk/AGP, so
  0.86 consumers need zero changes. RN 0.86 iOS can't be verified on this machine's iOS 27 runtime;
  verify it in CI on an older runtime later.
- **D9 (T02) Benchmark policy.**
  - Gate only `nitro-ui` arms, on **launch-paired ratios to `rn-core`** measured in the same run;
    noise is judged within the run per (scenario, metric), not by absolute drift vs baseline.
  - Committed baselines are ratio-only, produced on a clean tree, on an idle machine (record load
    average; refuse when busy), in a dedicated commit. Absolute numbers/trends live in CI artifacts.
  - Device keys = platform + OS runtime + device class (e.g. `ios27-sim-iphone17`,
    `android35-emu-pixel9`). One canonical device per platform; other hardware uses `--compare`.
  - Locally and on hosted CI, benchmarks **inform review**; they block only on a clear regression
    (ratio CI excludes the threshold) on the canonical device.
  - Wrapper re-render counts are a hard gate via Reassure `measureRenders` scenarios
    (counts stable, `redundantUpdates` empty) and run in `bun run check`.
  - Release benches never start Metro; no `METRO_PORT` in bench briefs.
