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
  `PR1505_Pixel`/`emulator-5560` outright, stop the Gradle daemons they start,
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
google_apis arm64 image existed already). `PR1505_Pixel` untouched. No Metro
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
