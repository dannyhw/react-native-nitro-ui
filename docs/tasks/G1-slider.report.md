# G1 — Slider — report

**Branch:** `task/G1-slider` (from `main` at `26d335f`)
**Final commit:** the tip of `task/G1-slider`; the commits are listed at the end of this file.

## Summary

A native Slider on the shared core: SwiftUI `Slider` on iOS, Material 3 `Slider`
on Android. `docs/components/slider.md` is the user-facing page; the interesting
work is in the four core fixes it forced (below) and in what "native owns the
displayed value" costs per frame.

- Spec, wrapper, both platform implementations, docs page, example screen.
- 21 device tests (`example/__tests__/Slider.harness.tsx`), green on iPhone 17
  (iOS 27) and `nitroui_t01` (Android 15/API 35); 54 tests total in each suite.
- Reassure render contract (`Slider.perf-test.tsx`), baseline 6, proven to fire.
- Bench: Slider arms for all four implementations plus a `--component` dimension,
  quick plan on both platforms.
- Screenshots in `docs/tasks/G1-slider/` (iOS + Android, light + dark).
- **Round 1 lives at the end of this file.** The review returned
  CHANGES-REQUIRED; every fix is in, and the Benchmarks section is rewritten —
  two verdicts quoted in round 1 are withdrawn there because the runner's own
  noise and signal rules never allowed them.

## What the first `fillWidth` component broke in the core

Switch is `intrinsic`: it asks "how big do you want to be?" and Yoga obeys. A
Slider is `fillWidth`: its width belongs to the parent and only its height is its
own. Nothing in the core had ever been asked that question, and four places
answered it wrongly — the fourth only revealed itself in a screenshot, after
every test was green. Each fix is backwards-compatible (Switch asks the same
question as before, verified by Switch's own suites staying green).

1. **`cpp/NitroUiSizingEngine.cpp` — a report's width is not a change.**
   The engine compares a native report with what the node was laid out at. For
   `fillWidth` the width half of that pair belongs to the parent, so two Sliders
   of *one* configuration in boxes of 300 and 200 disagreed with each other: 2
   corrections, and each correction rewrote the cache with its own box width, so
   the cache ended up answering 200 to a control that had only ever been 300 wide.
   `sameSizeForPush` now ignores the width for exactly that policy. This is what
   D17's "warm means exact on the first frame, for every instance" actually
   requires.
2. **`ios/core/NitroSwiftUIHost.swift` — the proposal is per policy.**
   `sizeThatFits` was proposed an unbounded size for both policies. A `fillWidth`
   control must be proposed the box's width with unbounded height (what height at
   *that* width?); SwiftUI answers a width-unbounded Slider with **width 0**.
   `fittingSizeProposal` now branches, and `refreshContentSize()` refuses to run
   the `fillWidth` measure before the box has a width, where a proposal of 0 is
   not the box.
4. **`ios/core/NitroSwiftUIHost.swift` — a box with no height must still be measured.**
   The gate first shipped as `!bounds.isEmpty`, which refuses the wrong half of
   the box: a cold first `fillWidth` instance legitimately *is* 0 tall, and its
   report is the thing that gives the box a height. Refusing there is a closed
   loop, and on iOS it rendered a whole screen of thumbs with no tracks. Android's
   measure was never gated on height, so Android was right from the start.
3. **`android/.../core/NitroComposeHost.kt` — a wrong height may not confirm itself.**
   `NitroUiMeasuredRoot` kept the incoming `maxHeight` for `fillWidth`. A box that
   is temporarily the wrong height (the fallback, a stale cache, a correction in
   flight) clamped the answer to itself: the report agreed with the layout, so the
   engine was never told and never corrected. A 12 dp seed stayed 12 dp forever,
   and that is what was hiding the control's real 48 dp. The height maximum now
   goes for the same reason the width minimum goes.

`docs/architecture/sizing.md` §4/§5 and `docs/architecture/core.md` §3/§11 were
wrong or silent about all of this — see "Guide fixes" below.

## Files

**New**

- `ios/components/Slider/HybridNitroUiSlider.swift`, `NitroUiSliderValue.swift`
- `android/.../nitroui/HybridNitroUiSlider.kt`, `NitroUiSliderValue.kt`,
  `android/src/test/.../NitroUiSliderValueTest.kt`
- `scripts/native-tests/slider-value.test.swift`
- `example/__tests__/Slider.harness.tsx`, `example/src/SliderScreen.tsx`
- `src/components/Slider/Slider.perf-test.tsx`
- `docs/components/slider.md`, `docs/tasks/G1-slider/*.png`

**Changed**

- `cpp/NitroUiSizingEngine.cpp`, `ios/core/NitroSwiftUIHost.swift`,
  `android/.../core/NitroComposeHost.kt` — the three fixes above
- `android/.../NitroUiPackage.kt`, `scripts/native-tests.sh`, `scripts/smoke/App.tsx`,
  `example/src/App.tsx` — registration / wiring
- `scripts/native-tests/sizing.test.cpp` — `fillWidth` engine tests
- `bench/src/*`, `scripts/bench/{lib,run,render}.mjs`, `bench/baselines/renders.json`
  — the component dimension + render baseline
- `docs/architecture/{sizing,core,benchmarks}.md`, `etc/*.md`, `etc/package-files.txt`

## Design decisions

- **Coalescing is native, on the frame tick.** Samples accumulate in one
  `pending` slot; a `CADisplayLink` tick (iOS) / `Choreographer` frame callback
  (Android) emits the newest. The pump only runs while a drag has something to
  report. On iOS the `objectWillChange.send()` rides the *same* tick as the emit,
  not the `Binding` setter: the model write is what the control itself renders,
  while `send()` re-evaluates the whole hosted body, and per-sample sends are
  exactly what core.md §11 warns about.
- **`displayed` is written when the finger moves, not when the event is
  delivered**, so the thumb is under the finger with no extra frame of latency —
  and the quantised value, not the raw float that came out of Material's control,
  is what the next recomposition reads back.
- **Value rules in one file per platform, one set of test vectors**
  (`NitroUiSliderValue`): clamp → snap → round to 15 significant digits. The
  rounding is load-bearing: Material's control is `Float`, so without it native
  holds `0.30000000000000004` where React holds `0.3`, the handshake's exact
  comparison sees a change on every commit, and the thumb is yanked out from under
  the finger. Both native test suites assert the same vectors.
- **Stepped mode is chosen from the range, not from `step != 0`.** SwiftUI's
  `step:` and M3's `steps` can only draw a range whose top is one of their stops;
  otherwise both use the continuous control and native quantises, which keeps the
  maximum reachable (`maximumValue={10} step={3}` can reach 10).
- **The range is interpreted in `afterUpdate()`, never in a setter.** Nitro does
  not order props inside a batch. A `Switch` hides this because a `Bool` has
  nothing to normalise against; anything numeric does not.
- **`beginDrag()` is idempotent.** `onEditingChanged(true)` and the first
  `Binding` write have no defined order, and a tap that jumps the thumb writes
  before it says editing started. Whoever arrives first opens the drag once. On
  Compose the first value change does that job (there is no start callback).
