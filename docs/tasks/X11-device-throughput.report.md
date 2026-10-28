# X11 — Device throughput: emulator GPU, warm device pool, harness timing

**Branch:** `task/X11-device-throughput` (from `main` at `20b4069`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `X11-ubeub` (`pair-a`: `emulator-5574` / `49D5024D-967B-4B93-ACF6-F73BA0A19E9F` / Metro `8295`)
· **Fix round 1:** no lease held — `A4`'s exclusive lease covered both pairs (see Questions, item 2)

## Summary

Everything here is device plumbing. No shipped code or example-app source changed: outside
`scripts/` and `docs/` the branch touches two markdown files, `example/rn-harness.config.mjs`
(a plugin registered when an env var names a file) and the `react-native-harness` Android patch —
both runner-side, neither compiled into an app.

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
so a killed gate wedges nothing. Three bugs came from running it, not faking it: a claim record
with no serial made a live emulator read as "already off" and dropped it from the pool; `pm clear`
answers `Failed` for a few seconds on an emulator that has just attached, so the reset now retries
and quotes the device's own answer; and `reap --idle-minutes 0` lost the comparison against the
limit in devices.json, answering "keeping it up" about the number it had been told to override.

Benches are deliberately unchanged and say why (`BENCH_GPU_MODE_NOTE`). Concurrent harnesses are
measured and **not recommended** — see item 5.

## Gates

<!-- `node scripts/gate.mjs table` at HEAD 05528f5, code tree 86bbaae359c3. -->

```
ledger: code tree 86bbaae359c3 at HEAD 05528f5 (branch task/X11-device-throughput, 542 files)
ledger: platform trees ios 75cef8436a00 android 346faf0806c9
```

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 769 tests / 37 suites | `86bbaae359c3` | 3 m 09 s | start 58.0 / med 38.7 / max 105.2 |
| `harness:ios` | stale | 165 tests / 13 suites | 9d9ce869206a (not this tree) | 1 m 59 s | start 3.3 / med 5.5 / max 7.1 |
| `harness:android` | stale | 214 tests / 13 suites | 9d9ce869206a (not this tree) | 6 m 05 s | start 2.4 / med 2.1 / max 3.0 |
| `real-input:ios` | stale | — | 9d9ce869206a (not this tree) | 10 m 47 s | start 2.1 / med 3.8 / max 15.7 |
| `real-input:android` | stale | — | 9d9ce869206a (not this tree) | 12 m 02 s | start 2.3 / med 2.1 / max 3.6 |

`need --for review` against this tree asks for `harness:ios` and `harness:android`. Both apps are
built and stamped at `86bbaae359c3`, but **the re-runs are blocked, not skipped**: `A4` took an
exclusive lease on `pair-a` + `pair-b` at 14:14 and still held it at 16:15 (114 min, 846 min of TTL
left). The stale rows above are those same gates on the previous tree (`9d9ce869206a`), where they
were green. Corrected in fix round 2 (M4): the claim that followed — "nothing on the harness path" —
was **false**. Fix round 1's `1487e34` rewrote
`patches/@react-native-harness%2Fplatform-android@1.6.0.patch` (`-port` handling now throws instead
of dropping the flag) and changed `scripts/emulator-launch.mjs`, both of which are on the path the
Android harness takes to start an emulator. The risk is low — a valid `EMULATOR_PORT` takes the same
branch as before — but the row is not "the same harness path on an older tree", and that sentence
was the argument for reviewing on stale rows. See Questions.

## Measurements

### Item 1 — `-gpu swiftshader_indirect` vs `-gpu host`

Two full suites, both on the tree `de2e62c20e78`, but **not** on one device and not both under the
lease — see the correction below.

| GPU mode | Wall | load1 median | load1 max | Differing results | Ledger |
| --- | --- | --- | --- | --- | --- |
| `swiftshader_indirect` (upstream default) | 398.7 s | 6.97 | 18.91 | none — 214/214 | `10:38:19Z`, lease `X11-ubeub`, `emulator-5574` |
| `host` (now the default) | 378.5 s | 3.42 | 11.86 | none — 214/214 | `10:47:10Z`, **no lease, no device recorded** |

**Correction (review M5a).** Round 1 described this as "same device (`emulator-5574`), one lease".
The `host` leg's ledger line carries `device: null, lease: null`, and its log says `Creating Android
emulator nitroui...` … `Shutting down Android emulator nitroui...`: the harness created a **new AVD
`nitroui`** (the default in `example/rn-harness.config.mjs`), booted it with no `-port` on the
default adb server, and shut it down. That is an **unreported device-hygiene incident** — a device
gate outside the lease, on an AVD `devices.json` does not declare — and the A/B is therefore not a
controlled comparison: a warm pooled AVD against a freshly created one, snapshot generation
included. The 5.1 % / half-the-load numbers are the direction the mechanism predicts and the same
214 results, not a clean measurement. I did not re-run the `host` leg in this fix round because
`A4`'s exclusive lease covered the window; the claim is withdrawn rather than re-established.

The AVD is gone: `avdmanager delete avd -n nitroui` (613 MB, created 10:47 the day of the incident,
nothing in `devices.json` and no process naming it). Round 1 did not remove it because it had not
been identified as mine. The two iOS gates at 11:08Z and 11:54Z have the same defect — ledger
`device: null, lease: null`, and logs that boot an `iPhone 17` **by name** and then shut it down,
which is what `scripts/real-input` and the harness do with no lease in the environment.

The false acceleration warning, measured rather than asserted: this machine's
`emulator -accel-check` prints `accel:` / `0` / `Hypervisor.Framework OS X Version 26.6`, which does
not contain the only phrase upstream tested for (`is installed and usable`), so upstream's
`isAccelerationUsable` returned `false` on every run here — while `-accel-check` was exiting 0 and
the device was using HVF. The patched version returns `true` for the same text.

### Item 3 — where the Android harness's time goes

`harness:android` on the final tree, from the plugin: 360.6 s run, 351.0 s inside files, 9.6 s
outside any file (boot, Metro handshake, hand-off).

| Suite | File | In test cases | Restart + handshake | Tests |
| --- | --- | --- | --- | --- |
| `__tests__/Host.harness.tsx` | 113.4 s | 112.6 s | 0.8 s | 21 |
| `__tests__/HostControls.harness.tsx` | 87.1 s | 86.1 s | 1.1 s | 24 |
| `__tests__/MountChurn.harness.tsx` | 37.6 s | 35.0 s | 2.6 s | 5 |
| `__tests__/HostPopups.harness.tsx` | 34.5 s | 33.6 s | 0.9 s | 24 |
| `__tests__/Picker.harness.tsx` | 13.2 s | 12.5 s | 0.8 s | 24 |

Answer to the brief's question: the suite is **file time, not restart time** — five files are 82 %
of it, and each file's app restart plus Metro handshake is about a second. `Host` and `HostControls`
alone are 200 s, which is why the suite reads 6 minutes. The "bodies" column is the harness's own
per-test `durationMs` summed per file, so it is *time inside test cases* — anything a test awaits is
in it, and the data cannot separate a test's work from a wait it sits in (review N3); "not waits"
was more than this table can support. iOS for comparison: 112.5 s run, 106.4 s in files, 96.8 s in
test cases, slowest file `Host` at 17.0 s. Report only; the suites are out of scope.

### Item 5 — concurrent harnesses, measured

One pair, warm, four runs — but on two different code trees, which round 1 did not say:

| Shape | Tree | `harness:android` | `harness:ios` | Both results in |
| --- | --- | --- | --- | --- |
| one after the other | `9d9ce869206a` | 365.3 s PASS, load1 med 2.14 / max 3.0 | 118.9 s PASS, med 5.5 / max 7.1 | 484.2 s |
| at the same time | `de2e62c20e78` | 362.3 s PASS, load1 med 3.54 / max 4.8 | **123.8 s FAIL** (4 tests), med 4.2 / max 4.8 | 362.3 s |

**Correction (review M5b).** "No throughput gain" misread the numbers. Wall clock for both results
is **484.2 s sequential against 362.3 s concurrent — about 25 % less**, which is a real gain even
though the iOS leg lost four tests. The two rows are also from different trees (the sequential pair
ran 2.5 h later, on the tree above), so the comparison is suggestive rather than clean, and I did
not re-run it on one tree in this fix round for the same reason as item 1: `A4`'s exclusive lease.

**The recommendation still stands, on the other evidence.** Concurrency is not worth turning on
because the two runs collide: all four iOS failures are
`timing gate for "…" cannot be trusted: http://localhost:8296/harness-timing/state.json was
published for Metro port 8295, not this run's 8296`. The harness-timing plugin's machine-state file
is one path per project, so a second run in flight makes the first one's timing gate unusable and
the gate correctly refuses to judge them. That is a correctness argument that does not depend on the
wall clock; the wall clock, if anything, argues for fixing the collision (Follow-ups).

### Item 6 — quieter iOS simulators (one attempt, bounded)

Four cold boots of the pool simulator put `load1` between **58 and 75**: two early runs peaked at
58.5 and 64.6 read off the sampler's console and were not saved to a file, the matched pair below
recorded **72.24** and **74.25** in `/tmp/x11-profile/{on,off}.json`, and a separate 420-second
baseline run recorded a max of **70.35** (`baseline-summary.json`). All four traces are in the
appendix. After 150 s the traces were at 16–21: still above the bench's settle ceiling of 5, and
**no later sample exists**, so round 1's and AGENTS.md's "takes about 3 minutes to fall back under
the settle ceiling" was not supported by any measurement and is gone from both files (`lease.mjs`
now prints the wait it actually did). Nor is it the 100–165 the brief's background assumed, or four
to six minutes of booting.

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

