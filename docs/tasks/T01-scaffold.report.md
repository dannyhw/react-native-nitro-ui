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

## Questions for orchestrator — Resolved

All five were answered by the orchestrator (recorded in `docs/DECISIONS.md` on
`main`; that file is not edited from this branch).

1. **Clock semantics** — Resolved: `nitroUiCore.now()` stays on
   `CLOCK_UPTIME_RAW` (Apple) / `CLOCK_MONOTONIC` (Android). No change; T02's
   Choreographer numbers share this base.
2. **iOS CI floor** — Resolved: the `xcode-27` preview label is OK for
   `harness-ios`. A `macos-26` row stays a later product decision.
3. **Metro port / device allocation** — Resolved: parallel tasks must be
   env-driven, not default-driven. `example/rn-harness.config.mjs` now takes
   `METRO_PORT`, `IOS_SIM_UDID` (or `IOS_SIM`), and `ANDROID_AVD` with neutral
   defaults, documented in `CONTRIBUTING.md`. Future briefs can pass their own
   values without editing the repo.
4. **api-extractor** — Resolved: deferred to T10, when the public surface is
   real. Nothing added here.
5. **`patches/`** — Resolved: acceptable for dev-only patches. The
   `@react-native-harness/platform-apple` patch stays until upstream ships a
   fix; it is dev/test-only and is not part of the published tarball.

# Round 2

