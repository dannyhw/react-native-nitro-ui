# Contributing

Everything in this file is a contract: these are the exact commands the
project's gates run. If you change one, change it here too.

**The gates are local for now.** The GitHub workflows in `.github/workflows/`
(CI, Bench, Smoke) are disabled on purpose, so nothing runs on a push or a pull
request. `bun run check` plus the device suites below, run on your machine, are
what a change is judged by. The release path is the exception: `Release` and
`Changeset status` are meant to be switched on (see "Releasing"), and until
`Release` is enabled, merging to `main` publishes nothing.

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
scripts/             patch-nitrogen.mjs, nitrogen-check.mjs, package-files.mjs
eslint-rules/        local ESLint plugin enforcing the perf contract
etc/                 package-files.txt (the published tarball manifest)
example/             bare RN app + react-native-harness tests
bench/               release-build benchmark app + private BenchProbe Nitro module
scripts/bench/       bench build/run/report tooling
scripts/perf/        Reassure render-count gate
docs/components/     one page per component (props, platform mapping, limits)
docs/architecture/   core runtime, sizing engine, benchmarks
docs/research/       the research notes behind the design
docs/DECISIONS.md    the decisions, numbered (D1, D2, …)
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
| `bun run test:native`       | Host-side C++ and Swift unit tests of the core (macOS only)          |
| `bun run nitrogen`          | Regenerate Nitro code, then apply `scripts/patch-nitrogen.mjs`       |
| `bun run nitrogen:check`    | Regenerate into a temp dir and fail on drift against `nitrogen/`     |
| `bun run autolinking:check` | RN CLI + Expo autolinkers must both resolve `NitroUiPackage`         |
| `bun run prepare`           | Build `lib/` with builder-bob (also runs `nitrogen`)                 |
| `bun run api-extractor`     | Regenerate the public API report in `etc/` (`:check` compares)       |
| `bun run publint`           | Validate `package.json` publish surface                              |
| `bun run manifest:check`    | Tarball contents must equal `etc/package-files.txt`                  |
| `bun run readme:check`      | README examples must equal `example/src/readme-examples.tsx`         |
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
| `bun run changeset`         | Record a release entry for your change (see "Releasing")             |
| `bun run release:version`   | Apply pending changesets, as the Version Packages PR does            |
| `bun run release:publish`   | **Release job only.** `npm publish` — never run it locally           |
| `bun run example <script>`  | Run an `example/` script, e.g. `bun run example ios`                 |
| `bun run hooks:install`     | Install optional git hooks (see "Commit messages and git hooks")     |
| `bun run hooks:uninstall`   | Remove them again                                                    |
| `bun run clean`             | Delete build outputs (`lib/`, native build dirs)                     |

`bun run check` = typecheck → bench:typecheck → lint → format → test →
test:native → perf:renders → nitrogen:check → autolinking:check → prepare →
api-extractor:check → publint → manifest:check → readme:check. `perf:renders` is part of `check` on purpose: render
counts are deterministic, so they can block, unlike anything measured on a device.

### Changing a README example

Every TSX block in `README.md` opens its fence with `tsx name=<region>` and must be
byte-identical to the `// #region <region>` block in
`example/src/readme-examples.tsx` — the file that makes those snippets typechecked
(`tsconfig.json` includes `example/src`). `bun run readme:check` compares the two and
names the first differing line, so a prop rename cannot survive in the docs: change
one side, run the script, and it goes red. Add a component by adding a region there
and the matching block in the README.

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
belongs to another nitro module in this repo — the private bench probe in
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
./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a   # x86_64 on Intel

cd ..
HARNESS_APP_PATH="$(pwd)/android/app/build/outputs/apk/debug/app-debug.apk" \
  bunx react-native-harness --harnessRunner android
