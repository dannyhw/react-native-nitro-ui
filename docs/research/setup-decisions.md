# Repo setup, tooling and guardrails: decisions

Status: research, 2026-10-22. Read `nitro-patterns.md` first.

Everything marked **[verified]** was built and run in `/tmp/nitro-ui-setup-spike/` on this machine:
- Xcode 27 with an iPhone 17 simulator on iOS 27.0.
- Android emulator: API 35, arm64. The `Pixel_9` AVD is broken (empty `.avd` directory), so a scratch AVD was created and used.
- RN 0.88.0, Nitro 0.37.1, Expo 58.0.17.

Everything else comes from npm, GitHub or the reference clones.

## TL;DR

| # | Question | Decision |
|---|---|---|
| 1 | Scaffolding | `create-react-native-library@0.64.0 --type nitro-view --languages kotlin-swift --example vanilla`, then switch to bun (hoisted) and apply the edits in section 1. |
| 2 | Package shape | One npm package, **`react-native-nitro-ui`** (available on npm), with one root export. Peers: `react`, `react-native >=0.86`, `react-native-nitro-modules ^0.37.1`. No config plugin is needed. Compose is fully contained in the library's `build.gradle`. The podspec uses `min_ios_version_supported` (15.1), and newer SwiftUI APIs are gated with `#available`. |
| 3 | RN version | Expo SDK 58 = RN **0.88.0** / React 19.3.0, so the example app uses RN 0.88.0. Nitro's Android base-ViewProps bug is **fixed upstream but unreleased** (nightlies only). We ship a post-nitrogen patch plus a header-only helper. Nitro#1184 (null props) is **unfixed anywhere**: never declare `?:` view props, use `T \| null` and always pass every prop. |
| 4 | Apps | `example/`: bare RN 0.88 for development and Harness tests. `bench/`: Expo SDK 58 CNG app, release builds, comparing nitro-ui vs `@expo/ui` vs RN core. `scripts/smoke/`: `npm pack` installed into fresh Expo and RN CLI apps. |
| 5 | Testing | Jest (template preset) for JS. react-native-harness 1.6.0 in `example/` for on-device correctness and visual tests, on debug builds only. |
| 6 | Benchmarks | A dedicated release-build bench app with a private Nitro `BenchProbe` that takes native timestamps from Fabric mount observers plus the next vsync, measures per-thread CPU and memory footprint, and emits signposts and Trace sections. A host-side runner interleaves implementations, uses a fresh process per case, warmup 5, K=20, and reports median/MAD. CI gating uses **relative ratios only**. Reassure guards wrapper render counts only. Static rules (ESLint, nitrogen drift, API report, tarball manifest) are hard gates. |
| 7 | CI | GitHub Actions: ubuntu for JS and Android (KVM emulator), `macos-26` for iOS, plus the `xcode-27` preview label. Benchmarks run on demand (`/bench` comment or label) and nightly, report-only on hosted runners. Real-device numbers are local or self-hosted. |
| 8 | Release | release-it 21.1.1 with `@release-it/conventional-changelog` 12.0.2, run from a `workflow_dispatch` job with npm **trusted publishing** (OIDC, automatic provenance). Keep the template's `files` list. Gate on `publint` and a committed tarball manifest. |

---

## 1. Scaffolding

### Recommendation

Use create-react-native-library (bob) 0.64.0 with the `nitro-view` template and a vanilla example app. Generate it in a scratch directory, copy it into the repo, then apply the edits below.

```sh
cd /tmp && npx -y create-react-native-library@0.64.0 react-native-nitro-ui --no-interactive \
  --slug react-native-nitro-ui --description "SwiftUI and Jetpack Compose controls for React Native, powered by Nitro" \
  --author-name "Daniel Williams" --author-email daniel.williams@callstack.com --author-url https://github.com/<you> \
  --repo-url https://github.com/<org>/nitro-ui \
  --type nitro-view --languages kotlin-swift --example vanilla \
  --tools eslint --tools jest --tools lefthook --tools release-it
rsync -a --exclude .git /tmp/react-native-nitro-ui/ ~/Developer/oss/nitro-ui/
```

Repeat `--tools` once per tool. In the spike, `--tools a b c` silently kept only the first tool.

### What each option generated [verified]

| | create-react-native-library 0.64.0 (`nitro-view`) | create-nitro-module 3.7.1 (`-t view`) | Hand-rolled (nitro-image / nitro-input) |
|---|---|---|---|
| Layout | Library at the root, `example/` as a workspace | Library at the root plus `example/` (`--monorepo` puts it in `packages/`) | `packages/<lib>` + `example/` (+ `bench/`, `modules/`) |
| Package manager | Yarn 4.18.1, vendored in `.yarn/releases`, `nmHoistingLimits: workspaces` | npm/bun scripts, no lockfile | bun 1.3, `linker = "hoisted"` |
| RN / Nitro | **RN 0.88.0, React 19.3.0, nitro 0.37.1** | RN 0.86.0, React 19.2.3, **nitro 0.36.1** (stale) | Pinned by hand |
| JS output | bob `module` (ESM) + `typescript`, plus a `custom` target that runs nitrogen. `exports` map with a source condition. | Legacy `main`/`module`/`react-native` fields, CJS + ESM | bob |
| Example | Bare RN CLI app, with `ios/` and `android/` committed. `--example expo` gives an Expo 58 CNG app. | Bare RN 0.86 app, optional Harness (`--include-harness`) | Bare app |
| Extras | CI workflow (lint, build-library, build-android, build-ios with turbo cache and `RCT_USE_PREBUILT_RNCORE`), release-it config, lefthook, eslint 9 | Harness workflows, semantic-release, `fix-prefab.gradle`, `post-script.js` | Benchmarks, patches |

**Why bob:**
- It is the only generator that is current today (RN 0.88, nitro 0.37.1).
- It emits a correct ESM `exports` map, which passes publint.
- Callstack maintains it, so it stays aligned with Harness and Reassure.

