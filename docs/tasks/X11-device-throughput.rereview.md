# X11 re-review — fix round 1 (branch `task/X11-device-throughput`, HEAD `53b20c8`)

Scope: the fix round `04e027d`…`53b20c8`, read against the first review (`eef03c9`) and the code
around it. Everything was read-only apart from this file. I wrote scratch probes in
`/tmp/x11-rereview/` that import the worktree's modules and use faked device ops in `mkdtemp` homes.
Mutations were applied one at a time, and each was reverted with `git checkout -- <file>`; the
worktree is clean apart from this file. I ran no devices, harnesses, builds or `lease.mjs` commands.
Jest ran under Node 24 only. The six touched suites pass: **241/241**.

**Verdict: FIX ROUND.** M1–M7 from the first review are fixed as claimed, and each mutation I
re-ran goes red. But the device-safety trace found two new ways a pool command acts on a device in
use:

- The N1 fix (decide under the lock, act outside it) opened a window. A lease *and* a live gate
  claim taken in that window are ignored, and the device is killed.
- The reset never looks at claims. A task that re-runs `acquire` while its own gate is running
  wipes the app under the suite.

The report also has one false premise, and the CONTRIBUTING text the M3 fix added has another.

## Device-safety trace (what holds)

Every boot, kill, reset and reap path, against the brief's four rules:

| Rule | Status | Where |
| --- | --- | --- |
| Only devices.json devices, identity checked live | **holds** | Android: the serial comes from the pair (`pairFor`, `device-pool.mjs:1213`), never from the record. `emu avd name` must name the record's AVD before `emu kill` (`:1326`). iOS: the UDID must equal devices.json's, and must be in the booted list (`:1290-1301`). Boot and reset only take the lease's own pair. |
| Never `emulator-5560` | **holds** | `isReservedSerial` on the record (`:1062`, `:1271`) and on the derived serial (`:1319`); `notePair` refuses (`:640`); `assertLeasable` / `normalizeDevices` refuse it at config time. |
| `adb -s <serial>` on the leased adb port | **holds** | `devices`, `emu avd name`, `emu kill`, `shell pm clear` and `getprop` all take the pair's `adbPort`. Only a pair with no `adbPort` falls back to the caller's `ANDROID_ADB_SERVER_PORT`. |
| Not held by another live lease / live claim | **at decision time only** | See M1 (the decide/act window) and M2 (the reset ignores claims). |
| Fails closed | **mostly** | Closed: a corrupt `leases.json` (`readJson` throws, reap is skipped as "reap failed"), an unreadable `acquiredAt` (counts as live), and an `emu avd name` timeout (refused). Not closed: a corrupt `pool.json` (N1). An `adb devices`/`simctl list` timeout reads as "already off" (N2). Neither N1 nor N2 kills a device in the normal path. |

Other verified points:

- **M1 (adb `shell`) is fixed.** The CLI stub now matches only `shell pm clear`. Dropping `shell`
  turns 4 tests red.
- **M2 (iOS uninstall, then container check, then optional reinstall) is fixed.** Removing the
  container check turns 1 test red. Swapping the uninstall argv turns 2 red.
- **M3 is fixed.** Removing the held check at the decision level turns 2 red, at the loop level
  2 red, and an unbounded `booting` phase 1 red.
- **M4 is fixed.** Using the stored serial turns 4 red. Removing the `emu avd name` gate turns 3
  red. An unreadable `acquiredAt` read as expired turns 1 red.
- **M6 is fixed.** Moving the exclusive power-off back to boot-only turns 2 red. Taking the keys
  from `pool.json` turns 3 red.
- **M7 is fixed.** Releasing the claim before the run turns `has the claim live while the run is in
  flight` red.
- **The reset retry is tested.** `attempts = 1` turns 3 red.
- The implementer's own sweep (`/tmp/x11-profile/sweep-fix1-final.log`, 21/21 red) is consistent
  with the above.
- **The report's corrections check out against `docs/tasks/X11/gates.jsonl`:**
  - The 10:47:10Z, 11:08:11Z and 11:54:46Z rows carry no lease and no device. The hygiene
    incident is now reported, and the AVD is deleted.
  - Item 5 is correct: 365.3 + 118.9 = 484.2 s sequential against 362.3 s concurrent (−25 %), on
    trees `9d9ce869206a` vs `de2e62c20e78`.
  - Q1's 142-vs-155 correction stands.
  - `check` passes at `911d1ce1b9fd` (177.9 s).
  - The appendix ledger extract matches the file line for line.
- **The fix-round section is inside its word cap.** It is 199 words, against a cap of 200.
- **N2–N5, N7 and N9 are addressed as described.** The docs no longer quote "54 s", "~200 s" or
  "3 minutes". `BENCH_GPU_MODE_NOTE` now answers N7 from git.

## Must fix

**M1 — Reap kills a device that a lease and a gate claim took during its own act pass.**
`DevicePool.reap` (`scripts/device-pool.mjs:1052-1141`) works in three passes:

1. It decides under `leases.lock`.
2. It releases the lock and acts on the pass-1 snapshot: `shutdownDevice(entry, { held:
   plan.held })` at `:1120-1124`. Both `entry.claims` and `held` date from pass 1.
3. It re-checks claims before *dropping records* (`:1170-1177`).

The doc comment at `:1019-1020` says this means "a run that started in the open window keeps its
device". That is false: the run keeps its *record*, and the device is already dead.

The window is every earlier device's I/O in pass 2. That is `simctl shutdown`, `adb devices` and
`emu avd name`, with timeouts of up to 120 s per adb call and 300 s per simctl call.

Probe (`/tmp/x11-rereview/race-probe.mjs`):

- Setup: two idle unleased records, `ios:UDID-B` then `avd:nitroui_a`.
- While the reaper is shutting down UDID-B, "task B" writes a live lease on pair-a and a live
  `harness:android` claim on the AVD. That is exactly what `acquire --boot` (warm reuse) plus
  `gate.mjs` do.
- Result: `kills=[["simctl shutdown","UDID-B"],["emu kill","emulator-5574",5043]]`. B's lease is
  live, the claim is live, and the record is kept.
- The control run without the interleave kills the same two devices.

Before N1, `acquire` and `claim` blocked on the lock, so this window did not exist. The N1 fix
traded a lock timeout for a mid-run kill.

Fix:

- Immediately before each device's I/O, re-take the lock. Re-read `leases.json` and that device's
  record, then recompute `heldIdentifiers` and `deviceIsBusy`.
- In pass 1, write `phase: 'reaping'` (with a timestamp and a bound, like `booting`) on the
  planned records. Make `claim()` refuse or wait on it, and make `ensureBooted` treat it as "not
  up yet". Clear it in pass 3.
- Add a test whose fake pass-2 op writes a lease and a claim mid-pass, as the probe does. It must
  leave the second device up.

**M2 — The between-task reset wipes the app under a live gate claim.**
`poolHandoff` runs `pool.resetPair(pair)` whenever `--boot` and `options.reset` are set
(`scripts/lease.mjs:774-786`). That includes the idempotent `sameTask` path (`:366-375`, `already:
true`; the comment at `:745-746` says `already` "still boots"). `resetPair`
(`device-pool.mjs:936-1008`) never consults claims or `deviceIsBusy`.

Failure scenario:

1. Task A starts `gate.mjs harness:ios --background`.
2. A re-runs `lease.mjs acquire --task A --boot --out a.env` in a new shell. Re-running acquire to
   regenerate an env file is what idempotent acquire is for.
3. The reset runs `adb shell pm clear nitroui.example` and `simctl uninstall <udid>
   nitroui.example` mid-suite.

Probe P1 (`/tmp/x11-rereview/probes2.mjs`): both records hold a live `harness:ios` claim, and the
output is `["pm clear emulator-5574 nitroui.example","simctl uninstall UDID-A nitroui.example"]`.

The same thing happens on a warm hand-off to a new lease while the previous lease's gate is still
running, for example when its lease was released mid-run.

Fix:

- Skip the reset when `result.already`.
- Skip any device whose record `deviceIsBusy`, and print "in use by pid … (gate) — not reset".
- Add a test for each case.

**M3 — "A leased pair is off-limits to the reaper" is false for the task's own reaper.**
`CONTRIBUTING.md` (the new "Anything started outside `gate.mjs` runs unclaimed" bullet) tells
agents that unclaimed work (`bun run harness:*`, direct real-input, Metro, builds) is protected
because "their pair is leased, and a leased pair is off-limits to the reaper".

But `reap` exempts the caller's own lease:

- `exceptLeaseId = this.env.NITRO_UI_LEASE_ID` (`device-pool.mjs:1036`).
- It feeds both `heldIdentifiers` (`:1253`) and `poolReapDecision`'s `held` (`lease-core.mjs:228`).
- The env file exports that variable (`lease-core.mjs:757`).
- The test `still reaps its own idle devices while holding a lease` enshrines the behaviour.

`lastUsedMs` only moves on claim, release or hand-off.

Failure scenario:

1. Task A acquires.
2. A builds for 20 minutes, then starts a direct `real-input/android.mjs` run, which takes about
   12 minutes and makes no claim.
3. 31 minutes after the hand-off, A runs `lease.mjs list` in its sourced shell. AGENTS/CONTRIBUTING
   tell everyone to run `list` routinely.
4. A's own emulator is killed mid-run.

Probe P3: `["emu kill emulator-5574"]`.

The code's rationale (`lease-core.mjs:224-227`: "treating your own hold as protection would stop
the clock firing for anyone") does not hold. Every *other* process's reap already treats that hold
as protection. So the exemption only ever reaches devices under the caller's own live lease, and
never an abandoned boot.

Fix: let the caller's own live lease protect its devices on the idle path. Keep the exemption only
for the exclusive power-off, which needs it because it holds every pair. Then update the test
above to the new rule.

