# X15 — Tooling and test hygiene sweep

**Branch:** `task/X15-tooling-sweep` (from `main` at `1d97611`) · **Rounds:** 1 + fix round 1 of 2 (D19) ·
**Lease:** `X15-58alc` (round 1), `X15-9xz8i` (fix round 1) — both pair-b: iPhone Air / `emulator-5570` / Metro 8293

## Summary

All seven items are closed.

**1 — Lease/Metro overlap.** `lease.mjs acquire` asks `lsof` what listens on every configured pair's
Metro port *before* it takes the lock, and `decideAcquire` treats a pair whose port is served the way
it treats a leased one: take the quiet pair, otherwise wait with a reason naming the pid and program
instead of "every pair is already leased" — which sends a task to `lease.mjs list`, where a stale Metro
is invisible. `gate.mjs` asks the same question about the port its own lease exported, before the build
rather than after the app has joined a stranger's Metro, and refuses naming the process;
`NITRO_UI_GATE_METRO_FORCE=1` is the escape hatch for one started on purpose. A task's own pair is
exempt. Both fail open *out loud* where `lsof` cannot answer.

**2 — `test:native:android`.** A `check` step now, and CI's `build-android` job runs it. Warm cost
here: 1.9 s inside `check`, 1.2 s after touching a Kotlin file, 11.5 s with `--rerun-tasks`, 37 s for a
first run that stores its configuration cache — under the brief's 60 s bar at the worst of them, so
`check` and not just CI. It reads `nitrogen/generated` through the library's own autolinking, so
`prepare` (which deletes that tree) waits on it as it does on `test` and `nitrogen:check`. In CI the
script skips for a job that has no JDK of its own and an empty gradle cache, and `build-android` —
JDK 17, licences, a cache warmed by a real build — opts in and runs it. *(Fix round 1: as first
shipped the skip caught `build-android` too, so CI ran no Kotlin tests; see below.)*

**4 — bench platform.** `resolveGate` reads the bench's own `--platform` into a new `benchPlatform`,
which the ledger's `platform`/`device` now use. `platform` itself stays null for a bench: it claims a
device, pre-flights Metro and asks for per-suite timings, and a bench does none of those.

**3, 5, 6, 7.** Menu's read-back test waits for each handle through the file's own `pollUntil` — for a
handle, never a value, so a wrong prop is exactly as red as before. A reference arm's monotonic leak
cell says "reported, not gated". `example/src/readme-examples.tsx` is check-only tooling. CONTRIBUTING
says `macos-26`, with a test comparing every runner label the doc names against the workflows'.

One bug found on the way was mine: `runGate` read `.status` off the number `metroPreflight()` returns,
so every device gate would have exited 0 having run nothing.

## Gates

`need --for review` exits 0 on this code tree ("need: review is satisfied"). Fix round 1 also ran the
merge-stage gates, in the order the merge runs them, so all five rows below are this tree's.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1480 tests / 54 suites | `24974b5e0603` | 3 m 09 s | start 2.5 / med 14.5 / max 25.3 |
| `harness:ios` | **PASS** | 223 tests / 15 suites | `24974b5e0603` (ios tree) | 3 m 37 s | start 2.2 / med 2.3 / max 5.8 |
| `harness:android` | **PASS** | 272 tests / 15 suites | `24974b5e0603` (android tree) | 7 m 43 s | start 4.7 / med 2.7 / max 4.8 |
| `real-input:ios` | **PASS** | — | `24974b5e0603` (ios tree) | 15 m 60 s | start 31.3 / med 6.7 / max 56.7 |
| `real-input:android` | **PASS** | — | `24974b5e0603` (android tree) | 20 m 51 s | start 4.7 / med 2.3 / max 5.6 |

All five ran on lease `X15-9xz8i`, serially, with no `NITRO_UI_GATE_METRO_FORCE` anywhere: pair-b is one
device *pair* with one Metro on 8293, so two of them at once would collide on exactly the port item 1
guards. The order above is the merge's order (`real-input:ios` → `real-input:android` → `harness:ios` →
`harness:android`), which is the sequence item 2 of the fix round had to make work.