create-nitro-module is a version behind on everything. A hand-rolled `packages/` monorepo adds indirection we don't need for a single package.

### Post-scaffold edits [all verified]

1. **Switch to bun 1.4, hoisted.** The machine has no yarn, and Node 26 has no corepack. bun also matches nitro, nitro-image and nitro-input.
   - Delete `.yarnrc.yml` and `.yarn/`.
   - Add `bunfig.toml` containing `[install]` / `linker = "hoisted"`.
   - Set `"packageManager": "bun@1.4.0"`.
   - Replace `yarn workspace react-native-nitro-ui-example` with `bun --cwd example`.
   - Hoisting puts everything in the root `node_modules`, so fix the example's hardcoded paths:
     - `example/android/settings.gradle`: both `includeBuild(...)` calls → `"../../node_modules/@react-native/gradle-plugin"`
     - `example/android/app/build.gradle`, inside `react { }`:
       ```groovy
       reactNativeDir = file("../../../node_modules/react-native")
       codegenDir     = file("../../../node_modules/@react-native/codegen")
       cliFile        = file("../../../node_modules/react-native/cli.js")
       hermesCommand  = "$rootDir/../../node_modules/hermes-compiler/hermesc/%OS-BIN%/hermesc"
       ```
       Without `hermesCommand`, release builds fail with "Couldn't determine Hermesc location".
     - The Podfile resolves its paths through `node -p require.resolve(...)`, so it needs no change.
   - Alternative: keep the template's vendored Yarn 4 and run `node .yarn/releases/yarn-4.18.1.cjs`. Contributors would find that awkward.
2. **Library `android/build.gradle`:** add Compose (section 2) and scope RN codegen:
   ```groovy
   react { jsRootDir = file("../src/"); libraryName = "nitroui"; codegenJavaPackageName = "com.margelo.nitro.nitroui" }
   ```
   Without this, the RN Gradle plugin scans the package root, including the dev `node_modules/react-native`. It regenerates every core TurboModule spec into the library, and `assembleRelease` then fails with `Type com.facebook.fbreact.specs.NativeAccessibilityInfoSpec is defined multiple times`. Debug builds pass, so the failure goes unnoticed. Rive does the same thing. This is worth reporting upstream to builder-bob.
3. **Nitro workaround scripts** (section 3):
   - Add `scripts/patch-nitrogen.mjs` and `cpp/NitroUiPropsCompat.hpp`.
   - Set `"nitrogen": "nitrogen && node scripts/patch-nitrogen.mjs"`. bob's `custom` target calls this script, so `prepare` and `npm pack` always ship patched code.
4. **Commit `nitrogen/generated/`.** nitro-image, nitro-input and Rive all do this. It makes codegen drift reviewable (section 6).
5. **Swift files need `import NitroModules`** for `NullType` and the variant types.
6. **Leave the iOS module name** `NitroUi` / Kotlin namespace `com.margelo.nitro.nitroui` as the template produced them, or rename them once in `nitro.json` before the first commit. Renaming later churns every generated file.

---

## 2. Package shape and zero-config install

### Name

| Name | Status |
|---|---|
| **`react-native-nitro-ui`** | **Available**. Use this. |
| `nitro-ui` | Taken: 0.0.1, "Nitro build tool", qodeninja |
| `@nitro-ui/core` | Taken: 1.0.7, "Core CSS for Nitro UI", icarasia. The scope is owned. |
| `@nitro-ui/react-native`, `react-native-nitro-native-ui`, `nitro-native-ui`, `@callstack/nitro-ui` | Available (`@callstack` requires org access) |

### Shape

**Single package, single native binary, one root export.**
- Keep the template's `exports`:
  ```json
  { ".": { "react-native-nitro-ui-source": "./src/index.tsx", "types": "./lib/typescript/src/index.d.ts", "default": "./lib/module/index.js" },
    "./nitrogen/generated/shared/json/*": "./nitrogen/generated/shared/json/*", "./package.json": "./package.json" }
  ```
- Add `"sideEffects": false`.
- Subpath exports buy nothing:
  - Metro doesn't tree-shake by default.
  - Every component's native code is linked anyway, as one pod and one AAR.
  - Splitting into multiple packages multiplies install steps, which defeats the "trivial setup" goal.
- Add a subpath later only for an opt-in extra with heavy JS.
- Alternative: an `@expo/ui`-style split into `/swift-ui` and `/jetpack-compose` subpaths. Rejected for v1; a single universal API is simpler for users.

**Peer dependencies:**
```json
"peerDependencies": { "react": "*", "react-native": ">=0.86.0", "react-native-nitro-modules": "^0.37.1" }
```
- `>=0.86` covers Expo SDK 57 (RN 0.86.3) and SDK 58 (RN 0.88.0).
- `^0.37.1` means `<0.38.0`, because generated code is tied to the runtime's minor version.
- Bump to `^0.37.2` when it ships, and drop the workaround.

### What users do [verified end-to-end with `npm pack`]

```sh
# Expo (dev build / CNG, not Expo Go)
npx expo install react-native-nitro-ui react-native-nitro-modules
npx expo prebuild   # or: npx expo run:ios / run:android / eas build

# React Native CLI
npm i react-native-nitro-ui react-native-nitro-modules
cd ios && pod install
```

**Autolinking:**
- On Expo, the `pod install` that prebuild triggers logged `Auto-linking React Native modules for target expoconsumer: NitroModules and NitroUi`.
- On Android, both apps picked up `NitroUiPackage` through RN CLI autolinking (`autolinkLibrariesFromCommand`). Expo delegates non-Expo modules to the same mechanism.
- **No config plugin and no `app.json` changes were needed.**
- Tested combinations:
  - fresh `create-expo-app --template blank-typescript@sdk-58`: Android release build, iOS release build on the simulator
  - fresh `@react-native-community/cli@20.2.0 init --version 0.88.0`: Android release build
  - Every build rendered the Compose or SwiftUI control.

### Jetpack Compose inside the library (host app needs zero changes) [verified]