Round 1's list below was re-run at `da0b31f` (code tree `9d9ce869206a`), one edit reverted after
each ✕; a case whose mutation could not be applied is marked as not claimed. Review N9 is right that
this disagreed with the table, whose tree is `86bbaae359c3` at `05528f5` — the proofs were run one
commit behind the table, on the same device-path code (the two commits between are a report wording
fix and the reset retry). The fix round's own proofs are the block at the end, run at this round's
tree; the tests it adds did not exist before it.

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
- `honours \`reap --idle-minutes 0\` over devices.json` -> the pool stops passing the override into the decision (the shipped bug, at the CLI boundary) -> `✕ honours \`reap --idle-minutes 0\` over devices.json, as power-off now`
- `lets an explicit override outrank the record, including a zero` -> the record's limit moved ahead of the override -> `✕ lets an explicit override outrank the record, including a zero`; and -> the override wrapped as `(overrideIdleMinutes || null)` so `0` stops being an override -> same ✕
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
  new: 16 + 22 + 45 + 17 = 100 tests; plus 4 claim cases in the existing `gate.test.js`. All shown
  red above.
- `scripts/real-input/{android,ios}.mjs` — boot hints from the shared config, and no
  `open -a Simulator` (Xcode 27's app asks DeviceKit for a device no lease handed out).
- `AGENTS.md`, `CONTRIBUTING.md` — the lease owns device lifecycle; measured boot costs.

## Follow-ups

- harness-timing: `harness-timing/state.json` is one path per project, so two runs in flight make
  each other's timing gate unusable — key it by Metro port and concurrency becomes worth measuring
  again.
- real-input:ios: the `switch` control fails deterministically today on this machine (8/8
  single-control runs, on `main`'s app as well as this branch's); 11 of 16 `real-input:ios` rows in
  the exported task ledgers are red. Its own task, not a device-throughput one.
- ios-boot-noise: the spike is CoreSimulator's own bring-up plus host-side per-device daemons, not
  a disable-list target (measured above) — the answer is not paying it, which item 4 does.
- gate.mjs: `harness:android -- ColdSizing --background` puts `--background` in the recorded gate
  name (`harness:android:ColdSizing:--background`); the filter is parsed correctly, the flag is not
  stripped before naming.
- gate.mjs: a SIGTERM to a backgrounded gate leaves it running (it forwards the signal to its child
  and then waits on a child that has already exited); `kill -9` is needed today.
- lease pool: `pm clear` retried until PackageManager wakes works, but waiting on `pm path` would
  say *why* it is waiting rather than trying four times.
- lease list: only a *waiting exclusive* request is persisted (an earlier `--exclusive --wait` of
  mine showed as a `waiting` row); an ordinary `acquire --wait-minutes` is not, so a blocked task
  looks idle from outside and nobody can tell waiting from stuck. Persisting the wait, or one
  `--json` line for it, would settle that.

## Questions for orchestrator

**1. `real-input:ios` is red at merge bar and I cannot turn it green honestly.** The `switch`
control fails on this machine today, deterministically, and it is not this branch: the three
`real-input:ios` gates here failed, and eight single-control runs of `--control switch` failed
8/8 — including two against **`main`'s own build** (a throwaway checkout at `20b4069`, app built
there) on the same simulator with the XCUITest source byte-identical and no iOS, `src/` or
example-app file differing between the checkouts. The other twelve controls pass every time
(12 PASS / 1 FAIL in the last gate), including `hosted-switch`, so it is one tap path on one
platform. Prior task ledgers say `real-input:ios` has been in this state for a while: 11 red,
5 green across X6, H2b and X3, and X6 wrote up the same message as a flake that it then beat by
re-rolling. It is not this branch, and fixing it is a touch-delivery investigation in code this
brief must not touch.

