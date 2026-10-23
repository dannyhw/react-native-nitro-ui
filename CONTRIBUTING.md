# Contributing

Everything in this file is a contract: CI and other tasks run these exact
commands. If you change one, change it here too.

## Prerequisites

- [bun](https://bun.sh) 1.4 — the package manager for this repo (`packageManager`
  in `package.json`). Do not add `yarn`/`npm` lockfiles.
- Xcode 26 or 27 (Xcode 27 if you want the iOS 27 simulator runtime), CocoaPods
- JDK 17, Android SDK (`ANDROID_HOME`) with an emulator image for API 35
- Node 22.11 - 24 — `.nvmrc` pins one, and the device gates refuse to start on
  anything else (bun runs the scripts, but Node transforms the tests). Node 25
  and 26 die later inside `react-native-harness`'s Jest transform with
  `Must use import to load ES Module … react-native/index.js`, which reads like
  a bug in the test file and is not one; the harness and real-input entry points
  now say this up front instead.

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
bench/               release-build benchmark app + private BenchProbe Nitro module
scripts/bench/       bench build/run/report tooling
scripts/perf/        Reassure render-count gate
docs/research/       architecture + tooling decisions (read before coding)
```

## Scripts

Run from the repo root.

| Command                     | What it does                                                         |
| --------------------------- | -------------------------------------------------------------------- |
| `bun run check`             | **All static gates.** Run this before pushing.                       |
| `bun run typecheck`         | `tsc` over the library and example                                   |
| `bun run bench:typecheck`   | `tsc` over `bench/` for each platform                                |
| `bun run lint`              | ESLint, including the local perf-contract rules                      |
| `bun run format`            | Prettier check (`format:write` to fix)                               |
| `bun run test`              | Jest unit tests (JS wrappers, lint rules, patch script)              |
| `bun run nitrogen`          | Regenerate Nitro code, then apply `scripts/patch-nitrogen.mjs`       |
| `bun run nitrogen:check`    | Regenerate into a temp dir and fail on drift against `nitrogen/`     |
| `bun run autolinking:check` | RN CLI + Expo autolinkers must both resolve `NitroUiPackage`         |
| `bun run prepare`           | Build `lib/` with builder-bob (also runs `nitrogen`)                 |
| `bun run publint`           | Validate `package.json` publish surface                              |
| `bun run manifest:check`    | Tarball contents must equal `etc/package-files.txt`                  |
| `bun run manifest:update`   | Rewrite the manifest after an **intentional** publish-surface change |
| `bun run harness:ios`       | On-device tests on iOS (see below)                                   |
| `bun run harness:android`   | On-device tests on Android (see below)                               |
| `bun run smoke:pack`        | `npm pack` the library into `$SMOKE_TMP/tarballs` (see below)        |
| `bun run smoke:expo`        | Install the packed lib into a fresh Expo app, Release, on-device     |
| `bun run smoke:rn-cli`      | Same for a fresh React Native CLI app                                |
| `bun bench`                 | Run the on-device benchmarks (see "Running the benchmarks")          |
| `bun run bench:report`      | Re-render an existing results file, no device needed                 |
| `bun run probe:nitrogen`    | Regenerate the private `bench/modules/bench-probe` Nitro code        |
| `bun run perf:renders`      | Reassure render-count gate for the JS wrappers                       |
| `bun run example <script>`  | Run an `example/` script, e.g. `bun run example ios`                 |
| `bun run hooks:install`     | Install optional git hooks (see "Commit messages and releases")      |
| `bun run hooks:uninstall`   | Remove them again                                                    |
| `bun run clean`             | Delete build outputs (`lib/`, native build dirs)                     |

`bun run check` = typecheck → bench:typecheck → lint → format → test →
perf:renders → nitrogen:check → autolinking:check → prepare → publint →
manifest:check. `perf:renders` is part of `check` on purpose: render counts are
deterministic, so they can block, unlike anything measured on a device.

### Changing the published surface

`etc/package-files.txt` is the reviewed list of published files. Adding a source
directory to `files` in `package.json` changes it; run `bun run manifest:update`
and review the diff so codegen or native sources can never silently disappear
from the tarball.

## Nitrogen and the ViewProps patch

`bun run nitrogen` runs `nitrogen src` and then `scripts/patch-nitrogen.mjs`,
which re-adds the base `ViewProps` that nitrogen 0.37.1 drops for generated view
specs (nitro#1655/#1656; #1184 is the separate null-props crash) using
`cpp/NitroUiPropsCompat.hpp`.

Only `src/` is scanned (and `nitro.json` lists `example`, `bench`, `lib`, `dist`,
`docs`, `scripts`, `patches` in `ignorePaths`), so a `*.nitro.ts` spec that
belongs to another nitro module in this repo — T02's private bench probe in
`bench/` — can never end up in this package's generated code or autolinking. A
second app/module brings its own `nitro.json` and runs nitrogen itself.

The patch script:

- hard-fails if its anchor is missing, so a nitrogen upgrade can't silently
  drop the patch (also when the checkout path contains a space, `#`, `%` or
  non-ASCII characters — `scripts/__tests__/patch-nitrogen.test.js` guards that);
