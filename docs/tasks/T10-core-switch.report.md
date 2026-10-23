# T10 — Report

Branch `task/T10-core-switch`. The core hosting runtime exists and the Switch runs
on it: one `UIHostingController` per iOS view, one `AbstractComposeView`
composition per Android view, controlled/uncontrolled behaviour through the
event-count handshake, perf marks, recycling, and 14 on-device tests that pass on
both platforms.

## Gates

| Gate | Command | Result |
| --- | --- | --- |
| Aggregate | `bun run check` | PASS — every row below, in one run |
| Types | `bun run typecheck` | PASS |
| Lint | `bun run lint` | PASS — 0 errors, 0 warnings; 5 local rules (4 perf-contract + `no-optional-view-props`) |
| Format | `bun run format` | PASS |
| Unit tests | `bun run test` | PASS — 69 tests, 7 suites |
| Nitrogen drift | `bun run nitrogen:check` | PASS — 51 generated files match |
| Library build | `bun run prepare` | PASS |
| API report | `bun run api-extractor:check` | PASS — `etc/react-native-nitro-ui.api.md`, 0 warnings |
| Publish surface | `bun run publint` | PASS — `publint --strict`, all good |
| Tarball manifest | `bun run manifest:check` | PASS — 132 files |
| iOS build | `xcodebuild … -sdk iphonesimulator -derivedDataPath build build` | PASS — `** BUILD SUCCEEDED **` |
| iOS harness | `IOS_SIM_UDID=F08675D3-… METRO_PORT=8293 HARNESS_APP_PATH=… bunx react-native-harness --harnessRunner ios` | PASS — 14/14 on `iPhone 17` (iOS 27.0), twice in a row |
| Android debug | `./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a` | PASS |
| Android harness | `ANDROID_AVD=nitroui_t01 METRO_PORT=8293 HARNESS_APP_PATH=… bunx react-native-harness --harnessRunner android` | PASS — 14/14 on AVD `nitroui_t01` (`emulator-5570`, API 35) |

## Mount cost (measured on device)

| Platform | 40 hosted Switches, one `render` | Asserted budget |
| --- | --- | --- |
| iOS (`iPhone 17`, iOS 27.0) | 27.2 – 29.7 ms | 10 000 ms |
| Android (AVD `nitroui_t01`, API 35) | 313.0 ms | 10 000 ms |

The suite logs what it measured (`Switch stress: …`) on every run, so the number
is in the harness output rather than only in this report; the `beforeAll` warm-up
render keeps one-time process costs (Nitro's first registry call, the first
composition / hosting controller) out of it. Default sizes are in *Measured
default sizes* below.

## Screenshots

`docs/tasks/T10-core-switch/` — `ios-light.png`, `ios-dark.png`,
`android-light.png`, `android-dark.png`: the example Switch screen in both
appearances on both platforms. The dark-mode pair is what found the iOS colour
bug below (the `tintColor` row rendered system green instead of the tint).
They are taken from the installed debug build; the LogBox "open debugger" banner
is a dev-mode overlay, so it was dismissed before capture.

## Files

**Core — JS** (`src/core/`, `src/NitroUiCore*`)

- `useStableCallback` — one identity forever, native callback wrapped as `{ f }`.
- `useControlled` — the §4 handshake: `{ value, defaultValue, mostRecentEventCount,
  onNativeChange }`, covering rejected changes, stale writes and uncontrolled mode.
- `useProcessedColor` — memoised `processColor`.
- `NitroUiCore` gains `setPerfEnabled`, `drainPerf`, `now` (C++, both platforms).

**Core — iOS** (`ios/core/`, 486 lines)

- `NitroUiModel` — `ObservableObject` with manual `objectWillChange`; one send per
  `afterUpdate` when dirty (no `@Published` per field, which would notify mid-batch).
- `NitroUiControlledValue<T>` — displayed value + accepted event count.
- `NitroSwiftUIHost<Content>` — one `UIHostingController<NitroUiRoot<Content>>` per
  instance, concrete generic (no `AnyView`), `safeAreaRegions = []`, clear
  background, frame in `layoutSubviews`, optional VC containment, `prepareForRecycle`
  that keeps the controller and suppresses the first animation after reuse.
- `NitroUIContent`, `NitroUiMainThread`, `UIColor+NitroUiColor`.

**Core — Android** (`android/.../nitroui/core/`, 358 lines)

