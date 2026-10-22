# T03 review: consumer smoke tests

Reviewer verdict: **CHANGES-REQUIRED**. The fixes are small, but B2 changes the iOS readiness
mechanism, so iOS needs one re-run afterwards.

Scope: `git diff main...task/T03-smoke` (3 commits, head `5669424`). Checks I ran myself:
- shellcheck.
- tsc on `scripts/smoke/App.tsx`.
- both consumer autolinker regexes against the old and new `NitroUiPackage.kt`.
- one iOS Release os_log probe on the assigned sim (`C5CD4A7F-…`, booted and shut down by me).
- two throwaway Gradle builds for Q1 (in `/tmp/t03rev/gradle086`).

I did not modify any tracked files.

What is good:
- The scripts work from any cwd (`BASH_SOURCE`-relative).
- `set -euo pipefail` is inherited from `common.sh`.
- The `SMOKE_TMP` path guard works. I tested space, `#` and `%`.
- Exit codes propagate.
- Logs are kept on failure and app dirs are deleted on success.
- There are no hardcoded UDIDs. Devices come from env.
- The `PR1505_Pixel` guard is in place.
- The KDoc fix is correct.
- The App.tsx "one import + one JSX line" contract is simple.

---

## BLOCKING

**B1. README claims a verification that failed.** `README.md:26-29` says the steps were run
"against … fresh React Native CLI apps (0.88.0 and 0.86.3), on iOS and Android". The report's own
gate table shows that both 0.86.3 runs FAILED. The commit message `c38ba4f` also says "0.86.3
supported". This is the user-facing compatibility claim, and Q1 shows it is false today.

Fix: either land the Q1 BOM change and re-run `PLATFORM=android RN=0.86.3`, or list only what
passed (Expo 58 and RN CLI 0.88.0, iOS and Android).

**B2. The iOS readiness design rests on a premise that is false.** The premise is that "iOS
Release strips all JS console output". It appears in `CONTRIBUTING.md:197-199`,
`scripts/smoke/App.tsx:12-14`, `scripts/smoke/pixel-ready.mjs:4-5`, `common.sh:220-224`, the
report and the commit message.

What the RN 0.88 source does:
- `RCTInstance.mm:451` always installs `nativeLoggingHook` via `bindNativeLogger`.
- `_RCTLogJavaScriptInternal` (`RCTLog.mm:328`) logs whenever a log function exists, and
  `RCTGetLogFunction()` always falls back to `RCTDefaultLogFunction`.
- The threshold is `RCTLogLevelInfo - 1` in every configuration.
- `RCTDefaultLogFunction` calls `os_log_with_type(subsystem "com.facebook.react.log",
  category "javascript")`. `console.log` maps to `OS_LOG_TYPE_INFO`.
- `log stream` hides INFO messages unless you pass `--level info`. That is why nothing showed up.

I confirmed this empirically. I took the spike's Expo SDK 58 **Release** simulator app (copied to
`/tmp`), replaced `main.jsbundle` with a 3-line probe, and launched it on `C5CD4A7F-…`:

```
xcrun simctl spawn $UDID log stream --level info --style compact \
  --predicate 'subsystem == "com.facebook.react.log"'
… I  expoconsumer[40350] [com.facebook.react.log:javascript] T03REV_PROBE_INFO_LEVEL
… E  expoconsumer[40350] [com.facebook.react.log:javascript] T03REV_PROBE_ERROR_LEVEL
… E  expoconsumer[40350] [com.facebook.react.log:native] Unhandled JS Exception: …
```

Without `--level info`, only the `E` lines appear. So the same `NITRO_UI_SMOKE_READY` console line
works on iOS. You also get deterministic fail-fast on JS fatals (`com.facebook.react.log:native`
"Unhandled JS Exception"). Today a JS fatal only shows up as a BLANK screen until the 180 s
timeout, because `--console-pty` stderr does not carry os_log.

Fix:
1. Before launch, start the `log stream` command above in the background, writing to
   `$ARTIFACTS/ios-runtime.log`.
2. Grep it for `READY_PATTERN`. Fail on `Unhandled JS Exception|RCTFatal`.
3. Launch with plain `simctl launch` and stop it with `simctl terminate`.
4. Take the screenshot as evidence.

The colour semaphore can stay as an optional cross-check, or be dropped together with
`pixel-ready.mjs` (117 lines). Either way, correct the docs and comments.