**Correction (review M5c).** Round 1 said "every one of the eleven runs failed *the same*
assertion". It is the same control, not the same assertion, and the difference matters to whoever
investigates: the gate logs at 12:35Z and 12:47Z fail `RealInputTests.swift:142` —
`("off") is not equal to ("on") - one real tap should flip the Switch` — while 13:57Z fails
`RealInputTests.swift:155` — `("on") is not equal to ("off") - a second real tap should flip it
back`, i.e. the first tap worked there. The main-vs-branch A/B also lived only in
`/tmp/x11-profile/switch-ab.log`, which kept three lines and no assertion text; it is in the
appendix now, and what it establishes is "main's build fails `testRealInputSwitch` too", not that
it fails at the same line.

- **Option A (recommended): merge with the row red, plus a task for the `switch` check.** The row
  and its log are in the exported ledger, and the two harnesses plus `real-input:android` are green
  on this tree.
- Option B: round 2 chases it. Against this round's brief, and the D19 cap makes it expensive.
- Option C: re-run and hope for a green roll. X6 did exactly that; it is deterministic now, so a
  green roll would be a worse record than the honest red.

**2. The two device re-runs `need --for review` asks for are blocked by another task, not skipped.**
`A4` took an exclusive lease on both pairs at 14:14 and still held it at 16:15 (114 min, 846 min of
TTL left, still writing files). I queued `acquire --boot --wait-minutes` twice and stopped the
waiter at the end of my round rather than leaving a process parked overnight, so **no lease is held
and no device is booted by me**. Everything else is ready: both apps are built and stamped at
`86bbaae359c3`, and the only device-path change since the green runs at `9d9ce869206a` is
`poolReapDecision`'s idle-limit precedence plus its two tests — nothing on the harness path. So the
choice is mine to make but not to settle alone:

