# T03 — Consumer smoke tests: report

## Summary

`scripts/smoke/{pack,expo,rn-cli}.sh` + `App.tsx` + `pixel-ready.mjs` now
prove the packed library installs and runs in fresh consumer apps with **zero
consumer-side native changes** (no Podfile/Gradle/app.json/config-plugin
edits anywhere). Both smoke scripts pass on iOS and Android for Expo SDK 58
and RN CLI 0.88.0. The RN 0.86.3 variants surfaced **two findings outside my
scope** (see Questions): a library bug (Compose BOM floor breaks RN 0.86-line
hosts) and a template-level incompatibility of RN 0.86.3 with this machine's
iOS 27 simulator runtime (reproduced with a library-free control app).

One library bug was found and fixed on this branch: the `NitroUiPackage.kt`
KDoc contained a declaration-shaped sentence ("The class still has to exist:")
whose text hijacks the class-name regex consumer autolinkers run over the raw
file (Expo SDK 58's `expo-modules-autolinking/build/reactNativeConfig/androidResolver.js`
and the same regex family in the RN CLI). Every Expo Android consumer build
failed with `cannot find symbol: class still`. The fix is comment-only.

## Files changed

- `scripts/smoke/pack.sh` - build + `npm pack` into `$SMOKE_TMP/tarballs`.
- `scripts/smoke/expo.sh`, `scripts/smoke/rn-cli.sh` - create consumer
  (`create-expo-app blank-typescript@sdk-$SDK`, default SDK 58;
  `@react-native-community/cli@20.2.0 init --version $RN`, default 0.88.0,
  `0.86.3` supported), install **with npm**, copy the smoke App, Release build
  (`xcodebuild … CODE_SIGNING_ALLOWED=NO` / `assembleRelease` for the host
  ABI), install, launch, verify, screenshot. `PLATFORM=ios|android|both`.
  Re-runnable (fresh app dir per run), delete temp apps on success, keep logs
  under `$SMOKE_TMP/artifacts/<script>-<ts>-<pid>/`. `KEEP_TMP=1` retains the
  app dir. They only boot an emulator that is not already up, refuse
  `emulator-5560` outright, stop the Gradle daemons they start,
  and set `hide_error_dialogs` so System-UI-ANR dialogs don't cover screenshots.
- `scripts/smoke/App.tsx` - renders every export once with `SMOKE-` testIDs;
  today: `NitroUiCore.now()` rendered + logged. Adding a component = its
  import + one JSX line (documented in CONTRIBUTING). Readiness = console line
  (Android logcat) **plus a background colour semaphore** (white/red/blue)
  read from screenshots: iOS Release builds strip all JS console output (RN
  routes `console.*` nowhere when `__DEV__` is false), so a log line cannot be
  the readiness signal there.
- `scripts/smoke/pixel-ready.mjs` - dependency-free PNG decoder (node `zlib`)
  that classifies the semaphore by channel dominance (Android screencap
  renders `#ff0000` as dark red depending on display colour profile).
- `android/src/main/java/com/margelo/nitro/nitroui/NitroUiPackage.kt` -
  comment reworded (the autolinker-hijacking prose above the class removed,
  hazard documented). No code change.
- `package.json` - `smoke:pack` / `smoke:expo` / `smoke:rn-cli` scripts.
- `.github/workflows/smoke.yml` - workflow_dispatch + nightly; pack job +
  Expo/RN-CLI jobs per platform (iOS on `xcode-27` per D2, Android on
  ubuntu+KVM), artifacts on failure. Written, not run (per brief).
- `README.md` - Installation section now records the exact verified steps +
  tested matrix.
- `CONTRIBUTING.md` - "Consumer smoke tests" section (env table, re-runnability,
  App.tsx one-line-per-component contract, dual readiness channels); scripts
  table rows. CI mirrors this file.
- `docs/tasks/T03-smoke/*.png` - screenshots (below).

## Gate results

