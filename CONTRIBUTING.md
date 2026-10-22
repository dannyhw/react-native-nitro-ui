# Contributing

Everything in this file is a contract: CI and other tasks run these exact
commands. If you change one, change it here too.

## Prerequisites

- [bun](https://bun.sh) 1.4 — the package manager for this repo (`packageManager`
  in `package.json`). Do not add `yarn`/`npm` lockfiles.
- Xcode 26 or 27 (Xcode 27 if you want the iOS 27 simulator runtime), CocoaPods
- JDK 17, Android SDK (`ANDROID_HOME`) with an emulator image for API 35
- Node >= 22 (used by tooling; bun runs the scripts)

Install dependencies once at the repo root — the example app shares the root
install (hoisted layout, see `bunfig.toml`):

```sh
bun install
```

## Repository layout

```
src/                 Nitro IDL specs (*.nitro.ts) + JS wrappers
cpp/ ios/ android/   C++ core, SwiftUI hosting, Compose hosting
nitrogen/generated/  nitrogen output — committed, patched, drift-checked
scripts/           patch-nitrogen.mjs, nitrogen-check.mjs, package-files.mjs
eslint-rules/        local ESLint plugin enforcing the perf contract
etc/                 package-files.txt (the published tarball manifest)
example/             bare RN app + react-native-harness tests
docs/research/       architecture + tooling decisions (read before coding)
```

## Scripts

Run from the repo root.

| Command                    | What it does                                                         |
| -------------------------- | -------------------------------------------------------------------- |
| `bun run check`            | **All static gates.** Run this before pushing.                       |
| `bun run typecheck`        | `tsc` over the library and example                                   |
| `bun run lint`             | ESLint, including the local perf-contract rules                      |
| `bun run format`           | Prettier check (`format:write` to fix)                               |
| `bun run test`             | Jest unit tests (JS wrappers, lint rules, patch script)              |
| `bun run nitrogen`         | Regenerate Nitro code, then apply `scripts/patch-nitrogen.mjs`       |
| `bun run nitrogen:check`   | Regenerate into a temp dir and fail on drift against `nitrogen/`     |
| `bun run prepare`          | Build `lib/` with builder-bob (also runs `nitrogen`)                 |
| `bun run publint`          | Validate `package.json` publish surface                              |
| `bun run manifest:check`   | Tarball contents must equal `etc/package-files.txt`                  |
| `bun run manifest:update`  | Rewrite the manifest after an **intentional** publish-surface change |
| `bun run harness:ios`      | On-device tests on iOS (see below)                                   |
| `bun run harness:android`  | On-device tests on Android (see below)                               |
| `bun run example <script>` | Run an `example/` script, e.g. `bun run example ios`                 |
| `bun run clean`            | Delete build outputs (`lib/`, native build dirs)                     |

`bun run check` = typecheck → lint → format → test → nitrogen:check → prepare →
publint → manifest:check.

### Changing the published surface

`etc/package-files.txt` is the reviewed list of published files. Adding a source
directory to `files` in `package.json` changes it; run `bun run manifest:update`
and review the diff so codegen or native sources can never silently disappear
from the tarball.

## Nitrogen and the ViewProps patch

