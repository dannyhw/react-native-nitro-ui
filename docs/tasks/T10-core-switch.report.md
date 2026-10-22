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