Why this matters beyond aesthetics: the semaphore needs more than 50% of sampled pixels to be red
(`pixel-ready.mjs:113`). That threshold gets tighter every time a component is added to the list.
And future tasks will read CONTRIBUTING's "iOS can't log" as fact.

Other no-native-code fallback options, if ever needed:
- `Settings.set({NITRO_UI_SMOKE: 'ready'})` (RN core, iOS-only, NSUserDefaults), read with
  `xcrun simctl spawn $UDID defaults read <bundleId> NITRO_UI_SMOKE`.
- An accessibility query via idb or XCUITest. That needs extra tooling, so I don't recommend it.

**B3. `pkill -9 -f "$exec"` kills unrelated processes** (`common.sh:232`, `:256`). `exec` is
`RnConsumer` or `expoconsumer`, and the pattern matches any process whose command line contains
that string. That includes:
- another worktree's concurrent smoke `xcodebuild -workspace …/RnConsumer.xcworkspace`;
- Gradle wrapper JVMs (`…/RnConsumer/android/gradle/wrapper/…`);
- editors.

This machine runs several agents in parallel, and they all use these same app names.

Fix: use `xcrun simctl terminate "$IOS_SIM_UDID" "$bundle_id"` (and `kill` the recorded
`launch_pid`). Never use `pkill -f`. Also remove the dead first `exec=` assignment (`:217`, which
is overwritten at `:227`).

## SHOULD-FIX

**S1. Shared default temp dirs collide across runs and worktrees.**
- `SMOKE_TMP=/tmp/nitro-ui-smoke` (`common.sh:11`) is shared by every worktree.
- `WORK="$SMOKE_TMP/expo-$SDK"` and `rn-cli-$RN` are fixed names, and each run starts with
  `rm -rf "$WORK"` (`expo.sh:16`, `rn-cli.sh:17`).
- `pack.sh:12` deletes every tarball in the shared dir.

So two concurrent runs (another worktree, or `PLATFORM=ios` and `PLATFORM=android` in parallel)
delete each other's app or tarball. `latest_tgz` can also pick another checkout's tarball.

Fix: make `WORK=$(mktemp -d "$SMOKE_TMP/expo-$SDK.XXXXXX")`, and pass the exact tarball path from
pack to the run (or key the tarball dir by repo path).

**S2. Stale-tarball risk.** `expo.sh` and `rn-cli.sh` never pack. `pack_lib` (`common.sh:85`) is
dead code. `bun run smoke:expo` after an edit therefore silently tests the previous tarball.

Fix: call `pack_lib` unless `SMOKE_TARBALL` / `SKIP_PACK=1` is set (CI sets it).

**S3. Leaks on failure paths.**
- The Gradle daemon leaks: `fail` exits before `./gradlew --stop` (`common.sh:141-146`). I found
  Gradle 9.3.1 daemon PID 31153 (started 21:09:53) and Kotlin 2.1.20 daemon PID 31318, both left
  by the failed 0.86.3 Android run (artifacts `rn-cli-20261022-210724`). I did not kill them. The
  implementer or orchestrator should.
- Background `adb logcat` and `simctl launch` processes leak whenever `set -e` or `fail` fires
  inside the verify functions. `RETURN` traps do not run on `exit` (for example, the `ERROR)`
  branch at `:242` and the unguarded `adb install`).

Fix:
- Add `--no-daemon -Pkotlin.compiler.execution.strategy=in-process`, as ci.yml already does.
- Track background PIDs in a global array that the existing EXIT trap kills.

**S4. smoke.yml would not pass as written.**
- `ensure_avd` defaults to an **arm64-v8a** system image (`common.sh:104`). On ubuntu x86_64
  runners, use `x86_64` (derive it from `$ABI`).
- `require_cmd emulator` runs **before** the PATH export (`common.sh:113` vs `:115`). `emulator`
  is not on PATH on hosted Ubuntu.
- There is no `sdkmanager --licenses` step. ci.yml has one.
- iOS uses `ruby/setup-ruby` without bundler or CocoaPods, then calls plain `pod install`. That is
  likely "command not found". For RN CLI use `bundle install && bundle exec pod install` (the
  template Gemfile pins CocoaPods). For Expo, use `gem install cocoapods`.
- `simctl create … "27.0"` needs a platform-qualified runtime (`iOS27.0` or `iOS 27.0`), or omit
  it.
