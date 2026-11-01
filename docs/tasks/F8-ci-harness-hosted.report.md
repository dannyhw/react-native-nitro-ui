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
