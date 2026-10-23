# G3 — Progress: implementation report

Round 1 (implementation). Branch `task/G3-progress`; `main` @ `52823a9` merged in `b734ed6`
(BUTTON/G2, T15b, the real-input runner, FIX2/D20 and doc updates). 60 files, +5422/-49 vs `main`.

## Summary

`<Progress>` — SwiftUI `ProgressView` (`.linear` / `.circular`) on iOS, Material 3
`LinearProgressIndicator` / `CircularProgressIndicator` on Android, with the same JS surface on both.

- **The first non-interactive component.** No `NitroUiControlledValue`, no `mostRecentEventCount`,
  no callback props (`docs/architecture/core.md` §12): `afterUpdate()` is `host.commit()` and nothing
  else, so a `value` written at 60 Hz costs one props commit and no round trip. The Reassure scenario
  (`src/components/Progress/Progress.perf-test.tsx`, baseline `7` renders) is the D9 half of that
  claim; `commits once per update at 60 Hz` in the harness suite is the on-device half.
- **Sizing.** `linear` = `fillWidth` (wrapper defaults to `alignSelf: 'stretch'`), `circular` =
  `intrinsic`; `nuiSizingKey` = the variant; declared fallbacks registered at startup in
  `NitroUiDeclaredFallbacks` on both platforms (T14), measured per OS (iOS 4 pt / 20 pt, Android
  4.19 dp / 40 dp). A variant change keys the native view, because Android's `NitroUiMeasuredRoot`
  answers the intrinsic/fillWidth question once, when the composition is built.
- **The animation gate.** Off-window, an indeterminate indicator is drawn as an **empty determinate**
  one in the same style — same style so the measured size does not move, empty because that is the one
  determinate state with no motion. On iOS that only holds for a **linear** bar: a circular
  `ProgressView` is drawn the same either way, so the gate changes nothing there (F3). `inWindow` is written by a zero-size UIKit sibling on iOS
  (`NitroUiProgressWindowObserver`) and by `onAttachedToWindow` / `onDetachedFromWindow` on Android,
  and the recycle (`reset()`) and `onDropView()` paths close the gate too. `nuiTestIsAnimating()`
  reports the gate; `animating` is derived from what the drawing code was handed. On **Android** the
  mirror and the pixels cannot disagree. On iOS a circular `ProgressView` spins whatever it is handed
  — including a determinate fraction — so for that one configuration the mirror reports a rule the
  pixels do not follow (F3, now documented in the component page).
- **Accessibility.** Android publishes `ProgressBarRangeInfo` semantics (the real progressbar role)
  plus the label; iOS has no public progressbar/busy trait, so it sets label + `accessibilityValue`
  (`"0%"`…`"100%"`, `nil` value while indeterminate) — documented in the component page.
- **`trackColor` on iOS** is stored and round-tripped but not painted: SwiftUI `ProgressView` has no
  API that addresses its track. Documented rather than faked.
- **No `animated` prop.** Interpolating between two values is left to the two toolkits (each has its
  own default), and the component page says which does what.

### FIX2 (D20) — the 60 Hz box claim

`keeps its box while the value changes 40 times` is green on **both** platforms with FIX2 in the
tree. It is the same shape as the T15 Finding 1 failure that the controlled Switch had (a hosted
control re-laid out after a `value` turn), so this is the case D20 says must stay green — and it
does. Nothing here needed a core patch.

## Files changed

- **Component** — `src/components/Progress/{Progress.tsx,Progress.nitro.ts,NativeNitroUiProgress.ts,NitroUiProgressConfig.ts,Progress.perf-test.tsx}`;
  `src/index.ts`; `nitrogen/generated/**` (committed output, drift-guarded).
- **iOS** — `ios/components/Progress/HybridNitroUiProgress.swift`; `ios/core/NitroUiDeclaredFallbacks.swift`.
- **Android** — `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiProgress.kt`
  (+ `NitroUiPackage.kt`, `core/NitroUiDeclaredFallbacks.kt`); JVM tests in
  `android/src/test/java/com/margelo/nitro/nitroui/ProgressModelTest.kt` (11 tests).
- **Tests / example** — `example/__tests__/Progress.harness.tsx` (12 tests), `example/src/**` screen,
  `scripts/smoke/App.tsx` (`SMOKE-progress`).