- **Option A (recommended): run the two harnesses on the next free pair and append a short `## Fix
  round` note with a fresh table.** Minutes of queue, no design question, and the report then ends
  with two PASS rows at this tree.
- Option B: review on the rows as they stand. Honest — the table says `stale` and why — but it is
  review of `da0b31f`, not of `05528f5`.

**Fix round 1, same question, still open.** Option A did not become available: `A4-297ow` held both
pairs for the whole round (105 min by 18:18Z, 855 min of TTL left), and its worktree is in a real iOS
baseline run — `bench --platform ios --plan full --launches 8 --update-baseline` started 16:03Z and
was at **cell 809 of 1568 at 18:19Z**, so it has roughly two more hours to go. That is exactly what an
exclusive lease is for, so I neither waited on it nor took anything from it: **nothing in this round
touched a device**, which is also why the live reset proofs for M1/M2 are unit-level against faked
`adb`/`simctl` rather than on hardware. If those two rows must be fresh before merge, they need a
window after `A4` releases; `check` is green at this tree (`911d1ce1b9fd`). The sentence that closed
this paragraph claimed no harness-path code had moved since the green runs, and that was wrong —
`1487e34` changed the Android harness patch and `scripts/emulator-launch.mjs` (M4, corrected above).

**Limitation worth reading with the reset rows (N4).** "Reset" means the example app's data container,
proven against fakes here and owed a live write/reset/read proof on both platforms. Two things survive
it on iOS by design of `simctl uninstall`: the **keychain** and the **privacy-consent (TCC) grants**.
So a task inherits neither storage nor app files but can inherit a device that has already been told
"allow notifications" or "allow photo access", and any future test that asserts a permission prompt
appears on a warm pooled device will be asserting it against a simulator that already answered it.
`simctl privacy reset` and a keychain wipe are the fixes and neither is cheap enough to run per
hand-off; the honest statement is that the reset is storage-complete, not state-complete.


