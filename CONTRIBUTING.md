# Contributing

The commands in this file are the ones the project's gates run. If you change one, change it
here too.

GitHub runs four workflows on its own. `CI` runs `bun run check`, the host native tests and an
Android debug build on every push to `main` and every pull request. `Changeset status` adds a
warning, never a red check, to a pull request that changes library code without a changeset.
`Release` and `Release tag` run the release path (see "Releasing"). `Smoke` is
`workflow_dispatch` only. The harness, real-input, smoke and bench suites need a device and run
locally, so `bun run check` on your machine is the first gate a change is judged by.

## Prerequisites

- [bun](https://bun.sh) 1.4, the package manager for this repo (`packageManager` in
  `package.json`). Do not add `yarn` or `npm` lockfiles.
- Xcode 27 with the iOS 27 simulator runtime, and CocoaPods.
- JDK 17 and the Android SDK (`ANDROID_HOME`) with an emulator image for API 35.
- [ccache](https://ccache.dev), optional, for the example and bench apps: `brew install ccache`.
  Everything that uses it checks for the binary first. See [Build speed](#build-speed).
- Node 24, pinned in `.nvmrc`. 22.11 to 24 are accepted. On any other version the device gates
  restart themselves under the pinned Node with `fnm exec` when fnm has it, and refuse
  otherwise: on Node 25 and 26 `react-native-harness`'s Jest transform fails with
  `Must use import to load ES Module … react-native/index.js`.

Install dependencies once at the repo root. The example app shares the root install (hoisted
layout, see `bunfig.toml`):

```sh
bun install
```

The doctor checks a machine against all of the above, plus `gh` push access, disk and load:

```sh
node scripts/doctor.mjs           # exit 1 if anything required is missing
node scripts/doctor.mjs --setup   # then create the device pairs
node scripts/doctor.mjs --prime   # and warm the build caches (see below)
```

`--setup` creates two simulator/AVD pairs (`nitro-ui A`/`B`, `nitroui_a`/`b`) and writes the
`~/.nitro-ui/devices.json` the lease script reads (see "Leasing a device or port"). It only
adds: it never touches an existing device, never changes an entry already in `devices.json`,
never installs SDK packages or accepts licenses (it prints the command), and never boots
anything.

`scripts/devices.example.json` shows what `devices.json` can hold. Besides the pool it carries
the machine's two limits: `maxDeviceLeases` (how many device tasks run at once) and
`maxConcurrentBuilds` (how many heavy native builds compile at once; see "One build at a
time"). A value that is not a positive integer is read as the default and named in the build's
output.

`--prime` builds both platforms once, in the main checkout, so a task's first build is warm. It
runs `build-app.mjs`, so it takes a build slot and queues behind a running build, and can sit
quietly before it prints anything. `doctor` reports the cache state as a `build caches` row
judged by ccache's hit count: `warn`, pointing at `--prime`, when there are no hits, and
`unknown` when ccache is not installed.

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
docs/performance.md  every benchmark cell behind the README's Performance summary
docs/DESIGN.md       the design and the decisions in force
```

## Scripts

Run from the repo root.

| Command                         | What it does                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `bun run check`                 | **All static gates.** Run this before pushing.                                 |
| `bun run typecheck`             | `tsc` over the library and example                                             |
| `bun run bench:typecheck`       | `tsc` over `bench/` for each platform                                          |
| `bun run lint`                  | ESLint, including the local perf-contract rules                                |
| `bun run format`                | Prettier check (`format:write` to fix)                                         |
| `bun run test`                  | Jest unit tests (JS wrappers, lint rules, patch script)                        |
| `bun run test:native`           | Host-side C++ and Swift unit tests of the core (macOS only)                    |
| `bun run test:native:android`   | JVM unit tests of the Kotlin core (needs the Android SDK; in `check`)          |
| `bun run nitrogen`              | Regenerate Nitro code, then apply `scripts/patch-nitrogen.mjs`                 |
| `bun run nitrogen:check`        | Regenerate into a temp dir and fail on drift against `nitrogen/`               |
| `bun run registry`              | Write the per-component lists from `src/components/*/component.json`           |
| `bun run registry:check`        | Fail when those lists are not what the manifests say ("Adding a component")    |
| `bun run regen`                 | `nitrogen` + `registry` — what to run after a merge or a new component         |
| `bun run autolinking:check`     | RN CLI + Expo autolinkers must both resolve `NitroUiPackage`                   |
| `bun run prepare`               | Build `lib/` with builder-bob (also runs `nitrogen`)                           |
| `bun run api-extractor`         | Regenerate the public API report in `etc/` (`:check` compares)                 |
| `bun run publint`               | Validate `package.json` publish surface                                        |
| `bun run manifest:check`        | Tarball contents must equal `etc/package-files.txt`                            |
| `bun run readme:check`          | README examples must equal `example/src/readme-examples.tsx`                   |
| `bun run task-ready`            | The hand-in bar: coverage, report citations, `need --for review`               |
| `bun run conformance:table`     | Print the shared table the conformance harness asserts against (`--write`)     |
| `bun run manifest:update`       | Rewrite the manifest after an **intentional** publish-surface change           |
| `bun run harness:ios`           | On-device tests on iOS (see below)                                             |
| `bun run harness:android`       | On-device tests on Android (see below)                                         |
| `bun run harness:cold:ios`      | Only the `ColdSizing` suite (`:android` for Android)                           |
| `bun run test:real-input:ios`   | OS-delivered taps and drags (`:android` for Android; see below)                |
| `bun run smoke:pack`            | `npm pack` the library into `$SMOKE_TMP/tarballs` (see below)                  |
| `bun run smoke:expo`            | Install the packed lib into a fresh Expo app, Release, on-device               |
| `bun run smoke:rn-cli`          | Same for a fresh React Native CLI app                                          |
| `bun bench`                     | Run the on-device benchmarks (see "Running the benchmarks")                    |
| `bun run bench:report`          | Re-render an existing results file, no device needed                           |
| `bun run probe:nitrogen`        | Regenerate the private `bench/modules/bench-probe` Nitro code                  |
| `bun run perf:renders`          | Reassure render-count gate for the JS wrappers                                 |
| `bun run changeset`             | Record a release entry for your change (see "Releasing")                       |
| `bun run release:version`       | Apply pending changesets, as the Version Packages PR does (see "Releasing")    |
| `bun run build:app`             | Build + stamp the example app for one platform (see below)                     |
| `node scripts/worktrees.mjs`    | List this clone's worktrees and why each is kept (`--prune` removes the rest)  |
| `node scripts/watchdog.mjs`     | Report what changed on the machine and project since the last run (`--status`) |
| `node scripts/task-records.mjs` | `--archive`: a merged task's records to `~/.nitro-ui`; staged, not committed   |
| `bun run lease <command>`       | Device/port leases for this machine: `acquire`, `release`, `reap`, `list`      |
| `bun run example <script>`      | Run an `example/` script, e.g. `bun run example ios`                           |
| `bun run storybook:ios`         | The example app in Storybook mode (`:android`; see `example/README.md`)        |
| `bun run hooks:install`         | Install optional git hooks (see "Commit messages and git hooks")               |
| `bun run hooks:uninstall`       | Remove them again                                                              |
| `bun run clean`                 | Delete build outputs (`lib/`, native build dirs)                               |

`bun run check` is seventeen steps: typecheck, lock:check, bench:typecheck, lint, format, test,
test:native, test:native:android, perf:renders, nitrogen:check, registry:check,
autolinking:check, prepare, api-extractor:check, publint, manifest:check and readme:check. A
scheduler runs them (`scripts/check.mjs`, with the step graph in `scripts/check-steps.mjs`), so
independent steps overlap: up to half the machine's cores at once, capped at 4. `--jobs N`
overrides that. `perf:renders` is in `check` because render counts are deterministic, so they
can block.

### Changing a README example

Every TSX block in `README.md` opens its fence with `tsx name=<region>` and must be
byte-identical to the `// #region <region>` block in `example/src/readme-examples.tsx`, which
is typechecked (`tsconfig.json` includes `example/src`). `bun run readme:check` compares the
two and names the first differing line. Add a component by adding a region there and the
matching block in the README.

### Changing the published surface

`etc/package-files.txt` is the reviewed list of published files. Adding a source directory to
`files` in `package.json` changes it: run `bun run manifest:update` and review the diff.

## Adding a component

Each control declares its facts once, in `src/components/<Name>/component.json`, and
`bun run registry` writes the per-component lists from it. The schema, and which lists are
generated and which are only checked, are documented in `scripts/registry-core.mjs`.

```sh
# 1. the per-component files
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
example/e2e/real-input/<id>.e2e.ts      one test file per control (Android)
docs/components/<name>.md               the component page
bun run changeset
```

`bun run registry:check` (in `bun run check`) fails when a list is not what the manifests say,
naming the file and the first line that moved. Never edit a generated region by hand:
`bun run registry` changes it.

The manifest holds identity, not prose: which sets the control belongs to (`bench`, `smoke`,
`realInput`, `hostable`), its kebab `id`, its `sizing` policy (`intrinsic`, `fillWidth`, or
`null` for something that sizes from its style), and its example tab. In a shipped file
(`etc/package-files.txt`), a row that is already there is copied, not re-rendered, and existing
rows keep their positions, so the published bytes do not move.
`scripts/__tests__/registry.test.js` asserts that `--write` over a copy of the tree leaves
every shipped file byte-identical.

`src/index.ts` is checked, not generated: it exports `<Host>`, which has no manifest, and
per-component types no manifest describes (`SegmentedControlChange`, `DatePickerVariant`). The
check fails when a component exists and the barrel does not export it.

The registry generates the `autolinking` section of `nitro.json` and is its only writer;
nitrogen only reads the file. `regen` runs the registry before nitrogen because nitrogen
refuses to generate a Hybrid View that has no entry.

The behaviour tables are hand-written. `scripts/__tests__/component-coverage.test.js` fails
when a bench arm has no branch for a benched control, or when the real-input suite has a
control with no check on either platform.

The conformance suite covers a new control from its manifest. Its four rules (the
accessibility name is on the node that takes focus, nothing leaks when a view is dropped, a
declared fallback is registered and not equal to the measured size, a recycle fully resets) are
driven from `src/components/*/component.json`:

- `example/__tests__/Conformance.harness.tsx` runs the three in-app rules for every fixture in
  its table, and `checkInAppFixtures` fails `check` until the table has a row for your control,
  or when the row's `component:` differs from your manifest's `hybridView`;
- `real-input:android` sweeps the accessibility rule over the screen your tab names, and
  `checkA11yTable` fails `check` when a manifest has no case, or its case points at a tab or a
  label that does not exist;
- `coverageMatrix` builds the rule × control table, and `checkCoverage` refuses a control with
  no row or a cell with no verdict.

If a rule fails on the new control and the fix is outside your change, add a row to the
matching exemption list (`A11Y_EXEMPTIONS` in `scripts/real-input/a11y.mjs`, or
`CONFORMANCE_EXEMPTIONS` in `scripts/conformance-core.mjs`). The suite then reports the control
as known debt, and the row itself goes red once the control is fixed, until it is deleted.

A control's measured size is written in three places: its declared fallback
(`FALLBACK_WIDTH_DP` / `declaresFallback` in its own `HybridNitroUi*` file, registered from
`ios/core/NitroUiDeclaredFallbacks.swift` and `.../nitroui/core/NitroUiDeclaredFallbacks.kt`),
its row in `CONFORMANCE_RULES` in `scripts/conformance-core.mjs`, and the shared table inside
`example/__tests__/Conformance.harness.tsx`. The third is generated from the second by
`node scripts/conformance/print-shared-table.mjs --write` and never hand-edited.

Before handing a round in, run `bun run task-ready`. It checks that the registry agrees with
the control set, every manifest has the conformance coverage above, no `TODO`/`FIXME` sits in a
declared fallback or a generated region, every backticked repo path in the branch's report
exists at HEAD (unless this branch's diff adds or deletes it), `gate.mjs need --for review` is
satisfied, and the report's gate table matches `gate.mjs table` for this code tree. It reports
every problem at once and runs no builds or gates.

- The task id comes from `--task` or from the leading letters and digits of the branch name.
- The report is looked for as `docs/tasks/<branch>.report.md`, then
  `docs/tasks/<ID>.report.md`, then `docs/tasks/<ID>-*.report.md` when exactly one file
  matches. Several matches is a failure that names them all.
- A branch that names two ids is refused until `--task` is passed once per task. A branch with
  no id in its name needs `--task` too.
- `--only coverage,report` runs a subset and prints `PARTIAL`, so a subset cannot be read as a
  pass.

### README screenshots

Every component the README lists is also shown, on both platforms.
`scripts/__tests__/readme-components.test.js` fails `check` until a component has a row in the
Components table, its name in the README import block, and
`docs/images/components/<kebab-case name>-{ios,android}.png` referenced from its Usage section
in an `<img>` and present on disk at the documented width. `Host` is the only exemption: it is
a container with no look of its own.

| Field   | Rule                                                                                                                                                           |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source  | the component's story in the example app's Storybook (`STORYBOOK_ENABLED=true`; `bun run storybook:ios` / `:android`), light appearance, default text size     |
| iOS     | an iOS 27 iPhone simulator at 3x — whichever one the lease hands out — cropped to **804 px** wide                                                              |
| Android | the lease's API 35 emulator, cropped to **720 px** wide                                                                                                        |
| Names   | `<kebab-case name>-ios.png` / `-android.png`, so `SegmentedControl` is `segmented-control-ios.png` and `AlertDialog` is `alert-dialog-ios.png`                 |
| README  | the same `<table>` Switch's Usage section uses: a `<tr><th>iOS</th><th>Android</th></tr>` header, `width="300"`, and alt text that says what the picture shows |

Photograph a presentation (a dialog, a sheet, an open menu) presented: open it first. Two
exports over one native view (`AlertDialog` and `ConfirmationDialog`) get one pair each.

An iOS 27 confirmation is a popover anchored to the dialog's own box, and UIKit draws it over
that box. Photograph it from `Dialog`'s `Confirmation Plain` story: one trigger low on an empty
page, so the card opens upward and its arrow lands on the button it points at.

The control pairs are crops at the simulator's native scale, so 804 and 720 px are two thirds
of those two windows. A presentation is usually wider: the iOS 27 alert card measures ~970 px
at 3x and the Material dialog ~735 px on a 1080-px screen, so a 804/720 px crop of the window
would cut its corners off. Take the band at the window's own width and scale it down to the
documented width. Measure the card's edges: dump a row and a column of pixels
(`magick shot.png -crop 1206x1+0+1360 +repage txt:-`) and find where they stop matching the
dimmed backdrop.

The test reads the width from the PNG's own IHDR chunk: 804 px for iOS (803 is also accepted,
because `button-ios.png` is 803 wide) and 720 px for Android.

To take a pair. None of the scratch edits below is committed; restore them before you finish:

```sh
node scripts/lease.mjs acquire --task <ID> --boot      # "Leasing a device or port"
node scripts/build-app.mjs --platform <p>              # an app to install on that device
bun run storybook:generate                             # the story list, from example/

# A scratch `initialSelection: '<component>--<story>'` (kebab-case of the file and the export, so
# `Dialog.stories.tsx`'s `Playground` is `dialog--playground`) in the getStorybookUI options in
# `example/.rnstorybook/index.tsx`, so the app cold-launches into the story to photograph: the
# on-device story list is not in the iOS accessibility tree, so there is nothing to tap. Switching
# stories means editing this line and relaunching. Restore the entry afterwards.
STORYBOOK_ENABLED=true bun --cwd example start --port <metro port from the lease>

# Point the installed app at that server the way scripts/real-input/ does: on iOS
# `xcrun simctl spawn <udid> defaults write <bundle id> RCT_jsLocation -string localhost:<port>`
# (delete the default afterwards), on Android the `debug_http_host` shared preference plus
# `adb -s <serial> reverse tcp:<port>` (remove the reverse afterwards).
# Android needs `adb -s <serial> shell am start -n nitroui.example/.MainActivity`: `monkey -p` prints
# a SYS_KEYS line and leaves the launcher on screen.

# Dismiss React Native's "Open debugger to view warnings" banner before photographing a bottom
# sheet — it is pinned to the bottom of the window and draws over it. On iOS `agent-device open
# --session sim --platform ios --device "<simulator name>" <bundle id>` then `agent-device
# react-native dismiss-overlay --session sim`; on Android a tap on its ✕, which is not in the
# accessibility tree, so measure it from a screenshot. It comes back on every launch.

# Present what is worth photographing. iOS: `agent-device press 'text="Open the alert"' --session
# sim --settle`, and `agent-device close --session sim` at the end. Android: `adb -s <serial> shell
# uiautomator dump` for the button's bounds, then `input tap` its centre.

xcrun simctl io <udid> screenshot /tmp/story-full.png
adb -s <serial> exec-out screencap -p > /tmp/story-full.png
magick /tmp/story-full.png -crop 1206x660+0+1040 +repage -resize 804x docs/images/components/<name>-ios.png
magick /tmp/story-full.png -crop 1080x640+0+930  +repage -resize 720x docs/images/components/<name>-android.png
```

`magick` and `sips` are a developer's tools, not a dependency: nothing in the repo resizes a
picture at build time.

### Merging two components

`bun run regen` is the merge recipe, and `bun run check` passing afterwards is the definition
of a finished merge; `registry:check` on its own proves the generated regions and nothing else.

When two branches both add a control, the lists they both touch conflict. Take either side of
every conflicted generated file and run `regen`: the generator adds any manifest a list is
missing, so both controls' rows come back. `nitro-ui.sizing.json` is generated by the registry
and takes either side as well. `nitrogen/generated/**` needs no hand resolution:
`.gitattributes` says `merge=union` there, and `regen` rewrites the files from scratch.

These files are inputs, not outputs, and need both sides' lines kept: `src/index.ts` (one
export per component), the bench arm's import and branch, `ROW_HEIGHTS` in
`bench/src/implementations/shared.ts` for benched controls (`bench:typecheck` fails if one is
lost), `func testRealInput<Name>` in `RealInputTests.swift`, the Android e2e test
`example/e2e/real-input/<id>.e2e.ts`, and the docs.

`bun run registry` refuses to write when a control has no `example/src/<Name>Screen.tsx`: the
check says so, so no `App.tsx` that does not compile is generated.

## Nitrogen and the ViewProps patch

`bun run nitrogen` runs `nitrogen src` and then `scripts/patch-nitrogen.mjs`, which re-adds the
base `ViewProps` that nitrogen 0.37.1 drops for generated view specs (nitro#1655/#1656; #1184
is the separate null-props crash) using `cpp/NitroUiPropsCompat.hpp`. `docs/upstream.md`
describes both defects.

Only `src/` is scanned, and `nitro.json` lists `example`, `bench`, `lib`, `dist`, `docs`,
`scripts` and `patches` in `ignorePaths`. A `*.nitro.ts` spec that belongs to another Nitro
module in this repo, such as the private bench probe in `bench/`, therefore stays out of this
package's generated code and autolinking. A second app or module brings its own `nitro.json`
and runs nitrogen itself.

The patch script:

- hard-fails if its anchor is missing, so a nitrogen upgrade cannot silently drop the patch
  (also when the checkout path contains a space, `#`, `%` or non-ASCII characters;
  `scripts/__tests__/patch-nitrogen.test.js` guards that);
- is idempotent, skips files that already contain upstream's fix, and is a no-op while the
  package has no Hybrid Views.

`nitrogen/generated/` is committed, so codegen is reviewable and nothing is generated at
install time, and `bun run nitrogen:check` guards it. Never edit generated files by hand:
change the script or the spec.

## Running the example app

```sh
bun run example ios          # builds + launches on a simulator
bun run example android
bun run example start        # plain Metro (port 8081)
```

## Leasing a device or port

Several tasks work on one machine at once, so the simulator, AVD, emulator port, adb port and
Metro port a run may use are leased, not chosen per task. `scripts/lease.mjs` hands them out.

```sh
node scripts/lease.mjs acquire --task <ID> --out /tmp/<ID>.env   # or: bun run lease acquire …
source /tmp/<ID>.env                                              # exports the variables below
node scripts/lease.mjs list
node scripts/lease.mjs release <ID>
```

`acquire` prints the env file on stdout (or writes it with `--out`) and exits 1 with a reason
when it refuses. It hands out `IOS_SIM_UDID`, `IOS_SIM`, `IOS_VERSION`, `ANDROID_AVD`,
`ANDROID_API_LEVEL`, `AVD_PROFILE`, `EMULATOR_PORT`, `ANDROID_SERIAL`,
`ANDROID_ADB_SERVER_PORT` and `METRO_PORT`, the variables `example/rn-harness.config.mjs` and
the real-input scripts read. It also exports `METRO_PORT_IOS` and `METRO_PORT_ANDROID` for the
platforms the lease covers; `gate.mjs` runs each device gate on its own platform's port, so an
iOS and an Android gate on one lease never share a Metro.

The rules the script enforces:

- At most `maxDeviceLeases` device leases at a time (default 2). The next one is refused.
- The queue is first come, first served. An `acquire` that is willing to wait
  (`--wait-minutes N`) records a ticket with the time it started waiting and refreshes it on
  every poll, and the oldest live ticket a pair would satisfy owns that pair. A waiter holds
  only what it can use: an iOS-only waiter does not hold an Android-only pair. A pair the queue
  is entitled to can sit idle until that waiter's next poll (10 s), or up to 60 s when its
  ticket belongs to a process that died. `--wait-minutes 0`, the default for a lease that is
  not exclusive, does not join the queue: it takes a pair now if nothing older is waiting and
  is refused otherwise. `list` shows the queue (task, waiting since, position), and a refusal
  names who is in front of you.
- `--exclusive`, for a bench session, waits until every other lease has ended and then holds
  every pair. While it waits it keeps its place and holds new leases back, so the machine goes
  quiet.
- The emulator serial `emulator-5560` can never be leased, because an `adb` command without
  `-s` reaches it. A pool that contains it is refused when it is read.
- Every device gate refuses to start without a lease. `gate.mjs harness:*`, `real-input:*`,
  `smoke:expo`, `smoke:rn-cli` and `bench`, filtered runs included, check `NITRO_UI_LEASE_ID`
  against `leases.json` before the build, the Metro pre-flight, the device claim and the
  ledger. They refuse unless the lease is live, belongs to the task and platform the run names,
  and holds the simulator or emulator the environment names. Nothing is recorded for a refusal
  and no flag skips it; a bench host passes because it holds an `--exclusive` lease. An Android
  run uses the lease's `ANDROID_SERIAL` and its private `ANDROID_ADB_SERVER_PORT`.
- The emulator boots on the port behind the serial it was handed: the harness passes
  `-port $EMULATOR_PORT`. A run whose `ANDROID_SERIAL` disagrees with its `EMULATOR_PORT`, or
  which names the reserved serial, is refused by the harness config and by real-input before
  anything is installed on a device.

A Metro port is part of the pair, and a server on it can outlive the lease:

- A pair whose Metro port a live process serves is not handed out. `acquire` asks the kernel
  (`lsof`) as well as the lease file, skips a free pair with a busy port, and a task with
  nowhere else to go waits with a reason that names the pid and program. A machine without
  `lsof` says so once and leases anyway.
- A device gate pre-flights the port its own lease exported before the build, and refuses
  naming the process that serves it. When that server is yours on purpose (a Metro started by
  hand for a debugging session, which the harness then attaches to), set
  `NITRO_UI_GATE_METRO_FORCE=1`; the gate prints a line saying it ran anyway.
- A gate stops a Metro its own run left behind, matched by process group, so another task's
  server is never touched. That lets `real-input:ios`, `real-input:android`, `harness:ios` and
  `harness:android` run in sequence on one lease.
- An `--exclusive` acquire does not wait on Metro ports, and names the process that holds one.
  A bench builds a Release app with the bundle inside it and never uses the port.

The pool is one file per machine, because UDIDs, AVD names and ports do not travel between
machines. Copy `scripts/devices.example.json` and edit it:

```sh
mkdir -p ~/.nitro-ui
cp scripts/devices.example.json ~/.nitro-ui/devices.json   # then put your real devices in it
```

```json
{
  "maxDeviceLeases": 2,
  "maxConcurrentBuilds": 1,
  "idleShutdownMinutes": 30,
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

A pair is one iOS simulator and one Android emulator that belong together, plus their ports.
`metroPort` is the iOS Metro port. The Android one is `androidMetroPort` when the pair names it
and `metroPort + 1000` otherwise; no two Metro ports in the file may be the same.
`reservedIdentifiers` is for anything else that must never be handed out (a person's own
device, another project's simulator). State lives in `~/.nitro-ui/leases.json` behind
`~/.nitro-ui/leases.lock`. Leases expire after a TTL (`--ttl-minutes`), so a killed task cannot
block the machine. `NITRO_UI_HOME` moves the whole directory.

`ANDROID_ADB_SERVER_PORT` gives each task a private adb server, so one task's `adb` never
queues behind another's. Never run `adb kill-server` on the default port.

A lease is for the platform it names. `--platform ios` boots only the pair's simulator and
`--platform android` only its emulator. Re-running `acquire --boot` without `--platform` keeps
the platform the lease was taken for.

### The lease owns device lifecycle

The lease keeps the pair it hands out warm, and a task does not power devices off.

```sh
node scripts/lease.mjs acquire --task <ID> --boot       # boots the pair, waits until settled
node scripts/lease.mjs list                             # what is booted, and who holds it
node scripts/lease.mjs reap                             # powers off what is idle past the limit
node scripts/lease.mjs reap --idle-minutes 0            # "power the pool off now", whatever the limit says
node scripts/lease.mjs release <ID>                     # devices stay up, on purpose
```

- Booting is opt-in. `--boot` (or `NITRO_UI_LEASE_BOOT=1` for a whole shell) boots what is
  down, waits for `adb devices` / `simctl list` to show it, then waits for the load average to
  settle, and prints how long it waited. Without it a lease only reserves names.
- Nothing reaps passively. `acquire`, `release` and `list` never power a device off, not even
  one idle past `idleShutdownMinutes` (`devices.json`, default 30). Devices are powered off in
  two places only: `node scripts/lease.mjs reap`, and an `--exclusive` acquire.
  `reap --idle-minutes N` overrides the configured limit for that one call; `0` is "off now".
  `NITRO_UI_LEASE_BOOT=0` turns the whole device lifecycle off, for a machine that manages its
  own devices.
- A device under a live lease is never powered off by a reap, whoever asks, and
  `--idle-minutes` does not override that. The idle limit applies to a device whose lease was
  released or expired. To get a leased device powered off, release its lease; `list` names
  whose it is.
- A warm device keeps app state. The pool touches nothing inside a device, so the example app's
  data, the iOS keychain and the privacy-consent (TCC) grants carry over from whoever used the
  pair last. A run that needs clean app state clears or reinstalls the app itself, and a test
  that asserts a permission prompt appears needs a freshly created device.
- A device is only powered off if `devices.json` names it, and never on a reserved serial. The
  address is derived from the pair, and the emulator is asked (`adb -s <serial> emu avd name`)
  which AVD is behind that serial before anything is powered off. A device that cannot identify
  itself stays up.
- A run in flight is never interrupted. A gate claims the devices of its lease for the duration
  of the run (`scripts/gate.mjs`), so a reap cannot power off an emulator mid-suite, and a
  second gate aimed at the same device is refused before it starts.
  `NITRO_UI_GATE_DEVICE_FORCE=1` runs anyway.
- An `--exclusive` acquire powers off every pool device no other lease holds, with or without
  `--boot`. It boots only for a typed `--boot`, never for `NITRO_UI_LEASE_BOOT=1`, and an
  exclusive `--boot` must name the half it warms (`--platform android|ios|both`) or it is
  refused. With `--boot`, a device of the named platform in the pair being handed over that is
  already up is left up.
- Anything started outside `gate.mjs` runs unclaimed: `bun run harness:*`, a direct
  `node scripts/real-input/*.mjs --control …` and `build-app.mjs`. Their protection is the
  lease, because a leased pair is never reaped. To run a device command, take a lease.
- A claim is a pid. A reap treats the claim of a gate that was killed as no claim.
- Nothing opens Simulator.app: a pooled simulator is booted with `simctl boot` and stays
  headless. On Xcode 27 the app boots a default device no lease handed out. Open it by hand to
  watch one.

## Running the on-device (Harness) tests

`react-native-harness` runs `.harness.tsx` files inside the app. It does not build the app and
it runs debug builds only, so build first, then run.

```sh
node scripts/build-app.mjs --platform ios        # or: --platform android
bun run harness:ios                              # or: harness:android
```

`build-app.mjs` runs `pod install` when the Pods are out of date, builds into a fixed path
inside your worktree (`example/ios/build` via `-derivedDataPath`, `example/android/app/build`),
and writes `app.stamp` next to the artifact. The harness config reads that stamp, so
`HARNESS_APP_PATH` does not have to be set; export it only to point a run at another artifact.

The stamp stops a device run from testing code the app does not contain. It records a hash of
the code tree (everything git tracks except `docs/`, `bench/`, `.github/`, `.vscode/` and
Markdown) and how many times each registered component's hybrid class appears in the binary.
The component list comes from nitrogen's generated autolinker. A harness or real-input run
refuses, before it touches a device, when:

- the tree hash differs from the one the app was built from, so your edit is not in the binary;
- a registered component is missing from the binary. On Android this is gradle reporting
  `packageDebug` up-to-date over a dex without the generated hybrid, which `build-app.mjs`
  repairs by re-running `packageDebug --rerun`.

The equivalent manual commands:

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

A hand-built artifact has no stamp, so a gate asked to use one refuses and names
`build-app.mjs`; pointing `HARNESS_APP_PATH` at an Xcode or Android Studio build does not pass
the check. `NITRO_UI_ALLOW_UNSTAMPED=1` is for a run that has no artifact at all (a suite
against whatever the emulator already has installed). It is read only when no artifact exists,
it cannot waive the check on one that does, and it prints a red line saying the run proves
nothing about this checkout. Never use it to get a gate green.

`scripts/pod-install.mjs` is the repo's only CocoaPods entry point. It runs the CocoaPods
version `Podfile.lock` records, so a machine on another version does not leave a diff that
changes only the lock's `COCOAPODS:` trailer.

### Recording a gate run

`scripts/gate.mjs` runs a named gate and records the result: `check`, `harness:<ios|android>`,
`real-input:<ios|android>`, `smoke:<pack|expo|rn-cli>` or `bench`. Each run appends one line to
`.gates/<branch>.jsonl` (gitignored), keyed to the code tree the stamp uses, so a docs-only
commit leaves a green gate green. The line is also copied to a record every worktree of the
clone reads, even after its worktree is removed. When a branch has no line of its own on a
device gate's current digest, the newest (by start time) full run or completion of that gate
on that digest from any branch decides, green or red, and the row names the branch it came
from. A relaxed green, or one written by other gate code or another ledger version, never
counts from elsewhere (`docs/agents/gates.md`, "Runs from other branches"). `check` is never taken from
another branch: it reads docs and `bench/`, which the digest leaves out. A device gate reads its
device from the lease and refuses to start unless that lease is live and holds the device it is
about to use.

```sh
set -a; source <(node scripts/lease.mjs acquire --task <id> --platform android); set +a
node scripts/build-app.mjs --platform android
node scripts/gate.mjs harness:android      # `-- ColdSizing` records `harness:android:ColdSizing`
node scripts/gate.mjs harness:android --rerun-failed   # after a red full run: re-runs only what failed
node scripts/gate.mjs need --for merge     # exits 1 and lists what is still missing
node scripts/gate.mjs table                # the gate table for a report
node scripts/lease.mjs release <id>
```

Each device gate is keyed to the files its own run reads: on a branch whose gates are already
green, an edit under `example/e2e/` owes `real-input:android` and nothing else, and an edit to a
harness test owes the harness gates and no real-input gate. A fresh branch owes `check` and the
device gates no branch of the clone has passed on its files. A red full `harness:<p>` or
`real-input:<p>` run can be completed with `--rerun-failed`, which re-runs only the suites or
controls that did not pass and records the outcome under the full gate; `table` shows it as
completed, never as a clean pass. An iOS gate and an Android gate can run side by side from one
worktree under one lease for both platforms: the lease exports a Metro port per platform and
each gate uses its own. Build both apps first, and run `real-input:ios` with no other gate
beside it; the two harness gates can run together.

What review and merge need, how a run is matched to the tree, completing a red run, waiting for
a background gate, and where logs are kept are in [docs/agents/gates.md](docs/agents/gates.md).

`table --full` adds the log path to every row and, under the table, the duration of each step
of the `check` run. A task report carries the table (`AGENTS.md`, "Report"). The ledger stays
local and is never committed.

A failed device gate appends to its log the booted simulators, the leased emulator's
`adb get-state`, the lease list, load1 and the app's last `logcat` lines. Any device identifier
in that block that is not the run's own lease is written as `<other device>`.

### Build speed

Nothing in this section changes what a library user gets: it is all in `scripts/`, the example
app and the bench app.

Four things make a local build faster:

- One ABI. `scripts/build-app.mjs` builds the ABI this machine runs (`arm64-v8a` on Apple
  Silicon, `x86_64` on Intel) instead of the four in `example/android/gradle.properties`.
  `--arch arm64-v8a,x86_64` or `NITRO_UI_ANDROID_ARCH` overrides it. The gradle default stays
  the full list, so a hand-run `./gradlew` builds every ABI, and the Android CI jobs pass
  `x86_64` because that is what their emulator runs.
- Gradle caches. The example app sets `org.gradle.caching` and
  `org.gradle.configuration-cache` in its `gradle.properties`. The bench script sets
  `org.gradle.caching` in its generated `android/` tree after every `expo prebuild`, and keeps
  the configuration cache off there, because the `app/build.gradle` Expo generates starts
  `node` while it is configured. The build cache is per user, so a fresh worktree starts with
  the tasks every other worktree already ran.
- ccache. The example Podfile passes `:ccache_enabled => true`, the bench app sets
  `USE_CCACHE=1` for the Podfile `expo prebuild` owns, and `scripts/gradle-ccache.init.gradle`
  (passed with `-I`, only when ccache exists) puts `CMAKE_<LANG>_COMPILER_LAUNCHER` in front of
  the NDK builds. The scripts export `CCACHE_BASEDIR` (this worktree) and `CCACHE_NOHASHDIR=1`,
  which make the same file in another worktree a cache hit. They are set in the environment
  because React Native points `CCACHE_CONFIGPATH` at its own config file for iOS builds, and
  the environment outranks every config file. `NITRO_UI_CCACHE=0` keeps ccache out of one
  build.
- No build when nothing moved. `build-app.mjs` asks the same question the device gates ask
  (`checkFreshApp`), and when the app is fresh it prints
  `<platform> example app is fresh, not rebuilt` and exits. `--force`, `--clean` and
  `--no-stamp` all build.

Three consequences to know before you look for a bug:

- Debug info names the worktree that first compiled the object. With `CCACHE_NOHASHDIR`, a
  cached object keeps the `DW_AT_comp_dir` of the directory that built it, so in another
  worktree lldb, Xcode and Android Studio resolve a C++ frame to the first worktree, or to
  nothing once it is deleted. Gates are unaffected. For a native-debugging session build with
  `NITRO_UI_CCACHE=0`, or `--force` with the cache cleared.
- iOS inherits React Native's ccache `sloppiness`. Its config file sets `modules`,
  `pch_defines`, `file_stat_matches` and `system_headers`, which risks missing a change reached
  through `@import` instead of `#include`. Nothing under `ios/` uses `@import`. If a rebuild
  looks ignored, use `NITRO_UI_CCACHE=0`.
- A ccache build and a plain build do not share an iOS module cache. A `.pcm` compiled under
  `CCACHE_BASEDIR` holds worktree-relative paths, so a build that sets it is passed
  `MODULE_CACHE_DIR=<derivedData>/ModuleCache-ccache.noindex`, and everything that compiles
  without ccache (`real-input:ios`, the smoke builds, Xcode itself) keeps Xcode's own
  `ModuleCache.noindex`. A build that reads a module cache written the other way stops with
  `module 'Foundation' is defined in both …`. Delete that `ModuleCache.noindex` to clear a
  stale one; a `pod install` does not.

```sh
node scripts/build-app.mjs --platform ios          # fresh? skipped, in half a second
node scripts/build-app.mjs --platform android --force
ccache --show-stats                                # what the cache has been doing
```

### One build at a time

A build needs no device, so the lease pool does not limit builds. `build-app.mjs` takes a
machine-wide build slot before it compiles and releases it after, and at most
`maxConcurrentBuilds` native builds (default 1) run at once. Waiting is the normal case: the
waiter prints one line naming the holder, its pid, how long it has held the slot and the state
file, and then polls.

A build that is still running holds its slot for as long as it runs
(`scripts/build-slot-core.mjs`). The `ttlMinutes` on a slot is not a deadline for a build: it
is how long a slot survives when its holder cannot be inspected (written by another host, or no
readable pid). A build that is stuck but alive blocks the queue until someone stops the pid the
message names, and a waiter gives up after `NITRO_UI_BUILD_WAIT_MINUTES` (default 60).

`node scripts/doctor.mjs --prime` queues like any other build. Its budget is the whole wait
plus a build (`NITRO_UI_PRIME_TIMEOUT_MINUTES`).

```sh
cat ~/.nitro-ui/builds.json                  # who is building now
node scripts/lease.mjs list                  # held device leases
node scripts/doctor.mjs                      # booted devices nobody owns
```

### Devices and ports

`example/rn-harness.config.mjs` reads every device setting from the environment, so several
checkouts can run at once on one machine, each with its own simulator, AVD and Metro port.

| Variable            | Default     | Meaning                                                |
| ------------------- | ----------- | ------------------------------------------------------ |
| `IOS_SIM_UDID`      | unset       | Simulator **UDID** — wins over `IOS_SIM`/`IOS_VERSION` |
| `IOS_SIM`           | `iPhone 17` | Simulator name (used when no UDID is given)            |
| `IOS_VERSION`       | `27.0`      | Simulator runtime the name is looked up in             |
| `ANDROID_AVD`       | `nitroui`   | Emulator name (the harness creates it if missing)      |
| `ANDROID_API_LEVEL` | `35`        | AVD system image                                       |
| `AVD_PROFILE`       | `pixel_9`   | AVD device profile                                     |
| `METRO_PORT`        | `8291`      | Metro port                                             |

`ANDROID_AVD` is the name to set; `AVD` is accepted as an alias.

`react-native-harness` selects an iOS simulator by name and runtime version. With
`IOS_SIM_UDID` the config looks the UDID up with `xcrun simctl list` and passes that
simulator's name and runtime:

- an unknown UDID is a hard error (create it first, or fix the UDID);
- if two available simulators share that name and runtime, the config errors too, because the
  harness would pick one of them at random. Give each simulator a unique name
  (`xcrun simctl rename <udid> nitro-ui-iPhone17`).

Example:

```sh
IOS_SIM_UDID=<simulator udid> METRO_PORT=8291 bun run harness:ios
ANDROID_AVD=<avd name> METRO_PORT=8292 bun run harness:android
```

Metro does not use the default 8081 here, because a busy port makes the harness hang.
Simulators and emulators are told which port to use when the harness launches the app, so
nothing is baked into the build; a stock `react-native start` is still on 8081. Every
concurrent run sets its own `METRO_PORT`: the harness fails fast with
`MetroPortUnavailableError` and never attaches to another run's Metro.

A lease prints these variables, so take one with `node scripts/lease.mjs acquire --task <id>`
instead of setting them by hand (see "Leasing a device or port").

### Reading a measured box in a harness log

- Every box is read from a poisoned fallback. `seedSizingSize` files a size no instance of the
  component can have (IconButton's suite uses 17.5 x 63.5 pt) under each configuration's key
  and then bumps the sizing environment, so the mount that follows starts wrong and has to
  correct. A fixture's fallback must never equal the right answer, or a correction that never
  arrived reads the same as one that did.
- A device box is a density multiple, not the number in the table. On an emulator at 2.625
  density, IconButton's `medium`/`wide` token of 52 dp is laid out as 137 px and reads back as
  52.19 dp. Comparisons in the suite allow 0.6 for it, and a docs table that quotes dp quotes
  the token.
- A known-debt row is pinned to the measurement that opened it. `A11Y_EXEMPTIONS`
  (`scripts/real-input/a11y.mjs`) matches a failure's own numbers, so a row is reported stale
  as soon as the geometry changes, including when the control is fixed, and a fixed control
  deletes its row.

### What a run publishes about itself

Harness assertions are structural: corrections, immediate pushes, flushes, stale frames, event
counts and layout boxes in px. They hold at any machine load. A test that measures a duration
prints it and judges nothing; what the library costs is measured by `bench/`.

Assertions run inside the app, which cannot see the runner's environment. The runner publishes
the one setting an assertion depends on, the locale opt-out
(`NITRO_UI_ALLOW_LOCALE_MISMATCH`, read by the conformance rule that compares a
locale-dependent box). `rn-harness.config.mjs` writes `example/harness-run/state-<port>.json`
for its Metro port (gitignored, refreshed every 2 s), and `example/metro.config.js` declares the
one Metro route that serves, per request, the file for the port the request arrived on, so two
runs on two ports never see each other's. It is served on the Metro port because an emulator
reaches the host only through the `adb reverse` the harness sets up for Metro. A reader checks
the file's `metroPort` and age before trusting it. `scripts/harness-run-state.js` holds the
publishing and serving code for both config files.

## Running the real-input tests

The harness drives controls through the library's own test hooks. The real-input suite proves
what that cannot: that a touch delivered by the operating system reaches a hosted SwiftUI or
Compose control inside a React Native app. It synthesises taps and drags outside the app
(`XCUIDevice`'s event path on iOS, `agent-device`'s on Android) and asserts only on `Text` the
app renders on screen. It uses no test hook, no Nitro callback and no in-app tracer. Android is
two phases on one device session: an e2e suite in `example/e2e/`, one file per control, then —
with the driver's daemon stopped, because `uiautomator dump` will not answer while it is attached
— the accessibility sweep and the `adb input` + `uiautomator` checks in
`scripts/real-input/a11y-sweep-device.mjs` and `scripts/real-input/android-tree-checks.mjs`. Both
phases decide one exit code and one ledger line, and `--control` narrows both.
`example/e2e/README.md` says what each phase asserts.

```sh
# iOS - the simulator must already be booted (the suite boots nothing)
IOS_UDID=<simulator udid> METRO_PORT=8291 bun run test:real-input:ios

# Android - the emulator must already be booted, on your own adb server
ANDROID_AVD=<avd> ANDROID_ADB_SERVER_PORT=<port> METRO_PORT=8292 \
  bun run test:real-input:android

# one control at a time
bun run test:real-input:android --control slider
```

A full iOS run also reads every accessibility case and measures every example tab as a touch
target. A filtered iOS run reads only the accessibility cases of the controls it names, and the
tab bar only when asked, so proving one control costs that control and a build:

```sh
node scripts/gate.mjs real-input:ios -- --control switch           # the switch and its a11y case
node scripts/gate.mjs real-input:ios -- --a11y form --tab-targets  # one a11y case and the tab bar
```

iOS builds first (`pod install` and the workspace's `NitroUiExampleUITests` scheme), with the
same ccache environment and module cache as `build-app.mjs`, so neither build recompiles what
the other compiled, and refreshes `app.stamp` with what it built. Android installs the debug APK that
`node scripts/build-app.mjs --platform android` left, and refuses when that stamp does not
match the tree. Both install, point the debug build at your `METRO_PORT`, and read the screen
afterwards: `accessibilityIdentifier` on iOS, the accessibility tree on Android, which is what
a person and a screen reader have. Neither script boots or shuts down a device, and neither
accepts a device it was not told about: a simulator UDID (`IOS_UDID`, or the `IOS_SIM_UDID` a
lease exports) and `ANDROID_AVD`/`ANDROID_SERIAL` are required, and an emulator running another
AVD is refused.

They are not part of `bun run check`: they need a booted device, a simulator build and several
minutes. Run them when you change how a control receives touch.

Both run on the Node version `.nvmrc` pins: started on another version, they restart
themselves under it with `fnm exec`.

Each run keeps its evidence in `.real-input/<platform>/` (gitignored): the `xcodebuild` log and
the `.xcresult` bundle on iOS, Metro's log and the driver's state directory on Android. Android
also keeps e2e's own `report.json` in `example/e2e/.e2e/android/`, with a trace, the screen as
the driver read it, and a screenshot for every attempt. A phase-2 check writes no file: the dump
a refused press was refused against, and the readings that decided a failed check, are printed
into the run's log, which `node scripts/gate.mjs` keeps beside the ledger line. Read those when a
check fails.

### Adding a control to the suite

Add one row in `scripts/real-input/controls.mjs`. For a library component, a manifest with
`realInput: true` and a `realInputTitle` generates the row (`bun run registry`); do not edit it
by hand. Then add one check per platform: `func testRealInput<Id>` in
`example/ios/NitroUiExampleUITests/RealInputTests.swift`, and one
`example/e2e/real-input/<id>.e2e.ts` on Android. Both runners compare their checks against the
shared table and fail, never skip, if a control has no check or a check has no control. The
`hosted-*` rows are hand-written: they prove things about `<Host>`, which is a container, and
their ids are scenario names this suite owns. `scripts/__tests__/component-coverage.test.js`
checks the same coverage on a machine with no device, one test per row.

## Consumer smoke tests

The smoke tests check a zero-config install: `npm pack` the library, install it with npm (what
users run, not bun) into a freshly generated app, build Release (bundle embedded, no Metro),
install, launch, wait for the ready signal, take a screenshot, and fail on crashes. If a fresh
consumer needs a manual native change, that is a library bug: fix the library, never work
around it in the scripts.

Both platforms use one signal. `scripts/smoke/App.tsx` logs `NITRO_UI_SMOKE_READY` once the
native core answers and every control has been laid out with a non-zero size. React Native
routes `console.*` to a host-readable stream in every build configuration: Android logcat, and
on iOS `os_log` under subsystem `com.facebook.react.log` (`console.log` maps to `INFO`, so the
stream needs `--level info`):

```sh
xcrun simctl spawn "$IOS_SIM_UDID" log stream --level info --style compact \
  --predicate 'subsystem == "com.facebook.react.log"'
```

The line carries the box each control got. This example is from iOS and shows seven controls
and `host`:

```
NITRO_UI_SMOKE_READY switch=61x28 slider=354x31 button=61x34.333343505859375 progress=354x4 segmented-control=165x31 date-picker=138x34 picker=72x35 host=354x96
```

`scripts/smoke/lib.mjs` owns the contract: one `name=WxH` box, greater than `0x0`, for every
name in `SMOKE_CONTROLS`, which is every control with `smoke: true` in its manifest plus
`host`, the `<Host>` container. A number may be fractional, because `onLayout` reports computed
layout metrics. `scripts/smoke/ready-line.mjs` is the command both platform paths call, so a
control that mounts at `0x0` fails the run on either platform. If the core answers and a
control still has no box after 6 s, the app logs `NITRO_UI_SMOKE_PENDING` with the sizes it
saw, and the runner fails on that at once without waiting out `READY_TIMEOUT`.
`scripts/__tests__/smoke-ready-line.test.js` (in `bun run check`) proves the assertion can
fail.

The same stream fails the run fast on `Unhandled JS Exception` / `RCTFatal`. The app paints its
background white while starting, red when ready, amber while a control still has no box and
blue on a failed core call, so a screenshot is readable by a person. Never launch with
`simctl launch --console-pty`: it does not carry `os_log`.

```sh
IOS_SIM_UDID=<udid> ANDROID_AVD=<avd> \
  bun run smoke:expo            # Expo SDK 58, the supported floor
PLATFORM=android bun run smoke:rn-cli   # RN 0.88.0, the supported floor
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

By default every run packs the library fresh from the working tree into its own directory
under `$SMOKE_TMP/tarballs`, so a stale tarball cannot mask an edit. `SMOKE_TARBALL` skips
packing and refuses a tarball whose recorded `.gitsha` is not the current commit.

The scripts are re-runnable and never collide: each run gets a unique `mktemp -d` app directory
under `$SMOKE_TMP`, and background processes, Gradle daemons and devices it booted are cleaned
up on every exit path (Gradle also runs `--no-daemon`). Logs, screenshots and timings stay
under `$SMOKE_TMP/artifacts/<script>-<timestamp>-<pid>/`, including the full console of the run
in `run.log`.

### Results

The install routes the README gives are the ones these scripts run: Expo Continuous Native
Generation (`npx expo prebuild`), a bare React Native CLI app
(`cd ios && bundle install && bundle exec pod install`), and, for an app installing from a
clone, `bun run smoke:pack` and then `npm install` of the tarball into a freshly generated app.

The `Smoke` workflow is dispatch-only, so these run by hand. The ticked cells are runs of the
0.1.0 tarball:

| Consumer              | iOS | Android |
| --------------------- | --- | ------- |
| Expo SDK 58 (RN 0.88) | ✅  | ✅      |
| RN CLI 0.88.0         | ✅  | ✅      |

RN 0.88 and Expo SDK 58 are the supported floor, and no older consumer row is kept. Two things
are not covered by those runs: the controls added to the smoke app after 0.1.0, and the
Compose 1.12 / Material 3 1.5 dependencies, which need the consumer to compile with SDK 37 and
AGP 9.1+ (both templates do).

### Keeping `scripts/smoke/App.tsx` current

`scripts/smoke/App.tsx` is copied over the generated app's `App.tsx` and is the single source
of truth for what a consumer must be able to render. Its rules:

- render every component the package exports exactly once, each with a `SMOKE-` testID;
- log `NITRO_UI_SMOKE_READY <control>=<W>x<H> …` exactly once, after mount, after
  `nitroUiCore.now()` answers and after every control has reported a non-zero `onLayout` box,
  and turn the background red;
- to add a component, set `smoke: true` in its manifest and run `bun run regen`, which writes
  its name into `SMOKE_CONTROLS` in this file and in `scripts/smoke/lib.mjs`, then add its
  import and one JSX line with its `onLayout`. Do not touch the ready-line logic. A component
  that needs state gets its own small probe component above the list (one `useState` and the
  render call). `smoke-ready-line.test.js` fails `check` if the two lists disagree;
- a `<Host>` counts as one control (`host`). A hosted child is drawn by the Host's own
  composition and its RN view is laid out at nothing (`docs/components/host.md`, Sizing), so a
  hosted Switch in `SMOKE_CONTROLS` would fail the contract. Render the Host with its children
  inside it;
- the file is typechecked by `bun run check` (`tsconfig.json` includes `scripts/smoke`), so a
  public-API rename fails the static gate.

`.github/workflows/smoke.yml` runs the same scripts and is `workflow_dispatch` only.

## Running the benchmarks

`bench/` is a release-build app that measures a component against RN core on a simulator or
emulator. The metrics, the protocol, how to read the numbers, the release comparison and the
per-component checklist are in `docs/architecture/benchmarks.md`. The commands:

```sh
IOS_SIM_UDID=<udid>   bun bench --platform ios     --plan quick
ANDROID_AVD=<avd>     bun bench --platform android --plan quick
IOS_SIM_UDID=<udid>   bun bench --platform ios     --plan full --compare-release
```

The third line is the release check. `--compare-release [ref]` measures `ref` (by default the
newest release tag) and this tree in one session on one device, as two bench apps installed one
at a time in alternating launch rounds, and exits non-zero naming the cells that got slower.
Benchmarks are a release-time measurement: a component task runs the `quick` plan when it wants
numbers for its report, and the verdict against the previous release is made once, before the
release, on a machine nothing else is using.

A quick plan is 31 cells x 4-5 arms x 4 launches at 6-10 s per launch, so budget roughly one
to two hours per platform. `--shutdown` powers off a simulator or emulator the runner booted
itself.

| Variable                 | Default     | Meaning                                                        |
| ------------------------ | ----------- | -------------------------------------------------------------- |
| `IOS_SIM_UDID`           | unset       | Simulator UDID to boot and measure on                          |
| `ANDROID_AVD`            | unset       | AVD name — the runner finds its serial among attached ones     |
| `ANDROID_SERIAL`         | unset       | Used only when there is no AVD name (physical device)          |
| `BENCH_ABIS`             | `arm64-v8a` | Android ABIs to build (`x86_64` on an Intel host)              |
| `BENCH_LAUNCH_TIMEOUT_S` | `180`/`300` | Per-launch wall-clock budget (s); raise it on a loaded machine |

Prefer `ANDROID_AVD` over `ANDROID_SERIAL`: console ports are allocated by availability, so a
serial goes stale when another emulator boots or dies.

The bench app is release-only: it embeds its own bundle and starts no Metro, so `METRO_PORT`
does not apply. Native projects under `bench/ios` and `bench/android` are generated and
gitignored; delete them (or pass `--prebuild`) when configuration changes.

On-device numbers inform review and block only on a clear regression. `--compare-release` and
`--compare <ref|file>` both gate the `nitro-ui` arms on launch-paired ratios to `rn-core`. A
verdict needs the ratio over 1.20 with a 95 % CI that excludes 1.05, on a cell that was quiet
inside its own run. The `rn-core` control and the `expo-ui-*` reference arms cannot fail a pull
request. No device timing is committed: the base side of a verdict is a run, either the release
measured beside the candidate or a results file you already have. The gate that always blocks
is the Reassure render count, because it is deterministic.

## Perf contract

The local ESLint plugin in `eslint-rules/` (see `eslint.config.mjs`) enforces these rules:

| Rule                                 | Enforces                                                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `nitro-ui/no-inline-callback-in-jsx` | No `callback(...)` **call** inside a JSX attribute (incl. spread attributes); pass a stable callback (`useStableCallback`) |
| `nitro-ui/no-anymap-in-spec`         | No `AnyMap` props in `*.nitro.ts` — use typed props                                                                        |
| `nitro-ui/no-json-string-prop`       | No `*Json`/`*JSON` string props — pass structured values                                                                   |
| `nitro-ui/no-optional-view-props`    | No `?:` members in Hybrid View props; use `T \| null` and always send every prop (nitro#1184)                              |

`no-inline-callback-in-jsx` follows the helper through an aliased import
(`import { callback as cb }`) and treats anything inside `use*`/`useMemo` as stable. It does
not track a callback hoisted into a variable in a render body
(`const onChange = callback(fn); <Switch onChange={onChange} />`): keep such values at module
scope or inside a stable hook.

The rest of the contract is checked in review. It is listed in `AGENTS.md` and explained in
`docs/architecture/core.md` and `docs/DESIGN.md` 3.3.

## Commit messages and git hooks

Use Conventional Commits; the optional `commit-msg` hook below checks them. Commit messages
decide nothing about releases: Changesets entries do (see "Releasing").

Git hooks are opt-in. `bun install` never installs them, because git hooks live in the `.git`
directory that every worktree of this repo shares. Enable them in a checkout whose dependencies
are installed:

```sh
bun run hooks:install      # commit-msg runs commitlint; pre-commit runs ESLint, Prettier + tsc
bun run hooks:uninstall    # remove them again
```

The hooks call `bunx --no-install`, so they use that checkout's local binaries and fail instead
of downloading a package. `pre-commit` typechecks the whole program, which is slow; the gate
that has to pass is `bun run check`.

## Releasing

Releases are cut by [Changesets](https://changesets.dev) from GitHub Actions and staged on npm.
There is no npm token in this repo, in the workflows or on any laptop, and no automated run can
publish. The package's npm Trusted Publisher is configured for staged publishing only, so the
last step of every release is a person approving it on npmjs.com.

1. **Make the change, then `bun run changeset`.** Pick the bump (`patch` for a fix, `minor` for
   a new capability, `major` for a breaking change) and write a note that reads well in
   `CHANGELOG.md`: that text is the release note. Commit the file it writes in `.changeset/`
   with your pull request. A change that must not release anything (docs, tooling, tests) still
   gets an entry: `bun run changeset add --empty`. `Changeset status` warns on a pull request
   that changes `src/`, `ios/`, `android/`, `cpp/` or `nitrogen/` without one; the warning
   never blocks a merge. Only `react-native-nitro-ui` is versioned: the `example`, `bench` and
   `bench/modules/bench-probe` workspaces are `private` and listed in `ignore` in
   `.changeset/config.json`. Changesets only versions packages listed in `workspaces`, so keep
   the `"."` entry in `package.json`: without it `changeset version` fails with "not in the
   workspace".
2. **Merge pull requests to `main`.** The `Release` workflow runs `bun run check` in a job with
   read-only rights. When it is green, a second job runs `bun run release:version` and opens or
   updates a pull request called **Version Packages**: it bumps `package.json`, prepends the
   notes to `CHANGELOG.md`, deletes the changeset files, and refreshes
   `example/ios/Podfile.lock` so the example builds against the new version. Everything merged
   before it lands folds into that one pull request. Review the version, the changelog and the
   lock there.

   The lock refresh needs CocoaPods, so this job runs on a macOS runner and installs the
   CocoaPods version the lock's `COCOAPODS:` trailer names. `release:version` is
   `--preflight && changeset version && --fix`: the preflight checks that CocoaPods is present
   and refuses before `changeset version` writes a file. `bun run check` carries `lock:check`,
   a string comparison that runs anywhere. If the refresh fails, the job fails before the
   action commits, so a release cannot go out with a stale lock.

   That pull request arrives with no checks: a pull request opened with `GITHUB_TOKEN` starts
   no workflows. The same commit runs the whole gate on `main` when it merges, so
   `release:version` must never write a tree that fails it. If `main` gets required status
   checks, that pull request cannot merge until the action is given a GitHub App token.

3. **Merge the Version Packages pull request.** The next `Release` run finds no pending
   changesets, so it packs the version now committed on `main` and runs `npm stage publish` on
   that tarball, trading the job's OIDC token for staging rights. Nothing is live yet, and
   automation does nothing more.
4. **Approve the staged version on npmjs.com.** Use the package's **Staged Packages** tab, or
   a machine that already has your npm credentials:

   ```sh
   npm stage list react-native-nitro-ui
   npm stage approve <id>
   ```

   2FA is asked for here, not in CI. Until the version is approved it does not exist for anyone
   installing the package, and no tag is made.

5. **The tag and the release follow on their own.** `Release tag` runs hourly: when
   `package.json`'s version is on the registry and `v<version>` has no release, it creates
   `v<version>` at the commit that bumped the version, with that version's `CHANGELOG.md`
   section as the notes. Run it from **Run workflow** to skip the wait.

Nothing else makes a tag. The Changesets action's own git tags and GitHub releases are switched
off: it would write `react-native-nitro-ui@0.1.1` instead of `v0.1.1`, and a staged version is
not live at publish time.

### Why the pipeline is split into jobs

`npm pack` runs this package's `prepare` (builder-bob, then nitrogen), which pulls the repo's
whole dependency tree into the process. That must not happen while a token that can reach npm
is in the environment, so the rights are split:

| Job       | Rights                                    | Does                                                                                                        |
| --------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `pack`    | `contents: read`                          | install, `bun run check`, the committed-codegen and clean-tree checks, `npm pack`, and the tarball's sha256 |
| `stage`   | `id-token: write`, and nothing else       | download the artifact, verify that sha256, ask the registry, `npm stage publish`                            |
| `version` | `contents: write`, `pull-requests: write` | the Version Packages pull request, through the Changesets action                                            |

`version` runs on `macos-26`, not `ubuntu-latest`, and installs the CocoaPods that
`Podfile.lock` records before it runs the action.

`stage` checks out nothing, installs nothing and runs no script from the tree, so no code from
the repository runs while it holds the OIDC token, and that token can only stage this package.

Every job reads state, not its own run, so a re-run is safe:

- a version that is already on the registry is left alone (`npm view`);
- npm's answer to a version it already knows, staged or published, is treated as success;
- `Release tag` does nothing when the release already exists.

A dropped, cancelled or re-run workflow loses nothing: the next run reads the same state.
GitHub keeps one pending run per concurrency group and replaces an older pending one when
pushes arrive quickly.

### The changelog

New entries come from `@changesets/changelog-git`: `## 0.1.2`, then `### Patch Changes`, then
one line per changeset, each starting with the short sha of the commit that carried it. That
sha is plain text: GitHub autolinks it in a release body, not in a rendered `CHANGELOG.md`.
`@changesets/changelog-github` is not used, because `changeset version` would then need a
token on a laptop.

A test holds the invariant `Release tag` depends on when it reads the release notes: `0.1.0`
stays the last version heading in `CHANGELOG.md`, and every heading above it is a version,
newest first.

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

A version that is on npm stays on npm. `npm unpublish` breaks every lockfile pointing at it, so
deprecate it and release a fix:

```sh
npm deprecate react-native-nitro-ui@0.1.2 "<why — point at the replacement>"
```

Never run `npm login` or `npm publish` from a checkout. The only credentials in this pipeline
are the release job's OIDC token, which may only stage, and your own npm account, which is for
approving. To see what a release would ship:

```sh
bun run prepare && npm publish --dry-run
```

The `0.0.0-stage` entry in this package's history is npm's placeholder for a package name that
did not exist yet. A staged version of an existing package is not on the registry at all until
someone approves it.

Two more things:

- every push to `main` runs the whole gate, docs-only pushes included.
- `bun run release:version` on a laptop writes the same files as the Version Packages pull
  request, without pushing them. Use it to preview the next version, not to cut one. It needs
  CocoaPods, because it refreshes `example/ios/Podfile.lock`, and runs in three stages:
  `--preflight`, `changeset version`, then `--fix`. The first refuses before anything is
  written when CocoaPods is missing. `node scripts/sync-example-lock.mjs` on its own is the
  check-only half and needs only the two files it compares.

### Owner setup, once

None of this is a contributor's step, and none of it lives in this repo:

1. npmjs.com → `react-native-nitro-ui` → **Settings** → **Trusted publisher** → GitHub Actions:
   owner `dannyhw`, repository `react-native-nitro-ui`, workflow name `release.yml`, and no
   environment name. Under **Allowed actions**, leave it at staged publishing: **do not tick
   `npm publish`**. That box is what keeps a person approving each version.
2. On the same page: **Require 2FA and disallow tokens**.
3. GitHub → this repository → Settings → Actions → General → tick **Allow GitHub Actions to
   create and approve pull requests**, or the Version Packages pull request cannot be opened.
4. After merging, check `gh workflow list`. A workflow file that is new to the default branch
   is enabled by itself, so `Changeset status` needs nothing; enable `Release` and
   `Release tag` if either shows as inactive. `Release tag` has to be enabled for the hourly
   schedule to fire.
5. Optional: `main` has no branch protection. The only commits that touch `package.json` and
   `CHANGELOG.md` are the Version Packages ones, so reviewing that pull request is the control.
   A rule that requires pull requests would also have to bypass the accounts that push to
   `main` directly, or those pushes fail.
6. First release, once 1 and 3 are done: merge a pull request with a changeset, review the
   Version Packages pull request, merge it, check `npm stage list`, approve, and confirm within
   the hour that `v<version>` and its release exist.

## Sending a pull request

- Install dependencies, then `bun run check`.
- If you touched specs or native code, run the example builds and the harness tests on both
  platforms.
- Say in the pull request which of the device suites (harness, real-input, smoke, bench) you
  ran and on what.

`.github/workflows/ci.yml` runs on every push to `main` and on every pull request, on
GitHub-hosted runners: `bun run check` (ubuntu, Node from `.nvmrc`), the host native ASan tests
in a `macos-26` job (they need a Swift toolchain and `xcrun`, and `scripts/native-tests.sh`
prints its skip reason on Linux), and an Android `assembleDebug` of the example.

Every push to `main` reaches a conclusion, by two rules.
`cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}` cancels superseded runs on pull
requests and feature branches only, and `main` gets a concurrency group per commit
(`group: ${{ github.workflow }}-${{ github.ref == 'refs/heads/main' && github.sha || github.ref }}`).
Both are needed: GitHub keeps one running and one pending run per group, and a newly queued run
replaces the pending one whatever `cancel-in-progress` says, so a branch-level group on `main`
would drop the middle of three quick merges with no conclusion.

The Android job also runs the Kotlin JVM tests. `scripts/native-tests-android.sh` skips when
`CI` is set, and the step in `build-android` sets `NITRO_UI_ANDROID_JVM_TESTS=1` to run them
there. Any job that runs this script sets that variable; nothing else in CI runs it.

The harness suites, the consumer smoke tests and the Android release build are
`workflow_dispatch` only, and the benchmarks have no workflow. The device gates that decide a
change run locally.

The two macOS labels CI schedules on have iOS 26-and-up simulators only, so nothing in CI can
exercise the declared sizing fallbacks on an older iOS runtime. `docs/ci-runner-images.md`
records what each published image installs and which image series has an iOS 18 simulator.

Validate workflow edits locally with [`actionlint`](https://github.com/rhysd/actionlint)
(`actionlint .github/workflows/*.yml`). `.github/actionlint.yaml` declares the one self-hosted
label a job may use.