- is idempotent, skips files that already contain upstream's fix, and is a
  no-op while the package has no Hybrid Views.

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

Nothing about a device is hardcoded to a task: `example/rn-harness.config.mjs`
reads everything from the environment, and its defaults are neutral (no `t01`,
`t02`, … in them), because several tasks run this repo concurrently on one
machine with their own simulator/AVD and their own Metro port.

| Variable            | Default     | Meaning                                                         |
| ------------------- | ----------- | --------------------------------------------------------------- |
| `IOS_SIM_UDID`      | unset       | Simulator **UDID** — wins over `IOS_SIM`/`IOS_VERSION`          |
| `IOS_SIM`           | `iPhone 17` | Simulator name (used when no UDID is given)                     |
| `IOS_VERSION`       | `27.0`      | Simulator runtime the name is looked up in                      |
| `ANDROID_AVD`       | `nitroui`   | Emulator name (the harness creates it if missing)               |
| `ANDROID_API_LEVEL` | `35`        | AVD system image                                                |
| `AVD_PROFILE`       | `pixel_9`   | AVD device profile                                              |
| `METRO_PORT`        | `8291`      | Metro port                                                      |
| `HARNESS_TIMING`    | unset       | Judge the wall-clock gates instead of only reporting them (D21) |

`ANDROID_AVD` is the name to set; `AVD` is still accepted as a legacy alias.

`react-native-harness` selects an iOS simulator by **name + runtime version**,
so a UDID cannot be handed to it directly: with `IOS_SIM_UDID` the config looks
the UDID up with `xcrun simctl list` and passes that simulator's name and
runtime. It then refuses to guess:

- an unknown UDID is a hard error (create it first, or fix the UDID);
- if two available simulators share that name **and** runtime, the config errors
  too — the harness would pick one of them at random. Give each task's
  simulator a unique name (`xcrun simctl rename <udid> T02-iPhone17`), which is
  also why briefs assign a UDID rather than "iPhone 17".

Example (the device and port from a task brief):

```sh
IOS_SIM_UDID=F08675D3-A32B-4F88-BC81-02D7E0CB797E METRO_PORT=8291 \
  bun run harness:ios
ANDROID_AVD=nitroui_t02 METRO_PORT=8292 bun run harness:android
```

Metro deliberately does **not** use the default 8081: this repo is often worked
on alongside other React Native checkouts, and a busy port makes the harness
hang. Simulators and emulators are told which port to use when the harness
launches the app, so nothing is baked into the build; a stock `react-native
start` is still on 8081. Every concurrent task must set its own `METRO_PORT` —
the harness fails fast with `MetroPortUnavailableError` rather than attaching to
someone else's Metro.

Only start devices you need, never touch a device you did not start, and shut
down the ones you started when you finish.

### Wall-clock gates (`HARNESS_TIMING`)

Harness assertions split in two (D21). **Structural** ones — corrections,
immediate pushes, flushes, stale frames, event counts, and layout boxes in px —
are wrong at any machine load, so every run asserts them. A threshold on a
**duration** is not: several tasks share this machine, and a loaded host turns a
correct implementation red. Those go through `expectTimingBudget`
(`example/__tests__/timingGate.ts`), which:

- **`HARNESS_TIMING` unset** (the default, and what CI and every gate run): logs
  the measurement from inside the app and skips the threshold — the same way the
  stress tests beside it have always logged their timings, so the number is
  there for whoever reads a failing suite's output. It is not a verdict.
- **`HARNESS_TIMING=1`, quiet machine**: asserts the threshold and fails on the
  miss.