- `NitroUiModel` — `mutableStateOf` fields; `NitroComposeHost<M>` with a fixed
  `Content()`, owners created only when missing, `DisposeOnLifecycleDestroyed` plus
  explicit `disposeComposition()` in `drop()`, recycle reset.
- `NitroUiPerf` — `RegisterNatives` thunk into the C++ ring buffer.

**Core — C++** (`cpp/`)

- `NitroUiCore` (shared): monotonic clock + perf marks.
- `cpp/core/NitroUiPerf.hpp` — header-only fixed ring buffer, relaxed-atomic flag
  gate; Swift reaches it through C++ interop, Kotlin through JNI.

**Switch** — `src/components/Switch/` (spec, config, native wrapper, `Switch.tsx`),
`ios/components/Switch/HybridNitroUiSwitch.swift` (247 lines with docs),
`android/.../HybridNitroUiSwitch.kt` (251 lines with docs).

**Guards & tooling**

- `eslint-rules/index.js`: `no-optional-view-props` extended for callback props.
- `patches/@react-native-harness%2Fplatform-apple@1.6.0.patch`: the Apple runner now
  always reinstalls the app before a run.
- `example/__tests__/Switch.harness.tsx` (14 on-device tests),
  `example/src/SwitchScreen.tsx`, `example/src/App.tsx`.

**Docs** — `docs/architecture/core.md` (the "how to build a component" guide),
`docs/components/switch.md`.

## Decisions

1. **`NitroUiSize` lives in `Switch.nitro.ts`.** nitrogen rejects a spec file that
   only declares structs, so the shared struct rides along with the first component
   that needs it; T11 can move it to `src/NitroUiCore.nitro.ts` with a regeneration.
2. **`measureContent()` reads a cache.** The host stores the content size whenever
   native lays out, so JS can call it from the JS thread. No synchronous
   UI-thread hop (architecture §1.2 forbids one).
3. **Perf marks are C++ with platform thunks.** One clock, one buffer, one drain,
   and both platforms report timestamps in the same base as their own frame clocks.
4. **`perfInstanceId < 0` means "no marks"**; the check is one relaxed atomic load.
5. **iOS `testID` is not re-applied by us.** `RCTViewComponentView` already maps
   RN's `testID` to `accessibilityIdentifier`, so the host only forwards it to
   Compose (via `View.tag`) where nothing else would.
6. **iOS default box is 51×31, not the 61×28 SwiftUI reports** — see Sizing below.
7. **No Compose equivalent of iOS's animation suppression on recycle.** M3 `Switch`
   animates its thumb on first composition after reuse; nothing in Compose says
   "commit without animation". Documented in `docs/architecture/core.md`.
8. **Colours decode by bit pattern, not by sign** — `processColor` is unsigned on
   iOS and signed on Android; the iOS getter returns unsigned so it can be
   compared with what iOS `processColor` produced. See the bug section.
9. **The suite waits with its own `waitForTestId`.** `screen.findByTestId` is
   one-shot, and the failures it produces under load look exactly like a broken
   component. Polling `HarnessUI.queryByTestId` keeps the assertion honest and the
   run reproducible.

## Measured default sizes

From inside the app (`measureContent()` = the control's own measurement; `box` =
the frame Yoga gave the Fabric node):

| Platform | `measureContent()` | Fabric box | `DEFAULT_SIZE` in the wrapper |
| --- | --- | --- | --- |
| iOS | 61 × 28 pt | 51 × 31 | 51 × 31 |
| Android | 52.19 × 48 dp | 52.19 × 48 | 52 × 48 |

Android's 52 × 48 is the M3 numbers exactly (52×32 track inside a 48 dp minimum
interactive size). iOS is the interesting one: SwiftUI's
`Toggle(…).labelsHidden().toggleStyle(.switch)` reports 61 × 28 — about 10 pt of
label spacing that survives `labelsHidden()` because the label still exists as an
empty view — while the track it paints is the 51 × 31 of UIKit's `UISwitch`. The
wrapper default uses the painted size so there is no dead zone next to the control;
T11 has `measureContent()` if it wants the layout size instead.

## Deviations from `docs/research/core-architecture.md`