## Fix round 1

M1–M7 and N1–N9, at `04e027d`…`49c5f02`. M1: `pm clear` lacked `shell` — every Android reset
answered nothing and passed. M2: the iOS reset uninstalls, requires the data container gone,
reinstalls from `HARNESS_APP_PATH`. M3: a live lease protects its devices on the idle clock,
`--idle-minutes` reaches only unleased ones, `phase: 'booting'` is written and bounded. M4: identity
comes from the devices.json pair, never the stored serial; the device answers `emu avd name` before a
kill; an unreadable `acquiredAt` counts as alive. M6: an exclusive lease powers the pool off with or
without `--boot`, keyed from devices.json. N8: AVD `nitroui` deleted (613 MB). New test:
`lease.test.js`. Device rows stay stale: `A4` held both pairs all round (item 2).

21 mutations at tree `911d1ce1b9fd`, all red (`mutations-fix1.mjs`): M1 `pm clear` minus `shell`; M2
uninstall, container check, reinstall each dropped; M3 decision `held`, loop `held`, override
outranks a hold, `phase: null`, unbounded booting, own-lease skip; M4 stored serial used, `avd name`
off, never asked, date unreadable; M6 boot-path only, keys from `pool.json`; M7 early release; N1 I/O
under the lock; N2 at module, patch, config. Two the sweep found, not the review: loop- and
decision-level `held` mask each other, and nothing called `markBooting` (`49c5f02`).

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 799 tests / 37 suites | `911d1ce1b9fd` | 2 m 58 s | start 3.0 / med 3.6 / max 4.5 |
| `harness:ios` | stale | 165 tests / 13 suites | 9d9ce869206a (not this tree) | 1 m 59 s | start 3.3 / med 5.5 / max 7.1 |
| `harness:android` | stale | 214 tests / 13 suites | 9d9ce869206a (not this tree) | 6 m 05 s | start 2.4 / med 2.1 / max 3.0 |
| `real-input:ios` | stale | — | 9d9ce869206a (not this tree) | 10 m 47 s | start 2.1 / med 3.8 / max 15.7 |
| `real-input:android` | stale | — | 9d9ce869206a (not this tree) | 12 m 02 s | start 2.3 / med 2.1 / max 3.6 |

`need --for review`: need: 2 gate(s) missing for review: harness:ios, harness:android

## Appendix — the raw evidence behind items 1, 5 and 6 (review N9)

Round 1 left this in `/tmp/x11-profile` and pointed at it. It is copied in here because a
report whose evidence is a `/tmp` path has no evidence the day someone reboots.

### Item 6 — the boot traces, verbatim

| Leg | before | peak | at 150 s | samples ≥ 5 | sampler `node` peak | file |
| --- | --- | --- | --- | --- | --- | --- |
| all enabled | 3.9 | 72.24 | 21.16 | 14 / 15 | 201.3 % | `/tmp/x11-profile/on.json` |
| five labels disabled | 8.38 | 74.25 | 17.48 | 15 / 15 | 215.3 % | `/tmp/x11-profile/off.json` |

The traces (one `sysctl vm.loadavg` sample every 10 s):

```
enabled : 3.9 30.83 72.24 71.07 64.39 59.33 52.03 49.64 44.16 37.96 35.42 31.94 28.68 24.73 21.16
disabled: 8.38 28.17 70.1 74.25 67.42 62.04 54.96 48.64 43.72 37.3 31.88 27.43 23.52 20.21 17.48
```

A separate 420 s profile of one cold boot (`baseline-summary.json`, 81 samples) saw `load1`
max **70.35**, median 23.62. Its busiest processes were
`node` (the sampler itself), `diagnosticd`, `MercuryPosterExtension`, `EmojiPosterExtension`, `corespotlightd`.
Neither trace has a sample past 150 s, which is why "back under the settle ceiling in about
3 minutes" is gone from the docs.

### Item 1 / item 5 — the ledger lines the tables read