- **Bench** — `bench/src/{plan.ts,types.ts,implementations/*}`, `scripts/bench/lib.mjs`,
  `scripts/__tests__/bench-gate.test.js`, `bench/baselines/renders.json`.
- **Docs / metadata** — `docs/components/progress.md`, `docs/tasks/G3-progress/` (4 screenshots),
  `etc/react-native-nitro-ui.api.md`, `etc/package-files.txt`, `nitro-ui.sizing.json`, `nitro.json`.

## Gate results

`bun run check` — **green** (all 13 steps: `tsc`, bench typecheck ×2, eslint, prettier, jest
118/118 in 8 suites, `test:native`, `perf:renders` 4/4, nitrogen drift, autolinking, `bob build`,
api-extractor, `publint --strict`, manifest 290 files).

JVM model tests — **47 passed / 0 failed / 0 skipped** (forced rerun; `ProgressModelTest` = 11):

```sh
ANDROID_HOME=$HOME/Library/Android/sdk bun run test:native:android   # :react-native-nitro-ui:testDebugUnitTest
```

Harness (Debug artifact + private Metro; the app is not built by the runner — see `CONTRIBUTING.md`):

```sh
export ANDROID_HOME=$HOME/Library/Android/sdk; export PATH=$ANDROID_HOME/platform-tools:$PATH

cd example/android && ./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a
cd example/ios && xcodebuild -workspace NitroUiExample.xcworkspace -scheme NitroUiExample \
  -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath build CODE_SIGNING_ALLOWED=NO build

# iOS — iPhone 17 (F08675D3-A32B-4F88-BC81-02D7E0CB797E), Metro 8293
cd example && IOS_SIM_UDID=F08675D3-A32B-4F88-BC81-02D7E0CB797E METRO_PORT=8293 HARNESS_TEST_TIMEOUT=60000 \
  HARNESS_APP_PATH="$(pwd)/ios/build/Build/Products/Debug-iphonesimulator/NitroUiExample.app" \
  bunx react-native-harness --harnessRunner ios            # -> 84 passed / 6 suites, 63.1 s
# Android — nitroui_t01 / emulator-5570, adb server 5041, Metro 8293
cd example && ANDROID_ADB_SERVER_PORT=5041 ANDROID_SERIAL=emulator-5570 ANDROID_AVD=nitroui_t01 \
  METRO_PORT=8293 HARNESS_TEST_TIMEOUT=60000 \
  HARNESS_APP_PATH="$(pwd)/android/app/build/outputs/apk/debug/app-debug.apk" \
  bunx react-native-harness --harnessRunner android        # -> 84 passed / 6 suites, 134.9 s
```