```

`harness:ios` / `harness:android` are shortcuts for the last command in each
pair; you still need the build (and `pod install`) before them.

### Devices and ports

Nothing about a device is hardcoded: `example/rn-harness.config.mjs` reads
everything from the environment, and its defaults are neutral, so several
checkouts can run concurrently on one machine, each with its own simulator/AVD
and its own Metro port.

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
  too — the harness would pick one of them at random. Give each simulator you
  use for this a unique name (`xcrun simctl rename <udid> nitro-ui-iPhone17`),
  or pass its UDID.

Example:

```sh
IOS_SIM_UDID=<simulator udid> METRO_PORT=8291 bun run harness:ios
ANDROID_AVD=<avd name> METRO_PORT=8292 bun run harness:android
```

Metro deliberately does **not** use the default 8081: this repo is often worked
on alongside other React Native checkouts, and a busy port makes the harness
hang. Simulators and emulators are told which port to use when the harness
launches the app, so nothing is baked into the build; a stock `react-native
start` is still on 8081. Every concurrent run must set its own `METRO_PORT` —
the harness fails fast with `MetroPortUnavailableError` rather than attaching to
someone else's Metro.

Only start devices you need, never touch a device you did not start, and shut
down the ones you started when you finish.

### Wall-clock gates (`HARNESS_TIMING`)

Harness assertions split in two (D21). **Structural** ones — corrections,
immediate pushes, flushes, stale frames, event counts, and layout boxes in px —
are wrong at any machine load, so every run asserts them. A threshold on a
**duration** is not: a loaded host turns a correct implementation red. Those go through `expectTimingBudget`
(`example/__tests__/timingGate.ts`), which:

- **`HARNESS_TIMING` unset** (the default, and what every gate run uses): logs
  the measurement from inside the app and skips the threshold — the same way the
  stress tests beside it have always logged their timings, so the number is
  there for whoever reads a failing suite's output. It is not a verdict.
- **`HARNESS_TIMING=1`, quiet machine**: asserts the threshold and fails on the
  miss.
- **`HARNESS_TIMING=1`, busy machine**: refuses. When the published 1-minute load
  average is at or above `busyLoad1` (10), the gate throws rather than judge,
  because a gate that cannot tell a slow build from a slow host is not evidence.

The assertions run inside the app, which cannot see the host's load average,
so the runner publishes it for the duration of the run: `rn-harness.config.mjs`
writes `example/harness-timing/state.json` (gitignored, refreshed every 2s) and
`example/metro.config.js` declares the one Metro route that serves it, per
request — so an assertion reads a current value, not one frozen at bundle time.
It has to be the Metro port: an emulator reaches the host only through the
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
Native app - a known failure class for SwiftUI-in-RN, and one this library hit
when a SwiftUI `Button` ignored the harness's HID-less touch. The real-input suite does
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
`NITRO_UI_SMOKE_READY` once the native core answers **and** every control has
been laid out with a non-zero size, and RN routes `console.*` to a host-readable
stream in **every** build configuration - Android logcat, and on iOS `os_log`
under subsystem `com.facebook.react.log` (`console.log` maps to `INFO`, so the
stream needs `--level info`):

```sh
xcrun simctl spawn "$IOS_SIM_UDID" log stream --level info --style compact \
  --predicate 'subsystem == "com.facebook.react.log"'
```

That line is asserted, not just grepped - it carries the box each control got:

```
NITRO_UI_SMOKE_READY switch=61x28 slider=354x31 button=61x34.333343505859375 progress=354x4 segmented-control=165x31 date-picker=138x34 picker=72x35 host=354x96
```

`scripts/smoke/lib.mjs` owns the contract (one `name=WxH` box per control -
the seven controls plus `host`, the `<Host>` container, each greater than `0x0`;
a number may be fractional, because `onLayout` reports computed layout metrics -
`52.19047546386719x48` on a density-scaled Android display,
`61x34.333343505859375` for a Button sized by its font on iOS, and the line
above is iOS-shaped output from a run) and
`scripts/smoke/ready-line.mjs` is the command both platform
paths call, so iOS and Android cannot drift apart and a control that mounts at
`0x0` - a sizing regression, a hosting change, a `measureContent()` that answers
0 - fails the run instead of turning the screen red. If the core answers and a
control still has no box after 6 s, the app logs `NITRO_UI_SMOKE_PENDING` with
the sizes it saw, and the runner fails on that immediately rather than waiting
out `READY_TIMEOUT`. `scripts/__tests__/smoke-ready-line.test.js` (in
`bun run check`) is the proof the assertion can fail, including on the bare
`NITRO_UI_SMOKE_READY` line this gate used to accept.

The same stream fails the run fast on `Unhandled JS Exception` / `RCTFatal`
instead of waiting out the timeout. The app also paints its background white
while starting, **red** when ready, **amber** while a control still has no box
and **blue** on a failed core call, so a screenshot is readable by a human
without being the machine channel. Never launch with `simctl launch
--console-pty`: it does not carry `os_log`.

```sh
IOS_SIM_UDID=<udid> ANDROID_AVD=<avd> \
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
| `EMULATOR_PORT`    | `5554`                   | Emulator console port                            |
| `KEEP_TMP`         | `0`                      | Keep the consumer app dir on success             |
| `READY_TIMEOUT`    | `180`                    | Seconds to wait for the ready line               |
| `SHUTDOWN_DEVICES` | `1`                      | Shut down devices this run booted, on exit       |
| `SMOKE_TARBALL`    | -                        | Install this tarball and skip packing            |
| `SKIP_PACK`        | `0`                      | Reuse the newest tarball (may be stale)          |