`bun run nitrogen` runs `nitrogen` and then `scripts/patch-nitrogen.mjs`, which
re-adds the base `ViewProps` that nitrogen 0.37.1 drops for generated view
specs (nitro#1184/#1655) using `cpp/NitroUiPropsCompat.hpp`. The script:

- hard-fails if its anchor is missing, so a nitrogen upgrade can't silently
  drop the patch;
- is a no-op while the package has no Hybrid Views.

`nitrogen/generated/` is committed on purpose (reviewable codegen, no install-time
codegen) and `bun run nitrogen:check` guards it. Never edit generated files by
hand — change the script or the spec.

## Running the example app

```sh
bun run example ios          # builds + launches on a simulator
bun run example android
bun run example start        # plain Metro (port 8081)
```

## Running the on-device (Harness) tests

`react-native-harness` runs `.harness.tsx` files **inside the app**; it does not
build the app and it runs debug builds only. So: build first, then point the
harness at the artifact.

### iOS

```sh
cd example/ios
pod install
xcodebuild -workspace NitroUiExample.xcworkspace -scheme NitroUiExample \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath build CODE_SIGNING_ALLOWED=NO build

cd ..
HARNESS_APP_PATH="$(pwd)/ios/build/Build/Products/Debug-iphonesimulator/NitroUiExample.app" \
  bunx react-native-harness --harnessRunner ios
```

### Android

```sh
cd example/android
./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a   # x86_64 on Intel/CI

cd ..
HARNESS_APP_PATH="$(pwd)/android/app/build/outputs/apk/debug/app-debug.apk" \
  bunx react-native-harness --harnessRunner android
```

`harness:ios` / `harness:android` are shortcuts for the last command in each
pair; you still need the build (and `pod install`) before them.

### Devices and ports

Device selection lives in `example/rn-harness.config.mjs` and is
environment-overridable, because every task gets its own device:

| Variable            | Default       | Meaning                                   |
| ------------------- | ------------- | ----------------------------------------- |
| `IOS_SIM`           | `iPhone 17`   | Simulator name                            |
| `IOS_VERSION`       | `27.0`        | Simulator runtime (the version is needed) |
| `AVD`               | `nitroui_t01` | Emulator name (the harness creates it)    |
| `ANDROID_API_LEVEL` | `35`          | AVD system image                          |
| `METRO_PORT`        | `8291`        | Metro port                                |

Metro deliberately does **not** use the default 8081: this repo is often worked
on alongside other React Native checkouts, and a busy port makes the harness
hang. Simulators and emulators are told which port to use when the harness
launches the app, so nothing is baked into the build; a stock `react-native
start` is still on 8081. Set `METRO_PORT` when two harness runs must share one
machine — the harness fails fast with `MetroPortUnavailableError` rather than
attaching to someone else's Metro.

Only start devices you need, and shut them down afterwards.

## Perf contract

Hybrid Views are easy to make slow, so these rules are enforced by the local
ESlint plugin in `eslint-rules/` (see `eslint.config.mjs`):

| Rule                                 | Enforces                                                                                      |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| `nitro-ui/no-inline-callback-in-jsx` | No `callback={...}` written inline in JSX; pass a stable callback (`useStableCallback`)       |
| `nitro-ui/no-anymap-in-spec`         | No `AnyMap` props in `*.nitro.ts` — use typed props                                           |
| `nitro-ui/no-json-string-prop`       | No `*Json`/`*JSON` string props — pass structured values                                      |
| `nitro-ui/no-optional-view-props`    | No `?:` members in Hybrid View props; use `T \| null` and always send every prop (nitro#1184) |

The rest of the contract is review-checked (see `AGENTS.md` and
`docs/research/nitro-patterns.md`): prop setters only store and mark dirty, one
`afterUpdate()` applies, hosting views are created once at init, `RecyclableView`
resets everything, no JS↔main thread blocking hops, and controlled values use the
event-count handshake.

## Commit messages and releases

Conventional Commits, checked by commitlint through the lefthook `commit-msg`
hook (`pre-commit` runs ESLint on staged files plus `tsc`). `@release-it` with
the conventional-changelog preset derives versions and changelogs from them, so
`feat`/`fix`/`BREAKING CHANGE` matter.

Releases are done from CI (`.github/workflows/release.yml`, manual dispatch, npm
trusted publishing). Do not run `bun run release` locally.

## Sending a pull request

- Install dependencies, then `bun run check`.
- If you touched specs or native code, run the example builds and the harness
  tests on both platforms.
- CI mirrors these gates; anything CI runs is listed in this file.