| Gate | Result |
| ---- | ------ |
| `bun run check` (typecheck, lint, format, test, nitrogen:check, prepare, publint, manifest:check) | PASS (exit 0) |
| `PLATFORM=android bun run smoke:expo` (SDK 58) | PASS |
| `PLATFORM=ios bun run smoke:expo` (SDK 58) | PASS |
| `PLATFORM=ios bun run smoke:rn-cli` (RN 0.88.0) | PASS |
| `PLATFORM=android bun run smoke:rn-cli` (RN 0.88.0) | PASS |
| `PLATFORM=android RN=0.86.3 bun run smoke:rn-cli` | FAIL - library bug, see Questions Q1 |
| `PLATFORM=ios RN=0.86.3 bun run smoke:rn-cli` (optional per brief) | FAIL - environment/template, see Q2 |

Devices: iOS sim `iPhone 17e` (`C5CD4A7F-…`, booted and shut down by me), AVD
`nitroui_t03` on port 5574 (created, booted and shut down by me; the API 35
google_apis arm64 image existed already). `emulator-5560` untouched. No Metro
used (Release bundles).

## Timings (single-machine, warm npm/bundler caches; some runs overlapped)

| Run | create/init | npm install | prebuild+pods | build | install+launch→ready |
| --- | --- | --- | --- | --- | --- |
| pack (prepare+npm pack) | - | - | - | 4 s | - |
| Expo 58 Android | 12 s | 35 s | 17 s | 496 s* | 6 s |
| Expo 58 iOS | 19 s | 50 s | 53 s | 227 s* | 14 s |
| RN CLI 0.88 iOS | 9 s | 39 s | 54 s | 255 s* | 18 s |
| RN CLI 0.88 Android | 3 s | 79 s | - | 223 s* | 19 s |

\* these final recorded runs executed two full builds concurrently (iOS xcode +
Android gradle) plus cold derived-data/gradle dirs in fresh app dirs; an
Expo Android release build with a warm daemon took 70 s standalone. The
ready signal arrives 3-19 s after launch on every passing run.

## Screenshots (`docs/tasks/T03-smoke/`)

All four passing runs show the red READY semaphore with `NitroUiCore.now():
<ms>` rendered: `expo-58-android.png`, `expo-58-ios.png`,
`rncli-0.88.0-ios.png`, `rncli-0.88.0-android.png`.
`rncli-0.86.3-ios-with-library.png` and `rncli-0.86.3-ios-control-no-library.png`
show springboard for both the library consumer and the library-free control
(Q2 evidence).

## Decisions made