Both platforms ran `Menu.harness.tsx` green (15 tests each), which is item 3's evidence: the test now
waits for the three `hybridRef` handles on devices where they used to arrive after the render settled.
The collision's signature — `The app bridge was replaced by a newer app connection`, three lost device runs
in the incident FOLLOWUPS records — is what `metroPortReason` prints when it refuses, so a refusal names
both the process and the failure it prevented.

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

Fix round 1 adds `scripts/__tests__/helpers/free-lsof-stub.js` (the shared "port is free" stub) and
touches `scripts/gate.mjs`, `scripts/gate-core.mjs`, `scripts/lease-core.mjs`, `scripts/lease.mjs`,
`scripts/native-tests-android.sh`, `scripts/check-steps.mjs`, `CONTRIBUTING.md`, `ci.yml` and the
five suites named in the red proofs.

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

## Fix round 1

**1 — the Kotlin tests never ran in CI.** Actions sets `CI=true` on every step, so the skip fired in
the job it named. The opt-out is per job: `build-android`'s step sets `NITRO_UI_ANDROID_JVM_TESTS=1`,
and the handoff test reads that step's `env:` from `ci.yml`, runs the script with it under `CI=true`,
asserting gradle is reached — red against the shipped script, which printed the skip.

**2 — the merge sequence blocked itself.** Each gate now stops a listener on its own leased port
afterwards; ownership is the child's process group (`ps eww` truncates env blocks, and the safe branch
past the cut is the leak). Sweep off -> the leak case times out at 90 s with no ledger line; ownership
widened -> a case names the stranger's server it killed. Then four gates, in order.

**3** An exclusive acquire names the port and proceeds instead of waiting an hour on a Metro a bench
never touches; non-exclusive keeps the guard — each red against the other's rule. **4** The bench row
is tested through the CLI: reverting `?? benchPlatform` reads `platform: android`. **5** `writes`
names `android/build`; stale JSDoc gone; daemon stays (0.9 s, not 4.4 s). Proofs are in the
appendix below.

## Appendix — red proofs (fix round 1)

Kept out of the fix-round section above, which has a 200-word bar. Twelve rows are recorded in
`docs/tasks/X15/mutations.json` under `fixRound1`; the one-line form:

- `native-tests-android-skip.test.js` "runs for real in the CI job it hands off to…" -> the CI guard
  as shipped (`CI` alone) -> the skip line, and `gradleArgs` null.
- the same test, first cut -> the parser could not step over the comment above `env:` -> `envIndex`
  was `-1`; fixed, then red again against the old script for the right reason.
- `lease-metro-port.test.js` "stops the Metro its own run left…" -> sweep disabled -> 90 s timeout,
  no ledger line; and -> `ownMetroPids` claiming nothing -> same.
- `lease-metro-port.test.js` "leaves a Metro in another process group alone" -> `ownMetroPids`
  claiming every listener -> the run reports stopping a server it must not touch.
- `lease-metro-port.test.js` "lets an exclusive acquire proceed…" -> the round-1 wait restored ->
  `ok` was false; "takes the quiet pair…" + "is not handed out by acquire…" -> the exception widened
  to every acquire -> both red.
- `gate.test.js` "records a bench's platform and device from its own --platform" -> `?? resolved.
  benchPlatform` reverted -> `Expected: "ios", Received: "android"`.
- `lease-metro-port.test.js` "leaves a run with no METRO_PORT alone" -> the pre-flight moved outside
  the `platform != null` guard -> `check` refused with a busy `METRO_PORT`: exit 1, not 0.
- `check-runner.test.js` "says where the Kotlin step writes…" -> `writes` back to
  `example/android/build` alone -> the arrayContaining misses `android/build`.
- `lease.test.js` (six cases) -> the new helper pointed at `/usr/sbin/lsof` -> pair-a's port served
  by another worktree's harness, which is the failure the helper exists to prevent.
