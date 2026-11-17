# X53 — do the root unit tests run faster on Vitest than on Jest?

**Branch:** `task/X53-vitest-trial` (from the X52 branch at `7d333db7`, which starts from `main` at
`589733b6`) · **Round:** 1 of up to 3 · **Lease:** none (no devices)

## Summary

**Where Jest's time goes.** Test bodies are 529 s of the 558 s of summed suite time (95 %). The
runner (start-up, transform, module loading) is about 30 s summed, roughly 3 s of wall time. The
wall time is one file: `bench-gate.test.js` is pure CPU, 69.5 s alone on Jest, 13.9 s on Vitest
`forks` and 68 s on Vitest `vmForks`. Jest's per-file `vm` context makes CPU-heavy code about 5×
slower (`bench-compare` also drops from 15.1 s to 2.2 s). The other slow files wait on child
processes and timers, and they take the same time on both runners.

**What ran.** All 65 tooling files (1829 tests) and all 28 library files (270 tests) pass on Vitest
5.1.0. The library files run through `vitest-native` 0.15.1, the only plugin that claims RN 0.88
support. Nothing was skipped. The ports are import lines, `isolateModules` →
`resetModules` plus `import()`, Vitest's `describe`/`it` for the RuleTester, `VITEST_WORKER_ID` as
a runner marker in `doctor-core.mjs`, the root mock as an alias, `SourceCode` set through
`mockNativeModule`, and a probe on `View`, because the real `Text` prepends a style. One
`check-runner` test guarded a constraint the move removes; it now asserts the new state.