Review `docs/tasks/T01-scaffold.review.md` (committed in this round): all
SHOULD-FIX #1–#8 and every NIT are addressed. No BLOCKING items existed. Nothing
here is a "declined" item; one finding is recorded as a documented gap rather
than a fix (#5, third bullet).

## SHOULD-FIX

1. **Hooks no longer leak across worktrees.** `package.json` now declares
   `"trustedDependencies": ["@parcel/watcher", "esbuild", "unrs-resolver"]`, so
   `bun install` refuses lefthook's postinstall and installs **zero** git hooks.
   Opt-in is `bun run hooks:install` (and `bun run hooks:uninstall`), and both
   `lefthook.yml` commands use `bunx --no-install` so a hook never needs a
   network install or an absolute path into one worktree's `node_modules`
   (`commitlint --edit {1}` replaced the `--print-config`-style invocation).
   The Yarn-ism `dependenciesMeta` block is gone. Verified: in a throwaway git
   repo with this `package.json` + `bun.lock`, `bun install` leaves
   `.git/hooks` at `*.sample` only, and `bun pm untrusted` blocks exactly
   lefthook. `lefthook` remains in `devDependencies` and the shared
   `/Users/daniel.williams/Developer/oss/nitro-ui/.git/hooks/` was checked: it
   already holds only `*.sample` files, so there was nothing to delete. This
   also retires the round-1 "Lefthook side effect" note above.
   - Finding worth recording: **bun treats an empty `trustedDependencies` array
     as unset** and falls back to its built-in list, which trusts lefthook. The
     array must be non-empty and explicit — verified with a matrix of
     absent/empty/explicit installs.
2. **`harness-ios` Ruby.** `.github/workflows/ci.yml` pins
   `ruby-version: '3.3'` on the iOS job (`example/Gemfile` requires >= 2.6.10 and
   there is no `.ruby-version`), so the job gets past "Setup Ruby" before
   `bundle install`.
3. **Trusted publishing.** `package.json` release-it config is now
   `"npm": { "publish": true, "skipChecks": true }`, and the release workflow
   (`release.yml`) runs `bun run check` and then
   `git diff --exit-code -- nitrogen/`, so a build that regenerates codegen fails
   the release instead of publishing a drift.
4. **Entry guard.** `scripts/patch-nitrogen.mjs` uses `invokedDirectly()`:
   `import.meta.main` when the loader sets it, otherwise it compares
   `realpathSync(fileURLToPath(import.meta.url))` against
   `realpathSync(resolve(process.argv[1]))`. The old `argv[1].includes(...)`
   test silently no-opped. `scripts/__tests__/patch-nitrogen.test.js` now runs an
   `it.each` over a path containing a space, `#`, `%` and a non-ASCII directory,
   asserting a changed-shape fixture exits non-zero every time; the legacy guard
   was confirmed to exit 0 (silent no-op) on the same fixtures, so these are real
   regression tests. JSDoc status union gained `'error'`.
5. **`no-optional-view-props` false negatives.** `eslint-rules/index.js` now
   resolves interface extends transitively, follows type aliases and
   intersections, matches qualified names on the right-most segment
   (`nitro.HybridObject`), and roots the search at view boundaries
   (`HybridView<P, M>`, `NitroView`, `viewProps(...)`/`view(...)`/`component<P>()`)
   instead of one hardcoded name. Reports are `TSPropertySignature[optional]`
   from `container.body ?? container.members`, so the TS-estree shape used by the
   parser is covered. Plain (non-view) structs and method-only interfaces still
   produce no diagnostics — new valid/invalid fixtures cover both. Rule tests are
   up to 34 (5 new invalid, 2 new valid cases).
   `no-inline-callback-in-jsx` was hardened the same way: it binds the
   `callback` import from `react-native-nitro-modules` including aliases
   (`import { callback as cb }`), handles `JSXSpreadAttribute`
   (`{...{ onX: callback(fn) }}`), and reports once per attribute instead of
   twice for nested JSX. `const c = callback(fn)` in a render body stays a
   documented gap (not a JSX attribute), and the JSDoc says so. `isSpecFile`
   collapsed to the single `/\.nitro\.tsx?$/` test.
6. **Nitrogen only scans `src/`.** `package.json` runs `nitrogen src`, and
   `scripts/nitrogen-check.mjs` invokes nitrogen with `join(root, "src")`, so
   nothing outside the library can create library codegen. `nitro.json` also
   carries `ignorePaths` for `node_modules`, `example`, `bench`, `lib`, `dist`,
   `docs`, `scripts`, `patches` as a second line of defence (strict JSON —
   comments there break nitrogen). Verified: codegen output is byte-identical
   before/after the scoping, and a probe `bench/src/BenchProbe.nitro.ts` produced
   **no** files under `nitrogen/generated`. `scripts/__tests__/
   nitrogen-scope.test.js` guards the contract so T02 cannot quietly widen it.
   The future bench app ships its own nitro module with its own `nitro.json`.
7. **Root configs are bench-ready.** `tsconfig.json` gained
   `include: ["src", "example/src", "example/__tests__"]` and
   `exclude: ["node_modules", "**/node_modules", "lib", "bench", "docs"]` (which
   also stops stale `lib/**/*.d.ts` from entering the program);
   `tsconfig.build.json` is `include: ["src"]` / `exclude: ["example", "bench",
   "lib", "node_modules"]`; jest ignores `<rootDir>/bench/`; `eslint.config.mjs`
   switched from a few repo-root strings to glob ignores (`**/build/`,
   `**/Pods/`, `**/.gradle/`, `**/.cxx/`, `**/.expo/`, `**/dist/`,
   `**/vendor/`, `**/node_modules/`) and the spec-only rules also apply to
   `bench/**/*.nitro.ts`; `.prettierignore` covers bench build outputs,
   `example/vendor`, `**/Pods`, `**/.expo`; `turbo.json` now watches `bun.lock`
   instead of `.yarnrc.yml`. So an Expo app in `bench/` plus `example/vendor`
   cannot break `bun run check`.
8. **Device selection is fully env-driven.** `example/rn-harness.config.mjs`
   reads `IOS_SIM_UDID` (resolved through `xcrun simctl list -j devices` into a
   name + runtime, because the harness API only accepts name + version; it hard
   errors on an unknown UDID and on same-name/same-runtime twins rather than
   guessing), `IOS_SIM`/`IOS_VERSION` (neutral `iPhone 17` / `27.0`),
   `ANDROID_AVD` (neutral `nitroui`, with `AVD` accepted as a legacy alias),
   `ANDROID_API_LEVEL`, `AVD_PROFILE` and `METRO_PORT` (8291). No task-specific
   identity remains. Documented in `CONTRIBUTING.md` under "Devices and ports",
   including the recommendation that parallel tasks each pass their own UDID, AVD
   and port.

## NITs

- `CONTRIBUTING.md`: ViewProps references corrected to nitro#1655/#1656, and the
  rule is described as "no `callback(...)` **call** inside a JSX attribute"; the
  opt-in hooks section and the slow-`pre-commit` note were added.
- `publint` now runs with `--strict` in the gate.
- `scripts/nitrogen-check.mjs` compares against `git ls-files nitrogen/` (fs
  fallback keeps `.gitattributes`), so an untracked `.DS_Store` no longer reads
  as drift.
- `.github/actions/setup/action.yml` cache key includes `patches/**`, so an
  edited patch invalidates `node_modules`.
- `package.json` `files` dropped the nonexistent `react-native.config.js`
  (`ios/` still appears in round 1's note; T10 creates it).
- `CODE_OF_CONDUCT.md` contact is `me@dannyhw.com`.
- `example/README.md` says bun and explains the monorepo layout;
  `example/jest.config.js` deleted (`git rm`) — the harness uses
  `example/jest.harness.config.mjs`.

## Round-2 gates

| Gate | Command | Result |
| --- | --- | --- |
| Aggregate | `bun run check` | PASS — typecheck, lint, format, 47 tests (4 suites), `nitrogen:check` "no drift (14 generated files match, 0 view(s) patched)", bob build, `publint --strict` "All good!", manifest 43 files |
| Clean install | `bun install --frozen-lockfile` | PASS — `bun.lock` records the trusted list (`esbuild`, `unrs-resolver`, `@parcel/watcher`) and no hooks land in `.git/hooks` |
| Codegen scope | `bun run nitrogen` then `git diff -- nitrogen/` | PASS — no diff; probe spec under `bench/src` generates nothing |
| Spaced path | run `scripts/patch-nitrogen.mjs` against a changed-shape fixture from a path with a space (and `#`, `%`, non-ASCII) | PASS — exits non-zero with the anchor error; asserted in `scripts/__tests__/patch-nitrogen.test.js` |
| iOS harness | `cd example && IOS_SIM_UDID=F08675D3-A32B-4F88-BC81-02D7E0CB797E METRO_PORT=8291 HARNESS_APP_PATH="$PWD/ios/build/Build/Products/Debug-iphonesimulator/NitroUiExample.app" bunx react-native-harness --harnessRunner ios` | PASS — 4/4; the run logs "Booting iOS simulator iPhone 17", i.e. the UDID was resolved to the harness's name+version form |
| Rule tests | `bun run test -- eslint-rules` | PASS — 34 rule cases |

Round 1's iOS `.app` was reused (nothing native or in `example/src` changed this
round); Android was not re-run, which the round-2 brief allows. After the harness
run the simulator was `Shutdown`, nothing was listening on 8291, and no
harness/Metro processes remained. Devices started in round 1 (`nitroui_t01` AVD,
`iPhone 17` sim) were already shut down at the time, and `emulator-5560`
(`PR1505_Pixel`) was never touched.

## Follow-ups

- Reviewer notes for T10 (view managers, per-view `autolinking` entries,
  `manifest:update`, expect "1 view(s) patched") and T03 (`manifest:check` needs
  `lib/` first) still stand; T02's #6/#7 concerns are now prevented by the
  `src`-scoped codegen and the bench-ready configs, and it must keep `bench`
  hoisted on the same RN version to avoid the duplicate-RN problem (harness #215).
- ViewProps patch remains pinned to nitrogen 0.37.1's output shape; the anchor
  failure mode is loud and now fails even from awkward paths.
- Add `USE_FRAMEWORKS: [unset, static]` and an Xcode matrix to `harness-ios` if
  Expo static-framework users need coverage (§7), plus a `smoke.yml` gate on
  `release.yml` once T03 exists.
- File the react-native-harness `simctl appinfo` bug upstream and delete
  `patches/` when a release fixes it.
