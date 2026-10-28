# X11 — Device throughput: emulator GPU, warm device pool, harness timing

**Branch:** `task/X11-device-throughput` (from `main` at `20b4069`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `X11-ubeub` (`pair-a`: `emulator-5574` / `49D5024D-967B-4B93-ACF6-F73BA0A19E9F` / Metro `8295`)

## Summary

Everything here is device plumbing. No shipped code and no example-app source changed — the only
file outside `scripts/` and `docs/` is `example/rn-harness.config.mjs`, which registers a plugin
when an env var names a file.

**One launch configuration** (`scripts/emulator-launch.mjs`): the harness patch, the lease pool and
real-input all take their emulator argv from it, so GPU mode and `-port` no longer depend on which
launcher booted the device first. The patch embeds the rendered blocks verbatim and a drift test
compares patch, installed copy and source. `-gpu host` replaces the harness's hard-coded software
rendering; `NITRO_UI_EMULATOR_GPU` overrides it for a bench host or an A/B run. The same patch's
accel check now reads `emulator -accel-check`'s exit status: the phrase it looked for stopped being
printed, so the check reported the device unusable on every Android run here while it was using
Hypervisor.Framework.

**Per-suite timing:** a harness plugin writes `.gates/suite-timing/<gate>-*.json` as each file
finishes, the ledger carries it (`LEDGER_VERSION` 3), `gate.mjs table --full` prints it. It paid for
itself immediately — the first version summed `result.testResults`, a field the harness does not
return, so every suite reported 0 tests and the whole restart/test-body split was silently wrong.

**A warm device pool the lease owns** (`scripts/device-pool.mjs`): `acquire --boot` boots what is
down, waits for the load to settle, resets the app; `release` leaves devices up; reaping (idle past
`idleShutdownMinutes`) runs from the lease commands people already type, with no daemon. A gate
claims its lease's devices for the duration of the run, so a reap cannot power off an emulator
mid-suite and a second gate aimed at the same device is refused before it starts. A claim is a pid,
so a killed gate wedges nothing. Two bugs came out of running it rather than faking it: a claim
record that carried no serial made a live emulator read as "already off" and dropped it from the
pool, and `pm clear` answers `Failed` for a few seconds on an emulator that has just attached, so
the reset now retries and quotes the device's own answer.

Benches are deliberately unchanged and say why (`BENCH_GPU_MODE_NOTE`). Concurrent harnesses are
measured and **not recommended** — see item 5.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 766 tests / 37 suites | `9d9ce869206a` | 2 m 54 s | start 4.6 / med 2.9 / max 4.6 |
| `harness:ios` | **PASS** | 165 tests / 13 suites | `9d9ce869206a` (ios tree) | 1 m 59 s | start 3.3 / med 5.5 / max 7.1 |
| `harness:android` | **PASS** | 214 tests / 13 suites | `9d9ce869206a` (android tree) | 6 m 05 s | start 2.4 / med 2.1 / max 3.0 |
| `real-input:ios` | **FAIL** | — | `9d9ce869206a` (ios tree) | 10 m 47 s | start 2.1 / med 3.8 / max 15.7 |
| `real-input:android` | **PASS** | — | `9d9ce869206a` (android tree) | 12 m 02 s | start 2.3 / med 2.1 / max 3.6 |

`need --for review`: `need: review is satisfied on this code tree.`
`need --for merge`: `need: 1 gate(s) missing for merge: real-input:ios` — see Questions.

## Measurements

### Item 1 — `-gpu swiftshader_indirect` vs `-gpu host`

Same code tree (`de2e62c20e78`), same device (`emulator-5574`), one lease, both legs full suite.

| GPU mode | Wall | load1 median | load1 max | Differing results |
| --- | --- | --- | --- | --- |
| `swiftshader_indirect` (upstream default) | 398.7 s | 6.97 | 18.91 | none — 214/214 |
| `host` (now the default) | 378.5 s | 3.42 | 11.86 | none — 214/214 |

5.1 % off the wall and half the median load, with identical results, so no test was re-baselined.
The CPU the emulator stops spending on rendering is the point.

The false acceleration warning, measured rather than asserted: this machine's
`emulator -accel-check` prints `accel:` / `0` / `Hypervisor.Framework OS X Version 26.6`, which does
not contain the only phrase upstream tested for (`is installed and usable`), so upstream's
`isAccelerationUsable` returned `false` on every run here — while `-accel-check` was exiting 0 and
the device was using HVF. The patched version returns `true` for the same text.

### Item 3 — where the Android harness's time goes

`harness:android` on the final tree, from the plugin: 360.6 s run, 351.0 s inside files, 9.6 s
outside any file (boot, Metro handshake, hand-off).

| Suite | File | Test bodies | Restart + handshake | Tests |
| --- | --- | --- | --- | --- |
| `__tests__/Host.harness.tsx` | 113.4 s | 112.6 s | 0.8 s | 21 |
| `__tests__/HostControls.harness.tsx` | 87.1 s | 86.1 s | 1.1 s | 24 |
| `__tests__/MountChurn.harness.tsx` | 37.6 s | 35.0 s | 2.6 s | 5 |
| `__tests__/HostPopups.harness.tsx` | 34.5 s | 33.6 s | 0.9 s | 24 |
| `__tests__/Picker.harness.tsx` | 13.2 s | 12.5 s | 0.8 s | 24 |

Answer to the brief's question: **test bodies, not restarts and not waits** — five files are 82 %
of the suite and each one's app restart is about a second. `Host` and `HostControls` alone are
200 s, which is why the suite reads 6 minutes. iOS for comparison: 112.5 s run, 106.4 s in files,
96.8 s bodies, slowest file `Host` at 17.0 s. Report only; the suites are out of scope.

### Item 5 — concurrent harnesses, measured

Same lease, same warm pair, same tree, four runs:

| Shape | `harness:android` | `harness:ios` |
| --- | --- | --- |
| one after the other | 365.3 s PASS, load1 med 2.14 / max 3.0 | 118.9 s PASS, med 5.5 / max 7.1 |
| at the same time | 362.3 s PASS, load1 med 3.54 / max 4.8 | **123.8 s FAIL** (4 tests), med 4.2 / max 4.8 |

No throughput gain — Android's wall is unchanged and iOS's is not shorter — and the iOS leg loses
four tests. The failures are not load: all four are
`timing gate for "…" cannot be trusted: http://localhost:8296/harness-timing/state.json was
published for Metro port 8295, not this run's 8296`. The timing gate's machine-state file is one
path per project, so two runs in flight poison each other and the gate correctly refuses to judge
them. **Recommendation: against concurrency**, as a default and as an invitation — it costs a red
gate until `harness-timing/state.json` is per run (Follow-ups). Not changed here; the brief says
report.

### Item 6 — quieter iOS simulators (one attempt, bounded)

Four cold boots of the pool simulator: `load1` peaks of **58.5 / 64.6 / 72.2 / 74.3**, back to
16–21 after 150 s and still above the bench's settle ceiling of 5 — not the 100–165 the brief's
background assumed, and not four to six minutes either. (AGENTS.md and CONTRIBUTING.md now say
this instead of the assumed numbers.)

An ownership probe during a boot put **68 %** of top-process CPU inside the device
(`MercuryPosterExtension`, `GradientPosterExtension`, `WidgetRenderer_Default`, a device-side
`diagnosticd`); the rest is host-side per-device work (`launchd_sim`, host `diagnosticd`,
`launchservicesd`) that nothing inside the simulator can reach.

The one attempt the brief allows: `simctl spawn <udid> launchctl disable user/501/<label>` for the
hot labels that device's own launchd lists (`PosterBoard`, `corespotlightservice`,
`spotlightknowledged`, `spotlightknowledged.updater`, `diagnosticextensionsd`) — `gui/501/…` is not
a target the simulator's launchd recognises, which is why the first probe looked like a no-op — each
one confirmed in `print-disabled user/501`, then a matched pair of boots:

