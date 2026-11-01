# F8 — The harness jobs green on GitHub's hosted runners

**Branch:** `task/F8-ci-harness-hosted` (from `main` at `a760514`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `F8-wbpsf` (pair-a: sim `49D5024D…` / AVD `nitroui_a` / `emulator-5574` / Metro `8295`)

## Summary

**iOS — the 8 failures classify into two premises and five races, no product bug.**
Each was reproduced or refuted locally, not read off the log:

- The DatePicker `103x36.33` vs `107x36.33` is **locale, not runtime**: launching the gate
  simulator with `-AppleLocale en_US` measures CI's 107.00x36.33 exactly. `HybridNitroUi
  DatePicker.swift`'s `fallbackSize` says it was measured at `en_PT`, which the gate simulator
  is. Same for `expected +0 not to be +0`: `TZ=UTC` on the gate simulator reproduces the DST
  precondition failure. Both premises were inherited; now they are declared —
  `example/rn-harness.config.mjs` pins `en_PT`/`Europe/Lisbon` for every iOS launch and prints
  `app-launch: the app runs at …`.
- A locale-dependent table row now carries `measuredUnderLocale`, and a mismatch is a **printed
  skip** covering exactly the two claims that number supports (box comparison, warm-corrections
  — the Swift comment prices a wider locale at one extra correction, which a device run proved
  by going red on `needed 1 correction(s)`). Poisoned-fallback correction, non-zero measurement
  and every other rule still assert. The skip covers a row only when that row names a locale.
- The other six (recycle-reset, a11y handle, `no-leak-on-drop` for Menu, Switch box, T14 ×2)
  appear in run `41230848294` and pass in `41234953779` on the same tree, at load1 152–380 on 3
  cores — races, not behaviours. Three of them were fixture bugs, and they are fixed: T14 read
  `handles.get(id)!` one statement after `render()` (`hybridRef` fires on a later commit) and
  Switch read `measureContent()` the same way; Conformance's recycle and leak controls compared
  engine counters against a baseline that was still moving. Those now wait for a handle, or read
  through `settledStats` (two consecutive equal reads, throws if it never settles). Every wait
  polls for *existence* only, so no value check got weaker.

**Android — `-gpu host` on a machine with no GPU.** Both runs died at 900 s with qemu alive. A
cache-HIT run (`41234953779`, snapshot-reuse, no snapshot generation) rules out cold-snapshot
cost, and the only repo-only difference from upstream's boot is our patch's `-gpu host`
(upstream ships `swiftshader_indirect`, and its own hosted job boots in ~40 s). The rule is now
machine-aware (`host` on macOS or with a display server, `swiftshader_indirect` headless),
rendered as one expression shared by the patch and `emulator-launch.mjs`. The job also prints
its boot config, wraps the run in the action's pre/after hooks, and uploads qemu/logcat.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1577 tests / 58 suites | `6d317aac80fd` | 2 m 37 s | start 2.4 / med 5.6 / max 6.8 |
| `harness:ios` | **PASS** | 227 tests / 16 suites | `6d317aac80fd` (ios tree) | 6 m 14 s | start 2.2 / med 14.1 / max 114.8 |
| `harness:android` | **PASS** | 278 tests / 16 suites | `6d317aac80fd` (android tree) | 14 m 27 s | start 2.1 / med 3.0 / max 118.7 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:ios:Conformance` | **PASS** | 40 tests / 1 suites | `6d317aac80fd` (ios tree) | 1 m 51 s | start 5.2 / med 47.8 / max 93.0 |

`need --for review`: `need: review is satisfied on this code tree.` (`real-input:*` is the
merge bar; F8 changes no product code and every changed harness file ran on both platforms —
the four iOS-only harness files ran in `harness:android` too, 278 tests green).

Device proof, three ways on the gate simulator: default pin -> `225 passed / 2 skipped` and
`app-launch: the app runs at TZ=Europe/Lisbon locale=en-PT`; same tree at `en_US`/`UTC`
**without** the guard -> Conformance red on CI's message word for word; with the guard ->
`40 passed`. The guard's own sentence is asserted in `conformance.test.js`, because the
harness forwards client `console.log` only for failing suites locally.

## Red proofs

- `app-launch-env · passes the locale as -AppleLocale` -> `options.arguments = []` -> `expect(received).toEqual(expected)` on `['-AppleLocale','en-US']`
- `app-launch-env · passes the zone as TZ` -> `options.environment = {}` -> `toEqual` on `{ environment: { TZ: 'UTC' } }`
- `conformance · pins the launch locale the table needs` -> `DEFAULT_APP_TEST_LOCALE = 'en_GB'` -> `toEqual` (pin/table drift finding)
- `conformance · reports the locale mismatch as a skipped comparison` -> `localePremiseMiss` always returns `null` -> `Received array: [{ problem: "the fallback 103x36.33 is not the measured 107x36.33 …" }]`
- `conformance · does not call the extra correction a locale costs a missing declaration` -> drop the `localeMiss` guard -> `toEqual` deep-equality on the findings list
- `emulator-launch · chooses the GPU mode by what the machine has, on both sides` -> headless branch returns `host` -> `- "pooled": "swiftshader_indirect"` / `+ "pooled": "host"` for `GitHub hosted Linux runner (headless)`
- `emulator-launch · renders the GPU rule into the patch as an expression` -> patch literal `return 'host'` -> `expect(received).toContain(expected)` (installed patched function ≠ Node rule)
- `ci-workflows · the Android job leaves evidence when the emulator never becomes ready` -> delete the `Collect emulator boot diagnostics` step -> `expect(received).not.toBeUndefined()`; also red for dropping that step's `if: always()`, for `emulatorGpuModeForHost` → a literal `'host'` in the preflight, and for renaming `preRunHook`
- `app-launch-env` (25 tests), `emulator-launch` (19), `conformance` (85) all green; C++/Swift and ASan suites run under `check`.

## Files changed

- `scripts/app-launch-env.mjs` + `scripts/__tests__/app-launch-env.test.js` — new: launch options from `NITRO_UI_TEST_{LOCALE,TZ,LANGUAGES}`, validated.
- `example/rn-harness.config.mjs` — default pin (`en_PT` / `Europe/Lisbon`) + `app-launch:` log line.
- `scripts/conformance-core.mjs`, `example/__tests__/Conformance.harness.tsx` — `measuredUnderLocale`, `localePremiseMiss`, skip channel, pin↔table cross-check; shared table regenerated.
- `example/__tests__/deviceContext.ts`, `handles.ts` (new) — app-visible locale/zone, `waitForHandle`.
- `example/__tests__/{ColdSizing,Switch,DatePicker,Conformance}.harness.tsx` — handle waits,
  `settledStats`, DST premise as a printed skip (all four ran on both platforms).
- `scripts/emulator-launch.mjs`, `patches/@react-native-harness%2Fplatform-android@1.6.0.patch`, `scripts/__tests__/emulator-launch.test.js` — machine-aware GPU mode, one rule for both runtimes.
- `.github/workflows/ci.yml`, `scripts/__tests__/ci-workflows.test.js` — Android preflight, pre/after hooks, boot diagnostics artifact + its guard.

## CI to dispatch

1. Push `task/F8-ci-harness-hosted`, dispatch `ci.yml` on it (no AVD-cache wipe — the point is to see the cached path boot on `swiftshader_indirect`).
2. Read `harness-boot-diagnostics-android` even if the job goes green: `Show the emulator configuration` prints the chosen GPU mode, and `pre-run:`/`after-run:` bound the boot.

## Follow-ups

- android-ci: a hosted Android boot on `swiftshader_indirect` is upstream-fast (~40 s) but unmeasured here — the next dispatch is the first data point.
- ios-ci-premise: `HARNESS_DEBUG` only adds spawn lines and client `console.log` shows for failing suites only, so a *passing* CI run cannot show its own skip lines; premise logs are only reviewable from a red run.
- lease-ttl: `lease.mjs list` shows my pair `idle 168m of 30m` while held — the idle column can't be read as "abandoned" for a live lease.

## Fix round 1

**Lease:** `F8-3lo05` (pair-a, same pair as round 1).

Nine code commits on `45280e2` (plus this report and the ledger export). The **Menu leak is
real**: a correction is an `Asynchronous` state update, RN re-lays out the revision that carried
it, and for a view dropped meanwhile `measure`
re-files a forgotten id — a ledger entry with no registry row, so the sweep never sees it.
`measure` now answers a finished id with the same size and files nothing per instance (4 KiB
ring; monotonic ids, no false positives). 286 native checks, ASan clean, patch changeset.

The **DatePicker failure is a fixture bug**: `handles` is keyed by `testID` and `hybridRef` fires
once per native view, so a mount's second owner was read through the first owner's handle — CI's
`1799971200000` *is* the first owner's pick. `expectANewHandle` (7 sites); `40/40` locally.

All six CodeRabbit comments are answered one line each below, under the gate table.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1585 tests / 59 suites | `dd53366ccfb8` | 2 m 36 s | start 4.8 / med 4.9 / max 7.8 |
| `harness:ios` | **PASS** | 227 tests / 16 suites | `e76d62bcbae9` (ios tree) | 4 m 11 s | start 2.6 / med 34.3 / max 121.1 |
| `harness:android` | **PASS** | 278 tests / 16 suites | `e76d62bcbae9` (android tree) | 8 m 20 s | start 2.2 / med 2.3 / max 3.4 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:ios:Conformance` | **PASS** | 40 tests / 1 suites | `e76d62bcbae9` (ios tree) | 1 m 52 s | start 2.2 / med 58.0 / max 108.5 |

`need --for review` is satisfied on this tree. iOS `225 passed / 2 skipped`
(`app-launch: … locale=en-US`); Android `278 passed` — every changed harness file ran on both
platforms.

## Fix round 1 appendix

### Each CodeRabbit comment

- **`ci.yml:269` (Read the configuration file only once)** — the helper is a real script now, `scripts/ci-avd-name.mjs`, and the step passes it a filename. Run 41256853746 showed the `ENAMETOOLONG` this caused.
- **`ci.yml:277 (Read the AVD configuration after cache restoration)`** — the `config.ini` hardware lines moved to the collect step, the first point in the job where that file exists. The preflight says so in its own output.
- **`ci.yml:334` (Do not fail the job when emulator logs are absent)** — `tail` runs per file behind `[ -e ]`, and the step's last command is a `find | wc -l` that cannot fail on an empty glob. Mutation: one `tail` over a glob -> `status 1`.
- **`ci.yml:341` (Include the hidden diagnostics directory)** — took the first option: the directory is `harness-diag`, not hidden, so no flag can be dropped later to re-arm it. `if-no-files-found` is `error`, not `ignore`.
- **`conformance-core.mjs:930` (Use the effective runtime locale)** — the comparison already read the *runtime* locale from `Intl`, never the requested one; what was wrong was the pin. It is `en_US` now — GitHub's own locale, and the row's measured one — and the suggestion's other half (align launch and measurement) is exactly that. A mismatch is a failure, not a skip; their regression case exists as `fails a locale mismatch rather than skipping it`.
- **`emulator-launch.mjs:255` (Update the default-GPU tests for headless hosts)** — took the first option: `emulatorLaunchArgs` gained a `host`, and every fixture row names its machine (headless Linux, `DISPLAY=:99`, Wayland, macOS).

### Red proofs

- `sizing.test · a layout arriving after forget files nothing` -> delete `measure`'s guard -> `got 1, want 0`, and `got 51, want 0` after 50 drops (CI's number)
- `sizing.test · an id that binds again is not treated as finished` -> drop `registerInstance`'s clear -> 8 checks red, incl. `the correction commits`
- `ci-workflows · diagnostics exits 0 with nothing to collect` -> one `tail` over a glob -> `status 1`, output stops at the header
- `ci-workflows · uploads a directory the uploader can see` -> `.harness-diag` + `if-no-files-found: ignore` -> the hidden-segment assertion goes red
- `ci-workflows · preflight prints nothing about an AVD that does not exist yet` -> `config.ini` back in the preflight -> `mentionsAvdFile: true`
- `ci-workflows · diagnostics still prints what exists` -> delete the device clock/locale block -> `Expected substring: "persist.sys.timezone="`
- `harnessHandles · rejects when the handle never arrives` -> return `undefined` at the deadline -> `Received promise resolved instead of rejected`; never checking the deadline hangs the run, which is the failure mode it replaces
- `conformance · pins the launch locale the table needs` -> loop the module constant, not the `declared` parameter -> `Expected substring: "nothing pins the emulator"`, received `""`
- `conformance · fails a locale mismatch rather than skipping it` -> restore round 1's skip -> red on the sentence it used to print

### Follow-ups

- android-tz: `fd95d15` puts `persist.sys.timezone` in the artifact, so the next dispatch decides whether a `-timezone` boot arg earns a patch. Android's `appLaunchOptions` is `{ extras }` only — `TZ` cannot reach the app as it does on iOS — and `emulator -help-timezone` warns the flag is ignored on M5 and older SDK releases.
- sizing-t11-flake: one Android run here had `provisional n=50 … confirmed=74` where 50 are owed — engine counters shared with another suite's in-flight reports; green on the re-run. `Sizing.harness.tsx` reads `stats()` un-settled, unlike Conformance's `settledStats`.
- coderabbit-reply: the six review threads need replies on the PR; none of them resolves itself.

### CI to dispatch

1. Push `task/F8-ci-harness-hosted` and dispatch `ci.yml` on it — both jobs, no AVD-cache wipe.
2. Read `harness-boot-diagnostics-android`: `host.log` carries the GPU mode, `config.ini`'s hardware lines and the device's zone/locale; the step cannot fail on an absent log, and an empty artifact is red.

## Fix round 2

**Lease:** `F8-a6ro7` (pair-a). Eleven commits, ending `64916aa`.

**Picker's leak is real and is a second route to the same leaked entry.** Its clue is the
half CI did not report as failing: `registry` stayed flat. `measure` is the only creator of a
ledger row and files one for an *unbound* id too (layout precedes the bind), so a layout whose
mount never arrives leaves a row `forget` is never told about and the registry sweep cannot
reach — its trigger is the registry *growing*. Rows now get the held set's one-second mount
window and are then **demoted** into it rather than deleted, so a bind that is merely very late
still claims its correction. The window is closed on flush too, because the leaking workload is
a churn that has already stopped. The sweep's trigger now follows the registry *down*. The
Picker-shaped native churn CI asked for exists and covers both routes.

**The 90-minute step is now `scripts/ci-emulator-diagnostics.mjs`:** every command killed at its
own deadline, cheap file evidence first, the step at 5 min and the jobs at 75/60.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1589 tests / 59 suites | `6fa500535009` | 2 m 39 s | start 1.8 / med 4.1 / max 5.0 |
| `harness:ios` | **PASS** | 229 tests / 16 suites | `6fa500535009` (ios tree) | 3 m 50 s | start 4.5 / med 4.6 / max 5.4 |
| `harness:android` | **PASS** | 280 tests / 16 suites | `6fa500535009` (android tree) | 8 m 21 s | start 4.4 / med 3.3 / max 4.6 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:ios:Conformance` | **PASS** | 40 tests / 1 suites | `6fa500535009` (ios tree) | 1 m 28 s | start 2.9 / med 3.4 / max 4.0 |

`need --for review` is satisfied. Locale pair re-recorded on this tree: `NITRO_UI_TEST_LOCALE=en_PT`
fails as designed (`the app runs in en-PT …`), and with `NITRO_UI_ALLOW_LOCALE_MISMATCH=1` it is
`40 passed`. Native: **340 checks**, ASan/UBSan clean.

### Red proofs

- `sizing · a layout that never binds is reclaimed` -> no prune in `measure` -> 5 red, `got 111, want 61`
- same -> reclaim deletes instead of demoting -> 6 red, incl. `a control whose mount was a second late is still corrected`
- same -> a bind stops closing its own window -> `nothing is waiting for a bind any more (got 1024, want 0)`
- same -> the file site stops checking `registry_` -> 4 red, `the window releases a hold whose bind never came`
- `sizing · a flush with nothing to apply still closes windows` -> prune only from `measure` -> `got 10, want 0`
- `sizing · the sweep still runs after the registry has shrunk` -> no gate re-anchor -> 4 red, both sweep cases
- `harness · Sizing · re-shown switch` -> engine back to `fb397d2`, both platforms -> `never reached 100 wide - last box 40.00x20.00`
- `ci-workflows · returns when every tool would hang` -> `timeout: 0` -> the case runs to its own 30 s kill
- same -> partial output discarded on kill -> `Expected substring: "SANDBOX_ADB_HANG devices"`
- same -> a hung command not recorded -> `Expected substring: "incomplete"`
- same -> answer/no-answer tested by prefix -> `<nothing mentions kvm or binder>` on a `sudo` that never answered

### Follow-ups

- android-ci-harness-failure: the `Run Harness tests` failure on `fb397d2` is still unexplained — the job log is to be forwarded; this round changed nothing in that path.
- picker-leak-repro: Picker's leak never reproduced locally (16 iOS + Android Conformance runs); the engine case is the proof, and both platforms are green.
- sizing-stats: `unboundFilingCount()` is C++-only. Surfacing it in `sizingStats()` would let a device rule name the table it is looking at instead of inferring it.

### CI to dispatch

1. Push `task/F8-ci-harness-hosted` and dispatch `ci.yml` — both jobs. Expect the diagnostics artifact inside 5 minutes of the harness step ending, whatever the emulator is doing.
2. If `Picker × no-leak-on-drop` is green, that closes the leak CI saw; if it is red again, `unboundFilingCount()` is the next thing to instrument.