- **Both gesture callbacks are always installed** (`NO_SLIDE_HANDLER`), for D7b
  (a callback prop must never become `null` mid-mount) and because
  `useStableCallback`'s identity changes when a handler appears or disappears.
- **`fillWidth` base style is `alignSelf: 'stretch'`** — the opposite of Switch's
  `'flex-start'`, for the same reason in reverse: the cross axis is the axis this
  control wants filled, and `alignSelf` is the only thing that decides it.
- **`nuiSizingKey` is `""`.** No prop changes a Slider's height, so there is one
  configuration and one cached height per process, which is what makes
  `prewarm(['NitroUiSlider'])` able to warm the whole component.

## Gate results

Commands and results, all on the final tree.

| Gate | Command | Result |
| ---- | ------- | ------ |
| Everything | `bun run check` | PASS (typecheck, bench typecheck ×2, lint, format, 111 Jest tests, `test:native`, `perf:renders`, nitrogen drift, autolinking, bob build, api-extractor, publint, manifest) |
| Native unit | `bun run test:native` | PASS — 177 C++ checks + the Swift `NitroUiSliderValue` vectors, ASan/UBSan |
| JVM | `bun run test:native:android` | PASS — 14 tests, 2 of them the Slider quantising vectors |
| iOS device | `HARNESS_APP_PATH=… IOS_SIM_UDID=F08675D3… METRO_PORT=8293 bunx react-native-harness --harnessRunner ios` | PASS — 51 tests (33 Switch/Sizing/App + 18 Slider) |
| Android device | `… ANDROID_AVD=nitroui_t01 ANDROID_ADB_SERVER_PORT=5041 … --harnessRunner android` | PASS — 51 tests |
| Render gate | `bun run perf:renders` | PASS — Slider 6, Switch 6, no redundant commits, no post-mount render |

Harness commands (the artifact paths matter — see "Environment gotchas"):

```sh
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$ANDROID_HOME/platform-tools:$HOME/.bun/bin:$PATH
cd example

# iOS - note -derivedDataPath build, NOT `bun run build:ios`
(cd ios && xcodebuild -workspace NitroUiExample.xcworkspace -scheme NitroUiExample \
  -configuration Debug -sdk iphonesimulator -derivedDataPath build build)
HARNESS_APP_PATH="$PWD/ios/build/Build/Products/Debug-iphonesimulator/NitroUiExample.app" \
  IOS_SIM_UDID=F08675D3-A32B-4F88-BC81-02D7E0CB797E METRO_PORT=8293 \
  bunx react-native-harness --harnessRunner ios

# Android - note assembleDebug, NOT `bun run build:android` (that makes an .aab)
(cd android && ./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a)
HARNESS_APP_PATH="$PWD/android/app/build/outputs/apk/debug/app-debug.apk" \
  ANDROID_AVD=nitroui_t01 ANDROID_ADB_SERVER_PORT=5041 METRO_PORT=8293 \
  bunx react-native-harness --harnessRunner android
```

## Every new test and gate shown to fail

