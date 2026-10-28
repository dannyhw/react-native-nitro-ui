# X11 review — device throughput (branch `task/X11-device-throughput`, HEAD `22d6c54`)

Reviewed `git diff main...HEAD` (14 commits, code tree `86bbaae359c3`) and the code around it: the
lease and pool scripts, `emulator-launch.mjs`, the harness patch, the patch regenerator, the suite
timing plugin, the gate claim, real-input and the two rule documents. Everything was read-only
except two scratch probes in `/tmp/x11-review-scripts` and the mutations listed below, each one
reverted with `git checkout -- .` (the worktree is clean apart from this file). I ran no devices,
no harness, no builds and no `lease.mjs` commands.

**Verdict: FIX ROUND.** The launch config, the accel fix, the per-suite timing and the claim
mechanism are sound and well tested. Two problems block merge:

- The between-task reset does not work on either platform. The Android command is not a valid
  adb command, and the iOS "no reset needed" rests on a premise the repo's own iOS patch
  contradicts.
- The reaper can power off a device that another task holds under a live lease.

Several of the report's measurement claims also don't match the recorded data. One of those runs
was an unreported device-hygiene incident: it created and booted an AVD outside the lease.

## What I verified (holds)

- **The patch applies cleanly from a fresh install.** `git apply --check` passes against the
  pristine `platform-android@1.6.0` from the bun cache. The patched result is byte-identical to the
  installed `dist/emulator-startup.js`, and `node --check` accepts it.
- **The drift test works.** Changing the patch's `|| 'host'` to `|| 'swiftshader_indirect'` turned
  `✕ puts the rendered launch block in the patch, verbatim` red.
- **Benches are unchanged.** `git diff main...HEAD -- scripts/bench` is empty, and nothing in
  `scripts/bench` boots an emulator.
- **The new tests pass.** All six touched jest files pass under Node 24: 233 tests.
- **Removing the gate claim is caught.** It turns 3 of the 4 claim cases red.
- **The suite-timing test guards `overheadMs`.** Mutating it to `durationMs` alone turns two
  tests red.
- **The item 1 and item 3 numbers match ledger lines** (`docs/tasks/X11/gates.jsonl`). For
  example, the Host file is 113.4 s / 112.6 s on `9d9ce869206a`.
- **The item 6 peaks match the probe files.** 72.24 vs 74.25 come from `/tmp/x11-profile/on.json`
  and `off.json`.
- **The prior `real-input:ios` record matches.** It is 11 red / 5 green across X6, H2b and X3, as
  stated.
- **`need --for review` is still red.** It is missing `harness:ios` and `harness:android` because
  those runs are stale, which is what the report says.

## Must fix

**M1 — The Android reset is not a valid adb command, so it never runs on a real device.**
`scripts/device-pool.mjs:270` runs `adb(['-s', serial, 'pm', 'clear', appId])`, with no `shell`.
adb has no top-level `pm` command. I checked this against the platform-tools binary without
starting a server:

```
adb -H 127.0.0.2 -P 1 -s emulator-9999 pm clear nitroui.example
adb: unknown command pm   (exit 1)
```

Failure scenario: every `acquire --boot` gets nothing on stdout. It retries 4× with sleeps, then
logs `reset avd:…: pm clear FAILED ((no answer))`, and the next task inherits the app data. The
report says `pm clear` "answers `Failed` for a few seconds" on a real boot, which this code path
cannot produce.

The tests enshrine the bug:
- The CLI stub matches `*'pm clear'*`.
- `lease-pool-cli.test.js:245` asserts `adb -P 5043 -s emulator-5574 pm clear`.
- Applying the correct fix (`'shell', 'pm', 'clear'`) turns that test **red**.
- `device-pool.test.js` fakes `clearAppData` above the argv level, so it never sees the argv.

Fix: add `shell`, make the stub require `shell pm clear`, and add a test on the real
`deviceOperations().clearAppData` argv (stub binary).