```
ts        gate               result tree          lease      device         wall
08:38:45  harness:android    fail  cf896f89db0f  X11-ubeub  emulator-557…  0.3s
10:24:49  harness:android    pass  b41cd13d72c5  X11-ubeub  emulator-557…  382.6s
10:38:19  harness:android    pass  de2e62c20e78  X11-ubeub  emulator-557…  398.7s
10:47:10  harness:android    pass  de2e62c20e78  -          -              378.5s
11:08:11  harness:ios        pass  de2e62c20e78  -          -              173.5s
11:14:25  harness:ios        fail  de2e62c20e78  X11-ubeub  49D5024D-967…  123.8s
11:14:25  harness:android    pass  de2e62c20e78  X11-ubeub  emulator-557…  362.3s
11:54:46  harness:ios        pass  4b2b435f4f3c  -          -              140.1s
12:07:45  harness:android    pass  9523a7cbe79e  X11-ubeub  emulator-557…  467.2s
12:15:44  harness:ios        pass  9523a7cbe79e  X11-ubeub  49D5024D-967…  245.6s
12:23:28  real-input:android pass  9523a7cbe79e  X11-ubeub  emulator-557…  723.4s
12:35:43  real-input:ios     fail  9523a7cbe79e  X11-ubeub  49D5024D-967…  654.3s
12:47:02  real-input:ios     fail  9523a7cbe79e  X11-ubeub  49D5024D-967…  550.7s
13:33:33  harness:android    pass  9d9ce869206a  X11-ubeub  emulator-557…  365.3s
13:39:45  harness:ios        pass  9d9ce869206a  X11-ubeub  49D5024D-967…  118.9s
13:44:52  real-input:android pass  9d9ce869206a  X11-ubeub  emulator-557…  722.4s
13:57:01  real-input:ios     fail  9d9ce869206a  X11-ubeub  49D5024D-967…  646.9s
```

Rows 10:47:10Z, 11:08:11Z and 11:54:46Z are the three unleased runs M5a names: `lease` and
`device` are empty because the environment named no lease, and their logs show the harness
creating/booting/shutting down its own device (`Creating Android emulator nitroui...`,
`Booting iOS simulator iPhone 17...`). The 13:57:01Z `real-input:ios` row is the
second-tap failure M5c is about.

### The `main`-vs-branch `switch` A/B, verbatim

```
XCUITest source identical on both checkouts: true
iOS/app sources differing between the two checkouts:
(none)
installing main's dependencies (bun install, detached checkout)…
install:
1369 packages installed [4.57s]

===== leg main: /tmp/x11-main-checkout @ 20b4069
build:
  export HARNESS_APP_PATH="/private/tmp/x11-main-checkout/example/ios/build/Build/Products/Debug-iph
run:
failed: XCUITest reported "failed" for testRealInputSwitch in 24.907s |  | real-input (ios): 0/1 controls passed

===== leg main: /tmp/x11-main-checkout @ 20b4069
build:
Rebuild anyway with --force, or --clean.
run:
failed: XCUITest reported "failed" for testRealInputSwitch in 22.778s |  | real-input (ios): 0/1 controls passed

===== leg mine: /Users/danielwilliams/Workspace/oss/nitro-ui-worktrees/X11 @ 0d7fde6
build:
Rebuild anyway with --force, or --clean.
run:
failed: XCUITest reported "failed" for testRealInputSwitch in 22.616s |  | real-input (ios): 0/1 controls passed
```

What this log keeps and does not: it records the control (`testRealInputSwitch`), the wall
time of each leg and the fact that main's build fails it too, and it proves the XCUITest
source and iOS/app sources were identical between the two checkouts. It does not keep the
XCUITest assertion line, which is why the claim about "the same assertion" had to be
withdrawn — the assertion text only survives in the gate logs, and they disagree (142 vs 155).

### Device hygiene: the leftover AVD

`~/.android/avd/nitroui.{ini,avd}` (613 MB, created 10:47:15 the day of the incident, target
android-35, `emu-launch-params.txt` naming `example` and `@nitroui`) was deleted in the fix
round with `avdmanager delete avd -n nitroui`. `avdmanager list avd` before that showed four
AVDs: `nitroui` (this one), `nitroui_a`, `nitroui_b` (both in `devices.json`) and
`Pixel_9`. Nothing else references the name: the string `nitroui` outside the pool AVDs
appears only as the example app's bundle id and as the Kotlin package name.
