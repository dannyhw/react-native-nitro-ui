# R5 — Publish prep: 0.1.0 — report

**Branch:** `task/R5-publish-0.1` (from `main` at `becbfcc`) · **Devices:** iPhone 17
simulator (iOS 27) `F08675D3-A32B-4F88-BC81-02D7E0CB797E` — already booted when the
task started, so it was used and left as found — and AVD `nitroui_t03`
(`emulator-5574`, private adb server `5043`), booted by this task and shut down at
the end. iPhone Air, `nitroui_t01`, `emulator-5570`, the `RNSB …` simulators and
`emulator-5560` were not touched. · **Node:** `v24.18.0` (`.nvmrc` major) through
`fnm exec --using 24 --`, bun 1.4.0. · **Metro:** `8295` was assigned and never
needed — every consumer build here is Release with the bundle embedded. ·
**Platforms:** both. · **Not done, deliberately:** no push, no tag, no GitHub
release, no `npm login`/`npm publish` — the owner publishes (D26).

## Verdict

1. **Version + changelog.** `package.json` stays `0.1.0`. `CHANGELOG.md` is now one
   `0.1.0 — 2026-10-26` entry: the old "Unreleased" work (Picker, DatePicker,
   `<Host>`, the three Android/sizing fixes) folded in as released content, not as
   fixes to some earlier release. `release-it` would fight a hand-cut release —
   §1 says exactly how, and `bun run release` was not run.
2. **Tarball: 464 files, 437.2 kB packed / 2.1 MB unpacked**, and
   `manifest:check` (464), `publint --strict` ("All good!") and `api-extractor` all
   agree with it. Nothing forbidden ships; everything required does (§2).
3. **Consumer smoke on the tarball: green on every row the README ticks**, on both
   platforms, with the new eighth box in the ready line — `host` — non-zero on
   both. Expo SDK 58 both (268 s), RN CLI 0.88.0 both (176 s), RN CLI 0.86.3
   Android (84 s). The smoke app now renders one `<Host>` with two hosted
   Switches, and the gate was shown red before it was trusted (§3).
4. **Install docs ready to publish,** and the npm switch is its own commit
   (`f23d3bc`, `docs: switch install instructions to npm`) so it can be dropped if
   the publish slips.
5. **D1 leftovers closed:** README status note + component table + CHANGELOG move
   Picker / DatePicker / `<Host>` to `0.1.0`; the README matrix covers all eight
   exports; `Picker`'s `tintColor` comment now names the four Android tint roles;
   platform keywords are in `package.json`.
6. `bun run check` green (exit 0). No bench/harness runs: nothing pointed at
   library code (§"Gate results").

## 1. Version + changelog

- `package.json`: `version` untouched at `0.1.0`; only `keywords` changed (§5).
- `CHANGELOG.md`: one entry, `## 0.1.0 — 2026-10-26`, sections `Components` (all
  seven controls) → `Container` (`<Host>`) → `Core` → `Platform behaviour` →
  `Benchmarks and tooling` → `Not in 0.1`. Two judgement calls:
  - the folded "Fixed" items are written as **behaviour of the released code**, not
    as fixes — there is no earlier release a reader could have been harmed by, and
    "Fixed: Android: every mount leaked its control" would describe a bug nobody
    ever shipped. What the code guarantees (a dropped Compose view releases its
    heap; over-wide content fits its box) is stated, with the churn test named as
    what guards it;
  - `Not in 0.1` now lists what is genuinely deferred: `<Host>` holds Switches
    only (0.2), no shared iOS host (measured and rejected, D23), no imperative
    surface (D14).
  - The `#unreleased` anchor the old "Not in 0.1" linked to is gone with it; no
    other file linked it (grepped).
- Two docs lines still called a merged control unreleased and moved with it:
  `docs/architecture/sizing.md:515` and `docs/components/segmented-control.md:271`.

### Why `bun run release` must not be used for this release

`release-it` is configured in `package.json` with `npm.publish: true` +
`npm.skipChecks: true`, `github.release: true` and
`@release-it/conventional-changelog` (angular preset), and the script is
`release-it --only-version`. Run against this tree it would (a) prompt for a
version and, driven by conventional-commit metadata, pick something other than the
`0.1.0` that is already in `package.json`; (b) rewrite the top of `CHANGELOG.md`
from commit messages, undoing the hand-written entry; (c) publish and open a
GitHub release as side effects, which is what D26 reserves for the owner. So: the
checklist in §6 is hand commands, and `release` should be neutralised before the
next release (Follow-ups).