- **`HARNESS_TIMING=1`, busy machine**: refuses. When the published 1-minute load
  average is at or above `busyLoad1` (10), the gate throws rather than judge,
  because a gate that cannot tell a slow build from a slow host is not evidence.

The assertions run inside the app, which cannot see this machine's load average,
so the runner publishes it for the duration of the run: `rn-harness.config.mjs`
writes `example/harness-timing/state.json` (gitignored, refreshed every 2s) and
`example/metro.config.js` declares the one Metro route that serves it, per
request — so an assertion reads a current value, not one frozen at bundle time.
It has to be the Metro port: an emulator reaches this machine only through the
`adb reverse` the harness sets up for Metro. A reader checks the file's
`metroPort` and age before trusting it, so a leftover from a dead run cannot be
mistaken for this one's. `scripts/harness-timing-gate.js` is the publishing and
serving half, required by both config files.

The harness prints one line at startup saying which mode it is in and what the
load average was; a timing run started on a loaded host is announced there too.

## Running the real-input tests

The harness drives controls through the library's own test hooks, which is how it
can assert on a Nitro callback. What it cannot prove is that a touch delivered by
the operating system reaches a hosted SwiftUI/Compose control inside a React
Native app - a known failure class for SwiftUI-in-RN, and one G2 hit when a
SwiftUI `Button` ignored the harness's HID-less touch. The real-input suite does
that one thing: it synthesises taps and drags outside the app (`XCUIDevice`'s
event path on iOS, `adb shell input` on Android) and asserts only on `Text` the
app renders on screen. No test hook, no Nitro callback, no in-app tracer.

```sh
# iOS - the simulator must already be booted (the suite boots nothing)
IOS_UDID=<simulator udid> METRO_PORT=8291 bun run test:real-input:ios

# Android - the emulator must already be booted, on your own adb server
ANDROID_AVD=<avd> ANDROID_ADB_SERVER_PORT=<port> METRO_PORT=8292 \
  bun run test:real-input:android

# one control at a time
bun run test:real-input:android --control slider
```

Both build first (iOS: `pod install` + the workspace's `NitroUiExampleUITests`
scheme; Android: the debug APK), install, point the debug build at your
`METRO_PORT`, and read the screen afterwards - `accessibilityIdentifier` on iOS,
`uiautomator dump` on Android - which is what a person and a screen reader have.
Neither script boots or shuts down a device, and neither accepts a device it was
not told about: `IOS_UDID` and `ANDROID_AVD`/`ANDROID_SERIAL` are required, and
an emulator running another AVD is refused.

They are **not** part of `bun run check`: they need a booted device, a simulator
build and several minutes. Run them when you change how a control receives
touch, and expect the maintainer to run them before a release.

Both run on the Node `.nvmrc` pins and refuse to start on anything else, so that
one runtime produced every device gate — a real-input pass on a Node the harness
cannot run on is not comparable evidence.

Each run keeps its evidence in `.real-input/<platform>/` (gitignored): the full
`xcodebuild` and `adb` logs, the accessibility hierarchy printed by a failing
case, the `.xcresult` bundle, and Metro's log. When a check fails, that is the
directory to read.

### Adding a control to the suite

One entry in `scripts/real-input/controls.mjs`, then one check per platform:
`func testRealInput<Id>` in
`example/ios/NitroUiExampleUITests/RealInputTests.swift`, and one key in `CHECKS`
in `scripts/real-input/android.mjs`. Both runners compare their checks against
the shared table and fail - never skip - if a control has no check, or a check
has no control, so a control cannot leave the suite unnoticed.

## Consumer smoke tests

