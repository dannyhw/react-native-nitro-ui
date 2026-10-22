# T01 — Report

Branch `task/T01-scaffold`. Repo scaffolded, toolchain wired, guardrails enforced,
`NitroUiCore` shipped as the first piece of the core module, and both example apps
built and tested on device/emulator.

## Gates

| Gate | Command | Result |
| --- | --- | --- |
| Clean install | `rm -r node_modules && bun install --frozen-lockfile` | PASS — 1205 packages, 4.5 s, dependency patch re-applied automatically |
| Aggregate | `bun run check` | PASS |
| Types | `bun run typecheck` | PASS |
| Lint | `bun run lint` | PASS (4 local perf-contract rules active) |
| Format | `bun run format` | PASS |
| Unit tests | `bun run test` | PASS — 3 suites, 28 tests |
| Nitrogen drift | `bun run nitrogen:check` | PASS — "no drift (14 generated files match, 0 view(s) patched)" |
| Patch idempotency | `bun run nitrogen` ×3, then `diff -r` copy-vs-regenerated | PASS — byte-identical |
| Library build | `bun run prepare` | PASS (bob: nitrogen + babel + tsc) |
| Publish surface | `bun run publint` | PASS — "All good!" (zero warnings) |
| Tarball manifest | `bun run manifest:check` | PASS — 43 files match `etc/package-files.txt` |
| iOS build | `xcodebuild -workspace NitroUiExample.xcworkspace -scheme NitroUiExample -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath build CODE_SIGNING_ALLOWED=NO build` | PASS (Xcode 27.0) |
| iOS harness | `HARNESS_APP_PATH=$PWD/ios/build/Build/Products/Debug-iphonesimulator/NitroUiExample.app bunx react-native-harness --harnessRunner ios` | PASS — 4/4 on `iPhone 17` (iOS 27.0, UDID `F08675D3-A32B-4F88-BC81-02D7E0CB797E`) |
| Android debug | `./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a` | PASS |
| Android release | `./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a` | PASS — 43 s (release/dex path, i.e. the `jsRootDir` fix works) |
| Android harness | `HARNESS_APP_PATH=$PWD/android/app/build/outputs/apk/debug/app-debug.apk bunx react-native-harness --harnessRunner android` | PASS — 4/4 on AVD `nitroui_t01` (`emulator-5570`, API 35) |

Both harness runs were re-run from a clean install with the app **uninstalled** from
the device, so the harness's own install path is covered too.

## Files

- Scaffold: everything from `create-react-native-library@0.64.0 --type nitro-view
  --languages kotlin-swift --example vanilla` (generator run in a temp dir, then
  rsynced; `docs/` and `AGENTS.md` kept), plus the §1 post-scaffold edits.
- Core: `src/NitroUiCore.nitro.ts`, `src/NitroUiCore.ts`, `src/index.ts`,
  `cpp/HybridNitroUiCore.{hpp,cpp}`, `nitro.json`, `android/CMakeLists.txt`,
  `android/src/main/java/.../NitroUiPackage.kt`.
- Codegen: `nitrogen/generated/**` (committed), `cpp/NitroUiPropsCompat.hpp`,
  `scripts/patch-nitrogen.mjs`, `scripts/nitrogen-check.mjs`.
- Guardrails: `eslint.config.mjs`, `eslint-rules/index.js` (+
  `eslint-rules/__tests__/rules.test.js`), `scripts/package-files.mjs`,
  `etc/package-files.txt`, `scripts/__tests__/patch-nitrogen.test.js` + fixtures,
  `src/__tests__/NitroUiCore.test.ts`.
- Harness: `example/rn-harness.config.mjs`, `example/jest.harness.config.mjs`,
  `example/__tests__/NitroUiCore.harness.tsx`, `example/src/App.tsx`.
- CI: `.github/actions/setup/action.yml` (bun), `.github/workflows/ci.yml`,
  `.github/workflows/release.yml`.
