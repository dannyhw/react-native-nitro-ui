# R5b — Post-publish verification: 0.1.0 — report

**Branch:** `task/R5b-post-publish` (from `main` at `f92ccac`) · **Round:** one bounded
round, no library code changed. · **Devices:** the assigned iPhone 17 simulator
`F08675D3-A32B-4F88-BC81-02D7E0CB797E` (already booted when the task started, used and
left as found) and AVD `nitroui_t03` as `emulator-5574` on a private adb server on port
`5043`, booted by this task and shut down at the end. Metro port `8295` was assigned and
never needed — every consumer build here is Release with the bundle embedded. The other
task's device (iPhone Air, `nitroui_t01`), the `RNSB …` simulators, `emulator-5560` and
`emulator-5570` were not touched; the default adb server was never killed and no process
was killed by name. · **Node:** `v24.22.1` through `fnm exec --using 24 --`, bun 1.4.0.
· **Tarball under test:** `SMOKE_TARBALL=/tmp/regpack/registry.tgz`, sha256
`fa1b7b969b961b6fa3b7ee16e2be3e5e82ec5c4a2db4efc9e5f40f0775fb5688` — the registry copy
of `react-native-nitro-ui@0.1.0`, byte-identical to the pack R5 tested.

## Verdict

**Everything is green.** The published `0.1.0` is the artifact that was tested, and a
clean consumer install of it builds, installs and lays out all eight controls on every
row requested. No row went red, so there is no log excerpt to reproduce and no reason to
`npm deprecate`.

| Row | Result | Duration |
| --- | --- | --- |
| Registry install check (`npm view` + `npm pack` from npm) | **PASS** — 464 files | ~5 s |
| `smoke:expo` SDK 58, `PLATFORM=ios` | **PASS** | 152 s |
| `smoke:expo` SDK 58, `PLATFORM=android` | **PASS** | 172 s (173 s wall) |
| `smoke:rn-cli` RN 0.88.0, `PLATFORM=ios` | **PASS** | 132 s |
| `smoke:rn-cli` RN 0.88.0, `PLATFORM=android` | **PASS** | 112 s |
| `smoke:rn-cli` RN 0.86.3, `PLATFORM=android` | **PASS** | 89 s |

Durations are the script's own `total`. iOS and Android rows of the same script were run
as two concurrent single-platform runs (separate app dirs, separate devices, separate
`mktemp` runs), which is why the expo pair totals more than R5's single `both` run.

## 1. Plain registry install check

In a fresh temp dir, Node 24 (`fnm exec --using 24 --`):

```sh
npm view react-native-nitro-ui@0.1.0
npm pack react-native-nitro-ui@0.1.0
tar -tzf react-native-nitro-ui-0.1.0.tgz | wc -l      # 464
```

- `version` `0.1.0`, `dist-tags.latest` `0.1.0`, `versions` `['0.0.0-stage', '0.1.0']`,
  published the same day.
- `dist.integrity` `sha512-UB9Mcedvta0QjA0NB4Eb+/GvdpS3ftoKCIhQEwXY7k0rV6hkGC6VYk7Ua4KzpbJQrMq1aaXXD76AC8upvehSsQ==`,
  `dist.shasum` `68d58b24bcd8d35489ddf860be4d10b45d0f27f0`, `dist.unpackedSize` 2116320.
- `npm pack` printed `total files: 464` and `tar -tzf | wc -l` counted **464** — the same
  number `manifest:check` guards.
- The freshly downloaded tarball hashes to
  `fa1b7b969b961b6fa3b7ee16e2be3e5e82ec5c4a2db4efc9e5f40f0775fb5688`, identical to
  `/tmp/regpack/registry.tgz` and to R5's pack of the merge commit. What is on npm is
  byte-for-byte the tree R5 gated.

## 2. Consumer smoke against the registry tarball

Each row: `SMOKE_TARBALL=/tmp/regpack/registry.tgz`, plus
`IOS_SIM_UDID=<iphone 17 udid>` / `ANDROID_AVD=nitroui_t03 EMULATOR_PORT=5574` and
`ANDROID_ADB_SERVER_PORT=5043`, one command per platform:

```sh
PLATFORM=ios      … bun run smoke:expo      # SDK 58
PLATFORM=android  … bun run smoke:expo
PLATFORM=ios      RN=0.88.0 … bun run smoke:rn-cli
PLATFORM=android  RN=0.88.0 … bun run smoke:rn-cli
PLATFORM=android  RN=0.86.3 … bun run smoke:rn-cli
```

Every run installed the registry tarball with npm into a freshly generated app, built
Release (bundle embedded, no Metro), installed on the assigned device, launched and
passed the ready-line contract — all eight controls, each with a non-zero box. The
expected `note: /tmp/regpack/registry.tgz.gitsha missing, cannot verify tarball commit`
appeared on every row: the registry tarball carries no `.gitsha` sidecar, and reusing it
is the point of this check (R5, publish checklist step 6).

| Row | Timings (s) | Ready line (abridged) | Artifacts (`/tmp/nitro-ui-smoke/artifacts/`) |
| --- | --- | --- | --- |
| expo 58 iOS | create 2 · install 15 · prebuild+pod 38 · ios-build 84 · ios-run 8 | `switch=61x28 … date-picker=103x36.33 picker=72x35 host=354x96` | `expo-20261026-150704-36375` |
| expo 58 Android | create 2 · install 5 · android-build 155 · android-run 3 | `switch=52.19x48 … date-picker=131.05x48 picker=280x56 host=363.43x96` | `expo-20261026-150745-38710` |
| rn-cli 0.88.0 iOS | init 3 · install 19 · pod 29 · ios-build 69 · ios-run 6 | `switch=61x28 … date-picker=103x36.33 picker=72x35 host=354x96` | `rn-cli-20261026-151109-44285` |
| rn-cli 0.88.0 Android | init 1 · install 7 · android-build 94 · android-run 4 | `switch=52.19x48 … date-picker=131.05x48 picker=280x56 host=363.43x96` | `rn-cli-20261026-151145-44801` |
| rn-cli 0.86.3 Android | init 3 · install 13 · android-build 65 · android-run 4 | `switch=52.19x48 … date-picker=131.05x48 picker=280x56 host=363.43x96` | `rn-cli-20261026-151330-46995` |

Each artifact dir holds `run.log`, the platform build log, the runtime console capture
and the screenshot. The iOS rows also prove autolinking from the published podspec
(`NitroUi (0.1.0)` installed by CocoaPods in both consumers) and the Android rows prove
autolinking from the published AAR sources; nothing in either consumer needed a manual
native change.

### Red rows

None. 5 of 5 device rows and the registry check passed on the first attempt.

## 3. Scope and device hygiene

- The Android emulator was started by this task (`-port 5574`, headless, private adb
  server on `5043`) and killed with `adb -s emulator-5574 emu kill` at the end; the
  private adb server was then stopped with `adb kill-server` against port `5043` only.
  The default-port adb server was never restarted or killed, and `adb devices` on it
  showed only another task's `emulator-5570`, untouched.
- All `adb` calls addressed the device by serial (`-s emulator-5574`), and the smoke
  scripts refuse `emulator-5560` outright.
- The assigned iPhone 17 simulator was already booted, so it was left booted; the
  iPhone Air and the `RNSB …` simulators were not booted, shut down or installed to.
- No Gradle daemon outlived the runs (`--no-daemon` plus in-process Kotlin, `gradlew
  --stop` per run); no logcat process outlived them (the scripts reap what they track).
- Nothing in the library was changed: this report is the only file committed.

## 4. Follow-ups

- RN 0.86.3 **iOS** remains untested by design (not in this brief's matrix, and R5
  labelled it not runnable: the 0.86.3 template app is killed at scene creation before
  any ready line). Nothing observed here contradicts that.
- `react-native-nitro-ui` has a `0.0.0-stage` version in `versions` (not in `dist-tags`),
  so `npm i react-native-nitro-ui` resolves `0.1.0`; noted, not acted on.