- **Dual readiness channel** (log line + colour semaphore) instead of a
  console-only signal: iOS Release physically cannot surface `console.*`
  (verified: nothing on stderr via `simctl launch --console-pty`, nothing in
  `log stream`, and even JS `fetch` to a live host-side HTTP server never
  produced a packet - so no consumer-side plist hack was needed, per the
  brief's rule). The semaphore also cross-checks Android ("ready log but no
  render" would fail).
- `127.0.0.1` loopback + AVD `10.0.2.2` conventions kept in the scripts for
  future use, but nothing in the verification path depends on the consumer
  app reaching the network.
- Screenshots are asserted programmatically (pixel classification), not
  eyeballed: BLANK/STARTING keep polling, ERROR fails fast, READY wins.
- Kept `--console-pty` on iOS launches as the crash detector (fatal/launch
  errors appear on stderr) even though it cannot see the success line.
- Workflow file mirrors ci.yml conventions (pinned actions, `xcode-27`,
  KVM setup) but is unrun by design.

## Known issues / follow-ups

- RN CLI `init`'s `npm install` may print `allow-scripts` warnings about our
  package's `prepare` (bob build). Harmless (tarball ships built `lib/`) but
  worth a look at release-readiness time.
- `smoke.yml` nightly matrix is 6 jobs; each creates fresh npm/gradle/pods
  state, so expect ~10 min warm-ish per job on hosted runners.
- If T10's components crash on mount, `App.tsx` never turns red and the smoke
  fails (intended); components that need state get their own probe component
  (documented in CONTRIBUTING).

## Questions for orchestrator

**Q1 - product bug (blocks RN ≥0.86 promise on Android):** the Compose BOM
pinned in `android/build.gradle` (`androidx.compose:compose-bom:2026.09.00` →
Compose 1.12.1) declares `compileSdk 37` + `AGP 9.1.0` floors. The RN 0.86.3
template is AGP 8.12 / compileSdk 36, so a fresh RN 0.86-line consumer fails
`checkReleaseAarMetadata` with 18 issues - zero-config install is broken for
that version line (Expo SDK 57 included). RN 0.88 / Expo 58 hosts are fine.
This is a T10-scope decision (T10 is coding against the current BOM), so I did
**not** change the pin. Options:
(a) downgrade to a BOM whose metadata floor is ≤36/AGP 8 (e.g. the compose
1.9.x-generation BOM), verify with these same scripts - my recommendation
if no 1.12-only APIs are needed;
(b) keep 2026.09 but make the BOM selection conditional on the host's AGP /
compileSdk in our `build.gradle`;
(c) raise the product floor to RN ≥0.88 (peerDeps + docs change).
Happy to re-run `RN=0.86.3 bun run smoke:rn-cli` against any fix.

**Q2 - environment, not our library:** a fresh RN **0.86.3** app *without our
library* also hangs at launch in Release on this machine's iOS 27 simulator
runtime (process alive, no window ever appears - control app + consumer
screenshots above). iOS verification is therefore impossible for 0.86.3 here;
the brief scoped 0.86 iOS to "if time permits". Expo SDK 58 (RN 0.88) and RN
CLI 0.88.0 verified green on iOS. Recommend: when backfilling an SDK 57 CI
row, target an older simulator runtime, or treat 0.86 iOS as unsupported on
iOS-27-runtime hosts until RN's prebuilt core catches up.

---

# Round 2 (review response)

Review: `docs/tasks/T03-smoke.review.md` (verdict CHANGES-REQUIRED). All three
BLOCKING items, all SHOULD-FIX items and all cheap NITs are addressed below.
The review document itself is now committed alongside this report.

## Round 2 gates (commands from the worktree root)

| Command | Result | Timings | Artifacts (`/tmp/nitro-ui-smoke/artifacts/`) |
| --- | --- | --- | --- |
| `bun run check` (now incl. `autolinking:check`) | **PASS** | - | - |
| `PLATFORM=ios bun run smoke:expo` (SDK 58) | **PASS** | 430 s (ios-build 142 s, ios-run 86 s) | `expo-20261022-220149-60361` |
| `PLATFORM=android bun run smoke:expo` (SDK 58) | **PASS** | 467 s (android-build 355 s) | `expo-20261022-221334-70288` |
| `RN=0.88.0 PLATFORM=ios bun run smoke:rn-cli` | **PASS** | 206 s (pod-install 45 s, ios-build 100 s, ios-run 7 s) | `rn-cli-20261022-222135-74329` |
| `RN=0.88.0 PLATFORM=android bun run smoke:rn-cli` | **PASS** | 301 s (android-build 243 s) | `rn-cli-20261022-220003-59357` |
| `RN=0.86.3 PLATFORM=android bun run smoke:rn-cli` | **PASS** | 333 s (android-build 238 s) | `rn-cli-20261022-215216-53042` |

Every run packed a fresh tarball (no `SMOKE_TARBALL`/`SKIP_PACK` used). The
0.86.3 Android pass is the proof that the Q1 BOM pin fixes the RN 0.86-line
consumer that round 1 could not build. RN CLI 0.88 iOS re-verified through the
new `bundle install && bundle exec pod install` path (autolinked
`NitroUi`), so every README row is now green with round-2 scripts.

iOS readiness seen in os_log (Expo run, `ios-runtime.log`):

```
2026-10-22 22:08:46.395 I  expoconsumer[66612:5958dc] [com.facebook.react.log:javascript] NITRO_UI_SMOKE_CORE_NOW=261565563.579833
2026-10-22 22:08:46.398 I  expoconsumer[66612:5958dc] [com.facebook.react.log:javascript] NITRO_UI_SMOKE_READY
```

RN **0.86.3 iOS remains not verifiable on this machine** (iOS 27 simulator
runtime hangs a library-free 0.86.3 control app too - round 1 Q2, control
screenshots kept as JPEGs). `smoke.yml` excludes that matrix row with a
comment; the README says so instead of claiming a pass.

## Review item -> fix

- **B1** README now lists only what passed (Expo 58 both platforms, RN CLI
  0.88.0 both, RN CLI 0.86.3 Android; 0.86.3 iOS = "n/a" + reason) and the
  BOM pin made 0.86.3 Android actually pass, so the floor claim in D8 holds
  where verifiable. Commit messages make no unverified claims.
- **B2** iOS readiness switched to the reviewer's os_log path:
  `install_start_verify_ios` starts `xcrun simctl spawn $UDID log stream
  --level info --style compact --predicate 'subsystem ==
  "com.facebook.react.log"'` before a plain `simctl launch`, greps
  `NITRO_UI_SMOKE_READY`, and fails fast on `Unhandled JS Exception|RCTFatal|
  Fatal error`. A screenshot is taken on success and on timeout alike.
  `scripts/smoke/pixel-ready.mjs` deleted (117 lines); the app still paints
  white/red/blue as a human-readable cue only. The false "iOS strips console
  in Release" premise is corrected in CONTRIBUTING, App.tsx and common.sh
  comments. Verified by two iOS runs above.
- **B3** All `pkill -f` uses removed. Apps are stopped with
  `simctl terminate <udid> <bundleId>` / recorded PIDs only; the dead first
  `exec=` assignment is gone.
- **S1** App dirs and tarball dirs are now `mktemp -d`-unique per run
  (`mk_run_dir`), pack writes into a per-run dir, and the exact tarball path
  is handed to the consumer install - no shared-name `rm -rf`, no
  `latest_tgz` races.
- **S2** Both run scripts pack fresh by default. `SMOKE_TARBALL` is honoured
  only when it matches the current HEAD (sidecar `<tgz>.gitsha`);
  `SKIP_PACK=1` still works but logs a loud warning.
- **S3** Background processes (log streams, logcat, emulators) are tracked in
  `BG_PIDS` and killed by the EXIT trap; `./gradlew --stop` runs for created
  project dirs on the same path. Gradle now runs
  `--no-daemon -Pkotlin.compiler.execution.strategy=in-process`, and
  `SHUTDOWN_DEVICES=1` (default) shuts down only devices a run booted. The
  daemons the reviewer found (Gradle 9.3.1 `31153`, Kotlin 2.1.20 `31318`)
  were terminated; `ps` shows zero daemons after the five round-2 runs.
- **S4** `.github/workflows/smoke.yml` rewritten: `plan` job honours the
  `platform` input; images use `x86_64` system images on ubuntu; PATH export
  precedes `require_cmd emulator`; `sdkmanager --licenses` added; Expo iOS
  does `gem install cocoapods`, rn-cli iOS uses
  `bundle install && bundle exec pod install`; `simctl create` without a
  runtime pin; `timeout-minutes` set; artifact actions SHA-pinned
  (upload-artifact v7.0.1 / download-artifact v8.0.1, SHAs checked against
  the GitHub API); the RN 0.86.3 x iOS row is excluded with a D8/iOS-27
  comment; header comment now matches the env the jobs actually set. Valid
  YAML (`ruby -ryaml`); still unrun by design.
- **S5** `scripts/smoke` added to `tsconfig.json` include and `App.tsx` fixed
  (three static styles via `StyleSheet.create`, `styles[status]`, no
  function-inside-StyleSheet). A component-API rename now breaks
  `bun run check` instead of a 10-minute smoke run.
- **S6** `scripts/check-autolinking.mjs` added to `bun run check`: runs the
  real `getPackageClassName` from `@react-native-community/cli-config-android`
  plus both Expo resolver regexes over `android/` and asserts
  `NitroUiPackage`. Proven to bite: pointed at main's pre-fix
  `NitroUiPackage.kt` it resolves `still` and fails. (The reviewer's optional
  `react-native.config.js` belt-and-braces was not added - see follow-ups.)
- **S7** The two 3.5 MB springboard PNGs are deleted and replaced with
  34 KB JPEGs (`sips -Z 600`). Whole evidence folder is now ~460 KB.
  Screenshots refreshed from round-2 runs (Expo iOS/Android, RN CLI iOS/
  Android 0.88, RN CLI 0.86.3 Android).
- **S8** README install steps are npm-first and match the scripts verbatim;
  bare RN shows `bundle install && bundle exec pod install`, which
  `rn-cli.sh` now executes when the template ships a Gemfile (verified in
  the round-2 RN CLI iOS run).
- **Q1** `android/build.gradle` pins `compose-bom:2026.06.01` with the
  "Compose 1.12+ needs compileSdk 37/AGP 9.1 - don't bump while RN 0.86 is
  supported (D8)" comment. Only those two lines changed in that file. No
  1.12-only APIs exist yet (the library has no Compose widgets until T10);
  material3 is 1.4.0 in both BOMs. The nightly 0.86.3 Android row is the
  guard, as recommended.
- **NITs** (all done): nitro-modules version read from our
  `peerDependencies` (`NITRO_MODULES_SPEC`); `CREATE_EXPO_APP_VERSION`
  override for the create-expo pin; `PLATFORM` validated before any work;
  whole run tee'd to `$ARTIFACTS/run.log`; Android crash detection filtered
  by package, extended to native `Fatal signal ... <pkg>`, and re-checked
  after the ready line; no more screenshot written then `mv`-overwritten;
  `RUN_START` used for the total; early emulator-exit detection via
  `kill -0` instead of waiting out `BOOT_TIMEOUT`; `sdkmanager
  --list_installed` captured before grepping (no SIGPIPE under pipefail);
  App.tsx top padding so text clears the iOS status bar; `key="switch"`
  gone from the example comment; the non-existent `NitroUiCoreProbe` and the
  unverified fetch-to-host claim are out of CONTRIBUTING; CONTRIBUTING gained
  the os_log section, the new env vars (`SMOKE_TARBALL`, `SKIP_PACK`,
  `SHUTDOWN_DEVICES`, `CREATE_EXPO_APP_VERSION`, `NITRO_MODULES_SPEC`) and
  the `autolinking:check` row.

## Round 2 cleanup evidence

- Zero Gradle/Kotlin daemons running after the round (`ps` checked).
- Emulator-5574 (`nitroui_t03`) not running; iPhone 17e
  `C5CD4A7F-9079-4FAB-9EE3-88BC0754CB85` shut down. No other agent's device
  (`emulator-5554/5560/5570`, iPhone 17, iPhone Air, nitroui_t01/t02) was
  touched.

## Round 2 known issues / follow-ups

- shellcheck (not wired into CI) still shows cosmetic warnings in
  `scripts/smoke/common.sh` (`SC2034` for `NITRO_MODULES_SPEC`, consumed by
  the sourcing scripts; a couple of `SC2155` `local x=$(...)`); left as-is to
  avoid churn while other tasks touch the same scripts.
- `create-expo-app` defaults to `latest` (pinning it would rot with each
  SDK); CI pins via `CREATE_EXPO_APP_VERSION` if desired.
- Optional reviewer suggestion not taken: shipping `react-native.config.js`
  with explicit `packageImportPath`/`packageInstance`. The regex regression
  guard (S6) covers the failure mode; can be added later if a consumer
  autolinker change ever breaks the regex path.
- `smoke.yml` remains unrun by design; first real execution will be when the
  orchestrator enables the nightly/CI trigger.