**Decision for review: a 30 s timeout on the tooling project.** Jest never times out a synchronous
test; Vitest does (vitest#2920). Before the timeout, 6 of 12 Vitest runs went red on `spawnSync`
tests that overran 5 s under load; with it, 13 of 13 were green. The cost: a hung async tooling
test takes 30 s to fail.

**Recommendation: move the tooling suites only.**
- **Tooling only:** unit tests go from 76 s to about 57 s, and `check` from 89 s to 57 s (medians).
  Cost: two runners (Jest stays for `src` and reassure), `vite` and `vitest`, and the timeout.
- **Everything:** the library group goes from 4.0 s to 2.2 s, but it is off `check`'s critical
  path. Cost: a pre-1.0, single-maintainer plugin pinned to RN 0.86–0.88, with its own mock API.
- **Stay on Jest:** costs nothing, but `check` keeps paying 20–30 s. Splitting
  `bench-gate.test.js` would recover most of that.

After the move, `check` is bounded by `gate.test.js` (about 55 s) and `test:native` (52–71 s),
which run side by side. The branch tip is "everything". For "tooling only", drop `9dc9e8b9` and
keep the timeout in a flat config.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 8 tests / 8 suites | `9ea147a1d91e` | 1 m 06 s | start 7.4 / med 13.1 / max 34.6 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

`need --for review`: `need: 2 gate(s) missing for review: harness:ios, harness:android`. They are
owed only because the diff from `main` touches `package.json` and `bun.lock`. This brief has no
devices, so they are left for whoever lands the change.

## Time table

The median of three interleaved runs on this machine (10 cores, shared with other tasks). The load is
load1 just before each run. The Jest runs are on `1a1ede07` and the Vitest runs on `53fc2166`; the
"tooling only" `check` is on `8d0c7bc5`.

| What | Jest runs (s) | Jest median | Vitest runs (s) | Vitest median |
| --- | --- | --: | --- | --: |
| Tooling group (65 files) | 72.2 @12.3, 73.2 @16.0, 75.6 @37.7 | **73.2** | 59.3 @15.4, 57.3 @9.2, 54.3 @14.0 | **57.3** |
| Library group (28 files) | 4.0 @10.8, 3.6 @14.5, 5.9 @6.4 | **4.0** | 2.7 @9.0, 2.2 @8.6, 2.0 @9.7 | **2.2** |
| All unit tests (93 files) | 76.1 @11.9, 75.9 @13.8, 118.3 @7.5 | **76.1** | 62.8 @9.5, 69.1 @8.6, 55.4 @10.2 | **62.8** |
| `bun run check`, tooling only on Vitest | 111.6 @19.6, 87.9 @14.8, 89.2 @13.3 | **89.2** | 57.2 @14.5, 56.0 @20.6, 63.9 @8.3 ¹ | **57.2** |
| `bun run check`, everything on Vitest | (same Jest runs) | **89.2** | 71.4 @8.4, 90.4 @24.6, 65.6 @7.4 | **71.4** |

¹ Taken before the tooling timeout, and the third run was red on a 5 s timeout. In `check`, the
`test` step runs beside `test:native` (49–71 s in every run), so the two Vitest variants differ by
load, not by design.

Commands and summary lines:
- `npx jest scripts eslint-rules` → `Tests: 1829 passed, 1829 total`
- `npx jest src` → `Tests: 270 passed, 270 total`
- `npx jest` → `Tests: 2099 passed, 2099 total`
- `npx vitest run --project tooling` → `Tests  1829 passed (1829)`
- `npx vitest run --project library` → `Tests  270 passed (270)`
- `npx vitest run` → `Tests  2099 passed (2099)`
- `bun run check` → `check: 17 passed, 0 failed` (18 on `8d0c7bc5`)

### Ten slowest suites (Jest, full run at load 8.9 rising to 49)

| Suite | Jest total s | Jest test bodies s | Vitest s |
| --- | --: | --: | --: |
| `scripts/__tests__/bench-gate.test.js` | 83.0 | 81.4 | 15.3 |
| `scripts/__tests__/gate.test.js` | 67.4 | 65.2 | 57.7 |
| `scripts/__tests__/gate-logs.test.js` | 65.7 | 63.5 | 51.3 |
| `scripts/__tests__/gate-runner.test.js` | 51.3 | 49.1 | 48.5 |
| `scripts/__tests__/lease-pool-cli.test.js` | 41.1 | 39.7 | 38.2 |
| `scripts/__tests__/gate-rerun.test.js` | 35.3 | 35.0 | 30.2 |
| `scripts/__tests__/lease-metro-port.test.js` | 28.8 | 28.7 | 21.8 |
| `scripts/__tests__/gate-evidence.test.js` | 22.8 | 22.4 | 17.9 |
| `scripts/__tests__/bench-compare.test.js` | 15.2 | 15.1 | 2.2 |
| `scripts/__tests__/example-lock.test.js` | 13.3 | 13.0 | 12.0 |

All 93 suites are listed in the appendix.

## Red proofs

- `test-env-scrub` "hands a child that was given no `env` an environment with no lease in it" -> drop `globalSetup` from `vitest.config.mjs` and run with `NITRO_UI_LEASE_ID` exported -> that test and "is the setup vitest is configured to run" fail; both pass with it restored.
- `gate-lease-required` "refuses a leased device gate, runs nothing and records nothing" -> `freeDiskGbFrom` reads only `JEST_WORKER_ID` -> 3 failed, among them "inside a test, asks only the cases that name a value".
- `check-runner` "only `perf:renders` writes Jest cache, so `test` may run beside it" -> `test` back in group `jest`, writing `jest-cache` -> `Tests  1 failed | 38 passed (39)`.
- `formRowAlignment` "is flex-start outside a row and center inside one" -> `SELF_SIZING_IN_ROW_STYLE` set to `flex-start` -> that test and 2 others under `Form.Row` fail.
- `rowAndroidIcon` "resolves an asset to the dev-server string and never sends the id" -> `mockNativeModule('SourceCode', …)` removed from `withDevServer` -> `Tests  2 failed | 7 passed (9)`.
- tooling `testTimeout` -> absent -> `Error: Test timed out in 5000ms.` in `gate-logs`, `watchdog`, `lease-pool-cli` and `native-tests-android-skip`, in 6 of 12 runs.

## Files changed

- `vitest.config.mjs`: the `tooling` and `library` projects, `globalSetup`, the nitro-modules alias.
- `package.json`, `bun.lock`: `vite` 8.3.8, `vitest` 5.1.0, `vitest-native` 0.15.1 (exact). `test` runs `vitest run`, and Jest's `testMatch` covers only `*.perf-test.*`.
- `scripts/check-steps.mjs`: the `test` step is Vitest and leaves the `jest` group.
- `scripts/doctor-core.mjs`: `VITEST_WORKER_ID` is a runner marker.
- `scripts/__tests__/helpers/test-global-setup.js`: renamed from `jest-global-setup.js`.
- `scripts/__tests__/*.test.js`, `eslint-rules/__tests__/rules.test.js`, `src/__tests__/*`: the ports.
- `CONTRIBUTING.md`: the `bun run test` row.

## Follow-ups

- gate: `check`'s Counts column parses Jest summaries, so after the move it counts only reassure's 8 tests.
- tests: `gate.test.js` (about 58 s) and `gate-logs.test.js` (about 51 s) are now the floor; splitting them would shorten either runner.
- tests: `bench-gate.test.js` is the whole of Jest's wall time; splitting it would gain most of the saving without a move.
- scripts: the "no `import.meta` so Jest can import it" constraints (`scripts/check-steps.mjs`, `scripts/bench/render.mjs`) can be lifted once tooling leaves Jest.
- tests: the `test-env-scrub` describe title and the `free-lsof-stub.js` comment still say jest.

## Questions for orchestrator

- Which option lands after X52: tooling only (recommended), everything, or stay? The 30 s tooling timeout comes with either move.

## Appendix: every suite

The Jest full run was at load 8.9 rising to 49; the Vitest run (`vitest-all` before the timeout
change) at load 22. Paths are from the repo root.

| Suite | Jest total s | Jest test bodies s | Vitest s |
|---|--:|--:|--:|
| `scripts/__tests__/bench-gate.test.js` | 83.0 | 81.4 | 15.3 |
| `scripts/__tests__/gate.test.js` | 67.4 | 65.2 | 57.7 |
| `scripts/__tests__/gate-logs.test.js` | 65.7 | 63.5 | 51.3 |
| `scripts/__tests__/gate-runner.test.js` | 51.3 | 49.1 | 48.5 |
| `scripts/__tests__/lease-pool-cli.test.js` | 41.1 | 39.7 | 38.2 |
| `scripts/__tests__/gate-rerun.test.js` | 35.3 | 35.0 | 30.2 |
| `scripts/__tests__/lease-metro-port.test.js` | 28.8 | 28.7 | 21.8 |
| `scripts/__tests__/gate-evidence.test.js` | 22.8 | 22.4 | 17.9 |
| `scripts/__tests__/bench-compare.test.js` | 15.2 | 15.1 | 2.2 |
| `scripts/__tests__/example-lock.test.js` | 13.3 | 13.0 | 12.0 |
| `scripts/__tests__/check-runner.test.js` | 13.1 | 12.8 | 13.7 |
| `scripts/__tests__/gate-lease-required.test.js` | 12.6 | 12.4 | 13.2 |
| `scripts/__tests__/task-records.test.js` | 11.1 | 10.8 | 11.3 |
| `scripts/__tests__/gate-check.test.js` | 10.6 | 10.4 | 9.7 |
| `scripts/__tests__/device-ops.test.js` | 10.2 | 10.1 | 14.7 |
| `scripts/__tests__/watchdog.test.js` | 8.6 | 8.5 | 7.7 |
| `scripts/__tests__/lease.test.js` | 7.4 | 7.3 | 5.7 |
| `scripts/__tests__/native-tests-android-skip.test.js` | 7.0 | 6.9 | 8.8 |
| `scripts/__tests__/worktrees.test.js` | 6.8 | 6.7 | 4.7 |
| `scripts/__tests__/bench-dry-run.test.js` | 6.2 | 5.7 | 3.5 |
| `scripts/__tests__/ci-workflows.test.js` | 5.5 | 5.4 | 4.3 |
| `src/__tests__/host.test.tsx` | 4.8 | 0.1 | – |
| `scripts/__tests__/gate-digests.test.js` | 4.6 | 4.0 | 2.6 |
| `scripts/__tests__/registry.test.js` | 3.5 | 1.8 | 1.4 |
| `scripts/__tests__/build-slot.test.js` | 3.2 | 3.1 | 3.1 |
| `scripts/__tests__/device-pool.test.js` | 2.0 | 0.3 | 0.3 |
| `scripts/__tests__/real-input-reveal.test.js` | 1.9 | 1.8 | 1.8 |
| `scripts/__tests__/patch-nitrogen.test.js` | 1.8 | 1.7 | 1.8 |
| `scripts/__tests__/conformance.test.js` | 1.7 | 0.2 | 0.1 |
| `scripts/__tests__/bench-missing-samples.test.js` | 1.7 | 0.1 | 0.0 |
| `scripts/__tests__/lease-queue.test.js` | 1.5 | 1.3 | 1.2 |
| `scripts/__tests__/app-stamp.test.js` | 1.0 | 0.9 | 0.7 |
| `eslint-rules/__tests__/rules.test.js` | 0.9 | 0.1 | 0.1 |
| `scripts/__tests__/harness-isolated.test.js` | 0.7 | 0.7 | 0.7 |
| `src/__tests__/materialTheme.test.ts` | 0.4 | 0.4 | – |
| `src/__tests__/iconButton.test.tsx` | 0.4 | 0.1 | – |
| `scripts/__tests__/test-env-scrub.test.js` | 0.4 | 0.3 | 0.2 |
| `src/__tests__/NitroUiCore.test.ts` | 0.3 | 0.3 | – |
| `scripts/__tests__/harness-suite-timing.test.js` | 0.3 | 0.1 | 0.1 |
| `src/__tests__/harnessHandles.test.ts` | 0.2 | 0.2 | – |
| `scripts/__tests__/real-input-a11y-ios.test.js` | 0.2 | 0.1 | 0.0 |
| `src/__tests__/formRowAlignment.test.tsx` | 0.2 | 0.0 | – |
| `src/__tests__/iconSource.test.ts` | 0.2 | 0.0 | – |
| `scripts/__tests__/component-coverage.test.js` | 0.2 | 0.1 | 0.1 |
| `src/__tests__/iconName.test.tsx` | 0.1 | 0.0 | – |
| `scripts/__tests__/pod-serialisation.test.js` | 0.1 | 0.0 | 0.0 |
| `src/__tests__/popover.test.tsx` | 0.1 | 0.1 | – |
| `src/__tests__/useSizingId.test.tsx` | 0.1 | 0.0 | – |
| `src/__tests__/picker.test.tsx` | 0.1 | 0.0 | – |
| `scripts/__tests__/build-speed.test.js` | 0.1 | 0.0 | 0.0 |
| `scripts/__tests__/task-ready.test.js` | 0.1 | 0.0 | 0.0 |
| `src/__tests__/hostInertStyles.test.tsx` | 0.1 | 0.0 | – |
| `src/__tests__/textField.test.tsx` | 0.1 | 0.0 | – |
| `src/__tests__/hostLayoutWarning.test.tsx` | 0.1 | 0.0 | – |
| `src/__tests__/hostReport.test.tsx` | 0.1 | 0.0 | – |
| `src/__tests__/segmentedControl.test.tsx` | 0.1 | 0.0 | – |
| `src/__tests__/rowAndroidIcon.test.tsx` | 0.1 | 0.0 | – |
| `scripts/__tests__/real-input-a11y.test.js` | 0.1 | 0.0 | 0.0 |
| `src/__tests__/buttonGroup.test.tsx` | 0.1 | 0.0 | – |
| `src/__tests__/checkbox.test.tsx` | 0.1 | 0.0 | – |
| `src/__tests__/buttonSizingKey.test.tsx` | 0.1 | 0.0 | – |
| `scripts/__tests__/real-input-suite.test.js` | 0.1 | 0.0 | 0.0 |
| `scripts/__tests__/bench-deps.test.js` | 0.1 | 0.0 | 0.0 |
| `scripts/__tests__/changesets.test.js` | 0.1 | 0.0 | 0.0 |
| `src/__tests__/menuSizingKey.test.tsx` | 0.1 | 0.0 | – |
| `scripts/__tests__/android-icons.test.js` | 0.1 | 0.0 | 0.0 |
| `scripts/__tests__/doctor.test.js` | 0.1 | 0.0 | 0.0 |
| `src/__tests__/stepper.test.tsx` | 0.1 | 0.0 | – |
| `src/__tests__/progressSizingKey.test.tsx` | 0.1 | 0.0 | – |
| `src/__tests__/form.test.tsx` | 0.1 | 0.0 | – |
| `scripts/__tests__/readme-components.test.js` | 0.1 | 0.0 | 0.0 |
| `scripts/__tests__/real-input-calendar.test.js` | 0.1 | 0.0 | 0.0 |
| `scripts/__tests__/release-catch-up.test.js` | 0.1 | 0.0 | 0.0 |
| `src/__tests__/useControlled.test.tsx` | 0.1 | 0.0 | – |
| `src/__tests__/viewConfigs.test.ts` | 0.1 | 0.0 | – |
| `scripts/__tests__/ci-harness-config.test.js` | 0.1 | 0.0 | 0.0 |
| `src/__tests__/dialog.test.tsx` | 0.1 | 0.0 | – |
| `src/__tests__/useStableCallback.test.tsx` | 0.1 | 0.0 | – |
| `scripts/__tests__/emulator-launch.test.js` | 0.1 | 0.0 | 0.0 |
| `scripts/__tests__/bench-drive.test.js` | 0.1 | 0.0 | 0.0 |
| `scripts/__tests__/bench-machine.test.js` | 0.1 | 0.0 | 0.0 |
| `scripts/__tests__/real-input-tab-targets.test.js` | 0.1 | 0.0 | 0.0 |
| `scripts/__tests__/real-input-ime-frame.test.js` | 0.0 | 0.0 | 0.0 |
| `scripts/__tests__/smoke-ready-line.test.js` | 0.0 | 0.0 | 0.0 |
| `scripts/__tests__/app-launch-env.test.js` | 0.0 | 0.0 | 0.0 |
| `scripts/__tests__/uitests-sources.test.js` | 0.0 | 0.0 | 0.0 |
| `scripts/__tests__/real-input-popover-placement.test.js` | 0.0 | 0.0 | 0.0 |
| `scripts/__tests__/real-input-android-tree.test.js` | 0.0 | 0.0 | 0.0 |
| `scripts/__tests__/real-input-ios-log.test.js` | 0.0 | 0.0 | 0.0 |
| `scripts/__tests__/harness-run-state.test.js` | 0.0 | 0.0 | 0.0 |
| `scripts/__tests__/pod-install.test.js` | 0.0 | 0.0 | 0.0 |
| `scripts/__tests__/bench-device-key.test.js` | 0.0 | 0.0 | 0.0 |
| `scripts/__tests__/real-input-gesture-echo.test.js` | 0.0 | 0.0 | 0.0 |