| # | Doc says | Code does | Why |
| --- | --- | --- | --- |
| 1 | §5 sketch: props may be optional (`T \| null`) | Every native prop is non-optional **except callbacks**, which are `fn?` | Nitro sends a function as `{ f: fn }` and only unwraps it when the property type *is* a function. `fn \| null` becomes `variant<function, NullType>`, is not a function type, so the wrapper is never unwrapped and converting the prop throws at mount — every Switch failed to mount until this changed. Encoded in the lint rule (`callbackPropNotNullable`) and in `docs/architecture/core.md` §3/§10. It is an exception to D7, not a repeal: the JS wrapper still sends every prop, and sends a callback that the hook always keeps. |
| 2 | Separate `@nitro-ui/core` package | Everything in `react-native-nitro-ui` | D6. |
| 3 | `NitroUiSize` in the core spec | Declared next to `NitroUiSwitch` | nitrogen rejects a struct-only spec file. |
| 4 | Host exposes `measure()` that measures content | Host caches the measured size; `measureContent()` returns the cache | JS must be able to ask from the JS thread; a real measure needs the UI thread. T11's shadow node can read the cache on the layout pass. |
| 5 | Perf marks in each platform's host | One C++ ring buffer + two thin thunks | Same clock base as each platform's frame clock, one `drainPerf()` for both. |
| 6 | VC containment for controls | Switch leaves `needsContainment = false` | Only presenting views need it; kept as a flag so a later component can flip it. |
| 7 | §5 sketches `AnyView`-free hosting with a `Content` closure | Same, plus a `NitroUIContent` marker protocol | Gives the content a uniform "read the model" contract and keeps `body` from capturing stale values. |
| 8 | Sizing out of scope (T11) | Wrapper applies a per-platform `DEFAULT_SIZE`; `measureContent()` exists and is only used by a harness test | Exactly what the brief asked for. |
| 9 | — | `NitroUiRoot` adds `.ignoresSafeArea()` | The host already sizes itself in `layoutSubviews`; without it SwiftUI insets the control on notched devices. |

## Environment notes

- Assigned devices only: iOS `F08675D3-A32B-4F88-BC81-02D7E0CB797E`, AVD
  `nitroui_t01` (`emulator-5570`, started with `-ports 5570,5571`), Metro 8293.
  `emulator-5554`, `emulator-5560`, `nitroui_t02`, `nitroui_t03` were left alone.
- **The shared `adb server` is a flakiness source.** Concurrent tasks with
  different `platform-tools` versions make adb kill and restart its own server,
  which surfaces as `adb shell … exit code 20` (server died) inside a harness run.
  Two Android runs failed that way before one completed; retrying is enough, but
  T03's smoke scripts should expect it.
- **Load matters more than correctness here.** With the machine at load average
  100–400 (three agents, several emulators + simulators), the app can exceed the
  harness's 120 s "bundle not ready" window and the emulator starves. All failures
  seen at high load were environmental and disappeared at lower load.
- The first render of the app process is slower than the harness's default 1000 ms
  mount timeout on a cold Android emulator, so the on-device suite warms up in
  `beforeAll` and then measures steady-state mounts.
- **`screen.findByTestId` has no timeout** — it throws on the first pass that
  finds nothing. Tests that render their own control failed twice under load
  ("Unable to find element with testID: sized") while tests that use the app's
  own screen passed. The suite now waits with a `waitForTestId` helper (poll
  `HarnessUI.queryByTestId`, then take the harness reference), and 2 consecutive
  iOS runs plus an Android run came back 14/14 afterwards.
- **Taking a screenshot outside a harness run needs the dev-server handshake.**
  The app asks for `localhost:8081`, so a bare `adb reverse tcp:8081 tcp:8293` is
  not enough: the app then reports "Unable to load script". What works is what the
  harness does — write `debug_http_host=localhost:<port>` into
  `shared_prefs/nitroui.example_preferences.xml` with `run-as` (see
  `@react-native-harness/platform-android/dist/shared-prefs.js`), keep the
  `tcp:8081 → <port>` reverse, and leave Metro running in a session that outlives
  the command that started it.
- RN's `SafeAreaView` is deprecated and applies no inset on Android, where every
  app is edge to edge: the example screen drew its title under the status bar
  (with white icons on a white background). It now pads `StatusBar.currentHeight`
  on Android and sets an adaptive `barStyle`. `StatusBar`'s `backgroundColor`
  prop no longer exists in the 0.88 types. See the questions below.
- `nitro.json` is nitrogen's own output, so it is now in `.prettierignore`:
  prettier collapses its arrays and `nitrogen:check` then reports drift. Same
  class of conflict as `etc/*.api.md`.
