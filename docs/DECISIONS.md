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
- **D7b (T10)** Exception to D7: **callback props** must be optional `fn?` (Nitro only unwraps
  `{ f }` for a pure function type; `fn | null` throws at mount). Enforced by lint.
- **D10 (T10)** Colours: `processColor` is unsigned on iOS and signed on Android — native decodes
  must use the bit pattern, never assume a sign (see docs/architecture/core.md "Colours").
- **D11 (T10)** Dev-tooling bugs (e.g. react-native-harness) may be patched in `patches/` (D5);
  record each one in `docs/upstream.md` with a link/issue draft so we can upstream them later.
- **D12 (T10)** Dev-only apps (example/, bench/) may use `react-native-safe-area-context`. The
  library itself must not depend on it.
- **D13 (T10) Device concurrency.** At most **2 device-heavy tasks** run at once on this machine.
  Each device task uses a private adb server (`ANDROID_ADB_SERVER_PORT` assigned in its brief) and
  never runs `adb kill-server` on the default port. Retries/warm-ups are allowed in harness helpers
  but a gate must still be green at normal load.
- **D14 (T10 review)** v0.1 does not expose `hybridRef`/native view types publicly; all props flow
  through React (UI thread, batched). Imperative methods come later with explicit main-thread
  hopping + commit. iOS default sizes must match the running OS (iOS 26+ Toggle is 61×28 layout),
  until T11's measured sizing replaces defaults (done: defaults are now only the cache-miss fallback, D16).
- **D15 (T02)** Canonical iOS bench device = iPhone 17 simulator (iOS 27). The iOS baseline is
  recorded by the first task that holds that device on an idle machine. A component's *first*
  `nitro-ui` arm never blocks (no baseline yet); its report must show ratios vs both `@expo/ui`
  arms and `rn-core`, and the target is **≤ 1.0× `expo-ui-shared-host` and well below
  `expo-ui-host-per-control`** on mount presented, UI CPU and memory. Misses need an explanation
  and a follow-up item; the reviewer decides. Same-class machines are distinguished by recording
  the machine model/CPU in result metadata (keys stay class-level).
- **D16 (T11)** Sizing: accept T11's recommendations — size-affecting-prop verification (R3)
  is owned by the first size-affecting component (G2 Button must add the test); `prewarmKeys`
  deferred past 0.1; measured sizes are explicit sizes, so cross-axis stretch is opt-in via
  `alignSelf: 'stretch'` (documented difference from RN `Switch`); one stale iOS frame after an
  environment change is accepted; rename `staleFramesSkipped` → `changedFlushes` before 0.1.
  D14's "until T11" clause is fulfilled: defaults are now only the cache-miss fallback.
- **D17 (T11 round 2)** Sizing frame budget, both platforms: the **first instance of a sizing
  configuration per environment epoch** (no exact cache entry yet) may show the declared fallback
  for one frame before its correction lands; every instance whose configuration is already exact
  in the cache must lay out exact on its first frame (0 stale). On Android a cold batch corrects
  up to the immediate budget inside the cancelled frame and the rest on the next frame — same
  rule, documented; no budget increase (synchronous pushes risk re-entering `measureContent`). The
  budget is platform-set since T12 (`flush(immediateBudget)`): 2 on iOS, 1 on Android, where each
  synchronous push is a full commit inside the pre-draw pass that cancels the frame — and one still
  measures `stale=0` for a cold batch, because the correction is shared by the configuration.
  No "hide until measured" mode in 0.1. Declared fallbacks must be accurate per OS (D14), and
  `prewarm` is the recommended way to make first mounts exact. Harness tests assert exactly this
  rule, with poisoned (wrong) fallbacks so a failed correction is visible.