| Leg | Peak load1 | After 150 s | Samples ≥ 5 |
| --- | --- | --- | --- |
| all enabled (as the pool hands it out) | 72.2 | 21.2 | 14 / 15 |
| five labels disabled | 74.3 | 17.5 | 15 / 15 |

No improvement, inside the noise (and the sampler's own `node` peak was comparable in both legs,
215 % vs 201 %). Not adopted, and reverted: all five labels are confirmed `enabled` in the device
again, so the pool simulator is left exactly as found.

## Red proofs

All of these were re-run against `da0b31f` (the code tree above), each one a single edit reverted
after the ✕; a case whose mutation could not be applied is marked as not claimed.

- `boots on host GPU rendering` -> `HARNESS_GPU_MODE = 'swiftshader_indirect'` -> `✕ boots on host GPU rendering, not the software default`
- `honours the gpu override` -> `gpuMode ?? HARNESS_GPU_MODE` (env read dropped) -> `✕ honours the gpu override an A/B run or a bench host uses`
- `names the port, snapshot and gpu args` -> `-port` never pushed -> `✕ names the port, snapshot and gpu args in one argv`
- `drops a port the emulator could not take` -> port-range check removed -> `✕ drops a port the emulator could not take rather than booting anywhere`
- `trusts a non-zero exit over confident-sounding output` -> exit status consulted only on empty output -> `✕ trusts a non-zero exit over confident-sounding output`
- `accepts this machine output, which upstream called unusable` -> success phrase back to `is installed and usable` -> `✕ accepts this machine output, which upstream called unusable`
- `reads a failure phrase before a success phrase` -> failure list ignored -> `✕ reads a failure phrase before a success phrase`
- `puts the rendered launch block in the patch, verbatim` -> `harnessLaunchBlock` renamed -> `✕ puts the rendered launch block in the patch, verbatim` (drift: the patch no longer contains it)
- `counts tests nested in describe blocks` -> back to reading `result.testResults` -> `✕ counts tests nested in describe blocks, not just the top level`
- `counts a failed file without dropping its timing` -> `durationMs: null` unless `status === 'passed'` -> `✕ counts a failed file without dropping its timing`
- `is off unless the file is named` -> `suiteTimingFromEnv` always returns a file -> `✕ is off unless the file is named`
- `never reaps a device whose claim is live` -> busy check bypassed in `poolReapDecision` -> `✕ never reaps a device whose claim is live, however idle the clock says it is`
- `treats a claim from a dead pid as no claim` -> `deviceIsBusy` counts any claim -> `✕ treats a claim from a dead pid as no claim at all`
- `counts idleness from the last release` -> `lastSeen = bootedAtMs` -> `✕ counts idleness from the last release, not from boot`
- `takes its limit from devices.json, including 0` -> limit pinned to the default -> `✕ takes its limit from devices.json, including a limit of zero`
- `never shuts down a device that is not in devices.json` -> both `isPoolDevice` guards off (reap loop and `shutdownDevice`) -> `✕ never shuts down a device that is not in devices.json`
- `never shuts down the reserved serial` -> both `isReservedSerial` guards off -> `✕ never shuts down the reserved serial, even if the state somehow names it`
- `leaves a device alone while a live claim holds it` -> busy guard off in the decision **and** in `shutdownDevice` -> `✕ leaves a device alone while a live claim holds it`
- `ignores a claim whose process is gone` -> dead claims never dropped (in `claim()` and `pruneClaims()`) -> `✕ ignores a claim whose process is gone`
- `starts a device that is down, and records the boot on the lease` -> pool boots `swiftshader_indirect`, ignoring the shared default -> `✕ starts a device that is down, and records the boot on the lease` (the stub `emulator` records argv, and `-gpu host` is missing)
- `retries a reset on a device that is still settling` -> `attempts = 1` -> `✕ retries a reset on a device that is still settling, and reports the tries`; and -> retry `sleep` removed -> same ✕ (the loop must wait, not busy-poll)
- `reports a pm clear that never succeeded as a failed reset` -> `ok: true` -> `✕ reports a pm clear that never succeeded as a failed reset, with the answer`; and -> `answer: null` -> same ✕
- CLI `retries a reset on a device still settling` -> the lease's `row.ok` test replaced by `true` -> `✕ says so, in the device's own words, when the reset never succeeds`
- CLI `says so, in the device's own words` -> the reset line stops quoting `pm clear` -> `✕ says so, in the device's own words, when the reset never succeeds`
- four gate-claim cases (`claims the platform it runs on`, `refuses a device another live run holds`, `runs anyway under NITRO_UI_GATE_DEVICE_FORCE=1`, `claims nothing when the environment names no lease`) were shown red when introduced at `ac4fa4b` and pass unchanged on this tree; their assertions were re-run green after the claim-message wording fix.
- `flattenTests` (item 3's fix) was additionally shown red by the same `result.testResults` mutation above, which is the proof that the real-run bug cannot come back silently.

## Files changed

- `scripts/emulator-launch.mjs`, `scripts/patch-harness-android.mjs`,
  `patches/@react-native-harness%2Fplatform-android@1.6.0.patch` — one launch config, the exit-status
  accel check, and a mechanical regeneration path.
- `scripts/harness-suite-timing.mjs`, `example/rn-harness.config.mjs`, `scripts/gate-core.mjs`,
  `scripts/gate.mjs` — per-suite timings, the ledger field, `table --full`.
- `scripts/device-pool.mjs`, `scripts/lease.mjs`, `scripts/lease-core.mjs`,
  `scripts/devices.example.json` — the warm pool, boot/reset/reap, claims.
- `scripts/__tests__/{emulator-launch,harness-suite-timing,device-pool,lease-pool-cli}.test.js` —
  new: 16 + 22 + 43 + 16 = 97 tests; plus 4 claim cases in the existing `gate.test.js`. All shown
  red above.
- `scripts/real-input/{android,ios}.mjs` — boot hints from the shared config, and no
  `open -a Simulator` (Xcode 27's app asks DeviceKit for a device no lease handed out).
- `AGENTS.md`, `CONTRIBUTING.md` — the lease owns device lifecycle; measured boot costs.

## Follow-ups

- harness-timing: `harness-timing/state.json` is one path per project, so two runs in flight make
  each other's timing gate unusable — key it by Metro port and concurrency becomes worth measuring
  again.
- real-input:ios: the `switch` control fails deterministically today on this machine (5/5), on
  `main`'s app as well as this branch's; 11 of 16 `real-input:ios` rows in the exported task
  ledgers are red. Its own task, not a device-throughput one.
- ios-boot-noise: the spike is CoreSimulator's own bring-up plus host-side per-device daemons, not
  a disable-list target (measured above) — the answer is not paying it, which item 4 does.
- gate.mjs: `harness:android -- ColdSizing --background` puts `--background` in the recorded gate
  name (`harness:android:ColdSizing:--background`); the filter is parsed correctly, the flag is not
  stripped before naming.
- gate.mjs: a SIGTERM to a backgrounded gate leaves it running (it forwards the signal to its child
  and then waits on a child that has already exited); `kill -9` is needed today.
- lease pool: `pm clear` retried until PackageManager wakes works, but waiting on `pm path` would
  say *why* it is waiting rather than trying four times.

## Questions for orchestrator

`real-input:ios` is red at merge bar and I cannot turn it green honestly. Evidence: 5/5 failures
this round, always the same assertion (`("off") is not equal to ("on") - one real tap should flip
the Switch`), including when the *app under test is `main`'s* build (`/tmp/x11-main-checkout` at
`20b4069`) on the same simulator, with the XCUITest source byte-identical and no iOS, `src/` or
example-app file differing between the two checkouts. So it is not this branch, and fixing it is a
SwiftUI/React-Native touch-delivery investigation in code this task must not touch.

1. **Merge with the row red, plus a task for the `switch` check (recommended).** The row and its
   log are in the exported ledger, and the two harnesses plus `real-input:android` are green here.
2. Round 2 chases the flake. Against this round's brief, and the D19 cap makes it expensive.
3. Re-run `real-input:ios` hoping for a green roll. X6 logged exactly this (three reds, then a
   pass) and called it a flake; it is now deterministic on this machine, so a green roll would be
   a worse record than the honest red.