**How Expo UI does it** (`@expo/ui@58.0.22`, `android/build.gradle`):
- A `buildscript` classpath for `org.jetbrains.kotlin.plugin.compose...:${kotlinVersion}`
- `apply plugin: 'org.jetbrains.kotlin.plugin.compose'`
- `buildFeatures { compose true }`
- Explicit `androidx.compose.*` 1.12.1 and material3 1.5.0-beta01 dependencies

Ours is the same idea, with a BOM. It worked unchanged in the RN CLI example, the RN CLI consumer and the Expo consumer:

```groovy
buildscript {
  // Compose compiler plugin version MUST equal the host's Kotlin Gradle Plugin version.
  // RN CLI apps set ext.kotlinVersion = "2.2.0" (RN 0.88 template); Expo's expo-root-project sets it too.
  def kotlinVersion = rootProject.ext.has("kotlinVersion") ? rootProject.ext.get("kotlinVersion") : "2.2.0"
  repositories { google(); mavenCentral() }
  dependencies {
    classpath "org.jetbrains.kotlin.plugin.compose:org.jetbrains.kotlin.plugin.compose.gradle.plugin:${kotlinVersion}"
  }
}
// ... existing template content (com.android.library, kotlin-android if absent, nitrogen autolinking, com.facebook.react)
apply plugin: "org.jetbrains.kotlin.plugin.compose"
android {
  buildFeatures { prefab true; compose true }
}
dependencies {
  implementation "com.facebook.react:react-android"
  implementation project(":react-native-nitro-modules")
  implementation platform("androidx.compose:compose-bom:2026.09.00")   // latest BOM on maven.google.com today
  implementation "androidx.compose.material3:material3"
  implementation "androidx.compose.ui:ui"
  implementation "androidx.compose.foundation:foundation"
}
```

Toolchain notes:
- RN 0.88 uses AGP 9.2.1, Kotlin 2.2.0 and Gradle 9.4.1. The Expo SDK 58 template sets `android.builtInKotlin=false`. The template's guard (`if (project.extensions.findByName("kotlin") == null) apply plugin: "kotlin-android"`) handled both setups.
- Compose material3 from BOM 2026.09 compiled fine with Kotlin 2.2.0.
- Risk: a future BOM built with a newer Kotlin version could need a newer compiler. Pin the BOM, and let the CI matrix catch it.

### iOS deployment target

**Podspec:** `s.platforms = { :ios => min_ios_version_supported }`, which resolves to **15.1** on RN 0.88. Expo SDK 58 apps use 16.4.
- Never set it higher than the RN CLI template's floor. CocoaPods rejects a pod whose deployment target is above the app's, so RN CLI users would have to edit their Podfile. That breaks zero-config.
- Gate SwiftUI APIs per component or modifier with `if #available(iOS 16/17/18/26, *)`, for example `@Observable` (17), `.sensoryFeedback` (17) and Liquid Glass (26). Below the required version, components fall back to the closest older API or render nothing, with a `__DEV__` warning.
- Document a "supported features by iOS version" table.
- Use `ObservableObject` (iOS 13+) for the per-view model, not `@Observable`. That keeps the root generic-free on 15.1.
- Android `minSdk` stays at RN's 24. Compose needs 23+.

### Native styling gotchas found in the spike

- **iOS:** the `UIHostingController` view is opaque by default and hides RN's `backgroundColor`. Set `host.view.backgroundColor = .clear`. Border and opacity worked.
- **Android:** even with the ViewProps fix, `borderWidth`/`borderColor` are **not** drawn on a Hybrid View. The generated manager is a `SimpleViewManager`, and border props live in `ReactViewManager`. `backgroundColor`, `opacity`, `transform`, `testID` and accessibility props work after the fix. Either document "use a wrapping `View` for borders and radius", or implement border and radius props in Compose.

---

## 3. RN version alignment and the two Nitro bugs

**Versions:**
- Expo SDK 58 (`expo@58.0.17`, `bundledNativeModules.json`): **react-native 0.88.0, react 19.3.0**. SDK 57 used RN 0.86.3.
- RN 0.88.0 was released on 2026-10-15.
- **Example app:** RN 0.88.0. Expo SDK 58 is on the same RN, so one RN version serves both.
- CI adds an RN 0.86 consumer smoke test for the peer-dependency floor.

### Android base ViewProps dropped (nitro#1655 → #1656)

**Status:**
- #1655 was **closed unmerged**. The maintainer asked for the fix to move into nitrogen-generated Props with `filterObjectKeys` and a version gate. #1661 was also closed.
- The real fix is **#1749 "fix: restore Android base View props"**, merged 2026-10-19 (commit `ffd9031`). Issue #1656 is closed as completed.
- It shipped **only** in nightlies:
  - `react-native-nitro-modules@0.37.2-nightly.*` (dist-tag `nightly` = `0.37.2-nightly.62.gfb894f673ff0`)
  - `1.0.0-alpha.nightly.*` (dist-tag `alpha-nightly`, which requires `react-native >=0.88`; Nitro v1 also moves to SwiftPM)
- `latest` is still 0.37.1, from 2026-08-27, and does **not** contain it. I grepped the tarballs.

**How the upstream fix works:**
- In nightlies, nitrogen generates `HybridXProps::HybridXProps(...) { #ifdef ANDROID nitro::RawPropsCompat::initializeDynamicProps(*this, sourceProps, rawProps, filterObjectKeys); #endif }`.
- That helper lives in the runtime (`cpp/views/RawPropsCompat.cpp`). It is version-gated:
  - RN ≥0.87: always called.
  - RN 0.84–0.86: called only when `enableExclusivePropsUpdateAndroid` is on.
- So a library generated with nightly nitrogen **will not build** for users on nitro-modules 0.37.1, because the header and symbol are missing. Shipping nightly codegen is therefore not an option.