## 2. The tarball

Packed from a clean tree (`git status --porcelain` empty) with `bun run prepare`
first, on Node 24:

| Pack | Commit | Files | Packed | Unpacked | sha256 |
| --- | --- | --- | --- | --- | --- |
| smoke tarball (all four device runs installed this) | `129902d` | 464 | 437.2 kB | 2.1 MB | `f80d1e39e3a5994a65d0417111101c9b4a9f103e3d4f377f55aeb5dbe7345bfd` |
| final tree (after the install-docs commit) | `f23d3bc` | 464 | 437.2 kB (437208 bytes) | 2.1 MB | `fa1b7b969b961b6fa3b7ee16e2be3e5e82ec5c4a2db4efc9e5f40f0775fb5688` |

`diff -rq` of the two extracted trees reports exactly one differing file:
`README.md` (the install section). So every device run here tested a package whose
code is byte-identical to the one to be published, and the final pack was
re-produced from the committed HEAD to check that (`437208` bytes, the sha above).

Contents (`tar -tzf`, 464 entries, `package/` stripped):

| Top level | Files | | Top level | Files |
| --- | ---|---| --- | --- |
| `nitrogen/` | 197 | | `cpp/` | 9 |
| `lib/` | 170 | | `package.json`, `nitro.json`, `nitro-ui.sizing.json`, `NitroUi.podspec`, `README.md`, `LICENSE` | 6 |
| `src/` | 42 | | | |
| `android/` | 24 | | `ios/` | 16 |

- **Nothing forbidden:** `grep -Ec 'example|bench|docs/|__tests__|__mocks__|__fixtures__|build/|node_modules|\.test\.|\.perf-test\.|\.harness\.|\.stories\.'`
  over the listing → **0**. No `example/`, `bench/`, `docs/` (so no `docs/tasks/`),
  no test or storybook sources, no Gradle/Xcode build output, no `gradlew`,
  `gradle/` or `local.properties`.
- **Everything required ships:** `nitrogen/generated` (197 files), `cpp/` (9),
  `ios/` (16, sources only), `android/` (24: `build.gradle`, `CMakeLists.txt`,
  manifest, `baseline-prof.txt`, the JNI cpp and the Kotlin sources — no
  `android/build/`), `lib/module` (85) + `lib/typescript/src` (84), `src/` (42,
  needed by the `react-native-nitro-ui-source` export condition), the podspec,
  `nitro.json` and the sizing table `nitro-ui.sizing.json`.
- **The three package checks agree with the tarball:**
  `manifest:check` → "tarball matches etc/package-files.txt (464 files)" — the
  committed manifest already counted the Picker/DatePicker/Host files, so
  `manifest:update` was not needed; `publint --strict` → "All good!";
  `api-extractor run` (no `--local`) → completed successfully, i.e.
  `etc/react-native-nitro-ui.api.md` has no drift.
- 464 files where R2 recorded 332: the growth is Picker, DatePicker and `<Host>`
  (native sources + generated specs), not stray output.

## 3. Consumer smoke on the tarball

All four runs installed the packed tarball with **npm** into a freshly generated
app, built **Release**, launched, and asserted the ready line through
`scripts/smoke/ready-line.mjs` — the same command on both platforms. Every run was
given `SMOKE_TARBALL=/tmp/R5-artifacts/tarballs/react-native-nitro-ui-0.1.0.tgz`,
whose `.gitsha` sidecar matched `HEAD` (`assert_tarball_head`), so all four tested
one artifact from the committed tree rather than four separate packs.

| Row | Result | Timings (s) | Artifacts (`/tmp/nitro-ui-smoke/artifacts/`) |
| --- | --- | --- | --- |
| `smoke:expo` SDK 58, `PLATFORM=both` | **PASS** | create 2 · install 11 · prebuild+pod 49 · ios-build 58 · ios-run 8 · android-build 131 · android-run 3 · **total 268** | `expo-20261026-135105-99329` |
| `smoke:rn-cli` RN 0.88.0, cli 20.2.0, `PLATFORM=both` | **PASS** | init 3 · install 18 · pod 20 · ios-build 48 · ios-run 5 · android-build 73 · android-run 3 · **total 176** | `rn-cli-20261026-135629-5886` |
| `smoke:rn-cli` RN 0.86.3, `PLATFORM=android` | **PASS** | init 2 · install 7 · android-build 66 · android-run 4 · **total 84** | `rn-cli-20261026-135931-8756` |
| `smoke:rn-cli` RN 0.86.3, `PLATFORM=ios` | **not runnable** | build+install fine, no ready line in 120 s | `rn-cli-20261026-140102-10055` |