- Harness gaps found (worth upstream / T03): the Apple runner skipped
  `simctl install` when the app was already installed (a two-hour-stale binary ran
  the tests; now patched in `patches/`), and `screen.screenshot(element)` reports
  `0x0` for an element target, so element bounds have to come from the raw
  `HarnessUI.queryByTestId`.

## Follow-ups

- T11: replace `DEFAULT_SIZE` with the measured intrinsic size, using the host's
  cached content size; decide 51×31 vs 61×28 for iOS.
- T11+: move `NitroUiSize` into the core spec once another component needs it.
- Consider an animation-suppression strategy for recycled Compose views.
- The example screen's colour handling (`useInk`) is ad hoc; a real theme helper
  belongs with the first docs-screen task.
- Every colour-accepting component must decode ARGB without a sign assumption
  (`docs/architecture/core.md` §"Colours"); the iOS fix here is the reference.
- If the repo adopts `react-native-safe-area-context` for the example/bench apps,
  drop the `StatusBar.currentHeight` padding and the deprecation warning with it.

## API report (D4)

Delivered. `etc/api-extractor.json` + `etc/react-native-nitro-ui.api.md` (97
lines, zero warnings) now exist, `api-extractor` / `api-extractor:check` are
scripts, and `api-extractor:check` runs inside `bun run check` after `prepare`
(so it reads the same `lib/typescript` the tarball ships). Two things were needed
to get there:

- `ajv@^8.17.1` as a devDependency — `api-extractor`'s `ajv-draft-04` peer needs
  ajv 8, but bun hoists eslint's ajv 6, and the run dies with `MODULE_NOT_FOUND`.
- `{@link Switch}` instead of `{@linkcode Switch}` in `Switch.tsx`, and no root
  `tsdoc.json`: api-extractor 7.59 rejects `{@linkcode}` under the default TSDoc
  tags, and `tsdocConfigFile` is not a valid config key. `compiler.tsdocConfigFile`
  and `messages.terminal` are also not valid keys — an empty `"compiler": {}` is
  what works.

It emits `lib/typescript/src/tsdoc-metadata.json`, so `etc/package-files.txt`
grew by one entry (`bun run manifest:update`); prettier is told to leave
`etc/*.api.md` alone. It runs against TypeScript 5.9.3 while the repo is on 6.0.3
and prints a "consider upgrading API Extractor" note — harmless today, worth
watching when the report starts lying.

## Bug found by the screenshots: opaque colours were dropped on iOS

`processColor` is not portable across platforms: it returns an **unsigned** 32-bit
value on iOS (`>>> 0`) and a **signed** one on Android (`| 0x0`). The shared
decode in `ios/core/UIColor+NitroUiColor.swift` used `Int32(exactly:)`, which
rejects anything ≥ `0x80000000` — i.e. every mostly-opaque colour. `tintColor`
therefore arrived, failed to decode, became `nil`, and the Switch kept the system
accent: on iOS the `tintColor="#7C4DFF"` row rendered system green while Android
rendered purple. Pixel sampling the light screenshot proved it
(`#34C759`, not `#7C4DFF`).

Fixed by taking the low 32 bits without a sign assumption
(`UInt32(truncatingIfNeeded:)`, bounded by a finite/range guard), and by making
the iOS prop getter return unsigned so it matches iOS `processColor`. Dark-mode
screenshots now show the purple track, and test 14
(`round-trips an opaque tintColor`) asserts `hybrid.tintColor ===
processColor('#7C4DFF')` on both platforms — it fails on the old code and passes
on the new. The rule is written up in `docs/architecture/core.md` §"Colours",
because every component with a colour prop would otherwise rediscover it.

## Questions for orchestrator