Both **green on the final tree** (`84/84`, 6 suites each). The Progress suite is 12 tests including
`keeps its box while the value changes 40 times`, and the edited harness file was run on both
platforms (AGENTS). One earlier Android pass and one earlier iOS pass each had a **pre-existing,
load-bound red in another suite** at load average ≈ 35: `Sizing › corrects a cold batch of 200 …`
(flush-ms ratio), `Slider › steps to the next legal value when a screen reader asks`, and
`Sizing › lays a cold Switch out at the size the control measures` (`hybrid?.measureContent()` read
before the ref callback landed). All three are the same class FIX2's report records as load-bound
(`expected 207.98 to be less than 160.4`, and "a second pre-existing Slider red … which passed on
other runs"); isolated retries and the final full runs are green. None is in Progress's files.

## Red proofs (every new test, shown failing)

Device suites use JS-only mutations where possible (Metro re-serves; no rebuild).

| Mutation | Where run | Result |
| --- | --- | --- |
| wrapper sends `Math.min(value, 0.5)` | iOS + Android | 7–8 of 12 red: `Expected "displayed=1.0" but the control reported "displayed=0.5"`, `…0.75…0.5`, `commits once per update at 60 Hz` → `expected 10 to be greater than or equal to 20` |
| wrapper gives the bar a `value`-dependent height | iOS + Android | `keeps its box while the value changes 40 times` → `expected '300.00x9.00' to be '300.00x4.00'` (iOS), `expected '300.19x9.14' to be '300.19x4.19'` (Android); the three sizing tests also went red (`The bar's box never became 300.00x4.00 tall (last=300.00x8.00, guess was 137x23)`) |
| wrapper drops `accessibilityLabel` | iOS | `labels the control and states its value to a screen reader` → `expected null to be 'Upload'` |
| wrapper sends `value ?? 0` (never indeterminate) and ignores caller `style` | iOS | `switches between a fraction and indeterminate` → `Expected "displayed=indeterminate" but the control reported "displayed=0.0"`; `honours an explicit size instead of its own box` → `expected 222 to be less than 1`; `animates while it is on screen…` red |
| `onDetachedFromWindow` / `onDropView` stop calling `refreshAnimationReport()` | Android (APK rebuilt) | `animates while it is on screen and stops when it is gone` → `expected true to be false`, **1 failed / 11 passed** — the only test that catches it |
| `ProgressModel.drawnValue` ignores `inWindow` | Android JVM | `ProgressModelTest` → 11 tests, 2 failed (`anIndeterminateIndicatorOffWindowDrawsEmpty`, `enteringAndLeavingAWindowMovesAnIndeterminateIndicatorBothWays`) |

11 of the 12 device tests were driven red. `mounts many instances at once` (**40** instances — the
D17 cold-batch shape at a scale one render holds; the test renders 40 and its log line says 40) was
not: every mutation that stops 40 controls mounting also stops one, which is already proved above,
and its unique claim is scale/timing — see follow-ups.

One thing the mutations found, worth recording: `drawnValue` and `animating` gate on `inWindow`
**independently**, so neither mutation alone reached the device oracle — the first mutated build
(`drawnValue` ignoring the window) left the device suite green. The detach-path mutation is what
proved the device test, and the JVM suite is what proved the model rule.

## Benchmarks (quick plan)

`bun bench --platform <ios|android> --plan quick --component progress --skip-build`, 4 launches ×
(5 warmup + 20 measured) per cell, N=50 mount/update, N=200 memory. Files:
`bench/results/b734ed6-dirty-ios-20261023T204649Z.md` (run A), `…205341Z.md` (run B),
`…android-20261023T210019Z.md`. Both bench apps were rebuilt after the merge (21:33 / 21:39 local)
and both runs are labelled `dirty`: the only uncommitted files were a comment deletion in
`example/__tests__/Progress.harness.tsx` and a worktree-path `Podfile.lock` artefact — neither is in
the bench app. Android was ART-primed (`speed-profile`, 1 attempt, recorded per D18). No baseline was
minted, so D15's first-arm rule applies: ratios, not gates.

Machine load at the bench was 17.8/22.8 (iOS A), 16.8/29.7 (iOS B), 11.0/13.5 (Android) — all
above the <20 preference, which is why several cells are noise-flagged.

### iOS — iPhone 17 (run B primary, run A in brackets)

| Cell | Arm | presented | mounted | JS commit | JS CPU/op | UI CPU/op | bytes/inst |
| --- | --- | --- | --- | --- | --- | --- | --- |
| mount N=50 | rn-core | 16.06 | 5.18 | 2.46 | 2.86 | 3.04 | — |
| mount N=50 | expo host-per-control | 159.77 | 36.27 | 4.10 | 4.86 | 107.37 | — |
| mount N=50 | expo shared-host | 16.13 | 5.69 | 1.37 | 1.71 | 15.03 | — |
| mount N=50 | **nitro-ui** | **36.52** | **26.84** | **1.59** | **1.91** | **31.97** | — |
| update N=50 | expo host-per-control | 16.09 | 6.38 | 2.73 | 2.96 | 11.77 | — |
| update N=50 | expo shared-host | 16.08 | 5.25 | 1.45 | 1.68 | 9.22 | — |
| update N=50 | **nitro-ui** | **16.07** | **2.84** | **1.55** | **1.78** | **7.38** | — |
| memory N=200 | rn-core / per-control / shared-host | — | — | — | — | — | 19.7 / 220.3 / 123.1 |
| memory N=200 | **nitro-ui** | — | — | — | — | — | **168.0** |

ms except bytes/inst (KiB). Ratios vs `expo-ui-shared-host` / `expo-ui-host-per-control`:

| Metric | vs shared-host | vs per-control | Verdictable? (runner's own flags) |
| --- | --- | --- | --- |
| mount presented | 2.26× [3.49×] | 0.23× [0.35×] | no — nitro spread 34.0% [13.7%], `presentedBeforeMount=33` [25] |
| mount mounted | 4.72× [4.61×] | 0.74× [0.95×] | no — run B flags 13.5% spread, and run A's nitro cell carries `presentedBeforeMount=25`, which bars a verdict (F4b) |
| mount UI CPU/op | 2.13× [1.70×] | 0.30× [0.37×] | no — shared-host cell 32.6% [11.4%] |
| update presented | 1.00× (tie) | 1.00× | yes (no flags) — but every arm lands on the one-frame ceiling (16.07 ms), so the tie is by construction |
| update mounted | 0.54× [0.53×] | 0.45× [0.45×] | run A yes → **PASS** |
| update UI CPU/op | 0.80× [0.80×] | 0.63× [0.66×] | no — 31.8% [23.4%] |
| memory | 1.36× [1.36×] | 0.76× [0.76×] | **yes** (all four cells clean, both runs) |

### Android — nitroui_t01 (ART `speed-profile`)

| Cell | Arm | presented | mounted | JS commit | JS CPU/op | UI CPU/op | bytes/inst |
| --- | --- | --- | --- | --- | --- | --- | --- |
| mount N=50 | rn-core | 43.75 | 18.15 | 4.26 | 4.62 | 9.05 | — |
| mount N=50 | expo host-per-control | 134.76 | 74.48 | 38.03 | 39.18 | 64.39 | — |
| mount N=50 | expo shared-host | 69.59 | 32.48 | 4.71 | 7.00 | 23.62 | — |
| mount N=50 | **nitro-ui** | **56.66** | **33.79** | **3.67** | **4.78** | **27.00** | — |
| update N=50 | expo host-per-control | n/a | n/a | 2.93 | 4.30 | 59.88 | — |
| update N=50 | expo shared-host | n/a | n/a | 1.31 | 2.81 | 70.70 | — |
| update N=50 | **nitro-ui** | 47.92 | 17.69 | 2.75 | 3.96 | **6.27** | — |
| memory N=200 | rn-core / per-control / shared-host | — | — | — | — | — | 50.9 / 231.3 / 88.2 |
| memory N=200 | **nitro-ui** | — | — | — | — | — | **130.9** |

The two `@expo/ui` update cells report `missingMount=80`, so no Android update latency verdict
exists at all. Ratios: mount presented 0.81× shared-host (not verdictable: 15.2% / 21.9% spread),
mount mounted 1.04×, mount UI CPU 1.14× (nitro cell clean, shared-host 11.7%), update UI CPU 6.27
ms/op **recorded and not compared** (F4a — the expo cells pay ≈3.5 s of mount/presented waiting
inside the CPU bracket, so their 59.9 / 70.7 ms is a different quantity; the runner also declined a
verdict at 17.1% spread on its own cell), memory **1.48×** shared-host /
0.57× per-control (verdictable, all four cells clean).

### D15 verdict, honestly

Target: ≤ 1.0× `expo-ui-shared-host` and well below `expo-ui-host-per-control` on mount presented,
UI CPU and memory.

- **Memory: MISS on both platforms** — 1.36× iOS (reproduced exactly in two runs) and 1.48× Android,
  the only verdictable misses of this task. +45 KiB (iOS) / +43 KiB (Android) per instance over a
  shared host is the price of **one hosting controller / composition per control**, which is what
  every component in this library pays: Android's 130.9 KiB/instance is the library's existing
  per-host floor (Switch measured 128.9–134.2 KiB in T12). Android has **no window observer at all**,
  and a zero-frame `UIView` is on the order of 1 KiB rather than 45, so the iOS observer is not the
  explanation either. Still 0.57–0.76× of the per-control host. Follow-up below, not chased (D19).
- **Mount latency iOS: directionally MISS, mostly not verdictable.** 2.26–3.49× presented and
  1.70–2.13× UI CPU, but every one of those cells is noise-flagged and both nitro cells carry
  `presentedBeforeMount`, so the latency pair is probe-suspect. `mounted` is **not verdictable in
  either run** (F4b): run A's nitro cell carries `presentedBeforeMount=25`, and a cell with that
  marker gets no verdict; `mounted` is not a D15 target metric anyway. Cause is structural, not this
  component: N controls = N hosted views, while
  the shared-host arm pays one host for all 50.
- **Mount Android: ~parity or better than shared-host** (0.81× presented, 1.04× mounted, 1.14× UI
  CPU), none verdictable. Still 0.42× of per-control.
- **Update path: iOS wins** — mounted 0.53–0.54× shared-host (PASS, verdictable in run A), UI CPU
  0.80×. The **Android update cells are not comparable** and no factor is claimed for them (F4a):
  `update.progress:expo-ui-*` still declares `mountSignal: true` while only `rn-core` is in
  `NO_MOUNT_SIGNAL` (`bench/src/plan.ts`), so every measured iteration waits out `awaitMountNs(1500)`
  + `awaitPresentedNs(2000)` (`bench/src/probe.ts:41`, `:52`) **inside** the CPU bracket
  (`bench/src/runner.ts:66-68`, `:332-334`) — both expo cells report `missingMount=80`. Their
  59.9 / 70.7 ms UI CPU/op is spread over ≈3.5 s of wall time against nitro's ≈50 ms, and the two
  arms also draw different things (M3 expressive `LoadingIndicator` vs a linear bar). The fix is a
  follow-up below, so the Android update row is a record, not a result.
  JS commit is the one place nitro is worse
  than shared-host on Android (2.10×, and 4.76× `rn-core`) — still 0.94× of per-control and inside
  Fabric's own commit cost.
- **`rn-core` (`ActivityIndicator`)** stays the cheapest control by definition (one UIKit view, no
  host): nitro is 2.27× of it on iOS mount presented (3.50× in run A) and 1.26× on Android, and its
  update JS commit is 2.39× (iOS) / 4.76× (Android) — recorded, and not comparable in kind.

## Known issues / follow-ups

- Mint a `progress` bench baseline (and any component baseline) on a machine at load < 10 so the iOS mount latency cells become verdictable; the D15 memory miss (1.36× iOS / 1.48× Android vs shared-host) then needs a reviewer's call.
- Investigate the +43–45 KiB/instance memory gap vs `expo-ui-shared-host`. Start at the per-control hosting controller / composition (Android's number equals the library's existing per-host floor, and Android has no observer). The iOS window-observer `UIView` is a ≈1 KiB secondary check at best; the question worth asking there is whether one observer per process can serve many instances.
- Make the Android update cells comparable before any ratio is quoted from them: put `update.progress:expo-ui-*` in `NO_MOUNT_SIGNAL` (or move `awaitMountNs`/`awaitPresentedNs` out of the CPU bracket in `bench/src/runner.ts`), and give both arms the same indicator.
- Add a `progress` entry to the T15b real-input runner — not "one trivial render check": `scripts/real-input/controls.mjs` is input-only by contract, and its `screen` union, an iOS `testRealInput*` and an Android `CHECKS` entry (plus a fail-proof) all need a new *render-check* control kind on both platforms.
- `mounts many instances at once` is the one Progress test never driven red; a mutation that fails it (a sizing flush that drops part of a cold batch) is a core-side experiment, not a wrapper edit.
- The real-input suite's `screen` union should reject a non-interactive control loudly instead of type-erroring at the entry (noticed while adding nothing to it).
- iOS `trackColor` is a no-op by Apple's API surface; if a track colour ever matters, it costs a custom `ProgressViewStyle` — deliberately not in this round.
- The three load-bound tests that flaked mid-round (`Sizing › corrects a cold batch of 200`, `Sizing › lays a cold Switch out…`, `Slider › steps to the next legal value…`) are other tasks'; FIX2's report already records the first two classes.

## Questions for orchestrator

1. **Should the load-bound tests be gated at all on this shared machine?** Three of them went red at
   load ≈ 35 and green on retry, on a tree that does not touch their code. Options: (a) leave as is;
   (b) raise the ms bars by a factor when `HARNESS_TEST_TIMEOUT` is raised (they already key off
   nothing); (c) move them to a "quiet machine only" tag. I would pick (c) and keep the structural
   gates (`immediate` counts) everywhere.