The only true check of "zero-config install": `npm pack` the library, install
it with **npm** (not bun - that's what users run) into a freshly generated app,
build **Release** (bundle embedded, no Metro), install, launch, wait for the
ready signal, screenshot, fail on crashes. If a fresh consumer ever needs a
manual native change, that is a library bug - fix the library, never work
around it in the scripts.

One signal, both platforms: `scripts/smoke/App.tsx` logs
`NITRO_UI_SMOKE_READY` once the native core answers, and RN routes `console.*`
to a host-readable stream in **every** build configuration - Android logcat,
and on iOS `os_log` under subsystem `com.facebook.react.log` (`console.log` maps
to `INFO`, so the stream needs `--level info`):

```sh
xcrun simctl spawn "$IOS_SIM_UDID" log stream --level info --style compact \
  --predicate 'subsystem == "com.facebook.react.log"'
```

The same stream fails the run fast on `Unhandled JS Exception` / `RCTFatal`
instead of waiting out the timeout. The app also paints its background white
while starting, **red** when ready and **blue** on a failed core call, so a
screenshot is readable by a human without being the machine channel. Never
launch with `simctl launch --console-pty`: it does not carry `os_log`.

```sh
IOS_SIM_UDID=<udid> ANDROID_AVD=<avd> EMULATOR_PORT=5574 \
  bun run smoke:expo            # Expo SDK 58 by default (SDK=57 to switch)
PLATFORM=android RN=0.86.3 bun run smoke:rn-cli
```

| Env                | Default                  | Meaning                                          |
| ------------------ | ------------------------ | ------------------------------------------------ |
| `PLATFORM`         | `both`                   | `ios` \| `android` \| `both`                     |
| `SDK` / `RN`       | `58` / `0.88.0`          | Consumer template version                        |
| `SMOKE_TMP`        | `/tmp/nitro-ui-smoke`    | Temp root for apps (no spaces/`#`/`%`/non-ASCII) |
| `IOS_SIM_UDID`     | - (required for iOS)     | Simulator UDID to install on                     |
| `ANDROID_AVD`      | - (required for Android) | AVD; created from API 35 google_apis if absent   |
| `EMULATOR_PORT`    | `5554`                   | Emulator console port (never 5556/5560 here)     |
| `KEEP_TMP`         | `0`                      | Keep the consumer app dir on success             |
| `READY_TIMEOUT`    | `180`                    | Seconds to wait for the ready line               |
| `SHUTDOWN_DEVICES` | `1`                      | Shut down devices this run booted, on exit       |
| `SMOKE_TARBALL`    | -                        | Install this tarball and skip packing (CI)       |
| `SKIP_PACK`        | `0`                      | Reuse the newest tarball (may be stale)          |

By default every run **packs the library fresh** from the working tree into its
own dir under `$SMOKE_TMP/tarballs`, so an edit can never be masked by a stale
tarball. `SMOKE_TARBALL` (what CI uses) skips packing and refuses a tarball
whose recorded `.gitsha` is not the current commit.

Scripts are re-runnable and never collide: each run gets a unique
`mktemp -d`-made app dir under `$SMOKE_TMP`, and background processes, Gradle
daemons and devices it booted are cleaned up on every exit path (Gradle also
runs `--no-daemon`). Logs, screenshots and timings always stay under
`$SMOKE_TMP/artifacts/<script>-<timestamp>-<pid>/`, including the full console
of the run in `run.log`.

### Keeping `scripts/smoke/App.tsx` current

`scripts/smoke/App.tsx` is copied over the generated app's `App.tsx` and is the
single source of truth for what a consumer must be able to render. Its rules:

- render **every** component the package exports exactly once, each with a
  `SMOKE-` testID;
- log `NITRO_UI_SMOKE_READY` exactly once, after mount and after
  `nitroUiCore.now()` answers, and flip the background to red;
- **adding a component = add its import + one JSX line** in the marked list.
  Do not touch the ready-line logic. Components that need state get their own
  small probe component above the list (one `useState` + the render call).
- it is typechecked by `bun run check` (`tsconfig.json` includes
  `scripts/smoke`), so a public-API rename fails the static gate instead of
  surfacing ten minutes into a smoke run.

`.github/workflows/smoke.yml` runs the same scripts nightly and on demand, and
CI mirrors this section.

## Running the benchmarks

`bench/` is a release-build app that measures a component against RN core on a
real simulator or emulator. The full story — metrics, protocol, what the numbers
mean, baselines, per-component checklist — is
`docs/architecture/benchmarks.md`. The commands:

```sh
IOS_SIM_UDID=<udid>   bun bench --platform ios     --plan quick
ANDROID_AVD=<avd>     bun bench --platform android --plan quick
```

Every component task runs the `quick` plan on **both** platforms and pastes both
tables (absolute and ratio-to-`rn-core`) into its report. It takes a few minutes
per platform. `--shutdown` powers off a simulator or emulator the runner booted
itself, which is what a task brief means by "shut down devices you start".

| Variable                 | Default     | Meaning                                                        |
| ------------------------ | ----------- | -------------------------------------------------------------- |
| `IOS_SIM_UDID`           | unset       | Simulator UDID to boot and measure on                          |
| `ANDROID_AVD`            | unset       | AVD name — the runner finds its serial among attached ones     |
| `ANDROID_SERIAL`         | unset       | Used only when there is no AVD name (physical device)          |
| `BENCH_ABIS`             | `arm64-v8a` | Android ABIs to build; CI sets `x86_64` for hosted runners     |
| `BENCH_LAUNCH_TIMEOUT_S` | `180`/`300` | Per-launch wall-clock budget (s); raise it on a loaded machine |

Prefer `ANDROID_AVD` over `ANDROID_SERIAL`: console ports are allocated by
availability, so a serial goes stale the moment another emulator boots or dies,
and a stale serial could otherwise point at a device belonging to another task.

The bench app is **release-only**, so it embeds its own bundle and starts no
Metro — `METRO_PORT` is irrelevant to it. Native projects under `bench/ios` and
`bench/android` are CNG output and gitignored; delete them (or pass `--prebuild`)
when configuration changes.

Gates: on-device numbers **inform review** and block only on a clear regression.
Both `--compare <ref>` and `--check` gate the `nitro-ui` arms on launch-paired
ratios to `rn-core`, and a verdict needs the ratio over 1.20 with a 95 % CI that
excludes 1.05 on a cell that was quiet inside its own run; the `rn-core` control
and the `expo-ui-*` reference arms can never fail your pull request. CI is
report-only (`.github/workflows/bench.yml`, `bench` label or `/bench` comment).
The gate that always blocks is the Reassure render count, below, because it is
deterministic.

## Perf contract

Hybrid Views are easy to make slow, so these rules are enforced by the local
ESlint plugin in `eslint-rules/` (see `eslint.config.mjs`):

| Rule                                 | Enforces                                                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `nitro-ui/no-inline-callback-in-jsx` | No `callback(...)` **call** inside a JSX attribute (incl. spread attributes); pass a stable callback (`useStableCallback`) |
| `nitro-ui/no-anymap-in-spec`         | No `AnyMap` props in `*.nitro.ts` — use typed props                                                                        |
| `nitro-ui/no-json-string-prop`       | No `*Json`/`*JSON` string props — pass structured values                                                                   |
| `nitro-ui/no-optional-view-props`    | No `?:` members in Hybrid View props; use `T \| null` and always send every prop (nitro#1184)                              |

`no-inline-callback-in-jsx` follows the helper through an aliased import
(`import { callback as cb }`) and treats anything inside `use*`/`useMemo` as
stable. Known gap: a callback hoisted into a variable in a render body
(`const onChange = callback(fn); <Switch onChange={onChange} />`) is not
tracked — keep such values at module scope or inside a stable hook.

The rest of the contract is review-checked (see `AGENTS.md` and
`docs/research/nitro-patterns.md`): prop setters only store and mark dirty, one
`afterUpdate()` applies, hosting views are created once at init, `RecyclableView`
resets everything, no JS↔main thread blocking hops, and controlled values use the
event-count handshake.

## Commit messages and releases

Conventional Commits — CI and releases rely on them (`@release-it` with the
conventional-changelog preset derives versions and changelogs from the messages,
so `feat`/`fix`/`BREAKING CHANGE` matter).

Git hooks are **opt-in**: `bun install` never installs them, because git hooks
live in the `.git` directory that every worktree of this repo shares, and
lefthook is therefore not in bun's `trustedDependencies` allowlist. Enable them
in a checkout whose dependencies are installed:

```sh
bun run hooks:install      # commit-msg runs commitlint; pre-commit runs ESLint + tsc
bun run hooks:uninstall    # remove them again
```

The hooks call `bunx --no-install`, so they use that checkout's local binaries
and fail loudly instead of downloading a look-alike `tsc`/`eslint` package.
`pre-commit` typechecks the whole program, which gets slow once `bench/` exists —
`bun run check` is the gate that actually has to pass.

Releases are done from CI (`.github/workflows/release.yml`, manual dispatch, npm
trusted publishing). Do not run `bun run release` locally.

## Sending a pull request

- Install dependencies, then `bun run check`.
- If you touched specs or native code, run the example builds and the harness
  tests on both platforms.
- CI mirrors these gates; anything CI runs is listed in this file.