- The `workflow_dispatch` `platform` input is declared but never used by the matrix.
- The two `0.86.3` rows are known-red (Q1/Q2), so they will make the nightly red from day one.
  Gate them until Q1 lands. For iOS, try an iOS 26.4 runtime, which is installed on this machine,
  so Q2 is testable here.
- No `timeout-minutes`.
- The header comment says jobs set `SMOKE_TARBALL_DIR`. They do not; this works only because the
  path matches the default.

**S5. `scripts/smoke/App.tsx` is not typechecked, and it fails typecheck.** I added a temp
tsconfig with `scripts/smoke/App.tsx` and got:
- TS2722 / TS2349 at `:58`;
- TS2560 at `:78`, because a function inside `StyleSheet.create` is not allowed.

The file is the consumer-API contract, so it must be in `tsconfig.json` `include`, so that API
renames break `bun run check` and not a 10-minute smoke run.

Fix: use `StyleSheet.create({ starting: {…}, ready: {…}, error: {…} })` and `styles[status]`.

**S6. The autolinking fix has no regression guard.** I confirmed what the comment-only fix does:
- On `main`, both regexes yield `still`.
- On the branch, RN CLI's `getPackageClassName(android/)` and Expo's two regexes
  (`androidResolver.js:195/203`) all return `NitroUiPackage`.

But any future KDoc containing "class X … :" before a `{` re-breaks every consumer. Expo also
drops the library from autolinking when the regex finds nothing (`androidResolver.js:95-97`).

Fix: add `scripts/check-autolinking.mjs` to `bun run check`. It should run
`@react-native-community/cli-config-android`'s `getPackageClassName` (already in node_modules)
plus the Expo regexes over `android/`, and assert `NitroUiPackage`.

Optional, for belt and braces: ship `react-native.config.js` with
`dependency.platforms.android.{packageImportPath,packageInstance}`. RN CLI and Expo
(`androidResolver.js:99-100`) both prefer these over the regex result. Add it to `files`.

No other autolinking hazards found:
- `nitrogen/` is outside `android/`, so it is not scanned.
- The namespace is detected from `build.gradle`.

**S7. Screenshot weight.** `rncli-0.86.3-ios-{with-library,control-no-library}.png` are 3.5 MB
each (7.2 MB of permanent git history) and only show springboard. Drop them, or convert with
`sips -Z 600 -s format jpeg` (about 36 KB). The other four (29-190 KB) are fine.

**S8. README install steps are not "exactly what the smoke runs".**
- The smoke runs `npm install <tgz> react-native-nitro-modules@^0.37.1`, then prebuild, then
  `pod install`.
- The README shows `npx expo install …` and `bun add …`.
- The RN 0.86/0.88 template recommends `bundle exec pod install`.

Fix: reword to "equivalent to", list npm first, and use `bundle exec pod install` for bare.

## NIT

- `react-native-nitro-modules@^0.37.1` is duplicated in `expo.sh:25` and `rn-cli.sh:26`. Read it
  from `package.json` `peerDependencies`.
- `create-expo-app@latest` is unpinned, while the RN CLI is pinned to `20.2.0`.
- Validate `PLATFORM` **before** the create/install steps (`expo.sh:29`, `rn-cli.sh:30`).
- Tee the whole run to `$ARTIFACTS/run.log`. npm, prebuild and pod logs are currently stdout only,
  so they are absent from failure artifacts.
- Android crash detection:
  - `FATAL EXCEPTION` matches any process, so filter by `$pkg`;
  - native crashes (`Fatal signal`, tombstones) are not matched;
  - there is no crash re-check after the ready line.
- `common.sh:253` takes a screenshot that the `mv` on `:254` immediately overwrites.
- `RUN_START` is unused (`:55`).
- `close()` in `pixel-ready.mjs:93` is a no-op wrapper.
- Emulator boot: detect an early emulator exit (`kill -0`) instead of waiting the full
  `BOOT_TIMEOUT`.
- `sdkmanager --list_installed | grep -q` under pipefail can SIGPIPE and trigger a needless
  reinstall.
- Devices the scripts boot are never shut down. iOS `bootstatus -b` boots silently. Consider
  shutting down only devices the script itself booted (it already knows on Android), behind a
  `SHUTDOWN_DEVICES=1` default.