Ready lines as printed (all eight boxes, every one non-zero):

```
iOS     switch=61x28.000015258789062 slider=354x31 button=61x34.33331298828125
        progress=354x4 segmented-control=165x31 date-picker=103x36.333343505859375
        picker=72x35 host=354x96
Android switch=52.19047546386719x47.99998474121094 slider=363.4285583496094x48
        button=91.04762268066406x48 progress=363.4285583496094x4.190460205078125
        segmented-control=256x48 date-picker=131.04762268066406x48.000030517578125
        picker=280x56 host=363.4285583496094x96
```

**Red shown.** Both platforms' screenshots show the ready colour (red) with all
eight boxes listed on screen, i.e. the app reached the "every control has a box"
state rather than merely launching. Committed here (resized):
`docs/tasks/R5-publish-0.1/expo-58-ios-ready.png` and
`…/expo-58-android-ready.png`. On the Android capture the two hosted Switches are
left-aligned inside the Host (a Compose column at the Host's width) while every
unhosted control is centred by the scroll view — visible evidence that the pair is
really drawn by the shared composition and not as ordinary RN views.

### `<Host>` in the smoke app, and how the gate was shown to bite

`scripts/smoke/App.tsx` renders one `<Host style={{height: 96}}>` with two
uncontrolled Switches; it is the eighth entry, `host`. Hosted children are **not**
in the control list on purpose: a hosted control is drawn by the Host's own
composition and its RN view is deliberately laid out at nothing
(`docs/components/host.md`, Sizing), so the container's box is the assertion worth
having. `lib.mjs` and the app agree on the eight names; `CONTRIBUTING.md` now says
so in the "keeping App.tsx current" rules, including the warning not to add a
hosted child to the list.

Proof the extended gate can fail (AGENTS.md), both run on this branch:

1. **list sync:** with the previous `App.tsx` checked back over the new one,
   `bunx jest scripts/__tests__/smoke-ready-line.test.js` →
   `✕ agrees with the control list the smoke app renders`
   (`expect(app).toContain('testID="SMOKE-host"')`), `1 failed, 18 passed`. Restoring
   the new app makes it 19/19.
2. **the contract itself:** the exact line the app printed *before* this change,
   through the command both platforms call —

   ```
   $ node scripts/smoke/ready-line.mjs --line "… picker=72x35"
   ready-line: host: no "WxH" box in the ready line
   ready-line: the ready line must carry 8 name=WxH boxes, each > 0x0.   exit=1
   ```

   with `host=354x96` appended it exits 0. So a release that loses the Host (or
   lays it out at nothing) fails the run instead of passing.

### The one row that cannot run here, and why

RN 0.86.3 on iOS built and installed fine and never produced a JS log line — not
even the `NITRO_UI_SMOKE_CORE_NOW` call — and the screenshot at timeout is the
springboard. The host has a crash report for it
(`~/Library/Logs/DiagnosticReports/RnConsumer-2026-10-26-140227.ips`):
`EXC_BREAKPOINT / SIGTRAP` with the faulting frame
`___UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption_block_invoke` in
UIKitCore — UIKit terminating an app that does not adopt the scene lifecycle,
during scene creation, with no library frames anywhere in the stack. This is the
template's oldest-supported-RN problem on an iOS 27 runtime, not a nitro-ui
problem (R2 measured the same launch failure with the library absent). The README
row stays `n/a` with that reason, and it needs an older iOS runtime — CI-only, and
CI is off (D22).

## 4. Install docs

`f23d3bc` — `docs: switch install instructions to npm`, the last commit to touch
the package and `README.md` only: the front door is

```sh
npm install react-native-nitro-ui react-native-nitro-modules
```

followed by the step each toolchain already has and that the smoke actually ran —
`npx expo prebuild` for Expo, `bundle install && bundle exec pod install` for the
bare CLI template (it ships a Gemfile) — plus a note that new native code needs a
rebuild, not a Metro reload. The "Today: build a tarball from source" and "After
the first release / **They do not work yet.**" framing is gone; building from a
clone survives under "Without npm", and the "not published yet" banner at the top
goes in the same commit. Dropping that one commit leaves a coherent README for the
pre-publish state, which is why it is separate.

## 5. D1 leftovers, keywords, Picker tint

- README status note + component table: Picker, DatePicker and `Host` now read
  `0.1.0`; the note (until the final commit) only says what is still true — that
  nothing is on npm (D25).
- `package.json` `keywords`: `react-native, ios, android` + `swiftui`,
  `jetpack-compose`, `compose`, `nitro-modules`, `nitro`, `native-components`,
  `ui-components`.
- `Picker`'s `tintColor` doc comment now names the four Android roles the
  measurement in `docs/components/picker.md` records (focused outline, focused
  label, focused trailing icon, unfocused label) and says iOS tints the menu title
  and chevron while a wheel takes nothing.

## Gate results

| Command | Result |
| --- | --- |
| `fnm exec --using 24 -- bun run check` | **PASS** exit 0 — typecheck, bench typecheck (both), lint, format, jest 15 suites / 226 tests, `test:native` (C++/ASan+UBSan) PASS, `perf:renders` 7/7 with no redundant renders, `nitrogen:check`, `autolinking:check`, `prepare`, `api-extractor:check`, `publint` "All good!", `manifest:check` 464 files, `readme:check` 8 blocks (log: `check-1.log`) |
| `… bunx jest scripts/__tests__/smoke-ready-line.test.js` | **PASS** 19/19 (and shown red two ways, §3) |
| `… bun run smoke:expo` (SDK 58, both) | **PASS** 268 s |
| `… bun run smoke:rn-cli` (RN 0.88.0, both) | **PASS** 176 s |
| `PLATFORM=android … bun run smoke:rn-cli` (RN 0.86.3) | **PASS** 84 s |
| `PLATFORM=ios … bun run smoke:rn-cli` (RN 0.86.3) | **FAIL — labelled, not fixed:** UIKit kills the template app at scene creation (§3) |
| `… bun run manifest:check` / `bun run publint` / `bun run api-extractor:check` on the final tree | **PASS** 464 files / "All good!" / no API drift |
| `… npm pack` on the committed final tree | 464 files, 437208 bytes, sha256 `fa1b7b96…`; byte-identical to the pack made before the last commit |
| `npm view react-native-nitro-ui version` | **404** — the name is free on the registry (checked 2026-10-26); `react-native-nitro-modules` latest is `0.37.1`, inside our `^0.37.1` peer range |

No harness / real-input / bench run was done: the brief makes them conditional on a
smoke failure pointing at library code, and no smoke failed. The only library-code
change in this task is a doc comment.

## Files changed

- `CHANGELOG.md` — one folded `0.1.0 — 2026-10-26` entry.
- `README.md` — status note, component table, consumer matrix (+ install section in
  the final commit).
- `CONTRIBUTING.md` — the ready-line example is the real 8-box line, and the
  "keeping `App.tsx` current" rules gained the Host rule.
- `scripts/smoke/App.tsx` — imports `Host`, renders one with two Switches, `host`
  in `SMOKE_CONTROLS`, header explains why hosted children are not asserted.
- `scripts/smoke/lib.mjs` — `host` in the contract + why.
- `scripts/__tests__/smoke-ready-line.test.js` — host boxes in both fixtures (and a
  host assertion on the fractional one), plus a stale name in the header comment.
- `src/components/Picker/Picker.tsx` — `tintColor` doc comment.
- `package.json` — `keywords`.
- `docs/architecture/sizing.md`, `docs/components/segmented-control.md` — no longer
  call a shipping control unreleased.
- `docs/tasks/R5-publish-0.1.report.md`, `docs/tasks/R5-publish-0.1/*.png`.

## Decisions

- **One tarball for every smoke row,** through `SMOKE_TARBALL` (HEAD-checked),
  rather than letting each run re-pack: the thing under review is one artifact, and
  four packs from one tree would be four chances to compare the wrong bytes.
- **`host` is a container box, not two more controls** (see §3) — the alternative
  (asserting hosted children) would assert a documented `0 × 0`.
- **Host given `height: 96` + `alignSelf: 'stretch'`** in the smoke app: an explicit
  height is what `host.md` tells callers to give it, and it makes the expected box
  deterministic on both platforms instead of depending on each OS's Switch height.
- **Fold, don't restate:** the changelog keeps the measured numbers that were
  already in the Unreleased entry (0.86× / 0.87× for 200 hosted Switches) rather
  than a vaguer claim, and the README matrix is dated so a stale row is visible.
- **`release-it` left in place but documented as unusable for 0.1.0** — removing or
  reconfiguring it is a 0.2 decision, not something to change under publish
  pressure.

## Publish checklist (owner — nothing here was run by this task)

Everything below is from a clean checkout of the merge commit, on Node 24
(`.nvmrc`) with bun 1.4 on `PATH`. `npm publish` runs `prepare` itself, and bob
runs the repo's `nitrogen` script through whichever package manager invoked it — so
keep both runtimes available for the publish, not just node.

```sh
# 1. Be on the merge commit, clean
git switch main && git pull --ff-only
git rev-parse HEAD            # note it: tag this commit
git status --porcelain        # must print nothing
bun install --frozen-lockfile

# 2. Gates, and the artifact as npm will see it
bun run check                                  # exit 0
bun run prepare                                # bob build (regenerates nitrogen/)
bun run manifest:check                         # "matches etc/package-files.txt (464 files)"
bun run publint                                # "All good!"
npm pack --dry-run                             # 464 files · 437.2 kB · 2.1 MB
shasum -a 256 react-native-nitro-ui-0.1.0.tgz  # fa1b7b96… from R5's pack, if the tree is identical

# 3. Publish — first publish is manual (D26)
npm whoami || npm login                        # an account able to publish the name
npm view react-native-nitro-ui                 # must 404 (verified free on 2026-10-26)
npm publish --access public                    # 2FA will ask for an OTP;
                                               # --access is a no-op for this unscoped name

# 4. Tag + release, from the same commit (workflows are disabled, so the tag fires nothing)
git tag -a v0.1.0 -m "react-native-nitro-ui 0.1.0"
git push origin main v0.1.0
gh release create v0.1.0 --title "react-native-nitro-ui 0.1.0" \
  --notes-file /tmp/nitro-ui-0.1.0-notes.md    # text below

# 5. Post-publish: is it really the package we tested?
npm view react-native-nitro-ui dist-tags.latest          # 0.1.0
npm view react-native-nitro-ui@0.1.0 dist.tarball dist.integrity
curl -o /tmp/registry-nitro-ui.tgz "$(npm view react-native-nitro-ui@0.1.0 dist.tarball)"
tar -tzf /tmp/registry-nitro-ui.tgz | wc -l              # 464
tar -tzf /tmp/registry-nitro-ui.tgz | sort > /tmp/published.txt
diff /tmp/published.txt <(tar -tzf react-native-nitro-ui-0.1.0.tgz | sed 's|^package/||' | sort | sed 's|^|package/|')

# 6. Post-publish: a real consumer, from the registry this time (same repo, clean tree)
IOS_SIM_UDID=<udid> ANDROID_AVD=<avd> EMULATOR_PORT=<port> \
  SMOKE_TARBALL=/tmp/registry-nitro-ui.tgz bun run smoke:expo
SMOKE_TARBALL=/tmp/registry-nitro-ui.tgz bun run smoke:rn-cli            # RN 0.88.0
PLATFORM=android RN=0.86.3 SMOKE_TARBALL=/tmp/registry-nitro-ui.tgz bun run smoke:rn-cli
```

The registry tarball has no `.gitsha` sidecar, so the runner prints
`note: … cannot verify tarball commit` and proceeds — that is expected for this
check and is the one time reusing a tarball is the point. If a post-publish smoke
row goes red, `npm deprecate react-native-nitro-ui@0.1.0 "<reason>"` is the
retreat; a 0.1.0 pull from the registry is not.

### Release notes for the GitHub release

> ## react-native-nitro-ui 0.1.0
>
> First release. Seven controls that are the real platform view — SwiftUI inside a
> `UIHostingController`, Jetpack Compose inside an `AbstractComposeView`, both
> wrapped in a Nitro Hybrid View, sized by their own measurement on your device —
> plus `<Host>`, an opt-in container that renders a batch of Switches in one
> Compose composition on Android.
>
> **Components**
>
> - `Switch` — SwiftUI `Toggle(.switch)` / Material 3 `Switch`. Controlled or
>   uncontrolled, `tintColor`.
> - `Slider` — SwiftUI `Slider` / Material 3 `Slider`. `minimumValue` /
>   `maximumValue` / `step`, `onSlidingStart` / `onValueChange` /
>   `onSlidingComplete`.
> - `Progress` — `ProgressView` / Material 3 indicators. `linear` or `circular`,
>   a determinate value or `null` for indeterminate.
> - `Button` — SwiftUI `Button` with five `.buttonStyle`s / the five Material 3
>   button composables. Five variants, three sizes, `systemImage` on iOS.
> - `SegmentedControl` — SwiftUI segmented `Picker` /
>   `SingleChoiceSegmentedButtonRow`. A parent decides whether to accept a
>   selection and the control snaps back when it does not.
> - `Picker` — SwiftUI `.menu` / `.wheel` `Picker` / Material 3
>   `ExposedDropdownMenuBox`. No wheel on Android (the menu takes its layout).
> - `DatePicker` — SwiftUI `DatePicker` / Material 3 `DatePicker` + `TimePicker`,
>   inline or behind a compact field. `mode="date" | "time" | "datetime"`.
> - `<Host>` (Android; iOS is a documented passthrough) — one Compose composition
>   for its `Switch` children: 0.86× mount memory and 0.87× mount UI CPU against
>   `expo-ui-shared-host` for 200 Switches, ~1.2× mount JS CPU.
>
> Also exported: `nitroUiCore` (one monotonic clock on both platforms, plus sizing
> diagnostics) and `prewarm` (adopt a component's declared size so its first mount
> needs no layout correction).
>
> **Install** — `npm install react-native-nitro-ui react-native-nitro-modules`,
> then autolinking: no config plugin, no Podfile or Gradle edits. Verified green
> for this package on Expo SDK 58 (RN 0.88) and React Native CLI 0.88.0 on both
> platforms, and RN CLI 0.86.3 on Android; RN 0.86.3 on iOS is unverified because
> UIKit terminates the template app on an iOS 27 runtime before any JavaScript
> runs. Floor: RN `>= 0.86` with the new architecture, iOS at RN's own floor,
> Android `minSdkVersion` 24. Expo Go is not supported — Nitro Modules needs a dev
> build.
>
> **Known limitations in 0.1** (full list per control in `docs/components/`):
> iOS `SegmentedControl` ignores `tintColor`; a determinate circular `Progress`
> spins on iOS; `trackColor` is Android-only and `systemImage` iOS-only; no wheel
> for `Picker`/`DatePicker` on Android and no combined date+time control;
> `<Host>` holds Switches only and needs an explicit height; `testID` lands on the
> host view on Android; accessibility props belong on the control, not a wrapping
> box.

## Known issues / follow-ups

- `bun run release` is a trap until it is reconfigured for a hand-cut flow
  (`npm.publish: false`, `github.release: false`, drop the changelog plugin — or
  delete the script). Documented above; not changed here.
- `CHANGELOG.md` is not in `package.json` `files`, so the published package never
  carries it. Fine at 0.1.0 (the README + GitHub release cover it); add it to
  `files` if the package should be self-describing.
- The README's stated floor is "Expo SDK 57+" but no SDK 57 consumer row has ever
  been run; the matrix only ticks what was measured.
- RN 0.86.3 iOS needs one run on an older iOS runtime to tick its cell; with CI off
  that is a manual hold on an older simulator runtime.
- The ready line prints raw layout metrics (`52.19047546386719x47.99998474121094`),
  which is truthful and noisy — A2's follow-up still stands.
- `package.json`'s `author` field ships inside the published `package.json` (npm
  metadata). D25's no-personal-information rule covers the repo's docs, but it is
  worth a deliberate yes/no before the first publish.
- `docs/tasks/R2-release-0.1.report.md` ends with a "Release notes draft" for the
  old five-control scope ("Not in 0.1: Picker, DatePicker, `<Host>`"). It is a
  historical report, so it stays as written; the text above is the one to paste.

## Questions for orchestrator

None — nothing blocks merging or publishing.