**Our fix:** keep nitrogen 0.37.1, then post-process its output so the fix lives entirely in our package.
- `cpp/NitroUiPropsCompat.hpp` is a header-only copy of the upstream helper, under the namespace `::nitroui::compat`. Do not put it in `nitroui::`, which collides with the generated `margelo::nitro::nitroui`.
- `scripts/patch-nitrogen.mjs`:
  - rewrites `) { }` at the end of each `nitrogen/generated/shared/c++/views/*Component.cpp` Props constructor into a call to the helper, and adds the `#include`
  - is idempotent
  - **skips files that already contain upstream's `RawPropsCompat::initializeDynamicProps`**
  - exits 1 if the pattern isn't found, so a nitrogen upgrade can't silently drop the fix
  - Both files are in `/tmp/nitro-ui-setup-spike/crnl/react-native-nitro-ui/{scripts,cpp}/`. Copy them.
- This works because `RN_SERIALIZABLE_STATE` is already defined for our library by nitrogen's `+autolinking.cmake` (`add_definitions(-DRN_SERIALIZABLE_STATE)`). `Props::initializeDynamicProps` is a public RN method.
- **Before and after:** on an Android emulator with RN 0.88, the Nitro view ignored `backgroundColor` and `opacity`. After the patch it applies them, in the example app and in both consumer apps.
- **Removal plan:** when 0.37.2 stable ships, bump nitrogen and the peer to `^0.37.2`. The script then becomes a no-op; delete it.
- Rejected alternatives:
  - patch-package: we can't patch a consumer's `node_modules`.
  - A hand-written `ViewManager` that serializes props itself: it duplicates generated state-updater code for every view.

```cpp
// cpp/NitroUiPropsCompat.hpp (shipped)
#pragma once
#include <react/renderer/core/Props.h>
#include <react/renderer/core/RawProps.h>
#ifdef ANDROID
#include <cxxreact/ReactNativeVersion.h>
#if REACT_NATIVE_VERSION_MAJOR == 0 && REACT_NATIVE_VERSION_MINOR >= 84 && REACT_NATIVE_VERSION_MINOR < 87
#include <react/featureflags/ReactNativeFeatureFlags.h>
#endif
#endif
namespace nitroui::compat {
inline void initializeDynamicProps([[maybe_unused]] facebook::react::Props& props, [[maybe_unused]] const facebook::react::Props& sourceProps,
                                   [[maybe_unused]] const facebook::react::RawProps& rawProps,
                                   [[maybe_unused]] bool (*filterObjectKeys)(const std::string&)) {
#if defined(ANDROID) && defined(RN_SERIALIZABLE_STATE)
#if REACT_NATIVE_VERSION_MAJOR > 0 || REACT_NATIVE_VERSION_MINOR >= 87
  props.initializeDynamicProps(sourceProps, rawProps, filterObjectKeys);
#elif REACT_NATIVE_VERSION_MINOR >= 84
  if (facebook::react::ReactNativeFeatureFlags::enableExclusivePropsUpdateAndroid()) props.initializeDynamicProps(sourceProps, rawProps, filterObjectKeys);
#endif
#endif
}
}
```

### Null props crash (nitro#1184)

**Status:**
- **Open.** It is not fixed in 0.37.2 or 1.0 nightlies: `JSIConverter<std::optional<T>>` still accepts only `undefined`.
- **Reproduced:** on Android with RN 0.88, a `label?: string` prop going from `'x'` to `undefined` crashes the app with `Exception in HostFunction: NitroUi.label: Value is null, expected a String`. Fabric sends `null` for removed props.

**Our rule, enforced by lint and tests:**
- **No optional (`?:`) props in `HybridViewProps`** in `*.nitro.ts`.
- "Unset" is modelled as `T | null`. Nitrogen maps it to `Variant_NullType_T`; in Kotlin that's `.asSecondOrNull()`, in Swift `if case .second(let v)`.
- Props with a natural default are non-optional, and the default is supplied in JS.
- The JS wrapper always passes every native prop (`label ?? null`).
- **Verified:** with `label: string | null` toggling between a value and `null`, there was no crash across 200+ ticks on Android and 20+ ticks on iOS.
- nitro-input follows the same "never send undefined" rule and has a Jest test for it (`NitroNumber.test.tsx`). Copy that test.

---

## 4. Example, bench and consumer smoke apps

**Recommendation: three app surfaces, each with one job.**
- **`example/`** (from the template): bare RN 0.88 with `ios/` and `android/` committed.
  - Used for the day-to-day playground, the Harness tests and debugging native code in Xcode or Android Studio.
  - Bare makes native iteration faster (no prebuild), and Harness CI workflows target it directly.
- **`bench/`**: Expo SDK 58 CNG app, with native dirs gitignored and `expo prebuild --clean` in CI.
  - It must be Expo because the `@expo/ui` comparison needs `expo` and Expo Modules.
  - It also continuously exercises the Expo/CNG install path with a workspace build.
  - Contains `bench/modules/bench-probe`, a private local Nitro module that is never published.
- **Consumer smoke tests** (`scripts/smoke/*.sh`): run on every release candidate and nightly. This is the only true check of "trivial install".
  - Rejected alternative: a single Expo example app. It is slower for native iteration and hides bare-specific issues.

**Smoke scripts.** These steps worked in the spike; bake them into scripts:

```sh
# scripts/smoke/pack.sh
bun run prepare && npm pack --pack-destination "$OUT"            # runs nitrogen + patch via bob custom target

# scripts/smoke/expo.sh   (SDK=58 | 57)
npx -y create-expo-app@latest expo-consumer --template blank-typescript@sdk-$SDK --no-install
cd expo-consumer && npm install && npm install "$OUT"/react-native-nitro-ui-*.tgz react-native-nitro-modules@^0.37.1
cp "$ROOT/scripts/smoke/App.tsx" App.tsx                          # renders every component once, with testIDs
CI=1 npx expo prebuild --no-install && (cd ios && pod install)
(cd android && ./gradlew :app:assembleRelease -PreactNativeArchitectures=$ABI)
xcodebuild -workspace ios/*.xcworkspace -scheme expoconsumer -configuration Release -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/build ARCHS=arm64 CODE_SIGNING_ALLOWED=NO build

# scripts/smoke/rn-cli.sh  (RN=0.88.0 | 0.86.3)
npx -y @react-native-community/cli@20.2.0 init RnConsumer --version $RN --skip-install --skip-git-init --install-pods false
cd RnConsumer && npm install && npm install "$OUT"/react-native-nitro-ui-*.tgz react-native-nitro-modules@^0.37.1
cp "$ROOT/scripts/smoke/App.tsx" App.tsx && (cd ios && pod install) && <same gradle/xcodebuild as above>
# then: install, launch, wait for "Running \"main\"|\"RnConsumer\"" in logcat / sim log, screenshot, assert no FATAL
```