By default every run **packs the library fresh** from the working tree into its
own dir under `$SMOKE_TMP/tarballs`, so an edit can never be masked by a stale
tarball. `SMOKE_TARBALL` skips packing and refuses a tarball whose recorded
`.gitsha` is not the current commit.

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
- log `NITRO_UI_SMOKE_READY <control>=<W>x<H> …` exactly once, after mount,
  after `nitroUiCore.now()` answers and after every control has reported a
  non-zero `onLayout` box, and flip the background to red;
- **adding a component = add its import + one JSX line (with its `onLayout`) in
  the marked list + its name to `SMOKE_CONTROLS`** in this file _and_ in
  `scripts/smoke/lib.mjs`. Do not touch the ready-line logic. Components that
  need state get their own small probe component above the list (one `useState`
  and the render call). `smoke-ready-line.test.js` fails `check` if the two
  lists ever disagree.
- **a `<Host>` counts as one control (`host`), not two.** The box worth
  asserting is the container's: a hosted child is drawn by the Host's own
  composition and its RN view is deliberately laid out at nothing
  (`docs/components/host.md`, Sizing), so putting a hosted Switch in
  `SMOKE_CONTROLS` would fail the contract by design. Render the Host with its
  children inside it, as the app does today.
- it is typechecked by `bun run check` (`tsconfig.json` includes
  `scripts/smoke`), so a public-API rename fails the static gate instead of
  surfacing ten minutes into a smoke run.

`.github/workflows/smoke.yml` is written to run the same scripts nightly and on
demand, but it is disabled with the other workflows, so these scripts are only
run by hand today.

## Running the benchmarks

`bench/` is a release-build app that measures a component against RN core on a
real simulator or emulator. The full story — metrics, protocol, what the numbers
mean, baselines, per-component checklist — is
`docs/architecture/benchmarks.md`. The commands:

```sh
IOS_SIM_UDID=<udid>   bun bench --platform ios     --plan quick
ANDROID_AVD=<avd>     bun bench --platform android --plan quick
```

A change to a component runs the `quick` plan on **both** platforms and puts both
tables (absolute and ratio-to-`rn-core`) in its pull request. It takes a few
minutes per platform. `--shutdown` powers off a simulator or emulator the runner
booted itself.

| Variable                 | Default     | Meaning                                                        |
| ------------------------ | ----------- | -------------------------------------------------------------- |
| `IOS_SIM_UDID`           | unset       | Simulator UDID to boot and measure on                          |
| `ANDROID_AVD`            | unset       | AVD name — the runner finds its serial among attached ones     |
| `ANDROID_SERIAL`         | unset       | Used only when there is no AVD name (physical device)          |
| `BENCH_ABIS`             | `arm64-v8a` | Android ABIs to build (`x86_64` on an Intel host)              |
| `BENCH_LAUNCH_TIMEOUT_S` | `180`/`300` | Per-launch wall-clock budget (s); raise it on a loaded machine |

Prefer `ANDROID_AVD` over `ANDROID_SERIAL`: console ports are allocated by
availability, so a serial goes stale the moment another emulator boots or dies,
and a stale serial could otherwise point at a device that is not yours.

The bench app is **release-only**, so it embeds its own bundle and starts no
Metro — `METRO_PORT` is irrelevant to it. Native projects under `bench/ios` and
`bench/android` are CNG output and gitignored; delete them (or pass `--prebuild`)
when configuration changes.