- Docs: `README.md`, `CONTRIBUTING.md`.
- `patches/@react-native-harness%2Fplatform-apple@1.6.0.patch`.

## Decisions

- **`NitroUiCore` is C++** (one implementation, one clock) and exposes
  `now(): number` — monotonic ms with ns resolution. `std::chrono::steady_clock`
  is `CLOCK_UPTIME_RAW` on Apple (same base as `CACurrentMediaTime`) and
  `CLOCK_MONOTONIC` on Android (same base as `System.nanoTime()`), which is the
  clock pair `docs/research/setup-decisions.md` §6 mandates for the bench probe.
  The T01 brief mentioned `elapsedRealtimeNanos`; see questions — that clock
  includes suspend time and would disagree with Choreographer frame times.
- **`NitroUiPackage.kt` is now an empty `BaseReactPackage`** whose companion
  object loads the native lib (`nitrouiOnLoad.initializeNative()`). RN
  autolinking still finds the package; there are no view managers until T10.
- **Compose/SwiftUI configuration is in place with no view code**: `android/build.gradle`
  applies the compose compiler (keyed to `rootProject.ext.kotlinVersion`) plus
  `compose-bom:2026.09.00`, `buildFeatures { prefab; compose }`, and the podspec
  already compiles `cpp/**`. T10 adds views into an already-working pipeline
  instead of discovering build-config problems in a component task.
- **Metro default is 8291**, overridable with `METRO_PORT`; CI relies on the
  default. Simulators/emulators are told the port at launch, so it is not baked
  into builds.
- **`nitrogen/generated/` committed**, drift-gated by `nitrogen:check`; the
  nitro#1655 patch script exits non-zero if its anchor moves and no-ops while no
  views exist.
- **Local ESLint plugin instead of an app-level plugin package** — the four
  perf-contract rules run through the real flat config (verified by firing each
  rule) and are unit-tested with `RuleTester`.
- **Tarball manifest** compares `npm pack --dry-run --json --ignore-scripts`
  against `etc/package-files.txt`; `--ignore-scripts` keeps `prepare` output from
  corrupting the JSON (it was: bob logs landed on stdout).
- **`publint` at zero warnings**: dropped the template's
  `./nitrogen/generated/shared/json/*` export (nothing generates those files) and
  set the implicit `"type": "commonjs"` explicitly (bob already scopes
  `lib/module/package.json` to `type: module`).
- **Prettier ignores `docs/` and `AGENTS.md`**, like ESLint already did: these are
  orchestrator-owned inputs, and a `prettier --write .` pass had rewritten them.

## Deviations from `docs/research/setup-decisions.md` / the brief

1. **Metro port 8091 → 8291.** On this machine 8091 is held by a long-running
   human dev server (and 8081 by another). The port is configurable, so nothing
   is lost; `METRO_PORT=8091` still works where 8091 is free.
   This also **closes open risk #11** in the research doc: a debug build on a
   non-default Metro port works on both platforms (harness overrides the JS
   location on iOS, `adb reverse` on Android).
2. **Clock base** is `CLOCK_UPTIME_RAW` / `CLOCK_MONOTONIC` rather than
   "elapsedRealtime equivalent" (see decisions + questions).
3. **iOS CI runs on the `xcode-27` label** (a GitHub preview image). §7 lists
   `macos-26` + `xcode-27`; `macos-26`'s default Xcode is 26.6, which has no iOS
   27 simulator runtime, and the harness config must name a simulator runtime
   version. One job (`harness-ios`) builds the Debug app and runs the tests, so
   there is no artifact handoff; a `macos-26` row can be added once the iOS floor
   is decided.
4. **Harness jobs live inside `ci.yml`** as jobs (4 jobs: checks, build-android,
   harness-android, harness-ios) because the brief asked for "android build +
   harness, ios build + harness" in that file, rather than the separate
   `harness-ios.yml` / `harness-android.yml` of §7.