**Install source:** use `npm` in consumers, not bun, because that's what most users run.

**Release builds:** build consumers in Release, which embeds the bundle. A smoke test then doesn't depend on Metro or ports, and it also catches release-only failures such as the dex-duplicate bug. Debug builds in this spike could not reach Metro on a non-default port; I did not investigate further.

---

## 5. Testing

- **Jest:** keep the template's config (`preset: '@react-native/jest-preset'`, jest ^29.7, `customExportConditions` including the source condition). Write unit tests for wrapper logic:
  - prop normalisation, including that host props never contain `undefined`
  - stable callbacks
  - style splitting
  
  `@testing-library/react-native` 14.1.0.
- **react-native-harness 1.6.0** in `example/`, for on-device correctness: props reach native, events, `hybridRef` methods, recycling, screenshot assertions.
  ```sh
  bun add -d --cwd example react-native-harness@1.6.0 @react-native-harness/platform-apple@1.6.0 \
    @react-native-harness/platform-android@1.6.0 @react-native-harness/ui@1.6.0
  ```
  - `@react-native-harness/ui` has native code, so rebuild the app after adding it. It is excluded from release builds.
  - No Metro, Babel or entry changes are needed in 1.5+. The CLI wraps the Metro config and swaps the entry itself.

  `example/rn-harness.config.mjs`:
  ```js
  import { androidPlatform, androidEmulator } from '@react-native-harness/platform-android';
  import { applePlatform, appleSimulator } from '@react-native-harness/platform-apple';
  const CI = process.env.CI === 'true';
  export default {
    entryPoint: './index.js',
    appRegistryComponentName: 'NitroUiExample',
    runners: [
      applePlatform({ name: 'ios', bundleId: 'nitroui.example',
        device: appleSimulator(process.env.IOS_SIM ?? 'iPhone 17', process.env.IOS_VERSION ?? '27.0') }),
      androidPlatform({ name: 'android', bundleId: 'nitroui.example',
        device: androidEmulator(process.env.AVD ?? 'Pixel_9', { apiLevel: 36, profile: 'pixel_9', diskSize: '2G', heapSize: '1G', snapshot: { enabled: CI } }) }),
    ],
    defaultRunner: 'ios',
    resetEnvironmentBetweenTestFiles: 'runtime',
    testTimeout: CI ? 30000 : 10000, platformReadyTimeout: CI ? 900000 : 300000,
    bridgeTimeout: 120000, bundleStartTimeout: 120000, maxAppRestarts: 4,
    detectNativeCrashes: true, forwardClientLogs: true,
  };
  ```

  `example/jest.harness.config.mjs`:
  ```js
  export default { preset: 'react-native-harness', testMatch: ['<rootDir>/**/__tests__/**/*.harness.[jt]s?(x)'] };
  ```

  - **Run:** `cd example && bunx react-native-harness --harnessRunner ios|android`. It must run from the app's directory (#273).
  - **Supports:**
    - iOS simulators and devices, Android emulators and devices, and web.
    - `screen.findByTestId` on native views, including Nitro views.
    - `screen.screenshot()` and `toMatchImageSnapshot`. Commit the baselines: a missing baseline passes (#198).
  - **Limitations:**
    - It does **not** build the app. You install a prebuilt app or pass `HARNESS_APP_PATH`.
    - It runs **debug builds only**, which is why it isn't the benchmark driver.
    - There is no timing API.
  - **Known issues:**
    - Two copies of `react-native` in a monorepo break view configs (#215). The hoisted bun layout avoids this.
    - On Android, `TextureView`/`SurfaceView` screenshots come out transparent (#197).
  - Margelo uses the same Harness version for Nitro's own view tests on RN 0.88.
- Visual snapshots belong in Harness, not in the benchmark app.

---

## 6. Benchmarks and performance guardrails

### Architecture

**`bench/` app:** Expo SDK 58, built in **release** (Hermes bytecode, R8, no dev tools).
- It contains one screen per scenario × implementation. Implementations:
  - `rn-core`, a control. For Switch, use `react-native`'s `Switch`. For other controls, use a plain `View` floor.
  - `expo-ui-host-per-control`
  - `expo-ui-shared-host` (N controls in one `Host` + `VStack`/`Column`; this is Expo's best case)
  - `nitro-ui`
- Expo UI requires a `<Host>`, so both Expo configurations are required for a fair comparison. TextFields in Expo UI are driven by `ObservableState`, so compare them as "controlled vs native-state" explicitly.
- The app reads a **plan** at launch and runs it unattended:
  - iOS: `xcrun simctl launch --terminate-running-process <udid> <bid> -benchPlan mount:nitro-ui:200`
  - Android: `adb shell am start -S -n <pkg>/.MainActivity --es benchPlan mount:nitro-ui:200`
- It writes NDJSON to the app container (pulled with `xcrun simctl get_app_container` or `adb exec-out run-as <pkg> cat files/bench.ndjson`). It also logs with a `NITRO_BENCH` prefix as a fallback.

**`bench/modules/bench-probe`:** a private Nitro HybridObject (Swift and Kotlin). All timestamps are in ns on one monotonic clock:
- iOS: `clock_gettime_nsec_np(CLOCK_UPTIME_RAW)`
- Android: `System.nanoTime()`, which matches Choreographer frame times. Not `elapsedRealtimeNanos`.

| Method | iOS | Android |
|---|---|---|
| `now(): number` | `clock_gettime_nsec_np(CLOCK_UPTIME_RAW)` | `System.nanoTime()` |
| `armMountObserver()` / `lastMountNs` | `RCTSurfacePresenterObserver.didMountComponentsWithRootTag:` (RN 0.88 `RCTSurfacePresenterStub.h`) | `UIManagerListener.didMountItems` (`FabricUIManager.addUIManagerEventListener`) |
| `nextFrameNs(): Promise<number>` | one-shot `CADisplayLink` after mount → `targetTimestamp` | `Choreographer.postFrameCallback` after `didMountItems` → `frameTimeNanos` |
| `threadCpuNs(thread: 'main' \| 'js')` | `thread_info(THREAD_BASIC_INFO)` | `/proc/self/task/<tid>/stat` utime+stime |
| `footprintBytes()` | `task_info(TASK_VM_INFO).phys_footprint` | `Debug.MemoryInfo` `getTotalPss()` + `summary.java-heap`/`summary.graphics` (slow; use outside timed regions) |
| `gc()` | n/a (settle) | `Runtime.getRuntime().gc()` + settle |
| `begin/end(name, id)` | `OSSignposter(subsystem: "nitro-ui.bench", category: .pointsOfInterest)` | `Trace.beginAsyncSection/endAsyncSection` |

The library itself emits **signposts and Trace sections** on its hot paths. Each one is a single static-flag check, compiled out unless `NITRO_UI_TRACING` is set (an Xcode build setting / Gradle `buildConfigField`). The instrumented paths are:
- prop setter → `afterUpdate()`
- SwiftUI body evaluation / Compose recomposition (via `Modifier.drawWithContent`)

These are white-box diagnostics. They let Instruments (`xcrun xctrace record --template 'Time Profiler' --instrument os_signpost`) or Perfetto (`record_android_trace -a <pkg>` + `trace_processor_shell` SQL on `slice`) explain a regression. They are **not** the gating metric, because they can't be applied to `@expo/ui` or RN core.

### Metrics

All metrics are black-box and identical for every implementation.

| Metric | Definition |
|---|---|
| **Mount(N)**, N ∈ {1, 50, 200} | `t0 = probe.now()` right before `setState({n: N})`. Report three durations: **JS commit** (t0 → `useLayoutEffect` in the parent), **mounted** (t0 → `lastMountNs`) and **presented** (t0 → `nextFrameNs()` after mount). |
| **Update latency**, N ∈ {1, 50} | K prop flips (for example `value` or `isOn`), each awaited to its next frame. Same three durations. |
| **JS-thread time per update** | `React.Profiler` `actualDuration`, plus a JS-thread CPU ns delta over the batch divided by K |
| **UI-thread CPU per update / mount** | Main-thread CPU ns delta over the batch. This catches expensive `setContent` or `rootView` rebuilds that latency alone can hide. |
| **Memory per instance** | `(footprint(N=200) − footprint(N=0)) / 200` after GC and a 1 s settle, as a median over launches |
| **Unmount(N)** and **leak slope** | Mount, then unmount ×10, then the footprint delta. Fail on a monotonic increase. |
| **Scroll FPS** (macro, Android) | Flashlight (`flashlight test --bundleId … --testCommand "maestro test scroll.yaml" --iterationCount 10`) on a FlatList of 200 rows of controls. Run it nightly and locally only. It samples every 500 ms, so it can't gate per-update latency. Its latest npm release dates from 2024; treat it as optional. |

### Noise control

**Protocol:**
- Release builds.
- Animations off (`adb shell settings put global *_animation_scale 0`).
- A **fresh process per (scenario, implementation)**.
- A 1 s settle after launch.
- **5 warmup + 20 measured** iterations per launch, taking the median per launch.
- **4 launches per implementation**, interleaved ABBA (nitro, expo, expo, nitro, …). This is nitro's own `performance.yml` scheme.
- Report the **median of medians ± MAD** and the p95 of presented latency.
- On real devices, wait for thermal state to return to nominal (`ProcessInfo.thermalState` / `PowerManager.getCurrentThermalStatus`) before each launch. This follows nitro-input.

**What gates, and where:**
1. **Hard gates in every PR** (deterministic):
   - Lint rules
   - nitrogen drift
   - API report
   - Tarball manifest
   - Jest
   - **Reassure render counts** for the JS wrappers: `measureRenders` with `runs: 10`. Any change in render count fails.
   
   Reassure measures nothing native. Use it only to stop wrapper re-render and memoisation regressions.
2. **Relative perf check on PRs, on demand** (`/bench` comment or `perf` label), on hosted runners:
   - Build **base and head** bench apps in the same job, then run them interleaved on the same simulator or emulator.
   - Compute `head/base` ratios per metric.
   - Also compute `nitro-ui/rn-core` ratios in the same run as a sanity control. If the control itself moved more than 10%, mark the run "noisy, inconclusive" instead of failing.
   - Comment the table on the PR.
   - **Fail** only if a ratio is over 1.20 on hosted machines (1.10 on a real device) and the bootstrap 95% CI of the ratio excludes 1.05, for any metric × scenario.
3. **Committed baselines:** `bench/baselines/{ios-iphone17-sim,android-api36-emu,ios-<device>,android-<device>}.json`. These are used for trend tracking and release gating, **with tolerances only on ratios vs `rn-core`** (absolute numbers drift with runner images). They are updated in a dedicated PR with `bun bench --update-baseline`.
   - Optionally push results to Bencher or `benchmark-action/github-action-benchmark` (`customSmallerIsBetter`) for charts.

**Commands:**
```sh
bun bench --platform ios --device "iPhone 17" --plan quick|full [--compare <git-ref>]
bun bench --platform android --serial emulator-5554 --plan quick|full [--compare <git-ref>]
# scripts/bench/run.mjs: builds (or reuses) release apps, loops plans with fresh launches, pulls NDJSON,
# scripts/bench/report.mjs: aggregates -> bench/results/<sha>.json + markdown table; --check against baseline
```

### Static guardrails

**ESLint.** These `no-restricted-syntax` selectors were verified against typescript-eslint:
```js
// eslint.config.mjs (add to the template's flat config)
{ files: ['src/**/*.nitro.ts'], rules: { 'no-restricted-syntax': ['error',
  { selector: "TSTypeReference[typeName.name='AnyMap']", message: 'No AnyMap in specs: declare a typed struct.' },
  { selector: 'TSPropertySignature[key.name=/json$/i]', message: 'No JSON-string props: use typed structs.' },
  { selector: "TSInterfaceDeclaration[extends.0.expression.name='HybridViewProps'] TSPropertySignature[optional=true]",
    message: 'Optional view props crash when removed (nitro#1184): use `T | null` and always pass it.' },
] } },
{ files: ['src/**/*.tsx', 'example/**/*.tsx', 'bench/**/*.tsx'], rules: { 'no-restricted-syntax': ['error',
  { selector: "JSXAttribute > JSXExpressionContainer > CallExpression[callee.name='callback']",
    message: 'Inline callback() re-sends the prop every render: memoize it (useStableCallback).' },
] } },
```
- Optionally also flag `ObjectExpression` and `ArrayExpression` literals passed directly to host components in `src/`, which cause identity-diff churn.
- Also ban `require('...nitrogen/generated/...json')` outside `src/native/`.

**Nitrogen drift:** the `nitrogen-drift` job runs
```sh
bun run nitrogen && git diff --exit-code -- nitrogen/ cpp/
```
`bun run nitrogen` includes the patch step. The job also asserts `grep -L "nitro-ui: initializeDynamicProps\|RawPropsCompat::initializeDynamicProps" nitrogen/generated/shared/c++/views/*Component.cpp` is empty.

**API surface:**
- `@microsoft/api-extractor` 7.59.4, with the report at `etc/react-native-nitro-ui.api.md`. CI runs `api-extractor run` and fails on an unreviewed change; developers update it locally with `--local`.
- The native-facing surface is already reviewable as `nitrogen/generated/shared/json/*Config.json` diffs.

**Package contents:**
- `npm pack --dry-run --json | jq -r '.[0].files[].path' | sort > /tmp/files.txt && diff etc/package-files.txt /tmp/files.txt`
- `npx publint@0.3.25 --strict`
- `npx @arethetypeswrong/cli@0.18.5 --pack --profile esm-only` as a sanity check only, because it doesn't model the `react-native` condition.

**Native lint:** ktlint/ktfmt for Kotlin and swift-format for Swift. These are nice to have; add them after v0.1.

---

## 7. CI (GitHub Actions)

Use the template's `ci.yml` and composite `setup` action as the base, swapping yarn for `oven-sh/setup-bun@v2` (`bun-version-file: package.json`, `bun install --frozen-lockfile`). Pin actions by SHA, as the template already does.

| Workflow / job | Runner | Trigger | Content |
|---|---|---|---|
| `ci.yml: lint` | ubuntu-latest | PR, push | eslint, tsc, jest, reassure (base vs head), api-extractor, nitrogen drift, tarball manifest, publint |
| `ci.yml: build-android` | ubuntu-latest | PR | JDK 17 (zulu), `gradle/actions/setup-gradle@v6` with `cache-provider: basic` (MIT; v6's default cache component is proprietary), cache `example/android/app/.cxx`, `./gradlew :app:assembleRelease -PreactNativeArchitectures=x86_64` (release catches dex issues) |
| `ci.yml: build-ios` | `macos-26` (Xcode 26.6 default) **and** `xcode-27` (preview label, Xcode 27.0, iOS 27 sims) | PR | `sudo xcode-select -s /Applications/Xcode_<v>.app`, ccache (`hendrikmuhs/ccache-action@v1.2`, `C_COMPILER_LAUNCHER`), Pods cache keyed on `Podfile.lock`+`bun.lock`, `RCT_USE_PREBUILT_RNCORE=1 RCT_USE_RN_DEP=1`, matrix `USE_FRAMEWORKS: [unset, static]` (nitro does this, and Expo users often have static frameworks) |
| `harness-ios.yml` | macos-26 | PR | build Debug sim app → `callstackincubator/react-native-harness@v1.6.0` (`runner: ios`, `app: ios/build/.../NitroUiExample.app`, `projectRoot: example`, `packageManager: bun`) |
| `harness-android.yml` | ubuntu-latest | PR | KVM udev rule, `assembleDebug -PreactNativeArchitectures=x86_64` → harness action (`runner: android`, it boots and caches the AVD; `cacheSavePolicy: never` if the Metro cache env-var limit bites, per nitro-input) |
| `smoke.yml` | ubuntu (Android) + macos-26 (iOS) | nightly, pre-release, `workflow_dispatch` | `scripts/smoke/{expo,rn-cli}.sh` for {Expo 58, Expo 57} × {RN 0.88, 0.86} |
| `bench.yml` | ubuntu-latest + KVM (API 36 x86_64 emulator via `reactivecircus/android-emulator-runner@v2.38.0` or the harness action's AVD logic) and macos-26 sim | `/bench` comment from a writer, `perf` label, nightly on main | base and head release bench apps, interleaved run, PR comment, artifacts |
| `release.yml` | ubuntu-latest | `workflow_dispatch` | see section 8 |

**Realistic expectations:**
- **Timings** (warm caches, from nitro's recent runs):
  - iOS build: 4–8 min
  - Harness iOS: 9–14 min
  - Android build: 3–8 min
  - Harness Android: about 5 min
  - A cold iOS build takes 20–30 min.
- **Cost:** standard runners are free for public repos. Larger runners are never free.
- **Benchmarks on hosted runners** are report-only by default, with only coarse gating on relative ratios. Shared VMs and software-GPU emulators are too noisy for absolute numbers.
  - Trustworthy per-device numbers should come from a **local run on real devices** (and the README benchmarks).
  - A self-hosted Mac mini with an attached iPhone and Pixel is the upgrade path for nightly real-device gating.
  - Blacksmith runners (which nitro uses) are a cheaper middle ground.
  - CodSpeed only fits pure-JS microbenchmarks (prop normalisation), and is optional.

---

## 8. Release

**Recommendation:**
- release-it 21.1.1 + `@release-it/conventional-changelog` 12.0.2. This is the template's own option, so it's already configured: `release-it --only-version`, the angular preset, `v${version}` tags, a GitHub release, and npm publish.
- Use Conventional Commits, enforced with lefthook `commit-msg` + commitlint.
- Run it from CI with **npm trusted publishing**.
- Alternative: changesets 3.0.3 (`changesets/action@v2`). Better for multi-package repos or reviewed changelog entries; overkill for one package.

```yaml
# .github/workflows/release.yml
name: Release
on: { workflow_dispatch: { inputs: { increment: { type: choice, options: [patch, minor, major, prerelease] } } } }
permissions: { contents: write, id-token: write }
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v7
        with: { node-version: 24, registry-url: https://registry.npmjs.org }
      - run: npm i -g npm@latest            # trusted publishing needs npm >= 11.5.1
      - uses: oven-sh/setup-bun@v2
        with: { bun-version-file: package.json }
      - run: bun install --frozen-lockfile && bun run prepare && git diff --exit-code -- nitrogen/
      - run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          bunx release-it ${{ inputs.increment }} --ci
        env: { GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} }
```

**Trusted publishing:**
- The **first publish is manual** (`npm publish --access public`).
- Then configure the package's Trusted Publisher (repo + `release.yml`) and enable "disallow tokens".
- `repository.url` must match the GitHub repo exactly.
- Provenance is automatic, so no `--provenance` flag and no `NPM_TOKEN` are needed.
- release-it shells out to `npm publish`. That's fine; don't use `yarn npm publish`.
- Gate the release job on the `smoke.yml` result for the same SHA (`needs` it via `workflow_call`).

**`files`:** keep the template list. It's correct for Nitro, and `!**/.*` already excludes `android/.cxx` and `android/.gradle`. The spike's 67-file tarball contained exactly `src`, `lib`, `android/{build.gradle,CMakeLists.txt,src}`, `ios/*.swift`, `cpp/`, `nitrogen/generated/**`, `nitro.json`, `*.podspec`, `README` and `LICENSE`.
```json
"files": ["src","lib","android","ios","cpp","nitrogen","nitro.json","*.podspec","react-native.config.js",
  "!ios/build","!android/build","!android/gradle","!android/gradlew","!android/gradlew.bat",
  "!android/local.properties","!**/__tests__","!**/__fixtures__","!**/__mocks__","!**/.*"]
```
- `scripts/` is not shipped, so the patched generated code must be committed and packed (it is).
- Add `app.plugin.js` only if a config plugin is ever needed. Today it isn't.

---

## Target repo layout

```
nitro-ui/
  package.json  bunfig.toml  bun.lock  nitro.json  NitroUi.podspec  eslint.config.mjs  lefthook.yml  .release-it (in package.json)
  src/                      # *.nitro.ts specs (no `?:` props), wrapper components, hooks (useStableCallback)
  ios/  android/  cpp/      # Swift/SwiftUI, Kotlin/Compose, NitroUiPropsCompat.hpp
  nitrogen/generated/       # committed, patched
  scripts/patch-nitrogen.mjs  scripts/smoke/  scripts/bench/
  example/                  # bare RN 0.88 + Harness (__tests__/*.harness.tsx, __image_snapshots__/)
  bench/                    # Expo SDK 58 CNG bench app, modules/bench-probe, baselines/*.json
  etc/                      # react-native-nitro-ui.api.md, package-files.txt
  docs/research/
```

## Open risks

1. **Nitro 0.37.2 / 1.0 transition.**
   - Our ViewProps patch depends on nitrogen 0.37.1's exact output shape. The script fails loudly if that shape changes.
   - Nitro 1.0 (alpha nightlies) requires RN ≥0.88 and moves to SwiftPM. A 1.0 migration will be needed within months.
   - Watch the `nightly` and `alpha-nightly` dist-tags. Test `0.37.2-nightly` in a CI canary job.
2. **nitro#1184 is unfixed.** The "no optional props" rule is ergonomically costly: `Variant_NullType_T` on the native side. Contribute an upstream fix that treats `null` as `nullopt` in `JSIConverter<std::optional>`; it's a small change.
3. **Compose compiler plugin = host Kotlin version.**
   - Hosts that override `kotlinVersion` (Expo `expo-build-properties` `android.kotlinVersion`) get that version of the compose plugin. That's fine as long as it is ≥2.0 and the BOM's libraries are readable by that compiler.
   - Add a smoke variant with Kotlin overridden to a newer version.
4. **Android borders and radius on Hybrid Views** are not applied (`SimpleViewManager`). Decide between native support and documenting a wrapping `View`.
5. **Leaf views and no Yoga measure** (see `nitro-patterns.md`): controls need explicit size or a JS-side measure. That affects benchmark comparability with `@expo/ui`'s `matchContents`.
6. **The iOS 15.1 floor** forces `#available` branches everywhere. Revisit if RN raises `min_ios_version_supported`.
7. **Hosted-runner benchmark noise** may make even ratio gates flaky. Be ready to make PR perf report-only and gate only nightly on self-hosted devices.
8. **Harness is debug-only, and some issues are open** (#198 missing snapshots pass, #215 duplicate RN, #273 cwd). Pin 1.6.0 and commit snapshot baselines.
9. **Builder-bob template bugs** found in the spike:
   - no `react { jsRootDir }`, so release builds fail with duplicate dex classes
   - the `--tools` multi-value parsing issue
   
   Report both upstream. Our repo carries the fixes either way.
10. **Local AVD `Pixel_9` is broken** (empty `~/.android/avd/Pixel_9.avd`). Recreate it, or use the AVD the Harness action creates in CI.
11. **Debug-build Metro connectivity on a non-default port** failed in the spike and was not investigated. Release-build smoke tests sidestep it.