- App.tsx text renders under the iOS status bar (see `expo-58-ios.png`). Add top padding.
- The `key="switch"` in the example comment is unnecessary.
- CONTRIBUTING mentions a `NitroUiCoreProbe` that does not exist (`:243`).
- The `fetch`-to-host claim (CONTRIBUTING `:199`) is unverified and probably an ATS or
  local-network effect. Drop it.
- Actions are not SHA-pinned in `smoke.yml` (`upload-artifact@v4`, `download-artifact@v4`),
  unlike ci.yml.

---

## Q1: Compose BOM for RN ≥ 0.86 (Expo SDK 57+)

**Recommendation: `androidx.compose:compose-bom:2026.06.01`.** It resolves to ui and foundation
**1.11.4** and material3 **1.4.0**, and it is the newest BOM before the Compose 1.12 line.

**Host toolchains** (from `facebook/react-native` `packages/react-native/gradle/libs.versions.toml`
and `@react-native-community/template`):

| Host | compileSdk | AGP | Kotlin | Gradle |
| --- | --- | --- | --- | --- |
| RN 0.86.3 (tag `v0.86.3`) | 36 | 8.12.0 | 2.1.20 | 9.3.1 |
| RN 0.87 / 0.88.0 | 37 | 9.2.1 | 2.2.0 | 9.4.1 (0.88 template) |

- For RN 0.86.3, the template sets `ext.kotlinVersion = "2.1.20"`.
- Expo SDK 57 (`expo@57.0.31`, template RN 0.86.3): `ExpoRootProjectPlugin` takes compileSdk and
  kotlin from RN's catalog, so it gets the same values.

**AAR metadata** (`META-INF/com/android/build/gradle/aar-metadata.properties`, from
dl.google.com) and POM kotlin-stdlib versions:

| Artifact | BOM | minCompileSdk | minAGP | kotlin-stdlib |
| --- | --- | --- | --- | --- |
| ui / foundation-android 1.10.6 | 2026.03.01 | 35 | 8.6.0 | 2.0.21 |
| ui / foundation-android 1.11.0 / 1.11.4 | 2026.04.01 / **2026.06.01** | 35 | 8.6.0 | 2.1.20 |
| ui / foundation-android 1.12.0 / 1.12.1 | 2026.08.00 / 2026.09.00 | **37** | **9.1.0** | 2.1.20 |
| material3-android 1.4.0 | every BOM since 2025.09.01 | 35 | 8.6.0 | 2.0.21 |

**Verification with a throwaway app module:**
- Setup: BOM plus `material3`, `ui` and `foundation`, the Kotlin compose plugin at the host's
  Kotlin version, and a `Switch` + `Slider` composable in a `ComposeView`.
- **RN 0.86 toolchain** (AGP 8.12.0, Kotlin 2.1.20, compileSdk 36, Gradle 9.3.1):
  - BOM 2026.09.00 → `checkReleaseAarMetadata` FAILS ("requires Android Gradle plugin 9.1.0 or
    higher" / compileSdk 37, on animation-core, ui-graphics, ui-text, foundation-layout, …). This
    reproduces the report.
  - BOM 2026.06.01 → `:app:assembleRelease` **PASSES**, including Kotlin compilation, so Kotlin
    2.1.20 reads the 1.11.4 metadata.
- **RN 0.88 toolchain** (AGP 9.2.1, Kotlin 2.2.0, compileSdk 37, Gradle 9.4.1): BOM 2026.06.01 →
  `:app:assembleRelease` **PASSES**.

**Notes:**
- material3 is identical (1.4.0) between 2026.06.01 and 2026.09.00. Only ui and foundation drop
  from 1.12.1 to 1.11.4, so the API impact for T10 should be small. Check that no 1.12-only
  ui/foundation APIs are in use.
- Consumers on newer stacks can still get newer Compose, for example `@expo/ui`, which uses
  material3 1.5.0-alpha (minCompileSdk 35, AGP 8.6.0). Gradle picks the highest version, so a BOM
  floor in a library is safe.
- Add a comment next to the pin: "Compose ≥1.12 requires compileSdk 37 / AGP 9.1 — do not bump
  past 1.11.x while RN 0.86 is supported."
- Keep the `RN=0.86.3 PLATFORM=android` smoke row as the guard.
- No other Compose/Kotlin dependencies in `android/build.gradle` need changing:
  - the compose compiler plugin follows `rootProject.ext.kotlinVersion`;
  - the `2.2.0` fallback is only used when the host doesn't define it.