5. **Added a dependency patch** (`patches/…platform-apple@1.6.0.patch`, applied by
   bun via `patchedDependencies`): react-native-harness 1.6.0 calls
   `simctl appinfo` through a spawn that rejects on non-zero exit, and Xcode 27
   exits 3 with "Application not found" for an uninstalled bundle id. So
   `isAppInstalled()` threw instead of returning false and the harness died with
   a masked `AbortError` on any simulator where the app was not already
   installed. The patch maps that specific output to "not installed" and still
   rethrows anything else. Android's `pm list packages` check is unaffected.
6. **api-extractor not added** (brief: optional). `etc/` holds only
   `package-files.txt` today; see questions.
7. Also out of T01 scope but worth noting: `reassure`, `scripts/smoke/`, `bench/`
   and a config plugin are absent by design (T02/T03), and there are no native
   formatters (ktlint/swift-format/clang-format) wired into `check` yet.

## Environment notes

- AVD `nitroui_t01` created per the brief
  (`system-images;android-35;google_apis;arm64-v8a`, `-d pixel_9`), booted
  headless on port 5570. Shut down at the end of this task. The `iPhone 17`
  simulator booted by the harness was shut down too. `emulator-5560`
  (`PR1505_Pixel`) was never touched.
- **Lefthook side effect:** `bun install` auto-installs its git hooks into the
  shared `git` directory, i.e. `/Users/daniel.williams/Developer/oss/nitro-ui/.git/hooks/{pre-commit,commit-msg}`,
  with absolute paths pointing at this worktree's `node_modules`. That would make
  commits in the main checkout (which has no `node_modules`) shell out to
  `npx eslint`. I removed both hooks again after committing; contributors who run
  `bun install` inside a worktree should expect the same, and can undo it with
  `LEFTHOOK=0` or by deleting the two hook files.

## Follow-ups

- The ViewProps patch is pinned to nitrogen 0.37.1's output shape; the anchor
  failure mode is loud, but an upgrade will need the fixture + anchor revisited.
- Add `USE_FRAMEWORKS: [unset, static]` and an Xcode matrix to `harness-ios` if
  Expo static-framework users need coverage (§7), plus a `smoke.yml` gate on
  `release.yml` once T03 exists.
- File the react-native-harness `simctl appinfo` bug upstream and delete
  `patches/` when a release fixes it.
- `example/jest.config.js` is a template leftover; the harness uses
  `example/jest.harness.config.mjs`. Harmless, can be pruned later.

## Questions for orchestrator

1. **Clock semantics for `nitroUiCore.now()`** — I use `CLOCK_UPTIME_RAW` (Apple) /
   `CLOCK_MONOTONIC` (Android), matching §6's bench-probe clocks; the brief said
   "`SystemClock.elapsedRealtimeNanos` equivalents", and elapsedRealtime keeps
   counting during suspend. Recommendation: keep the current clocks and update the
   brief's wording, because T02's Choreographer-based numbers must share this time
   base. Needs a decision before T02, not before T10.
2. **iOS CI floor** — is the `xcode-27` preview label acceptable for CI, or should
   the gate run on `macos-26` (Xcode 26.6) with an iOS 26 simulator? That also
   decides `min_ios_version_supported` usage in the example. Recommendation: keep
   `xcode-27` now, add a `macos-26` row when the supported floor is a product
   decision rather than an image availability one.
3. **Metro port allocation** — T01's default is 8291 (documented in
   `CONTRIBUTING.md`). If T02/T03/T10 can run concurrently, each brief should
   assign an explicit `METRO_PORT` (and device) instead of inheriting the default.
   Recommendation: add a one-line "Metro port" to each future brief.
4. **api-extractor** — add `etc/react-native-nitro-ui.api.md` now, or when the
   public surface becomes real in T10? Recommendation: T10; the API today is one
   internal clock accessor, so a report file would be churn.
5. **`patches/` in the repo** — acceptable as the mechanism for the harness bug
   fix, or do you prefer to pin/avoid something else? Recommendation: keep the
   patch (it is small, self-documenting and auto-applied by `bun install`).