AGENTS.md requires it, so each mutation was applied, the gate run, and the
mutation reverted (all still in this branch's history as passing tests).

| Gate | Mutation | Red result |
| ---- | -------- | ---------- |
| C++ `sameSizeForPush` | compare the width for `fillWidth` too | `7 of 177 checks FAILED` — `the 200-wide Slider's report is not a change either`, `a third Slider reads an answer, not the last box (got 200x40, want 300x40)` |
| Swift `NitroUiSliderValue.quantize` | `.rounded(.down)` | 6 checks FAIL — `0.36 snaps up to 0.4 (got 0.3)`, `a tie goes up` → `test:native: FAIL` |
| Kotlin `NitroUiSliderValue.quantize` | `round(x - 0.5)` | `14 tests completed, 2 failed` → BUILD FAILED |
| `viewConfigs.test.ts` | drop `step: true` from `NitroUiSliderConfig.ts` | `● hand-written view configs › NitroUiSliderConfig.json matches nitrogen output`, 1 failed |
| `api-extractor:check` | delete the `export function Slider…` line from `etc/react-native-nitro-ui.api.md` | exit 1 — "You have changed the API signature" |
| `manifest:check` | (natural) new files not yet in `etc/package-files.txt` | `48 added, 0 removed` → exit 1, then `manifest:update` |
| `perf:renders` | a `useEffect` in the wrapper that set state on `value` | `Slider … \| 6 \| 10 \| mount+1 redundant[3,5,7] \| CHANGED (+4)` while Switch stayed `ok` |
| harness height assertion | `EXPECTED_HEIGHT` 31 → 34 on iOS | `slider size: box=300.00x31.00 measured=300.00x31.00 expectedHeight=34` → `expected 3 to be less than 1` |
| harness height-vs-width | iOS `fittingSizeProposal` proposes `.infinity` width again | `height vs width: wide=300.00x31.00/0.00x31.00 narrow=180.00x31.00/0.00x31.00` → `expected 180 to be less than 1` |
| iOS coalescer | emit per sample in `drag(to:)` | `coalesce: same-turn moves=8 events=8` → `expected 8 to be 1` |
| iOS handshake | `if false && model.state.reconcile()` | `expected [ +0, 0.8 ] to deeply equal [ 0.2, 0.2 ]` |
| Android measure constraints | drop `maxHeight = Infinity` | `poison: guess=200x12 box=300.19x12.19 measured=300.19x12.19 corrections=1` → `expected 35.8 to be less than 1` |
| iOS `fillWidth` measure gate | restore the shipped `boundsIndependent \|\| !bounds.isEmpty` (refuse an *empty box*) | iOS: `● Slider › answers its own height even when the box has none` → `a box with no height stopped the control measuring (last=0.00x0.00)`; **Android passed the same test unchanged**, which is what proved the bug iOS-only |

This last one was re-run on the final tree rather than taken on trust: with the
mutation restored the Slider suite is `1 failed, 17 passed, 18 total` — exactly
the new test — and reverting it returns iOS to `51 passed, 51 total` (3 suites)
and Android to `51 passed, 51 total` (3 suites). Android needed no rebuild for
it: the mutation was iOS-only, and the test is JS, so the same APK answered both
ways — which is also how the bug was shown to be platform-specific rather than a
shared-protocol mistake.

Two honest notes:

- The **Android half** of "a box height cannot contaminate the measure" is the
  mutation that proves it (the 12 dp case above). The same mutation on iOS —
  proposing the box *height* instead of unbounded — does **not** fail: SwiftUI's
  `sizeThatFits` ignores a bounded height proposal for this control and answers 31
  anyway. The assertion is therefore live on Android and a tautology on iOS today.
- The **iOS width-proposal mutation** above also fails the original
  `hosts a control, fills the box…` test, which is where it was first proven.

## What the screenshots caught that 51 tests did not

The harness was green on both platforms before a single pixel was looked at. The
screenshots were not green.

**iOS drew thumbs with no tracks.** On the example screen every full-width Slider
rendered as a ~28 pt thumb at the origin — and the *same* screen's explicitly
sized `180 × 60` Slider rendered correctly, which is what made it look like a
styling bug rather than a layout one. `clipsToBounds` is false, so the leftover
SwiftUI minimum content overflowed into the rows above and below. Android drew
everything correctly, which made the shared JS, the shared protocol and the
shared sizing engine innocent by comparison.

On-device probes (a throwaway harness screen, since deleted) pinned it: **with** a
warm-up mount beforehand — exactly what the harness' `beforeAll` does — every
container shape measured (300×31, 370×31, 402×31). **Without** one, the first
hosted control of the whole process measured `0×0` and stayed there: its box was
`…×0`, because a `fillWidth` control's height starts unknown and the fallback that
should cover the first frame is registered by the component's first *view*, which
Fabric creates only after that node's first measure. And iOS gated the
`fillWidth` measure on `!bounds.isEmpty`, so: no height → no measure → no report
→ no height. A closed loop, and the sizing engine never got to run.

The fix is one term — gate on the box's **width**, never its height
(`ios/core/NitroSwiftUIHost.swift:356`) — because the width is the input the
control may not invent and the height is the answer it exists to give. `intrinsic`
controls never read the proposal, so Switch is untouched. The behaviour is now
asserted (`answers its own height even when the box has none`),
`docs/architecture/sizing.md` §5 says width where it used to say "empty bounds",
and the residual first-frame artifact — the first instance of a configuration is
still laid out at height 0 once before it corrects — is put to the orchestrator
below rather than quietly fixed: fixing it properly means registering a
component's fallback at registration time, which is not a minimal core change.

**Why the tests missed it**: `example/__tests__/Sizing.harness.tsx`'s `beforeAll`
mounts a Switch, and Switch is `intrinsic` — the warm-up turned the first
`fillWidth` mount into a *second* host, which is the case that always worked. A
suite-local warm-up hid a process-local bug. Worth knowing before the next suite
is written.

**A second lesson from the same fix**, learned the hard way: the first draft of
the new test rendered two trees in one test and measured both. It passed on iOS
and timed out on Android — once a second `render()` happens inside one Android
test, the *first* control's host answers `measureContent()` with `0×0` for as long
as the test lives, while iOS keeps both trees alive. `Sizing.harness.tsx` renders
one tree at a time and unmounts between measurements; the Slider suite now does
the same (`answers its own height at any width…` measures wide, unmounts, then
measures narrow), with the reason in the comments.

## Benchmarks

Device: iPhone 17 simulator (iOS 27) and `nitroui_t01` (Android 15, API 35).
Plan `quick`, 4 launches, 5 warmup + 20 measured iterations, release builds, no
Metro. D15: iOS on iPhone 17 is canonical. Both runs are in `bench/results/`
(gitignored; the file names are quoted so a reviewer can re-run and diff).

**Round 1 re-ran both platforms** and this section is what came out. The tables
the review saw are withdrawn, for two separate reasons:

- the iOS table was `efba374-dirty-ios-20261023T064108Z.md`, a tree from *before*
  `2825825` (the `fillWidth` measure fix this branch later landed), so it
  measured code the branch no longer has;
- the first round-1 iOS re-run, `7b6015e-ios-20261023T094459Z.md`, measured a
  stale bundle: the runner *reused* a `main.jsbundle` three and a half hours
  older than `bench/src/plan.ts`, so it never saw `mountSignal` and burned ~95 s
  per launch waiting for a signal the cell had stopped asking for. 633 s of
  numbers about a build that was not the one under test. That is fixed in
  `8812717` (the artifact's freshness test now checks the bundle, not the
  `.app` directory's mtime, and `--skip-build` refuses a stale bundle outright);
  it is also why the D15 reading below is stricter than the one in round 1 — the
  rig was quietly capable of publishing numbers for the wrong tree.

Nothing from the old tables survives into the verdicts. Both new runs are the
merged tree, post-T12 (Android's immediate sizing budget is 1, and the Compose
host T12 optimised is in the baseline I compare against), with Android primed
per D18. D15 also says a component's *first* `nitro-ui` arm never blocks, so
what follows is a recorded baseline plus the misses it contains.

### iOS — canonical

`f5c0450-ios-20261023T100532Z.md`: iPhone 17 (iOS 27), 263 s, machine load
3.36 / 5.15. The file name records `f5c0450`, the pre-rebase SHA of the tree it
measured — the round-1 commits section has the map.

| Cell                | arm                      | presented | mounted  | JS commit | JS CPU/op | UI CPU/op | bytes/inst |
| ------------------- | ------------------------ | --------- | -------- | --------- | --------- | --------- | ---------- |
| mount.slider N=50   | rn-core                  | 16.01 ms  | 1.31 ms  | 604.84 us | 1.23 ms   | 1.15 ms   | n/a        |
| mount.slider N=50   | expo-ui-host-per-control | 41.12 ms  | 17.05 ms | 2.07 ms   | 2.44 ms   | 47.84 ms  | n/a        |
| mount.slider N=50   | expo-ui-shared-host      | 45.35 ms  | 5.16 ms  | 1.08 ms   | 1.34 ms   | 26.78 ms  | n/a        |
| mount.slider N=50   | nitro-ui                 | 16.04 ms  | 24.08 ms | 1.44 ms   | 1.64 ms   | 22.68 ms  | n/a        |
| update.slider N=50  | rn-core                  | n/a       | n/a      | 294.17 us | 304.27 us | 675 ns    | n/a        |
| update.slider N=50  | expo-ui-host-per-control | 16.12 ms  | 3.72 ms  | 1.62 ms   | 1.74 ms   | 13.22 ms  | n/a        |
| update.slider N=50  | expo-ui-shared-host      | 16.11 ms  | 3.08 ms  | 874.45 us | 1.01 ms   | 10.81 ms  | n/a        |
| update.slider N=50  | nitro-ui                 | 16.13 ms  | 1.68 ms  | 987.89 us | 1.10 ms   | 7.56 ms   | n/a        |
| memory.slider N=200 | rn-core                  | n/a       | n/a      | n/a       | n/a       | n/a       | 6.6 KiB    |
| memory.slider N=200 | expo-ui-host-per-control | n/a       | n/a      | n/a       | n/a       | n/a       | 298.0 KiB  |
| memory.slider N=200 | expo-ui-shared-host      | n/a       | n/a      | n/a       | n/a       | n/a       | 178.0 KiB  |
| memory.slider N=200 | nitro-ui                 | n/a       | n/a      | n/a       | n/a       | n/a       | 258.4 KiB  |

**The D15 verdict**, built only from cells the runner's own rules let carry one
— no verdict on a metric whose within-run spread is above 10 %, and no verdict
for `presented` where `presentedBeforeMount` is high:

| D15 axis            | nitro ÷ shared-host | nitro ÷ host-per-control | verdict                                                    |
| ------------------- | ------------------- | ------------------------ | ---------------------------------------------------------- |
| update `presented`  | 1.00×               | 1.00×                    | **meets**                                                  |
| update `mounted`    | 0.55×               | 0.45×                    | **meets**, and well below host-per-control                 |
| memory `bytes/inst` | 1.45×               | 0.87×                    | **misses** shared-host — the only quiet axis on iOS        |
| mount `presented`   | 0.35×               | 0.39×                    | **no verdict** — the probe is broken for this cell         |
| mount `mounted`     | 4.67×               | 1.41×                    | no verdict (spread), but a **real cost**, see below        |
| mount `UI CPU/op`   | 0.85×               | 0.47×                    | no verdict (spread) — reported, not adjudicated            |
| mount `JS commit`   | 1.33×               | 0.70×                    | no verdict (spread 19.1 / 18.6 / 11.8 %)                   |
| mount `JS CPU/op`   | 1.22×               | 0.67×                    | no verdict (spread 37.4 / 36.2 / 36.1 %)                   |
| update `UI CPU/op`  | 0.70×               | 0.57×                    | no verdict (spread 22.1 / 19.7 / 18.8 %)                   |
| update `JS commit`  | 1.13×               | 0.61×                    | no verdict (spread 32.6 / 37.7 / 37.4 %)                   |

Withdrawing two claims from round 1, both of which were built on cells the
runner had already flagged: mount `presented` **0.99× "meets"** and mount
`UI CPU/op` **0.96× "meets"**. Neither can be made from these numbers.

Why mount `presented` gets no verdict, stated as precisely as the rig allows:
the runner prints `presentedBeforeMount=76` for the `nitro-ui` mount cell — 76
of 80 presentation stamps land *before* the mount signal — so for that arm the
latency pair is not measuring what D15 needs. The `--perf-marks` run
(`f5c0450-ios-20261023T102315Z-marks.md`, 64 s, load 4.40 / 4.83) says why:
`mounted` is 23.54 ms, and a mount that outlasts a frame is precisely the case
where "first `CADisplayLink` tick after the mount" stops being a cost — it
stamps an earlier vsync than the work. Its `presentedNs` there is 15.92 ms
median with a **32.81 ms p95**: about a tenth of the samples need a second
frame. The two expo arms are no better as evidence: their `presented` moved
16.16 → 45.35 ms (shared-host) and 16.15 → 41.12 ms (per-control) between runs
of code that did not change, which is a frame-boundary coin flip, not a
1.4× cost either way. A 0.35× ratio built from those is not a win to bank and
I am not banking it. **iOS mount `presented` cannot adjudicate a mount longer
than one frame; that is a rig gap, recorded as a follow-up.**

`mounted` is a real cost, not an artifact. 24.08 ms for 50 controls is
~0.47 ms per control, and it is 1.41× **`expo-ui-host-per-control`** as well as
4.67× shared-host — the round-1 text leaned on the shared-host comparison and
let the flattering reading of "the metric favours the wrong arm" stand. Both
ratios are here now. The spread rule still denies it a verdict (nitro 13.6 %,
shared-host 16.6 %), so it is stated as a measurement and a miss-shaped cost,
with the same `--perf-marks` support as before: `propsApplied/op = 50` at 1.00
per instance and `firstFrame/op = 50` (nothing applied twice, every instance
draws), props landed 22.68 ms, `props → draw` 161.71 µs. `expo-ui-shared-host`
is one node whose signal fires at 5.16 ms and builds 200 views afterwards, so
the 4.67× is partly what the mount signal counts. The 1.41× against
host-per-control is not explainable that way: same one-host-per-control idea,
less time. That goes to the follow-up already recorded in `docs/tasks/FOLLOWUPS.md`.

Memory is the one axis iOS measures quietly, and the Slider misses it:
258.4 KiB/instance vs 178.0 KiB (39.05× the 6.6 KiB floor, 0.87× the 298.0 KiB
per-control arm). One hosting view, one Nitro host object, one props buffer and
one Fabric node per control, where the shared host amortises all four across the
batch. Accepted for 0.1 and recorded in `docs/tasks/FOLLOWUPS.md`.

One reporting artifact of the `mountSignal: false` flag, so nobody reads it as a
result: with the floor no longer sitting in mount-signal timeouts during
`update.slider`, its `UI CPU/op` is 675 ns instead of the 17.88 ms the old run
printed — the floor draws nothing. So the runner's launch-paired ratio column
for that row prints 3 425×–15 946× and means only "arbitrary work over zero".
Read the absolute table on the update row; the ratios there are not comparisons.

### Android — primed, and carrying verdicts

`7b6015e-android-20261023T095647Z.md`: `nitroui_t01` (Android 15, API 35), ART
`speed-profile` for `com.nitroui.bench` (1 attempt, per D18), 206 s, machine load
6.44 / 6.67. Recorded by the runner as `ART: speed-profile`, so the priming is
part of the artifact and not a footnote. This is the merged tree, so the Compose
host in the baseline is T12's. I changed nothing in it.

| Cell                | arm                      | presented | mounted  | JS commit | JS CPU/op | UI CPU/op | bytes/inst |
| ------------------- | ------------------------ | --------- | -------- | --------- | --------- | --------- | ---------- |
| mount.slider N=50   | rn-core                  | 32.66 ms  | 16.84 ms | 872.14 us | 1.28 ms   | 1.90 ms   | n/a        |
| mount.slider N=50   | expo-ui-host-per-control | 36.70 ms  | 27.59 ms | 7.67 ms   | 8.44 ms   | 18.15 ms  | n/a        |
| mount.slider N=50   | expo-ui-shared-host      | 32.56 ms  | 21.10 ms | 1.53 ms   | 2.08 ms   | 6.92 ms   | n/a        |
| mount.slider N=50   | nitro-ui                 | 32.74 ms  | 24.81 ms | 1.78 ms   | 2.31 ms   | 10.78 ms  | n/a        |
| update.slider N=50  | rn-core                  | n/a       | n/a      | 365.63 us | 437.12 us | n/a       | n/a        |
| update.slider N=50  | expo-ui-host-per-control | 47.45 ms  | 14.51 ms | 2.64 ms   | 2.86 ms   | 6.16 ms   | n/a        |
| update.slider N=50  | expo-ui-shared-host      | 47.79 ms  | 15.52 ms | 1.29 ms   | 1.81 ms   | 3.87 ms   | n/a        |
| update.slider N=50  | nitro-ui                 | 48.78 ms  | 16.69 ms | 1.22 ms   | 1.77 ms   | 4.86 ms   | n/a        |
| memory.slider N=200 | rn-core                  | n/a       | n/a      | n/a       | n/a       | n/a       | 15.0 KiB   |
| memory.slider N=200 | expo-ui-host-per-control | n/a       | n/a      | n/a       | n/a       | n/a       | 198.8 KiB  |
| memory.slider N=200 | expo-ui-shared-host      | n/a       | n/a      | n/a       | n/a       | n/a       | 61.6 KiB   |
| memory.slider N=200 | nitro-ui                 | n/a       | n/a      | n/a       | n/a       | n/a       | 139.0 KiB  |

Priming is why this table can adjudicate at all: the only metric the runner
flags above 10 % spread is `UI CPU/unmount` (per-control 10.2 %, nitro 23.5 %),
so every mount and update axis except unmount carries a verdict.

| D15 axis            | nitro ÷ shared-host | nitro ÷ host-per-control | verdict                                          |
| ------------------- | ------------------- | ------------------------ | ------------------------------------------------ |
| mount `presented`   | 1.01×               | 0.89×                    | level (1.00× the floor); strictly above ≤ 1.0×   |
| mount `JS commit`   | 1.16×               | 0.23×                    | above shared, far below per-control              |
| mount `JS CPU/op`   | 1.11×               | 0.27×                    | same shape                                       |
| mount `mounted`     | 1.18×               | 0.90×                    | **misses** shared-host                           |
| mount `UI CPU/op`   | 1.56×               | 0.59×                    | **misses** shared-host, well below per-control   |
| memory `bytes/inst` | 2.26×               | 0.70×                    | **misses** shared-host                           |
| update `presented`  | 1.02×               | 1.03×                    | level                                            |
| update `mounted`    | 1.08×               | 1.15×                    | misses both                                      |
| update `UI CPU/op`  | 1.26×               | 0.79×                    | misses shared-host                               |
| update `JS commit`  | 0.95×               | 0.46×                    | **meets** shared-host                            |

`mount presented` at 1.01× is 0.18 ms on a metric quantised to a vsync, and the
same 1.00× as the `rn-core` floor, so "level with the shared host" is the honest
reading — but the D15 bar is ≤ 1.0× and 1.01× is above it. Not claimed as a
meet.

What D18 changed, which is the useful part of re-running: against the pre-T12,
ART-`verify` run (`efba374-dirty-android-20261023T063022Z.md`, which the
round-1 report itself labelled not comparable) the ratios were presented 1.20×,
`mounted` 1.19×, `UI CPU/op` 1.44×, memory 2.16×. Priming took `presented` from
1.20× to 1.01× — that gap was largely an ART artifact — while `mounted` (1.19× →
1.18×) and memory (2.16× → 2.26×) reproduce. So the shape that is left is
architectural, not warm-up: the Slider costs the Compose host more UI CPU and
more memory per control than the shared host does, and T12's host does not
change that. The per-control comparisons stay favourable throughout (0.23× JS
commit, 0.59× UI CPU, 0.70× memory).

Floors are not comparable across platforms, per the runner's own note: Android's
`rn-core` floor costs 15.0 KiB/instance against iOS's 6.6 KiB, so the 9.3× and
39.05× ratios to floor describe the floors, not the components. Compare arms.

### What the bench harness gained here

- `--component slider` picks the component dimension, and `componentOf()` maps a
  cell to its arms, so `mount.slider` / `update.slider` / `memory.slider` run as
  one unit (`bench/`).
- The guide now records that a cell can lack a mount signal, and that such a
  cell's floor ratios are to be read as re-layout cost only.
- A cell may now *declare* that: `mountSignal: false` in `plan.ts` stops the
  runner waiting ~1.5 s per iteration for a signal a bare `View` cannot send
  (~95 s per launch), and its records are labelled `absent by construction`
  instead of `missingMount=80 - treat this cell's latency pair with care`.
  Asked as question 4, approved, done here (`272e471`).
- `locateArtifact('ios')` now proves the artifact is fresh — the bundle inside
  it, not the `.app` directory's mtime — because a green `--skip-build` had
  reused a three-and-a-half-hour-old bundle (`8812717`).

## Screenshots

`docs/tasks/G1-slider/ios-light.png`, `ios-dark.png`, `android-light.png`,
`android-dark.png` — the example `SliderScreen` in both appearances on both
platforms, captured with the app on Metro (`METRO_PORT=8293`) and
`DEFAULT_SCREEN` pointed at the Slider tab for the capture.

They are four *re-shot* files. The first pass at them is what caught the iOS
sizing bug above, and after the fix every one was captured again.

Getting the dev LogBox banner out of the frame (T10's convention) took two
different mechanisms, which is worth recording:

- iOS: a temporary `LogBox.ignoreAllLogs(true)` at the top of `example/index.js`
  for the capture, reverted afterwards (`example/index.js` is untouched on this
  branch — verified with `git status`).
- Android: the banner is RN's native Dev Surface overlay and ignores that JS
  call, so it was tapped away using its bounds from `uiautomator dump`, then
  verified absent in a second dump before each capture. It stayed gone across the
  light→dark configuration change.

What the banner *says* is still unknown, and that is admitted rather than
glossed: the `/tmp/logbox.png` left by an earlier attempt in this task is not the
warning list — it is a red `Unable to load script.` box from a launch made before
`adb reverse` was in place — and the warning never appeared in `logcat`. It is a
dev-build artifact, and the text is React Native's own group label for
warning-level logs — `content: 'Open debugger to view warnings.'`,
`node_modules/react-native/Libraries/LogBox/Data/LogBoxData.js` — not a string
this repository produces. `T10-core-switch.report.md` records the same banner on
the Switch screen ("a dev-mode overlay, so it was dismissed before capture"), so
it predates this task; which warning(s) sat behind it is what this task never
managed to read.

## Environment gotchas (both cost real time; both now documented)

1. **`bun run build:ios` builds into Xcode's `DerivedData`, but the harness
   installs `example/ios/build/Build/Products/Debug-iphonesimulator/NitroUiExample.app`.**
   A green run can therefore be testing an hours-old binary; one of mine was. Use
   `xcodebuild … -derivedDataPath build build` (the T10 convention) and check the
   artifact is newer than the newest source before trusting a result. In Debug the
   JS comes from Metro, so only the native side is affected — which is exactly the
   half this library is about.
2. **`bun run build:android` produces an `.aab`; the harness needs an APK.** Use
   `./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a`
   (`app/build/outputs/apk/debug/app-debug.apk`), ~15 s incremental.

Both belong in the harness/build docs, not just here — see Guide fixes.

## Guide fixes (this is the first component after Switch, so the guide was thin)

`docs/architecture/sizing.md`

- §4: the "a warm configuration costs nothing" promise was untested **and false**
  for `fillWidth`; the section now says which half of a size a report may disagree
  about, and what a `fillWidth` cache entry really stores (only the height is the
  control's answer; the width is a restatement of the last box).
- §5: `fillWidth` changes the **question** the host asks the toolkit — box width,
  unbounded height — on *both* platforms, with the two failure modes named
  (SwiftUI answering 0 wide; a Compose `maxHeight` letting a wrong height confirm
  itself). Also: a `fillWidth` control whose height depends on its width must put
  the width in its `nuiSizingKey`, and the base style is per policy
  (`'stretch'` vs `'flex-start'`), not one constant.
- §5 said the `fillWidth` measure "must not run on empty bounds", which the first
  `fillWidth` component proved is the wrong rule: it must not run without a
  **width**, and must run whatever the height is. Rewritten to say which half of
  the box gates the measure and why the other half must never do it, with the
  deadlock and the iOS symptom spelled out.

`docs/architecture/core.md`

- §3: **Nitro does not order props inside a batch.** A numeric prop that must be
  interpreted against other props is stored raw and interpreted in
  `afterUpdate()`. Switch's `defaultValue`-in-setter is the special case that hides
  this, not the pattern.
- §11: for a continuous control the `objectWillChange` send belongs on the frame
  tick with the emit, not in the `Binding` setter.
- §11: a drag start has two candidates with no defined order, so it has to be
  idempotent and called from both.
- §11: quantising must also *tidy* (15 significant digits) before the handshake's
  exact comparison, and why Material's `Float` control makes that mandatory.

`docs/architecture/benchmarks.md`

- The scenario cell now carries a component (`mount.slider`, …) with bare names
  meaning the first component, `componentOf` as the one reader, and `--component`
  as the filter; the "equivalent work" rule gained the **floor** case: when RN
  core has no such control, `rn-core` is a floor rather than a peer, and a floor
  that changes nothing produces no mount signal in an `update` cell (`N without a
  mount signal` in the log is expected, and makes that cell's latency pair
  unreportable by construction).

Harness/tooling (reported rather than fixed here, since they are upstream):

- The label oracle cannot see Compose semantics:
  `@react-native-harness/ui`'s `ViewQueryHelper.viewMatches` matches
  `View.contentDescription`, while M3's `Slider` publishes its label and its
  increase/decrease actions in the `SemanticsNode` tree. There is no honest way to
  assert "TalkBack can find this control" from the View tree today.
- `screen.screenshot(element)` still reports `0×0` for an element target (T10's H4),
  so screenshots are full-screen.
- Two live `render()` trees in one test are a trap, not a style choice: on Android
  the first control's host stops answering `measureContent()` (`0×0`) while a
  second tree is mounted, and iOS keeps both alive — so such a test is green on
  iOS and times out on Android. The convention (`Sizing.harness.tsx`, now also
  `Slider.harness.tsx`) is one tree per test, unmount between measurements; the
  asymmetry is upstream and worth a harness issue.
- A suite-local `beforeAll` warm-up can hide a process-local bug: `beforeAll`
  mounts a Switch, so the "first `fillWidth` mount in the process" case never
  appeared in any test while it was broken on device. Worth a cold-process test
  in the sizing suite (T11's territory).

## Known issues / follow-ups

- **Android a11y: the label is still asserted at View level.** The step is not
  — round 1 drives the real Compose a11y action and asserts the value it lands
  on, which is the assertion that mattered (`1e1cc2d`). A Compose-semantics query
  in `react-native-harness` would still be the right home for the label.
- **`rn-core`'s slider floor** is a bare `View` (RN removed `Slider` in 0.80), so
  `update.slider:rn-core` emits no mount signal and its native-latency ratio is
  `n/a`. A `@react-native-community/slider` arm would be a *peer*, not a floor —
  worth adding if someone wants that comparison.
- The per-OS fallback for iOS below 26 is a measured 31 pt carried across all
  runtimes (D8: no older runtime on this machine). A `fillWidth` control corrects
  its own height on the first layout, so the cost is one stale frame, not a wrong
  layout — but CI on an iOS 18 runner would settle it. Answered in round 1:
  follow-up, recorded in `docs/tasks/FOLLOWUPS.md`.
- `OptionalTint` / `OptionalAccessibility` are now copied a second time (Switch,
  then Slider). Promote them to `ios/core/` when a third component needs them.
- ~~The bench runner spends ~1.5 s per iteration in `update.slider:rn-core`
  waiting for a mount signal that cannot arrive.~~ Done in round 1: cells declare
  `mountSignal: false` (`272e471`).
- The first instance of a `fillWidth` configuration in a process is still laid
  out at height 0 once and corrected on the next turn. The deadlock is gone
  (measure no longer waits for a height); the one-frame artifact is a different
  fix, registered-fallback rather than measure-gating — see the question below.
- The example debug build carries a LogBox warning banner whose text this task
  never captured (Screenshots section). iOS suppresses it with
  `LogBox.ignoreAllLogs`; on Android the same JS call does nothing, and
  `uiautomator` shows the banner as native views rather than React views, so it
  is drawn by the native dev surface. Anyone automating Android screenshots
  needs the tap-away.
- T11's `Sizing › corrects a cold batch of 200` bound (`flushMs < mountedIn * 0.1`)
  overshot once on a loaded machine (21.08 vs 20.24) and passes in isolation. It
  is pre-existing and load-sensitive, not Slider-specific; noted for whoever
  touches that test.

## Questions for orchestrator

1. **iOS below 26 is unmeasured.** The declared fallback is the measured 31 pt
   carried across every runtime, because D8 means this machine has no runtime
   older than 26.4. A `fillWidth` control corrects its own height on the first
   layout, so the worst case is one stale frame — but that is reasoned, not
   observed. Want an iOS 18 runner in CI (or a one-off run on an older runtime)
   before G3+ ship `fillWidth` controls with copied fallbacks?
2. **Android a11y is asserted as weakly as it can honestly be.** The harness can
   only see the View tree; M3's `Slider` publishes its label and its
   increment/decrement actions in the Compose `SemanticsNode` tree, which is not
   reachable today. Upstream a Compose-semantics query into
   `react-native-harness` (and then a real assertion here), or accept the
   current "View-level only" wording for v0.1?
3. **Do you accept the memory and mount-`mounted` gaps as the price of
   one-host-per-control?** iOS memory is 1.42× `expo-ui-shared-host` (0.85×
   per-control) and iOS mount `mounted` is 4.30× shared-host while `presented` is
   0.99× and UI CPU is 0.96×/0.72× (best slider arm). D15 lets the reviewer
   decide, with a follow-up item; the follow-up would be a *shared Nitro host*
   for batches, which is a core change well beyond G1 and touches T12's Android
   work. Say "accept, record it" or "open the follow-up" and I will do whichever
   in a follow-up commit here.
4. **`mountSignal: false` for bench cells.** The `update.slider:rn-core` floor
   burns ~1.5 s per iteration waiting for a mount signal a bare `View` can never
   send (~95 s per launch of timeouts), and its `UI CPU/op` is the denominator of
   every update UI-CPU ratio anyway. A per-cell `mountSignal: false` flag fixes
   both the cost and the reporting. It is a `bench/` change, not a Slider change —
   want it here or in a T02 follow-up?
5. **The cold first `fillWidth` frame.** Now that the deadlock is fixed, the
   remaining artifact is that a component's declared fallback is registered by its
   first *view*, and Fabric creates that view after the shadow node's first
   measure — so the first instance of a configuration is measured before the
   fallback it should have used exists, and gets laid out at height 0 once. The
   clean fix is to register fallbacks at component registration (JS → native at
   `registerComponent` time), which changes `src/core/` + both hosts and would
   also help Switch's cold first frame. That is not the "minimal, backwards
   compatible" core change this brief authorises, so it is a question, not a
   decision: want it as a T11/T12-sized task?
6. **Android numbers while T12 is running.** I report Android as measured
   (behind `expo-ui-shared-host` on presented 1.20×, UI CPU 1.44×, memory 2.16×)
   and changed nothing in the Compose host. If T12 lands a faster host, these
   Android cells need a re-run before they are quoted anywhere — flagging so the
   numbers do not get compared across branches by accident.

## Commits

`26d335f` (base) → tip, in order:

| SHA | What it carries |
| --- | --------------- |
| `c025432` | `feat(slider)`: spec, wrapper, generated glue, sizing declaration |
| `882465b` | `fix(sizing)`: a `fillWidth` control's box-owned width is not a change |
| `14e100b` | `fix(ios)`: propose the box width to `fillWidth` content |
| `aa78f73` | `fix(android)`: let a `fillWidth` measure answer any height |
| `970ddfd` | `feat(slider)`: the SwiftUI host, coalescer and quantising |
| `84f1fd4` | `feat(slider)`: the Material 3 host, coalescer and quantising |
| `4eee5a7` | `test(slider)`: harness tests for drags, coalescing, sizing, recycling |
| `01987e6` | `feat(example)`: the Slider screen |
| `592d051` | `bench(slider)`: the component dimension plus the four Slider arms |
| `b9f6b1d` | `test(slider)`: the Reassure render contract |
| `dcf9715` | `docs(core)`: what the first `fillWidth` component taught the guides |
| `efba374` | `chore(slider)`: regenerated API report and publish manifest |
| `2825825` | `fix(ios)`: a box with no height must not stop a `fillWidth` measure |
| `58a1258` | `test(slider)`: the two sizing questions a `fillWidth` control must answer apart |
| `eea3cf2` | `docs(sizing)`: the `fillWidth` measure waits for width, not height |
| `b57623a` | `docs(bench)`: what a floor is, and what a cell without a mount signal means |
| `4067f8b` | `docs(slider)`: the component page, the screenshots and this report |
| _tip_ | `docs(sizing)`: re-point the host line references the fix moved, and record the SHAs above — the SHA of this commit is in the task hand-off, not in the file it names |
## Fix round 1

The review returned CHANGES-REQUIRED: seven required fixes, a list of tests it
called weak, and a bench-honesty list. All of them are answered below — nothing
was declined, and nothing outside them was fixed (D19: what I found along the way
is a line in the last subsection, not a commit).

### Step 0 — the merge

The review doc was uncommitted, so it went in first as `86f2832`. Then `4a419c8`
merges `main` (`979b7b2`) in: T12's Android host changes — the Android
synchronous sizing budget is now **1** — the "Shared objects" rule in
`docs/architecture/core.md`, D18 (ART priming), D19 (hard stops), the amended D17,
and `docs/tasks/FOLLOWUPS.md`. The reviewer was right that there were no textual
conflicts; the merge needed judgement in two places instead:

- **Budget 1 on Android** changes when a `fillWidth` Slider may answer its own
  height synchronously. The sizing harness tests are the check, and they are in
  the 54 green: the Slider still answers its height under the tighter budget
  rather than waiting for a box that never arrives. Nothing in the Slider needed
  a change to fit it; the round-0 Android measure code was written against a
  budget of 2 and behaves the same at 1 because it never relied on a second
  synchronous round.
- **The "Shared objects" rule** is the reason fix 5 exists: `SliderDefaults.colors(…)`
  was being built per view, which the guide now says not to do. Switch already
  cached its equivalent, so the Slider follows the same shape.

`main` moved one commit after this merge (`e9e2448`, T13's docs-only report). It
is not re-merged: it is another task's report, and the published tables should
describe the tree the benches actually ran on.

### The required fixes

| # | Fix | Commit(s) |
| - | --- | --------- |
| 1 | **iOS handshake race.** A JS write could overtake a sample native had sampled but not yet emitted, and `reconcile()` would then treat the *old* controlled value as a fresh instruction and rewind the thumb mid-drag. The rule moved into the shared core: a controlled value tracks whether the last sample is still unreported (`NitroUiControlledValue.unreported`) and `reconcile()` refuses while it is, on both platforms — the race was Android-shaped too, it was only *observed* on iOS. The `pending`-comment in the Swift view says what it now means. | `eacf3fe` |
| 2 | **Rounding ties.** Kotlin's `round` sends a tie to the *even* neighbour, so `0.5` quantised to `0` while Swift sent it up the track. Both now use `floor(x + 0.5)` (`roundHalfAway`), and both suites carry a mid-range tie (`0.5` at step 1, and `2.5` where the even neighbour is `2`). | `c9d1820` |
| 3 | **Accessibility increment / decrement.** Both value rules gained `stepped(from:up:minimum:maximum:step:)`: the next legal stop *in the requested direction*, counted from `minimum`, with the bounds as stops — so `0…10 step 3` reaches `10` and an increment at the end of the track moves nothing instead of wrapping. The platforms contribute only the direction, because handing either one a `step:` on a range that does not end on a step would make `maximumValue` unreachable. Android drives it through the **real Compose a11y action** and the harness asserts the value it lands on; iOS vends the adjustable element the same way so VoiceOver's own gesture reaches it, and a VoiceOver value write with no editing callbacks attached cannot open a drag that never ends. | `ec390fb`, `cd08a4e`, `67f4f64`, `246f98e`, `e9e2f00`, `498f3fe` |
| 4 | **`endDrag()`.** `guard dragging` on both platforms: no `onSlidingComplete` without a start, and no late end landing on a recycled instance. The documented "complete without a start" limitation is gone rather than explained. | `b04a9f4` |
| 5 | **Android colours.** `SliderDefaults.colors(…)` is built once and cached (`SliderColorsCache`), per main's new "Shared objects" rule, matching Switch. It rode along in the a11y commit because both touch the same view file. | `cd08a4e` |
| 6 | **Example and doc nits.** The Android tab bar sits under the status bar instead of behind it; the off-grid `72` label is on the grid; the "the pump keeps the display link warm" claim was removed because it was not true of what the pump does; the `pending` comment describes the flag it sits on. | `2089576` |
| 7 | **Weak tests.** The abandoned-drag test now asserts the view was *actually reused* (`reused=${nextHandle === abandonedHandle}`) so it cannot silently become a test of garbage collection; both platforms now assert the frame source stops feeding after a drag ends (the `CADisplayLink` / Choreographer callback, which is what makes an abandoned drag a leak rather than a cosmetic miss); and `min == max` is rendered on device, which was previously only ever covered by native vectors. | `e9e2f00` |
| 8 | **Bench honesty.** Both platforms re-run, `mountSignal: false` implemented (approved as answer 4), and the iOS artifact freshness bug that made the first re-run worthless found and fixed. Tables and verdicts: the Benchmarks section above. | `272e471`, `8812717` |

### Every round-1 test shown to fail

AGENTS.md again: applied, run, reverted.

| Proof | Mutation / state | Red result |
| ----- | ---------------- | ---------- |
| Fix 1, iOS harness | `reconcile()` allowed while a sample is unreported (the pre-fix tree, JS writes the controlled value mid-drag) | `Slider › finishes a drag that a write from JS lands inside` → `expected 0.8 to be 0.5` (`/tmp/g1-ios-harness-1.log`) |
| Fix 3, iOS harness | before the view vended an adjustable element | both a11y tests fail with `no adjustable element` — they cannot even reach the action |
| Fix 2, Kotlin | `roundHalfAway` restored to `kotlin.math.round` (which is `Math.rint`) | `NitroUiSliderValueTest > tiesGoAwayFromZeroNotToTheEvenNeighbour FAILED` — `0.5 goes to 1, not to the even 0 (got 0.0, want 1.0)`; `36 tests completed, 1 failed`, `BUILD FAILED` (`/tmp/g1-jvm-tie-red.log`) |
| Fix 2, Swift | `.rounded(.toNearestOrEven)` | `slider-value.test: 8 failure(s)` → `test:native: FAIL`, including `a mid-range tie goes up, not to the even 2 (got 2.0, want 3.0)` and `a tie in a fraction goes up to the next stop (got 0.0, want 0.5)` (`/tmp/g1-swift-tie-red.log`) — the same bug, visible on the platform that had it right |
| Fix 3, Kotlin | the pre-fix tree (before `ec390fb`), JVM suite | `36 tests completed, 2 failed` — `anAccessibilityStepMovesToTheNextLegalValueInItsDirection` and `aPlatformFractionStillLandsOnTheGrid` (`/tmp/g1-jvm.log`) |
| Fix 8, runner guard | pre-fix tree, `node scripts/bench/build.mjs --platform ios` | answers `reused: true` while `main.jsbundle` (07:17) predates `bench/src/plan.ts` (10:42) and contains no `mountSignal`; post-fix `locateArtifact('ios')` throws on that same tree and the plain build path answers `reused: false` with a bundle that does contain it |

The Swift tie mutation failing **8** checks where the Kotlin one failed 1 is
worth noting: iOS was already correct, so the mutation showed how much of the
shared expectation the Swift suite actually covers. That is also why the fix went
to Kotlin rather than to a shared "whatever Swift does" shrug.

Both tie mutations were re-run for this round and the logs kept, because the
round-1 report cited a log that turned out to hold a *different* red (the
pre-fix a11y step, now its own row above) — a citation that does not contain its
claim is the same class of error as a bench table for the wrong tree, so the two
rows above are from runs taken on this tree and named accordingly.

One slip, recorded because the gate caught it: the first attempt at the
`498f3fe` warning fix was aimed at a `guard let division` line by content, and
the file has two textually identical ones — it hit the one in `quantize`, whose
binding *is* read, and `bun run check` died with `value of type … has no member
'wholeSteps'`. Re-aimed at line 197, green. The mutation is why the gate exists.

### Gates on the final tip

| Gate | Result |
| ---- | ------ |
| `bun run check` | **exit 0** — typecheck, bench typecheck, lint, format, 111 Jest tests (8 suites), `test:native` (187 C++ checks ×2 under ASan/UBSan, `handshake.test`, `slider-value.test`), `perf:renders` (baseline 6, both components), nitrogen no drift (77 generated files), autolinking, bob build, api-extractor, publint, manifest (202 files). **No source warnings** — `498f3fe` removed the one this round introduced. |
| `bun run test:native:android` | **36 tests, 0 failures** — `NitroUiSliderValueTest` 12, `SliderModelTest` 12, `NitroUiControlledValueTest` 9, `NitroUiWeakKeyTest` 3 |
| iOS harness | **54 passed, 3 suites** against an app rebuilt from this tree (`xcodebuild -derivedDataPath build`, app 11:33, no source newer than it) |
| Android harness | **54 passed, 3 suites** against the 11:22 APK — and no Android source is newer than that APK, which is gotcha 1 checked instead of assumed |
| Bench load | iOS run 3.36 / 5.15 (263 s), marks run 4.40 / 4.83 (64 s), Android 6.44 / 6.67 (206 s) — all under the D13 ceiling, all recorded in the artifacts |

Gotcha 2 cost another 10 minutes here in a new way: the harness's Jest transform
breaks on Node 26, and this shell's default is Node 26 while `.nvmrc` pins 24. A
harness run that *fails* with `Must use import to load ES Module …
react-native/index.js` is the Node version, not the code — re-run under Node 24
and the same binary gives 54/54.

### Answers received, and what happened

| Q | Answer | Done |
| - | ------ | ---- |
| 1 | iOS < 26: follow-up | recorded in `docs/tasks/FOLLOWUPS.md`; the follow-up bullet here points at it |
| 2 | Label at View level is fine; increment/decrement is real | fix 3 — the step now goes through the platform's own a11y action on both platforms; the label stays View-level and the follow-up bullet says exactly that |
| 3 | Accept memory 1.42× for 0.1; state the iOS mount-presentation result honestly | accepted and recorded in `FOLLOWUPS.md`; the iOS mount `presented` result is now "no verdict, the probe cannot adjudicate a >1-frame mount", which is the opposite of flattering |
| 4 | `mountSignal`: do it here | `272e471` |
| 5 | Fallback registration before the first measure is **T14** — not here | not done; D17 on main documents the height-0 cold frame, and the follow-up bullet points at T14 |
| 6 | Android: re-run primed | `7b6015e-android-20261023T095647Z.md`, ART `speed-profile` recorded in the artifact, verdict table above |

### What I found and did not fix (D19)

- `react-native-harness` needs Node 24 (`.nvmrc`) and dies on Node 26 with an ESM
  transform error that looks like a code bug — worth a line in the harness docs.
- The bench rig cannot adjudicate `presented` for a mount longer than one frame on
  iOS (`presentedBeforeMount=76`); needs a mount-relative stamp, not a vsync stamp.
- The Android example's tab bar uses `StatusBar.currentHeight` rather than
  `react-native-safe-area-context` (D12 allows it; a safe-area dependency would be
  tidier for the next screen that needs insets).
- `NitroUiSliderValue.swift` has two textually identical `guard let division`
  lines — a content-only patch target cannot tell them apart.
- A superseded `f5c0450-dirty-*` marks run was taken while the tree was mutated
  for the tie proofs; it is deleted rather than published, and this line is its
  tombstone. The stale-bundle run `7b6015e-ios-20261023T094459Z*` is **kept** as
  the evidence for the `8812717` fix.

### Round 1 commits

`86f2832` (base, the review doc) → tip, after `4a419c8` merges `main`:

| SHA | What it carries |
| --- | --------------- |
| `86f2832` | `docs(slider)`: the round-1 review of the Slider task |
| `4a419c8` | merge of `main` (T12 host + budget 1, D17/D18/D19, FOLLOWUPS) |
| `c9d1820` | `fix(slider)`: a rounding tie goes up the track on Android too |
| `eacf3fe` | `fix(slider)`: a React write cannot overtake a sample native has not emitted |
| `b04a9f4` | `fix(slider)`: only a drag that started may end |
| `ec390fb` | `feat(slider)`: the value rule knows the next legal value in a direction |
| `cd08a4e` | `feat(slider)`: a screen reader's step lands on the grid, via the platform's action — and the cached `SliderDefaults.colors` |
| `67f4f64` | `fix(slider)`: the a11y step probe reports usefully, and stops killing the app |
| `246f98e` | `feat(slider)`: the view vends the element a screen reader focuses |
| `e9e2f00` | `test(slider)`: the drag a write lands inside, a reader's step, a flat range, the reuse and frame-source assertions |
| `2089576` | `docs(slider)`: the example's tab bar, the off-grid 72, and what the pump does |
| `272e471` | `perf(bench)`: a cell may declare that it has no mount signal |
| `8812717` | `fix(bench)`: the iOS artifact's freshness test trusted a directory mtime |
| `498f3fe` | `fix(ios)`: the compiler knew the a11y step did not need the division |

The branch was rebased once during this round to remove a `Co-Authored-By:` trailer
from `cd08a4e`'s message (AGENTS.md: no attribution of this kind in commits). The
rewrite touched messages only: `git diff` between the pre-rewrite and post-rewrite
tips is empty, so `f5c0450` ≡ `8812717` and `7b6015e` ≡ `272e471` — which is why
the bench artifact file names still show the old SHAs and why the tables above are
unaffected by the rewrite.