Gates: on-device numbers **inform review** and block only on a clear regression.
Both `--compare <ref>` and `--check` gate the `nitro-ui` arms on launch-paired
ratios to `rn-core`, and a verdict needs the ratio over 1.20 with a 95 % CI that
excludes 1.05 on a cell that was quiet inside its own run; the `rn-core` control
and the `expo-ui-*` reference arms can never fail your pull request. `--check`
compares against the committed baselines in `bench/baselines/`, which exist for
both canonical devices (an iPhone 17 simulator on iOS 27 and an API 35 Pixel 9
emulator); on any other device use `--compare <ref>`. `.github/workflows/bench.yml`
would post these tables on a pull request, but it is disabled. The gate that always blocks is the Reassure render count, below, because it is
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

The rest of the contract is review-checked (see `docs/architecture/core.md`
and `docs/research/nitro-patterns.md`): prop setters only store and mark dirty, one
`afterUpdate()` applies, hosting views are created once at init, `RecyclableView`
resets everything, no JS↔main thread blocking hops, and controlled values use the
event-count handshake.

## Commit messages and git hooks

Conventional Commits, checked by the optional `commit-msg` hook below. Commit
messages no longer decide anything about releases — Changesets entries do (see
"Releasing") — but the history still reads better in the agreed shape.

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

## Releasing

Releases are cut by [Changesets](https://changesets.dev) from GitHub Actions and
published with npm **trusted publishing** (OIDC): there is no npm token in this
repo, in the workflows, or on any laptop. 0.1.0 was published by hand (DECISIONS
D26); everything after it is this path (D27).

1. **Make the change, then `bun run changeset`.** Pick the bump (`patch` for a
   fix, `minor` for a new capability, `major` for a breaking change) and write a
   note that reads well in `CHANGELOG.md` — that text _is_ the release note.
   Commit the file it writes in `.changeset/` with your pull request. A change
   that must not release anything (docs, tooling, tests) still gets an entry:
   `bunx changeset --empty`. `Changeset status` warns on a pull request that
   changes `src/`, `ios/`, `android/`, `cpp/` or `nitrogen/` without one; the
   warning never blocks a merge, because a maintainer can add the entry.
   Only `react-native-nitro-ui` is ever versioned: the `example`, `bench` and
   `bench/modules/bench-probe` workspaces are `private` and listed in `ignore`
   in `.changeset/config.json`.
2. **Merge pull requests to `main`.** The `Release` workflow runs
   `bun run check`, then `changeset version`, and opens or updates a pull
   request called **Version Packages**: it bumps `package.json`, prepends the
   notes to `CHANGELOG.md` and deletes the changeset files. Everything merged
   before it lands folds into that one pull request — you review the version and
   the changelog there.
3. **Merge the Version Packages pull request.** The next `Release` run finds no
   pending changesets, runs `bun run check` again, publishes the version now
   committed on `main`, tags `vX.Y.Z` and opens the GitHub release from the
   changelog entry. `npm publish` runs this package's `prepare` (builder-bob →
   nitrogen) while packing, and provenance comes from the job's OIDC token.

Two things that look wrong and are not:

- npm can show the new version briefly as a staged placeholder (`0.0.0-stage…`)
  while it runs its automated scan of the package before the version goes live.
  Check `npm view react-native-nitro-ui version` afterwards; that is the truth.
- A release job that fails after the version is merged leaves the bump on `main`
  with nothing published. Fix the cause and **re-run the failed job** from the
  Actions run: `changeset publish` skips a version the registry already has, so
  a half-finished run finishes instead of double-publishing.

A version that is on npm stays on npm. `npm unpublish` breaks every lockfile
pointing at it, so retreat with a deprecation and release a fix:

```sh
npm deprecate react-native-nitro-ui@0.1.2 "<why — point at the replacement>"
```

Never run `npm login`, `npm publish` or `bun run release:publish` locally: the
only publishing credential is the release job's OIDC token. To see what a
release would ship, use a dry run instead:

```sh
bun run prepare && npm publish --dry-run
```

The one-time owner setup — naming this repo and `release.yml` as the package's
Trusted Publisher on npmjs.com, allowing GitHub Actions to create pull requests
in the repository settings, enabling the `Release` workflow — is recorded with
the R6 report (`docs/tasks/R6-changesets-release.report.md`); without it nothing
publishes.

## Sending a pull request

- Install dependencies, then `bun run check`.
- If you touched specs or native code, run the example builds and the harness
  tests on both platforms.
- Say in the pull request which of the device suites (harness, real-input,
  smoke, bench) you ran and on what. There is no CI to run them for you.
