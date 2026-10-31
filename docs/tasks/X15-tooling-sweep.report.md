# X15 — Tooling and test hygiene sweep

**Branch:** `task/X15-tooling-sweep` (from `main` at `1d97611`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `X15-58alc` (pair-b: iPhone Air / `emulator-5570` / Metro 8293)

## Summary

All seven items are closed.

**1 — Lease/Metro overlap.** `lease.mjs acquire` asks `lsof` what listens on every configured pair's
Metro port *before* it takes the lock, and `decideAcquire` treats a pair whose port is served the way
it treats a leased one: take the quiet pair if there is one, otherwise wait on the port with a reason
naming the pid and program instead of "every pair is already leased" — which sends a task to
`lease.mjs list`, where a stale Metro is invisible. `gate.mjs` asks the same question about the port
its own lease exported, before the build rather than after the app has joined a stranger's Metro, and
refuses naming the process; `NITRO_UI_GATE_METRO_FORCE=1` is the escape hatch for a Metro started on
purpose. A task's own pair is exempt, so re-sourcing an env file mid-suite still works. Both checks
fail open *out loud* where `lsof` cannot answer.

**2 — `test:native:android`.** A `check` step now, and CI's `build-android` job runs it. Warm cost
here: 1.9 s inside `check`, 1.2 s after touching a Kotlin file, 11.5 s with `--rerun-tasks`, 37 s on a
first run that must store its configuration cache — under the brief's 60 s bar at the worst of them,
so `check` and not just CI. It reads `nitrogen/generated` through the library's own autolinking, so
`prepare` (which deletes that tree) waits on it as it does on `test` and `nitrogen:check`. In CI the
script skips when `CI` is set and the Android job runs it: that job has JDK 17, accepted licences and
a gradle cache warmed by a real build, where `checks` has an SDK but no JDK of its own. The skip
names the job that owns the run, so a green `check` row cannot read as "no Kotlin tests ran
anywhere".

**4 — bench platform.** `resolveGate` reads the bench's own `--platform` into a new `benchPlatform`,
and the ledger's `platform`/`device` come from that. `platform` itself stays null for a bench: it is
the field that claims a device, pre-flights Metro and asks for per-suite timings, and a bench does
none of those.

**3, 5, 6, 7.** Menu's read-back test waits for each handle through the file's own `pollUntil` — for a
handle, never for a value, so a wrong prop is exactly as red as before. A reference arm's monotonic
leak cell says "reported, not gated". `example/src/readme-examples.tsx` is check-only tooling.
CONTRIBUTING says `macos-26`, with a test that compares every runner label the doc names against what
the workflows schedule on.

One bug found on the way, and it was mine: `metroPreflight()` returns a number and `runGate` read
`.status` off it, so *every* device gate would have returned `undefined` before starting — exit 0, no
ledger line, nothing built. That is why two of the new CLI cases exist, and they are named in the
red proofs.

## Gates

`need --for review` exits 0 on this code tree ("need: review is satisfied"). `real-input:*` are the
merge-stage bar, not review's.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1470 tests / 54 suites | `a3a7211b9242` | 2 m 39 s | start 2.3 / med 4.4 / max 5.6 |
| `harness:ios` | **PASS** | 223 tests / 15 suites | `a3a7211b9242` (ios tree) | 5 m 46 s | start 1.7 / med 2.9 / max 4.8 |
| `harness:android` | **PASS** | 272 tests / 15 suites | `a3a7211b9242` (android tree) | 7 m 53 s | start 3.7 / med 2.8 / max 3.9 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

Both platforms ran `Menu.harness.tsx` green (15 tests each), which is item 3's evidence: the test now
waits for the three `hybridRef` handles on devices where they used to arrive after the render settled.
The two harness runs were serialised on purpose: pair-b is one device *pair* with one Metro on 8293, so
a concurrent `harness:ios` would collide with `harness:android` on exactly the port item 1 guards (and
item 1's pre-flight is the guard that would say so instead of failing obscurely).

## Red proofs

- `lease-metro-port.test.js` "is not handed out by acquire…" + "refuses when every pair is leased…" +
  "says so once when the machine cannot answer…" -> `const portBlocked = []` in `lease.mjs` -> pair-a
  handed out over a served port; no Metro reason in stderr; no fail-open warning.
- `lease-metro-port.test.js` "makes gate.mjs refuse…" + "runs the gate under
  NITRO_UI_GATE_METRO_FORCE=1" -> `const preflight = 0` in `gate.mjs` -> `expect(second.status).toBe(1)`
  got 0; the forced run recorded no ledger line.
- the same two CLI cases -> `preflight.status !== 0` (the shape first written) -> both red: the run
  never started, nothing was recorded, and the process exited 0 on the silence.
- `check-runner.test.js` "`check:serial` … is exactly what the graph declares" (+3 chain/graph cases)
  -> new step in `CHECK_STEPS`, `check:serial` untouched -> "the chain and the graph are different
  steps".
- `native-tests-android-skip.test.js` "hands the run to CI's Android job…" -> the `CI` guard deleted
  from `native-tests-android.sh` -> the gradle stand-in's args file was written: it ran.
- `native-tests-android-skip.test.js` "really is run by the CI job it hands off to" -> the step
  removed from `build-android` -> job body no longer mentions the script.
- `MenuModelTest.kt` (the test item 2 exists to run) -> `applyPick` closes before it reports ->
  `aPickReportsTheChoiceThenClosesThePopup`, `aPickFromASubmenuOrASection…`,
  `aCloseOnlyReportsTheTransition` red at `MenuModelTest.kt:73/86/122` in 2 s.
- `bench-gate.test.js` "labels a reference arm's monotonic climb as reported, not gated" -> written
  before the fix -> the `expo-ui-host-per-control` cell printed `MONOTONIC (gated as a leak)`.
- `gate.test.js` "treats the check-only allow-list as no platform at all" -> written before the
  mapping -> `isToolingPath('example/src/readme-examples.tsx')` was false.
- `gate.test.js` "takes a bench platform from the bench's own --platform" + "records the bench
  platform's device…" -> written before the fix -> `benchPlatform` was `undefined`, and
  `deviceFromEnv(env, null)` answered `android` for an iOS run.
- `contributing-ci-claims.test.js` "names no runner label that no workflow uses" -> written before the
  doc fix -> the invented list was `["macos-latest"]`.
- item 3 (Menu read-back) waits for a handle rather than adding an assertion, so it has no mutation of
  its own: turning it red would mean breaking the harness's own ref registration. Its evidence is that
  the shape that failed at X14 (`handles.get(...)` read once) is gone from the test, and that both
  platforms stay green below.

## Files changed

- `scripts/lease-core.mjs`, `scripts/lease.mjs`, `scripts/gate.mjs` — the Metro port question and the
  gate's pre-flight; `scripts/__tests__/lease-metro-port.test.js` (new, 27 tests).
- `scripts/check-steps.mjs`, `package.json`, `scripts/check.mjs`,
  `scripts/__tests__/check-runner.test.js` — `test:native:android` as the 17th step.
- `.github/workflows/ci.yml`, `scripts/native-tests-android.sh`,
  `scripts/__tests__/native-tests-android-skip.test.js` — who runs it in CI, and the skips.
- `example/__tests__/Menu.harness.tsx` — `waitForHandle`, used by the read-back test.
- `scripts/gate-core.mjs`, `scripts/__tests__/gate.test.js` — `benchPlatform`, the tooling mapping.
- `scripts/bench/render.mjs`, `scripts/__tests__/bench-gate.test.js` — the leak-cell label.
- `CONTRIBUTING.md`, `scripts/__tests__/contributing-ci-claims.test.js`, `docs/tasks/FOLLOWUPS.md`.

## Follow-ups

- `check`'s new step needs an NDK the first time it configures (`prepareHeaders` runs): on a machine
  with an SDK and no NDK it fails rather than skipping. Left alone — CI installs the NDK and so does
  every device host.
- `scripts/native-tests-android.sh` runs `:react-native-nitro-ui:testDebugUnitTest` only; the example
  app's own JVM tests, if any are ever added, sit outside it.
- Metro and the bench: `scripts/bench/devices.mjs:10` records that a release build embeds the bundle
  and ignores `METRO_PORT`, so a bench never joins a Metro and item 1's pre-flight is correctly not
  applied to it. If a debug-build bench is ever wanted, that is the line that changes.
- The two `?:` reads in Menu's read-back test (`named?.title`) are now dead `?.` on a non-optional
  value; harmless, and left so the diff stays the three lines that matter.