**M2 — The iOS reset is a no-op justified by a false premise, and neither reset is proven
complete.** `device-pool.mjs:773-818` reports iOS as "none needed (simctl install replaces the app
container)". `simctl install` over an installed bundle id keeps the data container. The repo's own
platform-apple patch says so in its installed code
(`node_modules/@react-native-harness/platform-apple/dist/instance.js:70-75`: "`simctl install` is
fast and keeps the app container").

Failure scenario: task A's `NSUserDefaults`/Documents survive into task B on the same pooled
simulator, and `lease` prints a row saying the reset is satisfied.

The brief asks for "the cheapest reset that is provably complete, with a test". Neither platform
has a completeness proof. Fix:
- Use `simctl uninstall <udid> nitroui.example` on iOS (and keep or fix `pm clear` on Android).
- Record one device check in the report: write a value, reset, read it back.

Context: the Android harness already uninstalls and reinstalls the app whenever
`HARNESS_APP_PATH` is set (`platform-android/dist/instance.js:150-153`). The reset matters most
for real-input and any other consumer.

**M3 — The reaper powers off devices that a live lease holds.** The brief says "Devices *with no
lease* are shut down after `idleShutdownMinutes`". `poolReapDecision` (`scripts/lease-core.mjs:173-219`)
reaps idle devices "whether or not a lease still names it", and its docstring attributes that rule
to the brief.

Only a live gate *claim* protects a device. Many lease-holder activities make no claim:
- `build-app.mjs`;
- Metro;
- direct `node scripts/real-input/*.mjs --control …` runs (the report ran eight of them);
- `bun run harness:*`;
- simply working between gate runs.

Probe (`/tmp/x11-review-scripts/reap-probe.mjs`, fake ops):
- **Case A:** lease L1 is live with no claim and 31 min idle. Any other task's `lease.mjs list`
  runs `adb -P 5043 -s emulator-5574 emu kill`.
- **Case C:** `reap --idle-minutes 0` kills a leased device that was idle for 1 minute. CONTRIBUTING
  (`CONTRIBUTING.md:407`) recommends that command as "power the pool off now", and AGENTS.md does
  not forbid agents from running it.

Also, `entry.phase === 'booting'` (`lease-core.mjs:155`) is never set anywhere. A warm-reuse
`acquire` whose record is already past the limit can therefore be reaped by another process during
the up-to-3-minute settle wait, before `notePair` refreshes `lastUsedMs`.

Fix:
- Keep any device whose devices.json pair a live lease holds.
- Let `--idle-minutes` override only unleased devices, or put the leased case behind an explicit
  `--force`.
- Say in AGENTS.md that agents do not run `reap` with an override.

**M4 — Reap kills the serial stored in `pool.json`, checked only by AVD name.** `isPoolDevice`
(`device-pool.mjs:936-944`) matches `entry.id` against `pair.android.avd`. `shutdownDevice`
(`:923-929`) then runs `adb -P <entry.adbPort> -s <entry.serial> emu kill` with the *recorded*
serial and port, which are never re-derived from devices.json.

Probe case B: the record is `avd:nitroui_a` with serial `emulator-5576`, while pair-b
(`nitroui_b` on 5576) is held by live lease L2. The reap runs `adb -P 5045 -s emulator-5576 emu
kill`, killing another task's emulator.

Stale serials have two realistic sources:
- devices.json renumbering (this branch itself renumbers pair-b's `adbPort` in the example);
- `claim()` writing `ANDROID_SERIAL` ahead of `EMULATOR_PORT` (`pairFromEnv:991-993`,
  `identityFor:391-395`), for example after a hand-set `ANDROID_SERIAL` for one gate.

Fix: at reap time, derive serial and adbPort from the devices.json pair for that AVD. Refuse when
the record disagrees. Optionally check `adb -s <serial> emu avd name` before `emu kill`.

**M5 — The report's measurements don't match the recorded data.**

*(a) Item 1 (GPU A/B).* The report says "same code tree, same device (`emulator-5574`), one lease".
The `host` leg says otherwise:
- Its ledger line (10:47:10Z) has `device: null, lease: null`.
- Its log (`.gates/logs/harness+android-2026-10-28T10-47-10.003Z.log`) says `Creating Android
  emulator nitroui...` … `Shutting down Android emulator nitroui...`.
- So the harness created a **new AVD `nitroui`** (`~/.android/avd/nitroui.avd`, created 10:47 and
  still on disk), booted it outside the lease (no `-port`, default adb server), and shut it down.

The `swiftshader_indirect` leg ran on the pool-warm `nitroui_a`. The A/B therefore compares a warm
AVD with a freshly created one, including snapshot generation. It is not controlled, and it is an
unreported hygiene incident: a device gate with no lease, and an AVD outside devices.json. The iOS
gates at 11:08Z and 11:54Z also ran with no lease (`Booting iOS simulator iPhone 17` by name, then
shut down).

*(b) Item 5 (concurrency).* The report says "same tree, four runs":
- The sequential pair ran on `9d9ce869206a` (13:33Z / 13:39Z).
- The concurrent pair ran on `de2e62c20e78` (11:14Z).
- "No throughput gain" misreads the result. Sequential is 365.3 + 118.9 = 484.2 s of wall time
  for both results, against 362.3 s concurrent: about 25 % less wall time.
- The recommendation against concurrency can stand on the `state.json` collision, but not on this
  reasoning.

*(c) Question 1.* The report says "every one of the eleven runs today failed the same assertion
(… one real tap should flip …)".
- The 13:57Z gate on `9d9ce869206a` failed `RealInputTests.swift:155`, "a second real tap should
  flip it back". The first tap worked.
- The main-vs-branch evidence exists only in `/tmp/x11-profile/switch-ab.log`, which is
  uncommitted. It keeps the last 3 lines of output and has no assertion text.
- It supports "main's build fails the switch control", not "the same assertion".

Fix:
- Re-run the `host` leg under the lease on `nitroui_a`, or withdraw the "same device" claim.
- Correct item 5 and Q1.
- Report the incident.

**M6 — `--exclusive` powers nothing off unless `--boot` is also passed.** Brief item 4:
"`--exclusive` (benches) shuts down every non-leased pool device before it returns." In
`lease.mjs:668`, `poolHandoff`, which holds the exclusive power-off (`:710`), runs only when
`options.boot` is set. Otherwise only the idle reap runs.

CONTRIBUTING says a bench host wants a lease *without* `--boot` (`CONTRIBUTING.md:416-418`), and
also promises that `--exclusive` powers devices off (`:434`).

Failure scenario: a bench runs `acquire --exclusive` as documented, and another task's idle-grace
emulator stays up through the baseline.

Fix: run the exclusive power-off whenever reaping is on. Enumerate devices.json pairs rather than
only the `pool.json` records (`unheldPoolKeys`, `:880`), so a pool device booted outside the pool
is included.

**M7 — The gate-claim test does not guard the property it exists for.** The claim's purpose is
"a reap cannot power off an emulator mid-suite". As a mutation, I released the claim *before*
`runGateUnclaimed` (`gate.mjs`, one added line). All four claim cases in `gate.test.js:2007-2060`
still **pass**: they check the claim message and the post-run state, never that a claim is live
while the runner runs.

Fix: have the fake runner read `pool.json` (or run `reap`) mid-run and assert the claim is
present and the device is kept.

## Nits / follow-ups

**N1 — Device I/O runs under `leases.lock`.** `reap` calls `simctl list`, `simctl shutdown` and
`adb emu kill` inside `withPool` (`device-pool.mjs:847-905`). Two consequences:
- `LOCK_TIMEOUT_MS` is 10 s, so a slow shutdown makes another task's `acquire` or gate claim fail.
  The gate then exits 1 before it runs.
- `withLock` steals a lock older than `LOCK_STALE_MS` (30 s) without a pid check, so a slow reap
  can lose its lock in the middle of a read-modify-write.

Fix: decide under the lock, act outside it, then re-lock to drop records.

**N2 — An invalid port is dropped silently, and the emulator boots wherever it can.**
`emulatorLaunchArgs` drops an invalid port (`emulator-launch.mjs:153`), so the emulator boots on
any free console port. That is the opposite of what the test name says ("…rather than booting
anywhere", `emulator-launch.test.js:173`). `normalizeDevices` only checks `Number.isInteger`
(`lease-core.mjs:282`), so an odd `emulatorPort` reaches the pool boot. Throw instead.

**N3 — "Test bodies, not … waits" is not supported by the data.** `testBodyMs` is the harness's
per-test duration, which includes in-test waits, so the data cannot separate waits from bodies.
Rephrase item 3.

**N4 — Stale and untraceable numbers in comments and docs.**
- Code comments still carry the refuted boot numbers: `device-pool.mjs:6-7` and `lease-core.mjs:90`
  ("4-6 min", load "~100"/"past 100"), and `lease-pool-cli.test.js:226`.
- AGENTS.md:36-37 and CONTRIBUTING.md:395 give "54 s" and "~200 s" boot times. Neither number is
  in any recorded data.
- They also say the load takes "about 3 minutes to fall back under the settle ceiling", but the
  item 6 data shows load still at 16–21 after 150 s, with no later sample.

**N5 — Doc comments describe behaviour the code doesn't have.**
- `device-pool.mjs:23` and `:825` say `release --exclusive` powers devices off. The power-off is
  actually on `acquire`, and `release` has no exclusive path.
- `device-pool.mjs:16` says the patch makes the harness's Android `dispose` leave the emulator
  alone. The patch only touches `emulator-startup.js`, and `instance.js:184-187` still stops an
  emulator the harness started.

**N6 — Runs outside `gate.mjs` claim nothing.** A harness or real-input run started outside
`gate.mjs` can be reaped mid-run once its device is past the idle limit. The M3 fix covers this.
Otherwise, claim from the real-input scripts or document the limitation.

**N7 — Bench GPU (question, not a fix).** The bench code is unchanged, but the emulator a bench
measures is now booted `-gpu host` by the harness or pool, where the harness used to boot
`swiftshader_indirect`. Nothing states which mode the committed Android baselines were minted on.

**N8 — Leftover AVD.** `~/.android/avd/nitroui.avd` (from M5a) is outside devices.json. The
implementer or the human should remove it; the reviewer did not touch it.

**N9 — Report bookkeeping.**
- The red proofs say "re-run against `da0b31f` (the code tree above)", but the table's tree is
  `86bbaae359c3` at `05528f5`.
- The evidence for item 6 and the switch A/B lives only in `/tmp/x11-profile`. Copy the summaries
  into the appendix.

## Verdict: FIX ROUND

Must fix:
- M1 — `adb -s <serial> pm clear` has no `shell`: "unknown command pm", so the Android reset never runs, and a test asserts the broken argv (`device-pool.mjs:270`, `lease-pool-cli.test.js:245`).
- M2 — iOS "no reset needed" is false: `simctl install` keeps the data container (the repo's own iOS patch says so); neither reset is proven complete (`device-pool.mjs:773-818`).
- M3 — The reaper powers off devices under a live lease, against the brief; `reap --idle-minutes 0` and an unset `booting` phase widen it (`lease-core.mjs:173-219`, `:155`).
- M4 — Reap kills the recorded serial after checking only the AVD name, so a stale serial kills another pair's leased emulator (`device-pool.mjs:923-944`, `:391`, `:991`).
- M5 — Report measurements don't match the data: the GPU `host` leg ran with no lease on a newly created AVD `nitroui` (unreported incident); the item 5 legs are from different trees and the wall time was misread; Q1's "same assertion" is false.
- M6 — `acquire --exclusive` powers nothing off without `--boot`, which is how CONTRIBUTING tells bench hosts to lease (`lease.mjs:668`, `:710`).
- M7 — The gate-claim tests still pass when the claim is released before the run, so "never reaped mid-suite" is untested (`gate.test.js:2007`).

Nits:
- N1 — Reap does device I/O under `leases.lock` (10 s timeout, 30 s steal) (`device-pool.mjs:847-905`).
- N2 — An invalid emulator port is dropped silently and the emulator boots anywhere; the test name says otherwise (`emulator-launch.mjs:153`).
- N3 — Item 3's "not waits" can't be told from `testBodyMs`.
- N4 — Stale load and boot numbers in code comments; "54 s", "~200 s" and "3 minutes" in AGENTS/CONTRIBUTING are untraceable.
- N5 — Doc comments name `release --exclusive` and a harness `dispose` patch, neither of which exists (`device-pool.mjs:16,23,825`).
- N6 — Runs outside `gate.mjs` claim nothing and can be reaped mid-run.
- N7 — Question: the GPU mode the bench device runs with changed de facto; which mode the baselines used is not recorded.
- N8 — The leftover `~/.android/avd/nitroui.avd` should be removed.
- N9 — The red-proof tree label is inconsistent, and the item 6 and switch A/B evidence is only in `/tmp`.
