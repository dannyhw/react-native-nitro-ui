# Contributing

Everything in this file is a contract: these are the exact commands the
project's gates run. If you change one, change it here too.

**The gates are local for now.** The GitHub workflows in `.github/workflows/`
(CI, Bench, Smoke) are disabled on purpose, so nothing runs on a push or a pull
request. `bun run check` plus the device suites below, run on your machine, are
what a change is judged by. The release path is the exception: `Release`,
`Release tag` and `Changeset status` are meant to be switched on (see
"Releasing"). No version reaches npm without a person approving it, whichever of
the three are on — and a workflow file that is new to `main` is enabled as soon as
it lands, so `Changeset status` starts commenting on pull requests with the merge
that brings it.

## Prerequisites

- [bun](https://bun.sh) 1.4 — the package manager for this repo (`packageManager`
  in `package.json`). Do not add `yarn`/`npm` lockfiles.
- Xcode 27 with the iOS 27 simulator runtime — what the device gates run on, and
  what the doctor checks for — and CocoaPods
- JDK 17, Android SDK (`ANDROID_HOME`) with an emulator image for API 35
- [ccache](https://ccache.dev) — optional, and only for the example/bench apps:
  `brew install ccache` (this repo was verified on 4.14.2). Everything that uses
  it checks for the binary first, so CI and a machine without it build exactly
  what they built before. See [Build speed](#build-speed).
- Node 24 — pinned in `.nvmrc`, and what every gate runs on (bun runs the
  scripts, but Node transforms the tests). 22.11 - 24 are accepted. On anything
  else the device gates restart themselves under the pinned Node with
  `fnm exec` when fnm has it, and refuse otherwise: Node 25 and 26 die later
  inside `react-native-harness`'s Jest transform with
  `Must use import to load ES Module … react-native/index.js`, which reads like
  a bug in the test file and is not one.

Install dependencies once at the repo root — the example app shares the root
install (hoisted layout, see `bunfig.toml`):

```sh
bun install
```

To check a machine against all of the above (plus `gh` push access, the agent
CLIs, disk and load), run the doctor. `--setup` also creates two simulator/AVD
pairs (`nitro-ui A`/`B`, `nitroui_a`/`b`) and writes the `~/.nitro-ui/devices.json`
the lease script reads (see "Leasing a device or port"). It only adds: it never
touches an existing device or `devices.json`, never installs SDK packages or
accepts licenses (it prints the command), and never boots anything.

What that file can say is in `scripts/devices.example.json`, so copy it rather than
typing it. Besides the pool it carries the machine's two limits: `maxDeviceLeases`
(how many device tasks run at once) and `maxConcurrentBuilds` (how many heavy native
builds compile at once, whatever else is running — leave it at `1` unless your machine
has cores to spare, and see "One build at a time"). A value that is not a positive
integer is read as the default and named in the build's output rather than obeyed.

```sh
node scripts/doctor.mjs           # exit 1 if anything required is missing
node scripts/doctor.mjs --setup   # then create the device pairs
node scripts/doctor.mjs --prime   # and warm the build caches (see below)
```

`--prime` builds both platforms once, in the **main** checkout, so the first real build
of your first task is not a cold one — a cold iOS build took 9½ minutes on a machine
whose warm one took 138 seconds. It delegates to `build-app.mjs`, so it takes a build
slot like any other build and will queue behind one rather than joining it; its budget is
the queue wait plus a build, which is why it can sit quietly for a while before it
prints anything. `doctor` reports the cache state either way, as a `build caches` row
judged by ccache's hit count: a machine with no hits says `warn` and points at
`--prime`, and `unknown` (not "cold") when ccache is not installed at all.

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

| Command                       | What it does                                                                |
| ----------------------------- | --------------------------------------------------------------------------- |
| `bun run check`               | **All static gates.** Run this before pushing.                              |
| `bun run typecheck`           | `tsc` over the library and example                                          |
| `bun run bench:typecheck`     | `tsc` over `bench/` for each platform                                       |
| `bun run lint`                | ESLint, including the local perf-contract rules                             |
| `bun run format`              | Prettier check (`format:write` to fix)                                      |
| `bun run test`                | Jest unit tests (JS wrappers, lint rules, patch script)                     |
| `bun run test:native`         | Host-side C++ and Swift unit tests of the core (macOS only)                 |
| `bun run test:native:android` | JVM unit tests of the Kotlin core (needs the Android SDK; not in `check`)   |
| `bun run nitrogen`            | Regenerate Nitro code, then apply `scripts/patch-nitrogen.mjs`              |
| `bun run nitrogen:check`      | Regenerate into a temp dir and fail on drift against `nitrogen/`            |
| `bun run registry`            | Write the per-component lists from `src/components/*/component.json`        |
| `bun run registry:check`      | Fail when those lists are not what the manifests say (see "Adding a comp…") |
| `bun run regen`               | `nitrogen` + `registry` — what to run after a merge or a new component      |
| `bun run autolinking:check`   | RN CLI + Expo autolinkers must both resolve `NitroUiPackage`                |
| `bun run prepare`             | Build `lib/` with builder-bob (also runs `nitrogen`)                        |
| `bun run api-extractor`       | Regenerate the public API report in `etc/` (`:check` compares)              |
| `bun run publint`             | Validate `package.json` publish surface                                     |
| `bun run manifest:check`      | Tarball contents must equal `etc/package-files.txt`                         |
| `bun run readme:check`        | README examples must equal `example/src/readme-examples.tsx`                |
| `bun run manifest:update`     | Rewrite the manifest after an **intentional** publish-surface change        |
| `bun run harness:ios`         | On-device tests on iOS (see below)                                          |
| `bun run harness:android`     | On-device tests on Android (see below)                                      |
| `bun run harness:cold:ios`    | Only the `ColdSizing` suite (`:android` for Android)                        |
| `bun run test:real-input:ios` | OS-delivered taps and drags (`:android` for Android; see below)             |
| `bun run smoke:pack`          | `npm pack` the library into `$SMOKE_TMP/tarballs` (see below)               |
| `bun run smoke:expo`          | Install the packed lib into a fresh Expo app, Release, on-device            |
| `bun run smoke:rn-cli`        | Same for a fresh React Native CLI app                                       |
| `bun bench`                   | Run the on-device benchmarks (see "Running the benchmarks")                 |
| `bun run bench:report`        | Re-render an existing results file, no device needed                        |
| `bun run probe:nitrogen`      | Regenerate the private `bench/modules/bench-probe` Nitro code               |
| `bun run perf:renders`        | Reassure render-count gate for the JS wrappers                              |
| `bun run changeset`           | Record a release entry for your change (see "Releasing")                    |
| `bun run release:version`     | Apply pending changesets, as the Version Packages PR does (see "Releasing") |
| `bun run build:app`           | Build + stamp the example app for one platform (see below)                  |
| `bun run lease <command>`     | Device/port leases for this machine: `acquire`, `release`, `list`           |
| `bun run example <script>`    | Run an `example/` script, e.g. `bun run example ios`                        |
| `bun run storybook:ios`       | The example app in Storybook mode (`:android`; see `example/README.md`)     |
| `bun run hooks:install`       | Install optional git hooks (see "Commit messages and git hooks")            |
| `bun run hooks:uninstall`     | Remove them again                                                           |
| `bun run clean`               | Delete build outputs (`lib/`, native build dirs)                            |

`bun run check` = typecheck → bench:typecheck → lint → format → test →
test:native → perf:renders → nitrogen:check → registry:check → autolinking:check → prepare →
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

## Adding a component

A control used to mean a row in about fifteen hand-maintained lists, so two
components in flight conflicted on every one of them. Each control now declares
its facts once, in `src/components/<Name>/component.json`, and `bun run
registry` writes the lists. The rules — the schema, which lists are generated,
which are only checked, and why — are documented in
`scripts/registry-core.mjs`.

```sh
# 1. the per-component files, as before
src/components/<Name>/<Name>.nitro.ts   the Nitro spec
src/components/<Name>/<Name>.tsx        the JS wrapper
src/components/<Name>/NitroUi<Name>Config.ts
example/src/<Name>Screen.tsx            the tab's screen (behaviour: hand-written)

# 2. say what the control is, and let the lists follow
src/components/<Name>/component.json    copy one and edit it
bun run regen                           the registry, then nitrogen, then the registry

# 3. the behaviour a manifest cannot describe
src/index.ts                            the export list
bench/src/implementations/*.tsx         one branch per arm
bench/src/implementations/shared.ts     its ROW_HEIGHTS entry (benched controls)
example/.../RealInputTests.swift        func testRealInput<Name>
scripts/real-input/android.mjs          one CHECKS entry
docs/components/<name>.md               the component page
bun run changeset
```

`bun run registry:check` (in `bun run check`) fails when those lists are not what
the manifests say, naming the file and the first line that moved — so a generated
region is never edited by hand, and `bun run registry` is what changes it.

The manifest holds **identity**, not prose: which sets the control belongs to
(`bench`, `smoke`, `realInput`, `hostable`), its kebab `id`, its `sizing` policy
(`intrinsic`, `fillWidth`, or `null` for something that sizes from its style),
and its example tab. What a row _says_ stays in the file, which is how the
published bytes stay put: in a shipped file (`etc/package-files.txt`) a row that
is already there is copied rather than re-rendered, and existing rows keep their
positions. `scripts/__tests__/registry.test.js` asserts that running `--write`
over a copy of the tree leaves every shipped file byte-identical.

One file the brief might have expected the generator to own is deliberately only
**checked**:

- `src/index.ts` exports `<Host>`, which has no manifest (a container, not a
  control), and its export lists name per-component types that vary by rule no
  manifest carries (`SegmentedControlChange`, `DatePickerVariant`). Its header
  prose is also the statement of what is public.

The check on it catches the mistake a hand-written file actually makes: a
component exists and something downstream cannot see it.

`nitro.json` is not in that list: the registry generates its `autolinking`
section, because the alternative is a per-component edit a merge throws away
(see "Merging two components"). Nitrogen only _reads_ the file — `nitrogen src
--config nitro.json` — and writes it nowhere in this repo's scripts, so the
registry is the only writer and nothing contends for it. `regen` runs the
registry before nitrogen for exactly that reason: nitrogen refuses to generate a
Hybrid View with no entry, so the entry has to exist first.

The behaviour tables stay hand-written, and a test says so when one is missing:
`scripts/__tests__/component-coverage.test.js` fails if a bench arm has no branch
for a benched control (an arm falls through to rendering the `Switch`, so the cell
would measure the wrong control and still print a number), or if the real-input
suite has a control with no check on either platform.

### Merging two components

`bun run regen` is the merge recipe, and `bun run check` passing afterwards is the
definition of a finished merge — not `registry:check` on its own, which sees the
generated regions and nothing else. When two branches both add a control, the
lists they both touch conflict; take **either side** of every conflicted
generated file and run `regen`, and both controls' rows come back — the generator
adds any manifest it finds that a list is missing, so whichever side won the
conflict, the loser's rows return. `nitro-ui.sizing.json` is generated by the
registry and takes either side as well. `nitrogen/generated/**` needs no hand
resolution at all: `.gitattributes` says `merge=union` there, which keeps both
sides' appended lines, and `regen` rewrites the files from scratch anyway (see
`.gitattributes` for why union stops there).

These are inputs, not outputs, and need the two sides' lines kept together
(`bench/src/implementations/shared.ts`'s `ROW_HEIGHTS` too, for benched
controls; `bench:typecheck` fails if one is lost): `src/index.ts` (one export per component), the bench arm's import and
branch, `func testRealInput<Name>` in `RealInputTests.swift`, and the `CHECKS`
entry in `scripts/real-input/android.mjs`. The docs are the same kind of thing.
`nitro.json` used to be in this list and no longer is: its `autolinking` entry is
generated now, which matters because a lost entry used to break the recipe —
nitrogen refuses to generate a Hybrid View that is not in `nitro.json`, so
without it `regen` could not run at all. These are the files where the two
sides genuinely say different things, which is the right place to spend
attention.

Measured on two controls, both merge orders, against this layout and against
`main`'s pre-registry layout (`dc13833`, with the same lines typed by hand):
19 conflicted files here, 22 there (the extra three are
`nitrogen/generated/**`, where `.gitattributes` now says `merge=union` and
`regen` rewrites the file anyway). Taking either side of all of them loses 36 of
the merged control's 52 shared-list entries, in 19 files — the same in both
layouts, because a control really does add a line in that many places.

The difference is what happens next. Here it is the four edits above and `bun run
regen`, and `bun run registry:check` then proves the merge is right in 0.2 s:
0 entries lost, both orders. Run the whole of `bun run check` afterwards; the
registry check proves the generated lists, not the hand-written edits. There, it is 19 files re-edited by hand. Pre-X3 was not unprotected —
`tsc`, `nitrogen:check`, `host.test.tsx`, `viewConfigs.test.ts` and the smoke
ready-line test each catch a few of those rows, and the report attributes each
list to the gate that sees it — but eight of the thirteen had nothing, notably
`example/src/App.tsx`'s tab bar, where a lost row is a control with no tab and no
failure until you look at a device.

`bun run registry` refuses rather than half-writing: a new control has no
`example/src/<Name>Screen.tsx` until someone writes it, and the check says so
instead of generating an `App.tsx` that does not compile.

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

## Leasing a device or port

Several tasks work on one machine at once, so which simulator, AVD, emulator
port, adb port and Metro port a run may use is a **resource**, not a detail to
invent per task: two tasks on one simulator, or two Metros on one port, both
produce a run nobody can trust. `scripts/lease.mjs` is the gate.

```sh
node scripts/lease.mjs acquire --task G6 --out /tmp/g6.env   # or: bun run lease acquire …
source /tmp/g6.env                                            # exports the variables below
node scripts/lease.mjs list
node scripts/lease.mjs release G6
```

`acquire` prints the env file on stdout (or writes it with `--out`) and exits 1
with a reason when it refuses. It hands out `IOS_SIM_UDID`, `IOS_SIM`,
`IOS_VERSION`, `ANDROID_AVD`, `ANDROID_API_LEVEL`, `AVD_PROFILE`,
`EMULATOR_PORT`, `ANDROID_SERIAL`, `ANDROID_ADB_SERVER_PORT` and `METRO_PORT`,
which are the variables `example/rn-harness.config.mjs` and the real-input scripts
already read, so a task stops naming devices and starts by leasing them.

Four rules are enforced rather than written down:

- at most **2 device leases** at a time (a third is refused: two device tasks is
  what one machine does without load turning duration gates red, D21);
- `--exclusive` - for a bench run or a baseline mint, which needs a quiet
  machine - **waits until every other lease has ended**, then holds every pair;
- the emulator serial **`emulator-5560` can never be leased**, because an `adb`
  command without `-s` reaches it. A pool that contains it is refused when it is
  read, so the mistake is a config error rather than a borrowed device.
- the emulator **boots on the port behind the serial** it was handed: the
  harness passes `-port $EMULATOR_PORT`, so a leased AVD cannot come up as some
  other console. A run whose `ANDROID_SERIAL` disagrees with its `EMULATOR_PORT`,
  or which names the reserved serial, is refused by the harness config and by
  real-input before anything is installed on a device.

The pool is one file per machine, because UDIDs, AVD names and ports do not
travel between machines. Copy `scripts/devices.example.json` and edit it:

```sh
mkdir -p ~/.nitro-ui
cp scripts/devices.example.json ~/.nitro-ui/devices.json   # then put your real devices in it
```

```json
{
  "maxDeviceLeases": 2,
  "maxConcurrentBuilds": 1,
  "reservedEmulatorPorts": [5560],
  "reservedIdentifiers": [],
  "pairs": [
    {
      "id": "pair-a",
      "ios": {
        "name": "iPhone 17",
        "udid": "<simulator udid>",
        "system": "27.0"
      },
      "android": {
        "avd": "<avd name>",
        "emulatorPort": 5574,
        "adbPort": 5043,
        "apiLevel": 35,
        "profile": "pixel_9"
      },
      "metroPort": 8295
    }
  ]
}
```

A pair is the unit: one iOS simulator and one Android emulator that belong
together, plus the ports that go with them. `reservedIdentifiers` is for anything
else that must never be handed out (a person's own device, another project's
simulator). State lives in `~/.nitro-ui/leases.json` behind a lock file
(`~/.nitro-ui/leases.lock`); leases expire after a TTL so a killed task cannot
wedge the machine, and `NITRO_UI_HOME` moves the whole directory - which is how
`scripts/__tests__/lease.test.js` tests the lock and the limits without touching a
real one.

`ANDROID_ADB_SERVER_PORT` is part of a lease on purpose: a private adb server per
task means one task's `adb` never queues behind another's, and it is what makes
`adb kill-server` on the default port somebody else's problem - so don't.

## Running the on-device (Harness) tests

`react-native-harness` runs `.harness.tsx` files **inside the app**; it does not
build the app and it runs debug builds only. So: build first, then run.

```sh
node scripts/build-app.mjs --platform ios        # or: --platform android
bun run harness:ios                              # or: harness:android
```

`build-app.mjs` is the one build step: it runs `pod install` when the Pods are out
of date, builds into a **fixed path inside your worktree** (`example/ios/build`
via `-derivedDataPath`, `example/android/app/build`), and then writes `app.stamp`
next to the artifact. The harness config reads that stamp, so `HARNESS_APP_PATH`
does not have to be set at all; export it only to point a run at some other
artifact.

The stamp is what stops a device run testing code it does not contain
(`G2-button.report.md` records that failure). It records a hash of the code tree
(everything git can see except `docs/`, `bench/`, `.github/`, `.vscode/` and Markdown) and how
many times each registered component's hybrid class appears in the binary - the
component list comes from nitrogen's generated autolinker, so a new component
joins the gate on its own commit. A harness or real-input run **refuses** (in red,
before it touches a device) when:

- the tree hash differs from the one the app was built from: your edit is not in
  the binary, so its green would be somebody else's green;
- a registered component is missing from the binary - on Android this is gradle
  calling `packageDebug` up-to-date over a dex that never got the generated
  hybrid, which `build-app.mjs` repairs itself by re-running `packageDebug --rerun`.

The equivalent manual commands, if you ever need them:

```sh
cd example/ios && node ../../scripts/pod-install.mjs
xcodebuild -workspace NitroUiExample.xcworkspace -scheme NitroUiExample \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath build CODE_SIGNING_ALLOWED=NO build
# -> example/ios/build/Build/Products/Debug-iphonesimulator/NitroUiExample.app

cd example/android && ./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a
# x86_64 on Intel   -> example/android/app/build/outputs/apk/debug/app-debug.apk
```

A hand-built artifact has no stamp, so a gate asked to use one says so and names
`build-app.mjs`. `scripts/pod-install.mjs` is the repo's only CocoaPods entry
point: it runs the version a `Podfile.lock` already records, so a machine on
another CocoaPods does not leave a `COCOAPODS:`-trailer-only diff in a tracked
lock file (four tasks each lost time restoring that line by hand).

### Recording a gate run

`scripts/gate.mjs` runs a named gate and records the result: `check`,
`harness:<ios|android>`, `real-input:<ios|android>`, `smoke:<pack|expo|rn-cli>`
or `bench`. Each run appends one line to `.gates/<branch>.jsonl` (gitignored),
keyed to the code tree the stamp uses, so a docs-only commit leaves a green gate
green. A device gate reads its device from the lease.

```sh
set -a; source <(node scripts/lease.mjs acquire --task <id> --platform android); set +a
node scripts/build-app.mjs --platform android
node scripts/gate.mjs harness:android      # `-- ColdSizing` records `harness:android:ColdSizing`
node scripts/gate.mjs need --for merge     # exits 1 and lists what is still missing
node scripts/gate.mjs table                # the gate table for a report
node scripts/lease.mjs release <id>
```

The merge bar is `check`, both full harness runs and both real-input runs; a
filtered harness run satisfies nothing. A task report starts from
`docs/tasks/REPORT-TEMPLATE.md`, and `gate.mjs export --task <id>` commits the
ledger beside it. The rules are in the header of `scripts/gate.mjs` and in
`scripts/gate-core.mjs`.

### Build speed

Nothing in this section changes what a library user gets. It is all in
`scripts/`, the example app and the bench app; `android/build.gradle`,
`NitroUi.podspec`, `src/`, `ios/`, `cpp/` and `nitrogen/` are untouched, and
`bun run manifest:check` plus `npm pack` keep that honest.

Four things make a local or agent build faster:

- **One ABI.** `scripts/build-app.mjs` builds the ABI this machine runs
  (`arm64-v8a` on Apple Silicon, `x86_64` on Intel) instead of the four in
  `example/android/gradle.properties`. `--arch arm64-v8a,x86_64` or
  `NITRO_UI_ANDROID_ARCH` overrides it; the gradle default stays the full list,
  so a hand-run `./gradlew` and the release CI job still build everything a user
  can install, and the Android CI jobs pass `x86_64` because that is all their
  emulator runs.
- **Gradle caches.** The example app sets `org.gradle.caching` and
  `org.gradle.configuration-cache` in its `gradle.properties`, and the bench
  script applies the same two to its generated `android/` tree after every
  `expo prebuild`. The build cache is per user, so a fresh worktree starts with
  the tasks every other worktree already ran.
- **ccache.** The example Podfile passes `:ccache_enabled => true`, the bench
  app sets `USE_CCACHE=1` for the Podfile `expo prebuild` owns, and
  `scripts/gradle-ccache.init.gradle` (passed with `-I`, only when ccache
  exists) puts `CMAKE_<LANG>_COMPILER_LAUNCHER` in front of the NDK builds. The
  scripts also export `CCACHE_BASEDIR` (this worktree) and `CCACHE_NOHASHDIR`
  (`1` - no underscore; ccache ignores `CCACHE_HASH_DIR` and keeps hashing the
  compile directory, which is the silent miss-per-worktree this avoids), which is
  what makes the _same file in another worktree_ a hit
  instead of a miss; environment is deliberate, because React Native points
  `CCACHE_CONFIGPATH` at its own config file for iOS builds and the environment
  outranks every config file. `NITRO_UI_CCACHE=0` keeps it out of one build.
- **No build when nothing moved.** `build-app.mjs` asks the same question the
  device gates ask (`checkFreshApp`), and when the answer is yes it prints
  `<platform> example app is fresh, not rebuilt` and exits. `--force`, `--clean`
  and `--no-stamp` all build.

Three things it buys that are worth knowing before you go looking for a bug:

- **Debug info names the worktree that first compiled the object.**
  `CCACHE_NOHASHDIR` is what makes a second worktree a hit, and it also means a
  cached object keeps the `DW_AT_comp_dir` of the directory that built it. So in
  worktree B, lldb/Xcode/Android Studio resolve a C++ frame back to worktree A -
  or to nothing, once A is deleted. Gates are unaffected (they read the binary,
  not the paths in its debug info). For a native-debugging session, build that
  worktree's objects itself: `NITRO_UI_CCACHE=0`, or `--force` with the cache
  cleared.
- **iOS inherits React Native's ccache `sloppiness`.** Its config file sets
  `modules`, `pch_defines`, `file_stat_matches` and `system_headers`, which is
  upstream's choice, not this repo's. It trades a little correctness for hits:
  the risk is a change reached through `@import` rather than `#include`. Nothing
  under `ios/` uses `@import` today; if that changes and a rebuild looks ignored,
  `NITRO_UI_CCACHE=0` is the answer to all three.
- **A ccache build and a plain build do not share an iOS module cache.**
  `CCACHE_BASEDIR` changes what clang _records_, not only what ccache hashes: a
  `.pcm` compiled under it holds worktree-relative paths. So a build that sets
  it is passed `MODULE_CACHE_DIR=<derivedData>/ModuleCache-ccache.noindex`, and
  everything that compiles without ccache - `real-input:ios`, the smoke builds,
  Xcode itself - keeps Xcode's own `ModuleCache.noindex`. Sharing one directory
  is not slower, it is fatal: the next build reads those `.pcm` files and stops
  with `module 'Foundation' is defined in both …` — the same directory written
  two ways, one of them relative to the worktree. Deleting that
  `ModuleCache.noindex` clears a stale one; a `pod install` does not.

```sh
node scripts/build-app.mjs --platform ios          # fresh? skipped, in half a second
node scripts/build-app.mjs --platform android --force
ccache --show-stats                                # what the cache has been doing
```

The measurements are in `docs/tasks/X6-build-speed.report.md`.

### One build at a time

A build needs no device, so the lease pool does not limit builds: on a 10-core machine,
one task's iOS build and another's Android build plus a `check` reached load average 13,
which is what makes _every other_ task's load guard fire. So `build-app.mjs` takes a
machine-wide **build slot** before it compiles and releases it after, and at most
`maxConcurrentBuilds` native builds (default 1) run at once. Waiting is the normal case:
the waiter prints one line naming the holder, its pid, how long it has been in and the
state file, and then polls.

The rule, stated once in `scripts/build-slot-core.mjs`: **a build that is still running
holds its slot for as long as it runs.** The `ttlMinutes` on a slot is not a deadline for
a build — it is how long a slot survives when its holder cannot be inspected (written by
another host, or no readable pid). Expired a slow build's slot and you get a second build
beside it, the exact spike this exists to prevent, so a `--clean` iOS rebuild that beats
the ttl keeps its slot. The cost is deliberate: a wedged-but-alive build blocks the queue
until somebody stops the pid the message names, and the waiter ends on its own budget
(`NITRO_UI_BUILD_WAIT_MINUTES`, default 60) rather than hanging forever.

`node scripts/doctor.mjs --prime` is a build like any other, so it queues; its budget is
the whole wait _plus_ a build (`NITRO_UI_PRIME_TIMEOUT_MINUTES`), because a timer shorter
than the queue would `SIGTERM` a build that had not started — and a signalled build never
runs its cleanup, which is how `xcodebuild` and Gradle children get orphaned mid-compile.

```sh
cat ~/.nitro-ui/builds.json                  # who is building now
node scripts/lease.mjs list                  # held device leases, and devices nobody owns
```

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

Those variables are what a lease prints, so prefer `node scripts/lease.mjs
acquire --task <id>` over setting them by hand (see "Leasing a device or port").

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

iOS builds first (`pod install` + the workspace's `NitroUiExampleUITests` scheme)
and refreshes `app.stamp` with what it built; Android installs the debug APK that
`node scripts/build-app.mjs --platform android` left, and **refuses** when that
stamp does not match the tree - the same `app.stamp` the harness reads, so an
unbuilt change cannot pass here either. Both install, point the debug build at your
`METRO_PORT`, and read the screen afterwards - `accessibilityIdentifier` on iOS,
`uiautomator dump` on Android - which is what a person and a screen reader have.
Neither script boots or shuts down a device, and neither accepts a device it was
not told about: a simulator UDID (`IOS_UDID`, or the `IOS_SIM_UDID` a lease
exports) and `ANDROID_AVD`/`ANDROID_SERIAL` are required, and an emulator running
another AVD is refused.

They are **not** part of `bun run check`: they need a booted device, a simulator
build and several minutes. Run them when you change how a control receives
touch, and expect the maintainer to run them before a release.

Both run on the Node `.nvmrc` pin: started on a different one, they restart
themselves under it with `fnm exec` rather than refusing a device run, so that one
runtime produced every device gate - a real-input pass on a Node the harness cannot
run on is not comparable evidence.

Each run keeps its evidence in `.real-input/<platform>/` (gitignored): the full
`xcodebuild` and `adb` logs, the accessibility hierarchy printed by a failing
case, the `.xcresult` bundle, and Metro's log. When a check fails, that is the
directory to read.

### Adding a control to the suite

One row in `scripts/real-input/controls.mjs` — for a library component, the row a
manifest with `realInput: true` and a `realInputTitle` generates (`bun run
registry`), not a hand edit — then one check per platform:
`func testRealInput<Id>` in
`example/ios/NitroUiExampleUITests/RealInputTests.swift`, and one key in `CHECKS`
in `scripts/real-input/android.mjs`. Both runners compare their checks against
the shared table and fail - never skip - if a control has no check, or a check
has no control, so a control cannot leave the suite unnoticed. The `hosted-*`
rows stay hand-written: they prove things about `<Host>`, which is a container
rather than a component, and their ids are scenario names this suite owns.
`scripts/__tests__/component-coverage.test.js` checks the same coverage on a
machine with no device, one test per row.

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

| Variable                 | Default      | Meaning                                                              |
| ------------------------ | ------------ | -------------------------------------------------------------------- |
| `IOS_SIM_UDID`           | unset        | Simulator UDID to boot and measure on                                |
| `ANDROID_AVD`            | unset        | AVD name — the runner finds its serial among attached ones           |
| `ANDROID_SERIAL`         | unset        | Used only when there is no AVD name (physical device)                |
| `NITRO_UI_MACHINE_LABEL` | `unlabelled` | This machine's label — required by `--check` and `--update-baseline` |
| `BENCH_ABIS`             | `arm64-v8a`  | Android ABIs to build (`x86_64` on an Intel host)                    |
| `BENCH_LAUNCH_TIMEOUT_S` | `180`/`300`  | Per-launch wall-clock budget (s); raise it on a loaded machine       |

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
compares against the committed baselines, which live per machine —
`bench/baselines/<NITRO_UI_MACHINE_LABEL>/<deviceKey>.json` — so a machine gates only
against baselines it measured itself. `maintainer-mac-1` has both canonical devices
(an iPhone 17 simulator on iOS 27 and an API 35 Pixel 9 emulator); a machine without
its own directory, or any other device, uses `--compare <ref>` instead.
`.github/workflows/bench.yml` would post these tables on a pull request, but it is
disabled. The gate that always blocks is the Reassure render count, below, because it is
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
**staged** on npm (DECISIONS D27, D28). There is no npm token in this repo, in the
workflows, or on any laptop — and no automated run can publish. The package's npm
Trusted Publisher is configured for **staged publishing only**, so the last step of
every release is a person approving it on npmjs.com. 0.1.0 was published by hand
(D26); everything after it is this path.

1. **Make the change, then `bun run changeset`.** Pick the bump (`patch` for a
   fix, `minor` for a new capability, `major` for a breaking change) and write a
   note that reads well in `CHANGELOG.md` — that text _is_ the release note.
   Commit the file it writes in `.changeset/` with your pull request. A change
   that must not release anything (docs, tooling, tests) still gets an entry:
   `bun run changeset add --empty`. `Changeset status` warns on a pull request
   that changes `src/`, `ios/`, `android/`, `cpp/` or `nitrogen/` without one;
   the warning never blocks a merge, because a maintainer can add the entry.
   Only `react-native-nitro-ui` is ever versioned: the `example`, `bench` and
   `bench/modules/bench-probe` workspaces are `private` and listed in `ignore`
   in `.changeset/config.json`. Changesets only versions packages listed in
   `workspaces`, so the `"."` entry in `package.json` — the library itself — is
   load-bearing: drop it and `changeset version` fails with "not in the
   workspace", because it cannot see this package at all.
2. **Merge pull requests to `main`.** The `Release` workflow runs `bun run check`
   in a job with read-only rights. When it is green, a second job runs
   `bun run release:version` and opens or updates a pull request called **Version
   Packages**: it bumps `package.json`, prepends the notes to `CHANGELOG.md`, deletes
   the changeset files, and refreshes `example/ios/Podfile.lock` so the example builds
   against the version it just shipped. Everything merged before it lands folds into
   that one pull request — you review the version, the changelog and that lock there.

   That lock is why this job runs on a macOS runner and not on the Ubuntu one the rest
   of the pipeline uses: the only way to write a correct post-bump `Podfile.lock` is to
   run CocoaPods (a path-pod's `SPEC CHECKSUMS` entry is the sha1 of CocoaPods' own
   evaluation of the podspec), so the job installs the CocoaPods the lock's own
   `COCOAPODS:` trailer names and runs `pod install` inside `release:version`. That script
   is `--preflight && changeset version && --fix`, in that order on purpose: the preflight
   asks only whether CocoaPods is there, and refuses before `changeset version` writes a
   file, so a preview of a release on a machine without the tool does not leave a
   half-versioned tree behind. It is
   also why `bun run check` carries `lock:check`: the guard is a string comparison that
   runs anywhere, and the repair needs the tool. If the refresh ever fails, the job
   fails before the action commits, so a release cannot go out with the lock left
   behind — which is the bug this exists to prevent, and it cost every iOS build after
   it a dirty tree and a stale `app.stamp`.

   That pull request arrives with no checks, which is expected rather than a gap:
   a pull request opened with `GITHUB_TOKEN` starts no workflows. The same commit
   runs the whole gate on `main` the moment it merges, and that run is the gate —
   so `release:version` must never write a tree that fails it. (If `main` ever
   grows required status checks, that pull request cannot merge until the action
   is given a GitHub App token.)

3. **Merge the Version Packages pull request.** The next `Release` run finds no
   pending changesets, so nothing is versioned. What it does instead is pack the
   version now committed on `main` and run `npm stage publish` on that tarball,
   trading the job's OIDC token for staging rights — no npm credential. **Nothing
   is live yet.** That is the end of what automation is allowed to do.
4. **Approve the staged version on npmjs.com.** The package's **Staged Packages**
   tab, or from a machine that already has your npm credentials:

   ```sh
   npm stage list react-native-nitro-ui
   npm stage approve <id>
   ```

   This is where the proof-of-presence lives: 2FA is asked for here, not in CI.
   Until it is approved the version does not exist for anyone installing the
   package, and no tag is made.

5. **The tag and the release follow on their own.** `Release tag` runs hourly:
   when `package.json`'s version is on the registry and `v<version>` has no
   release, it creates `v<version>` at the commit that bumped the version, with
   that version's `CHANGELOG.md` section as the notes. Run it from **Run
   workflow** rather than waiting out the hour.

Nothing else makes a tag, and that is deliberate. The Changesets action's own git
tags and GitHub releases are switched off — not for style: it writes
`react-native-nitro-ui@0.1.1` instead of `v0.1.1` for any package whose workspace
tool is not `root`, and `"."` in `workspaces` makes manypkg report `bun`. And
tagging at publish time would be wrong anyway, because a staged version is not
live yet.

### Why the pipeline is split into jobs

`npm pack` runs this package's `prepare` — builder-bob, then nitrogen — so packing
pulls the repo's whole dependency tree into the process. That is not something to
do while a token that can reach npm is in the environment, so the rights are split:

| Job       | Rights                                    | Does                                                                                                        |
| --------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `pack`    | `contents: read`                          | install, `bun run check`, the committed-codegen and clean-tree checks, `npm pack`, and the tarball's sha256 |
| `stage`   | `id-token: write`, and nothing else       | download the artifact, verify that sha256, ask the registry, `npm stage publish`                            |
| `version` | `contents: write`, `pull-requests: write` | the Version Packages pull request, through the Changesets action                                            |

`version` is the one job that runs on `macos-26` rather than `ubuntu-latest`, and it
installs the CocoaPods that `Podfile.lock` records before it runs the action: the lock
refresh inside `release:version` needs the real tool, and the commit it produces is the
action's, so there is no later step that could add the lock to it. The rights column is
unchanged by that — a macOS runner is about the toolchain, not the token.

`stage` checks out nothing, installs nothing and runs no script from the tree, so
no code from the repository is ever running while it holds the OIDC token — and
that token can stage one package and do nothing else with it.

Nothing keys on "my run was the one that published", which is what makes a re-run
boring:

- a version that is already on the registry is left alone (`npm view`);
- npm's answer to a version it already knows — staged or published — is treated as
  the outcome we wanted, not as a failure;
- `Release tag` does nothing when the release already exists.

So a dropped, cancelled or re-run workflow loses nothing: the next run reads the
same state. GitHub keeps one pending run per concurrency group and replaces an
older pending one when pushes arrive quickly, which is exactly why the jobs key on
state instead of on the run.

### The changelog

New entries come from `@changesets/changelog-git`: `## 0.1.2`, then
`### Patch Changes`, then one line per changeset, each starting with the short sha
of the commit that carried it. Two things worth knowing:

- that sha is plain text. GitHub autolinks it in a release body, not in a rendered
  `CHANGELOG.md`.
- `@changesets/changelog-github` would link pull requests and their authors
  instead. Inside Actions it would work — the action exports `GITHUB_TOKEN` to the
  version script — but on a laptop `changeset version` would then refuse to run
  without a token, and a changelog generator is not worth a credential on a path
  meant to need none.

The invariant that matters is tested, because a release note that points at the
wrong section is worse than none: `0.1.0` stays the last version heading in
`CHANGELOG.md`, and every heading above it is a version, newest first. Changesets
prepends, so that is what the first Version Packages merge writes — and it is what
`Release tag` reads the release notes out of.

### When something goes wrong

| Where it stopped                | What actually happened                                                | What to do                                                                                                                              |
| ------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `pack` red                      | nothing was packed, versioned or staged                               | fix the cause and push, or re-run the failed run — a re-run uses its original commit                                                    |
| run dropped before `stage`      | GitHub replaced a pending run with a newer one                        | nothing: the next run stages whatever is not on the registry yet                                                                        |
| `version` opened no PR          | _Allow GitHub Actions to create and approve pull requests_ is off     | turn it on and re-run the job; the changesets are still on `main`                                                                       |
| `stage` red                     | the OIDC exchange or the publisher config failed, and npm has nothing | fix the trusted publisher, then run `Release` from **Run workflow**                                                                     |
| staged, never approved          | the version stays invisible, and no tag is made                       | approve it, or `npm stage reject <id>` and let the next run stage it again                                                              |
| approved, no tag or release     | nothing failed: the hourly job has not run yet                        | wait, run `Release tag` by hand, or `gh release create v0.1.2 --target <sha> --title "react-native-nitro-ui 0.1.2" --notes-file <file>` |
| a tag or release failed partway | `gh` failed mid-way                                                   | nothing: the next hourly run does only what is still missing                                                                            |

A version that is on npm stays on npm. `npm unpublish` breaks every lockfile
pointing at it, so retreat with a deprecation and release a fix:

```sh
npm deprecate react-native-nitro-ui@0.1.2 "<why — point at the replacement>"
```

Never run `npm login` or `npm publish` from a checkout. The only credentials in
this pipeline are the release job's OIDC token, which may only stage, and your own
npm account, which is for approving rather than for pushing a build out. To see
what a release would ship:

```sh
bun run prepare && npm publish --dry-run
```

One `0.0.0-stage` entry does sit in this package's history, and it is npm's own
placeholder for a package _name_ that did not exist yet — that is how 0.1.0's
first minute looked while npm ran its scan. It is not what a staged version of
yours shows up as: a staged version of an existing package simply is not on the
registry until somebody approves it.

Two more things that are as designed:

- every push to `main` runs the whole gate, docs-only pushes included, because
  staging a version is only worth what the run that staged it actually checked.
- `bun run release:version` on a laptop writes the same files as the Version
  Packages pull request, without pushing them. It is for checking what the next
  version would look like, not for cutting one. It needs CocoaPods, though, because it
  refreshes `example/ios/Podfile.lock` in the same breath, so it is three stages:
  `--preflight`, `changeset version`, then `--fix`. The first stage asks only "is
  CocoaPods here?" and refuses _before anything is written_ — on a machine without it, a
  preview either works fully or does not start, rather than leaving you a half-versioned
  tree to clean up. (`node scripts/sync-example-lock.mjs` on its own is the check-only
  half and needs nothing but the two files it compares; `--preflight` and `--fix` are the
  two halves that reach for the tool.)

### Owner setup, once

None of this is a contributor's step, and none of it lives in this repo to change:

1. npmjs.com → `react-native-nitro-ui` → **Settings** → **Trusted publisher** →
   GitHub Actions: owner `dannyhw`, repository `react-native-nitro-ui`, workflow
   name `release.yml`, and no environment name — the job uses none. Under **Allowed
   actions**, leave it at staged publishing: **do not tick `npm publish`**. The
   pipeline is built around a person approving each version, and that box is the
   only thing that keeps it that way.
2. On the same page: **Require 2FA and disallow tokens**.
3. GitHub → this repository → Settings → Actions → General → tick **Allow GitHub
   Actions to create and approve pull requests**, or the Version Packages pull
   request cannot be opened.
4. After merging, check `gh workflow list`. A workflow file that is new to the
   default branch is enabled by itself, so `Changeset status` needs nothing; enable
   `Release` and `Release tag` if either shows as inactive. `Release tag` has to be
   enabled for the hourly schedule to fire at all.
5. Optional: `main` has no branch protection today. The only commits that touch
   `package.json` and `CHANGELOG.md` are the Version Packages ones, so reviewing
   that pull request is the control. A rule that requires pull requests would also
   have to bypass the accounts that push to `main` directly, or those pushes start
   failing.
6. First release, once 1 and 3 are done: merge a pull request with a changeset,
   review the Version Packages pull request, merge it, check `npm stage list`,
   approve, and confirm within the hour that `v<version>` and its release exist.

## Sending a pull request

- Install dependencies, then `bun run check`.
- If you touched specs or native code, run the example builds and the harness
  tests on both platforms.
- Say in the pull request which of the device suites (harness, real-input,
  smoke, bench) you ran and on what.

`.github/workflows/ci.yml` runs on every push to `main` and on every pull
request, on free GitHub-hosted runners: `bun run check` (ubuntu, Node from
`.nvmrc`), the host native ASan tests (**macOS**: they need a Swift toolchain and
`xcrun`, so `scripts/native-tests.sh` prints its skip reason on Linux and CI runs
them in a `macos-latest` job instead), and an Android `assembleDebug` of the
example. Anything that needs one of this project's devices or a Mac's simulators -
the harness suites, the consumer smoke tests, the benchmarks, the Android release
build - stays **manual**: those jobs are `workflow_dispatch` only, because a
hosted runner has no device and a bench number from a shared runner measures
nothing (D21).

Validate workflow edits locally with
[`actionlint`](https://github.com/rhysd/actionlint)
(`actionlint .github/workflows/*.yml`). `.github/actionlint.yaml` declares the one
self-hosted label a job may use.
