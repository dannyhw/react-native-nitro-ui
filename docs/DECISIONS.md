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
  - **R4 amendment - the idle rule judges the run, not its last minute.** The runner samples
    `load1` every 30 s and at every launch boundary and records `{ count, ceiling, median, p90,
    max, over, overFraction }`; a run is refused when its **median** is over 0.5 x cores or when
    **more than 10 %** of the samples are, and `--update-baseline` also refuses *before starting*
    when `load1` is already over the ceiling (fail fast rather than burn three hours). Results
    files without samples keep the single-sample rule. Learned from A1/A1b: two complete,
    problem-free iOS runs were refused by the load of their final minute.
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
  (registered at startup by `NitroUiDeclaredFallbacks`, T14, so that frame is the declared size,
  never 0; a correct declaration costs 0 corrections — exception: iOS 26+ apps with
  `UIDesignRequiresCompatibility` pay one correction, sizing.md §8) for one frame before its correction lands; every instance whose configuration is already exact
  in the cache must lay out exact on its first frame (0 stale). The immediate (synchronous) budget
  per flush is platform-set: iOS 2, Android 1 (T12; measured −32/−37 % flush time at 200/500 rows).
  The rest of a cold batch lands on a later frame. Gated: the synchronous-push count and the
  never-stale exact-cache instance; **not** gated: a whole cold batch's stale count (logged; T12
  measured 0 for 100 instances at budget 1 on one emulator, no mechanism claimed). No budget
  increase (synchronous pushes risk re-entering `measureContent`).
  No "hide until measured" mode in 0.1. Declared fallbacks must be accurate per OS (D14), and
  `prewarm` is the recommended way to make first mounts exact. Harness tests assert exactly this
  rule, with poisoned (wrong) fallbacks so a failed correction is visible.
- **D18 (T12)** Android bench numbers are only comparable within one ART compilation state.
  Runs record it (`art`); baselines are minted only from `speed-profile` runs. Android numbers
  published before T12 (T02 rounds 3–4, T11, T12 phase 1) were measured at `verify` — ratios and
  absolutes both differ. Primed Android baselines are recorded during release readiness (Phase 4).
- **D19 (human: "we can't spin on this forever")** Hard stops.
  - **Rounds:** each task gets at most **one implementation round + two fix rounds**. Fix rounds
    only for correctness bugs, failing gates or false claims in docs. Anything else becomes a
    one-line follow-up in `docs/tasks/FOLLOWUPS.md`. After the second fix round the orchestrator
    either merges (with follow-ups) or cuts the task. No third fix round.
  - **Re-verification:** an Opus re-review only after an implementation round or when a fix
    round changed native/C++ code; doc/test-only fix rounds are merged on green gates.
  - **Spikes/experiments** (T13 and later): one round, no fix rounds. Whatever the first report
    says decides it; "inconclusive" means flag off / not shipped, recorded as a follow-up.
  - **v0.1 scope is fixed:** Switch, Slider, Progress, Button, SegmentedControl. Picker and
    DatePicker move to 0.2 unless they are already merged when the others are done. No new
    infrastructure tasks before release readiness unless a component is blocked by a bug.
  - **Perf:** a D15 miss after one optimisation task is documented (with follow-up), not chased.
- **D20 (FIX2)** Exception to T11's S1 rule ("a props-only turn costs no measure"): an instance
  whose laid-out size was ever **corrected** re-dirties its measurement on later props-only clones
  (`requiresFreshMeasure`). Reason: React clones from its own pre-correction revision, whose Yoga
  cache and `layoutMetrics_` still hold the old size, and our `adopt` creates a fresh State on every
  props change, so RN's `progressState` never re-dirties it. Cost for a flagged instance: one
  measure + a Yoga pass up the dirtied ancestors per props turn (measured 8–48 µs on host for
  35–316 node trees). Never-corrected instances keep the zero-cost path. Any future sizing change
  must keep the "box stays right across props turns after a correction" harness cases green.
  Cheaper non-sticky alternative (dirty on obsolete state) is a follow-up.
- **D21 (G3)** Harness gates on this shared machine assert **structure** (counts: corrections,
  immediate pushes, flushes, stale frames, event counts) everywhere; **wall-clock thresholds**
  (e.g. cold-batch `flushMs`) move behind a quiet-machine tag (`HARNESS_TIMING=1`, refused when
  load average ≥ 10) and are reported, not gated, otherwise. Done during release readiness.

## D22 — No public release and no CI for now (2026-10-24)

The human's call: the repo stays private (`dannyhw/react-native-nitro-ui`), nothing goes to npm, and
all GitHub workflows (CI, Release, Bench, Smoke) are disabled. Local gates (`bun run check`, harness,
real-input, smoke, bench) are the only gates. Phase A = committed bench baselines + deferred small
fixes (A1/A2). 0.2 scope: Picker, DatePicker, Android over-wide content fix, opt-in Android `<Host>`
(Switch first, then the rest), iOS mount profiling to decide an iOS Host.

## D23 — Try `<Host>` on both platforms; ship it where it is better (2026-10-26)

The human's call: try the shared `<Host>` on iOS as well as Android, and use it if it is better. This
reverses P1's H3 drop (P1 found the iOS *mount time* cost is the first measure, but the per-instance
*memory* is host-attributable and nothing else measured fixes it). T17 spikes the iOS Host (Switch +
Slider, one round). "Better" = vs nitro-ui without a Host, on the same run: mount memory (N=200) and
mount UI CPU/op lower with a verdict, `presented` not worse (within its spread); reported against
`expo-ui-shared-host` too. If T17 clears that, H3 productionises the iOS Host with Android's API
(`<Host>`, `HostProps extends ViewProps`, direct nitro-ui children). The Host stays **opt-in** on
both platforms: inside it controls are native content, not RN views (no interleaving, `ScrollView`,
clip/transform, `Modal`), so it cannot be a silent default. Android H1/H2 proceed as planned.