1. **Should `docs/DECISIONS.md` gain two amendments?** Both are things every later
   component copies and can only rediscover by crash or by screenshot:
   - **D7 (props):** "no optional Hybrid View props, use `T | null`" cannot hold
     for callbacks — they must be `fn?` (Deviations #1). Encoded in the lint rule
     and `docs/architecture/core.md` §3/§10, but not in the decisions log.
   - **Colours:** `processColor` is unsigned on iOS and signed on Android, so a
     decode must never assume a sign. This cost an iOS-only silent bug that only
     dark-mode screenshots exposed. Written up in `docs/architecture/core.md`
     §"Colours"; a D-entry would make it discoverable before the first bug.
2. **Is the `patches/` strategy acceptable for harness bugs repo-wide?** I patched
   `@react-native-harness/platform-apple` so the iOS runner reinstalls the app
   (without it, a stale binary silently ran the suite). T03 will hit that plus
   `screen.screenshot(element)` reporting `0x0`, and now also the missing
   `findByTestId` timeout (worked around inside the suite rather than patched). If
   upstream fixes are preferred, say so and I will drop the patch.
3. **Which safe-area answer does the repo want for example/bench apps?** RN's
   `SafeAreaView` is deprecated *and* inert on Android, so it logs a warning on
   every mount and leaves content under the status bar. I fixed the example with
   `StatusBar.currentHeight` + adaptive `barStyle` (no new dependency), but the
   warning stays and the fix is Android-only. Adopting
   `react-native-safe-area-context` in the example (and T02's bench) is the real
   fix; it costs a native pod/Gradle module in dev-only apps. T02 is being built
   now, so this is cheapest to settle today.
4. **iOS intrinsic size for T11: 51 × 31 (painted track) or 61 × 28 (what SwiftUI
   reports)?** I defaulted to the painted size; T11 has to pick one for the shadow
   node, and a mismatch between the two would show up as a jump when T11 lands.
5. **Machine contention policy.** Three tasks on one host at load 100–400 caused
   false failures (adb server killed by another client, harness 120 s bundle
   window, emulator starvation, `findByTestId` timeouts). Retries, one warm-up and
   one polling helper were enough here, and every gate/suite is green at load < 30.
   Should device tasks get a serial queue, or run a private adb server
   (`ANDROID_ADB_SERVER_PORT`) so they stop killing each other's?

---

# Round 2 — review fixes

Reviewed in `docs/tasks/T10-core-switch.review.md` (CHANGES-REQUIRED). Every
BLOCKING item and every SHOULD-FIX item is addressed; NITs are fixed or written
down where the honest answer is a limitation. Two items are answered with
evidence instead of code — B3's keep-or-drop recycling call and SF6's Android
intrinsic measure — both explained below.

## Verification (round 2)

| Gate | Command | Result |
| --- | --- | --- |
| Full check | `bun run check` | PASS — typecheck, lint (0/0), format, 72 unit tests (7 suites), `test:native`, `nitrogen:check` (51 files), `autolinking:check`, `bob build`, `api-extractor:check`, `publint --strict`, `manifest:check` (133 files) |
| API report | `bun run api-extractor:check` | PASS — **0 warnings** (`etc/react-native-nitro-ui.api.md`) |
| Host native tests | `bun run test:native` | PASS — `clock.test` (C++/Obj-C++) + `handshake.test` (Swift), all checks |
| Kotlin unit tests | `bun run test:native:android` | PASS — 7 tests (`android/build/test-results/testDebugUnitTest/`) |
| iOS harness | `IOS_SIM_UDID=F08675D3-… METRO_PORT=8293 HARNESS_APP_PATH=… bun run harness:ios` | PASS — 14/14, `iPhone 17` (iOS 27.0) |
| Android harness | `ANDROID_AVD=nitroui_t01 ANDROID_ADB_SERVER_PORT=5041 METRO_PORT=8293 HARNESS_APP_PATH=… bun run harness:android` | PASS — 14/14, AVD `nitroui_t01` (`emulator-5570`), against an APK rebuilt from this tree at 00:55 |
| Consumer smoke | `PLATFORM=android ANDROID_AVD=nitroui_t01 EMULATOR_PORT=5570 ANDROID_ADB_SERVER_PORT=5041 bun run smoke:rn-cli` | PASS — fresh RN 0.88.0 CLI app, npm-installed tarball, release APK, `NITRO_UI_SMOKE_READY` with the Switch mounted; 93 s total (rn-init 6 s, npm 22 s, build 55 s, run 6 s) |

Round-1 numbers that moved: 40 hosted Switches mount in **287.7 ms** on
`nitroui_t01` (was 313 ms) — the suite logs it every run. Still ~10× iOS, still
a debug build on an emulator, still T02's release-mode question (NIT 5).

## BLOCKING

**B1 — iOS default size, OS-versioned.** `usesModernSwitchSize()`
(`src/components/Switch/Switch.tsx:69-83`) reads `Platform.constants.osVersion`
(a string on iOS — the `typeof Platform.Version === 'number'` trap is called out
in the comment) and picks **61×28 from iOS 26, 51×31 before** it
(`src/components/Switch/Switch.tsx:98-104`), per D14. Verified three ways: the
new harness test asserts the Yoga box equals the expected box within 0.6 pt,
that `measureContent()` is not larger than the box, and that a press near each
inside edge is delivered (`example/__tests__/Switch.harness.tsx:251-292`);
Android logs `fabric=52.19x48 hosted=52.19x48`; and a pixel pass over the
committed iOS screenshot measures the painted capsule at 187×79 px = 62.3×26.3 pt
inside a 61×28 pt box (183×84 px) — the ~1 pt/side difference is the glass
rendering the review predicted, where the old 51 pt box had a 189 px track
(~6 pt dead at each end). `docs/architecture/core.md` §7 carries the table and
the failure mode, and says T11 replaces the constant, not the plumbing.

**B2 — D1 clock base.** New `cpp/core/NitroUiClock.hpp`:
`clock_gettime_nsec_np(CLOCK_UPTIME_RAW)` on Apple, `clock_gettime(CLOCK_MONOTONIC)`
elsewhere, and it is now the single base for `nitroUiCore.now()`, the perf marks
and both frame clocks. `std::chrono::steady_clock` is rejected in the header
comment with the reason (on Apple it is `CLOCK_MONOTONIC_RAW`, which keeps
counting through sleep). The time-base test is host-side, deterministic and in
`check`: `scripts/native-tests/clock.test.mm` asserts `nowNs()` against
`CACurrentMediaTime()` — the base `CADisplayLink.timestamp`/`targetTimestamp`
use — plus `NSProcessInfo.systemUptime` and a direct
`clock_gettime_nsec_np(CLOCK_UPTIME_RAW)` read (all within 9 µs, tolerance
5 ms), that it is monotonic, and that it is *not* `CLOCK_MONOTONIC_RAW` —
measured 9.1 h of divergence on this machine, which is the bug the review
predicted. `NitroUiPerf` marks are asserted to use the same clock.

**B3 — Android recycling, with the real ordering.** The claim was right: the
composition does not survive a recycle, and the guide said it did. Investigation
(RN 0.88 + the nitrogen-generated manager, all cited in
`docs/architecture/core.md` §6): reuse needs *both* `RecyclableView` (only that
makes the generated manager call `setupViewRecycling()`) and
`ReactNativeFeatureFlags.enableViewRecycling()`, which is `false` by default —
so by default every `onDropViewInstance` is a real unmount. When both are on,
the generated `onDropViewInstance` calls `hybridView.onDropView()` **before**
`super.onDropViewInstance(view)`, and `prepareToRecycleView` runs inside that
super call. So `drop()` → `disposeComposition()` always precedes
`prepareForRecycle()`, and "survive the recycle by not disposing" would mean
leaving a composition alive on every *real* unmount — the default case.
**Decision: keep the dispose**, document precisely, and let T02 measure a
keep-alive variant with the flag on. `NitroComposeHost`'s class docs,
`prepareForRecycle()` (`:222-229`, re-arms `isMeasurePending`,
`contentSize`, `firstFrame`) and `docs/components/switch.md` now say the same
thing as §6, including the asymmetry with iOS, where `+shouldBeRecycled`/
`_didDropView` keep the hosting controller and composition alive. Rule written
down: a component must be correct after a bare `prepareForRecycle()` on both
platforms, and must never assume it was recycled.

**B4 — smoke app.** `scripts/smoke/App.tsx` now imports `Switch` and renders
`<Switch testID="SMOKE-switch" defaultValue={true} />` — one import, one line,
per T03's contract. One smoke run executed (table above): a fresh RN 0.88.0 CLI
consumer, release APK from the packed tarball, ready line, screenshot. It also
needed `android/build.gradle` to set `react { jsRootDir }` — the template omits
it and the release build then fails with duplicate `index.android.bundle`
classes (recorded as B1 in `docs/upstream.md`).

**B5 — `docs/upstream.md`.** Created, with a status table and a paste-ready
issue draft per entry, and a **Removal** line saying what to delete when
upstream fixes it. Covers the two `patches/@react-native-harness%2Fplatform-apple@1.6.0.patch`
fixes (H1: `simctl install` skipped when the app is already installed, so a
stale binary silently ran the suite; H2: `simctl appinfo` exit 3 surfacing as a
throw), the non-patched harness gaps (H3 `findByTestId` has no timeout,
H4 `screen.screenshot(element)` reports 0×0, H9/H10 the Modal second-window
gaps), the nitro workarounds (N1 base `ViewProps` dropped on Android — fixed
upstream, unreleased; N2 = nitro#1184; N3 callbacks must be optional;
N4 generated `SimpleViewManager` ignores border/radius) and the
`create-react-native-library` (bob) template bugs from
`docs/research/setup-decisions.md` (B1 `jsRootDir`, B2 `--tools` keeping only
the first value). D11 now has something to point at.

## SHOULD-FIX

1. **iOS `accessibilityLabel`** now guards on a real change and calls
   `host.markDirty()` (`ios/components/Switch/HybridNitroUiSwitch.swift:183-197`),
   with a comment: only the handshake props may skip the mark.
2. **Android label moved onto the control.** It is a `mutableStateOf` field on
   the model and reaches the M3 `Switch` through
   `Modifier.semantics { contentDescription = it }`
   (`android/.../HybridNitroUiSwitch.kt:93-98`); the container keeps none, so
   TalkBack gets one actionable node instead of a named box around an unnamed
   control. `core.md` §3 states the pattern for later components.
3. **`hybridRef` is no longer a typed invitation** (D14): `src/index.ts` stops
   exporting the native view types, the handle in `SwitchProps.hybridRef` is an
   inline **read-only** shape, and it is `@internal` with what it is for
   (harness + benchmarks) and the fact that a new closure never re-fires it.
   `core.md` §5 covers threading, the off-main write hazard, and how a real
   imperative API should arrive.
4. **Uncontrolled → controlled** no longer freezes JS writes: every native
   event count is remembered in a ref in both modes, and the render-phase mode
   flip seeds `mostRecentEventCount` from it
   (`src/core/useControlled.ts:59-75`); the echo runs **before** the user's
   handler so a throwing handler cannot strand native
   (`src/core/useControlled.ts:96-113`); a `__DEV__` warning fires on a mode
   switch, as React DOM does. 11 unit tests in
   `src/__tests__/useControlled.test.tsx` (jest: 69 → 72 tests).
5. **`sizeThatFits` is off the hot path.** `wantsContentSize` defaults to off
   and, when a component turns it on, the measure runs per **bounds change,
   size-affecting trait change, first commit or `invalidateContentSize()`** —
   never per commit (`ios/core/NitroSwiftUIHost.swift:176-195`, `:242`).
   `invalidateContentSize()` exists because content can change size with
   neither signal (`Picker`'s longer title, a re-wrapped label); that rule is in
   §7 so T11+ doesn't rediscover it.
6. **Android `contentSize` — answered, not changed.** An unbounded answer is
   not available inside the pass: a `Measurable` may be measured exactly once
   per pass (`MeasurePassDelegate` throws otherwise), and the default
   `maxIntrinsicWidth/Height` is not implemented for the wrappers we use, so it
   would answer 0 rather than the truth. §7 now says plainly that the two
   platforms answer different questions — Android "what size did it get in this
   box", iOS the unbounded question — why, and that the unbounded Android answer
   is T11's design (`docs/tasks/T11-intrinsic-sizing.md` §11), not a constant.
7. **Public surface matches intent.** `src/index.ts` exports components and the
   shared clock only; the hooks, `ControlledState`, `NitroCallbackProp`, the
   Hybrid View types and `NitroUiSize` are package-internal. `api-extractor` is
   back to **0 warnings**, this time with nothing swept under
   `ae-forgotten-export`.
8. **The disabled test has a barrier.** A second enabled Switch is pressed after
   the two presses on the disabled one and its event is awaited
   (`example/__tests__/Switch.harness.tsx:494-528`), so the assertion is "the
   pipeline demonstrably flushed and nothing arrived", not "nothing arrived
   yet". The vacuous `:294` comment is gone.
9. **Native handshake tests exist**, as host binaries rather than new
   simulators: `scripts/native-tests.sh` compiles the shipping sources with
   `clang`/`swiftc` and runs them in `bun run test:native` (so in `check`), and
   `scripts/native-tests-android.sh` runs the Kotlin twin
   (`android/src/test/java/com/margelo/nitro/nitroui/core/NitroUiControlledValueTest.kt`,
   7 tests). Both mirror the JS vectors — stale drop, rejected revert, rapid
   double toggle, mode switch, `Double` equality — because
   `NitroUiControlledValue` is the file a later component edits. New on-device
   coverage too: taps faster than a React round trip, and mount/unmount repeat
   with `disabled`/`tint` re-checked after reuse.
10. **Android Modal fallback sets both owners** — `LifecycleOwner` *and*
    `SavedStateRegistryOwner`, each filled only if missing
    (`android/.../NitroComposeHost.kt:248-262`) — and the stale "the gap is RN
    Modal" comment is replaced with the truth: in 0.88 `Modal` is a
    `ComponentDialog`, whose window already provides both, so this is a fallback
    for a parent that provides neither. R6 is closed with an on-device test that
    hosts, measures and takes props inside a Modal.
11. **`docs/architecture/core.md` is now buildable-from** for Slider and
    Progress: §5 threading/`hybridRef`, §6 recycling on both platforms, §7
    sizing, §8 what each perf mark does and does not mean per platform, §9 the
    checklists (testing, perf, and the file list a new component must touch —
    export, `api-extractor`, smoke line, `docs/components/<name>.md`), §10 the
    traps, then **§11 Slider** — emit at most one event per frame and coalesce
    to the newest, `NitroUiControlledValue.user()` exactly once per emitted
    event, `onValueChange` vs `onSlidingComplete`, why `reconcile` accepts a
    write as soon as `jsEvents >= nativeEvents` (during a drag native is ahead
    *by design*), exact float equality with no epsilon plus "quantise in native
    before emitting", the fact that **a native interaction must re-render
    itself** and how that differs per platform (Swift `objectWillChange.send()`
    in the binding setter; Compose a plain snapshot write and *no*
    `sendApplyNotifications()` outside `commit()`), and recomposition scoping —
    and **§12 Progress** — no handshake, no callbacks, what still applies.

## NITs

1. Kotlin colour decode is `raw.toLong().toInt()`, the bit-pattern rule from
   D10 (`android/.../HybridNitroUiSwitch.kt:193`).
2. `propsApplied` is aligned: Android marks every `updateState`, like iOS marks
   every commit, and `core.md` §8 documents both marks' real meaning (neither is
   a drawn frame; use T02's `BenchProbe` for a frame boundary).
3. `NitroUiTheme` wraps the dynamic colour scheme in
   `remember(context, dark)` (`android/.../NitroComposeHost.kt:391`).
4. §8 says the ring is mutex-guarded, not lock-free, and states the gating
   cost exactly: one integer compare for an unmarked view, one relaxed load for
   a marked one with recording off.
5. Kept as a T02 lead, and the suite now prints the number every run
   (`Switch stress: 40 hosted controls mounted in 287.7ms`).
6. `useStableCallback`'s doc comment states the `useMemo` caveat and that a
   changed callback prop is never re-invoked — which is why `hybridRef` fires
   once, at mount (`src/core/useStableCallback.ts:40-55`).
7. Documented as a Switch limit: no `ref` forwarding, no `aria-*` translation,
   and why a container-level `accessible`/`accessibilityRole` can hide the
   hosted control from the a11y tree.
8. Documented as a Switch limit: a rejected change reverts without animation
   (the thumb snaps back), on purpose for v0.1, with the file:line of the only
   place animation is suppressed.

## Judgement calls worth a second opinion

- **Recycling (B3)**: chosen on the evidence above — keep the dispose, document
  the ordering, let T02 measure the alternative with `enableViewRecycling` on.
  If the orchestrator would rather ship "survives recycling" now, the change is
  to skip `disposeComposition()` when the call came from
  `onDropViewInstance` and the pool accepted the view — RN gives no such signal,
  so it would need a flag of our own plus a leak budget.
- **Android intrinsic measure (SF6)**: left as-is with the reasoning in §7
  because doing it properly is T11's shadow-node design, not a one-line
  `Constraints()` swap; the record path is honest about which question it asks.
- **`wantsContentSize` stays on for Switch** rather than off-until-T11, because
  the harness test and `measureContent()` need a size and the measure is no
  longer per-commit. If T02's 200-row mount says otherwise, the flag is one
  line.

## Round-1 questions, resolved

Q4 is settled by the review and D14 (OS-versioned default now, runtime
measurement in T11). Q1 (the callback-prop amendment to D7, and the
unsigned-on-iOS colour rule) is recorded in `core.md` §3 and §"Colours" and as
N2/N3 in `docs/upstream.md`. Q2 (patches vs upstream) is now attributable per
entry in `docs/upstream.md`, each with an issue draft and a Removal line — say
the word and the harness patches come out. Q3 (safe area in the example/bench
apps) and Q5 (device contention) are still open, and Q5 got louder: this round
lost ~15 min to a stale `nitroui_t01` APK and to background jobs dying with
their shell, not to the code.