**M4 — The report says no harness-path code moved; the fix round changed the Android harness
patch.** The report says "no harness-path code has moved since the green runs at `9d9ce869206a`"
(`X11-device-throughput.report.md:306-307`, repeating `:62-64` and `:289-290`). Commit `1487e34`
rewrote `patches/@react-native-harness%2Fplatform-android@1.6.0.patch`: `-port` handling now
throws, where it used to drop the flag silently. It also changed `scripts/emulator-launch.mjs`.

The stale `harness:android` row is therefore not "the same harness path on an older tree". The
risk is low: a valid `EMULATOR_PORT` takes the same branch as before. But the claim is false, and
it is the argument for Question 2's option B.

Fix: correct the sentence. The device rows have to re-run at merge regardless.

## Nits / follow-ups

**N1 — A corrupt `pool.json` fails open for claims.**
`readPool` moves the file aside and returns an empty state (`device-pool.mjs:119-140`), and `reap`
then proceeds. On the exclusive path, `declaredEntry` builds claim-less records for every declared
key, and the reap shuts them all down.

Probe P2:

- Setup: the corrupt file held a live claim on `nitroui_b`, and that claim's lease had already gone.
- With the corrupt file, `emu kill emulator-5576` runs.
- With a readable file, it does not.

This needs a gate that outlived its lease, so it is a nit. Fix: when `recovered` is set, skip the
reap for that call, or treat every record as busy for it.

**N2 — A tool timeout reads as "already off", and the pool forgets a live device.**
`attachedSerials` and `simulators()` ignore exit status and timeouts (`:272-282`, `:381-397`).
`shutdownDevice` returns `'already'` (`:1301`, `:1324-1325`), and pass 3 drops the record.

Probe P4: an empty `adb devices` gives `alreadyOff`, with 0 records left. Nothing is killed, but the
emulator leaks out of the pool until an exclusive acquire. Fix: a non-zero or timed-out status
should mean `'failed'`, not `'already'`.

**N3 — Some guards are untested, so a mutation leaves every test green.** Each of these went green
under a mutation:

- the held check inside `shutdownDevice` (Android `:1320`, iOS `:1297`);
- the exclusive declared-path skip (`:1154`). These layers mask each other, so no single one is
  proven.
- the `emu avd name` parser (`:302`) accepting any answer;
- **removing the `markBooting` call from `ensureBooted` (`:849`)**.

The report credits `49c5f02` with fixing "nothing called `markBooting`". But its test calls
`markBooting` directly, and its sweep mutates inside `markBooting`. So the call site the fix added
is still unguarded. Add a test through `ensureBooted`.

**N4 — Reset completeness is only proven against fakes.**
The first review asked for one device check: write a value, reset, read it back. The report says it
was blocked by `A4`, which is fair, but it is still owed.

The scope of "provably complete" is also worth stating:

- `simctl uninstall` leaves keychain items and privacy/TCC grants. `simctl privacy … reset all
  <bundle>` covers the latter.
- The CLI stub's `get_app_container` always exits 1, so only the `device-pool.test.js` fakes
  exercise a surviving container.
- The stub's unknown-package `pm clear` answer has not been checked against API 35.

**N5 — A misleading reset failure on a fresh AVD.** On an AVD where the app has never been
installed, `pm clear` fails four times, with sleeps. It then prints "the next run inherits its
data", when there is no data to inherit. Tell "not installed" apart from "refused".

## Verdict: FIX ROUND

Must fix:
- M1 — Reap's decide/act split lets a lease and a gate claim taken mid-pass be ignored, so `emu kill` hits a leased, claimed device; the doc comment's "keeps its device" is false (`device-pool.mjs:1019-1020`, `:1052-1141`).
- M2 — `resetPair` ignores claims, so an idempotent re-`acquire --boot` runs `pm clear`/`simctl uninstall` under the task's own running gate (`lease.mjs:366-375`, `:774-786`; `device-pool.mjs:936`).
- M3 — Own-lease exemption (`NITRO_UI_LEASE_ID`) lets a task's own `list` kill its claim-less run; CONTRIBUTING's "a leased pair is off-limits to the reaper" is false (`device-pool.mjs:1036`, `lease-core.mjs:224-228`).
- M4 — The report's "no harness-path code has moved" is false: `1487e34` changed the Android harness patch (`report.md:306-307`).

Nits:
- N1 — A corrupt `pool.json` is recovered as empty and the reap proceeds; an exclusive acquire then kills a device whose claim was in the lost file (`device-pool.mjs:119-140`).
- N2 — An `adb devices`/`simctl list` failure or timeout reads as "already off", and the record of a live device is dropped (`:272-282`, `:1301`, `:1324`).
- N3 — Removing the `ensureBooted`→`markBooting` call, the inner held checks, or the avd-name parser leaves all tests green (`:849`, `:1297`, `:1320`, `:1154`, `:302`).
- N4 — Reset completeness is only proven against fakes; the device write/reset/read check is still owed, and keychain and TCC grants survive the uninstall.
- N5 — On a fresh AVD with no app, the reset retries 4× and claims "the next run inherits its data".
