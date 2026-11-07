# X20 — A real-input false green, an iOS lease that touches Android, and older iOS runtimes in the pool

**Branch:** `task/X20-gate-and-pool-fixes` (from `main` at `9626bbe7`) · **Round:** 1 of up to 3 (D19) ·
**Leases:** `X20-6gxmv` (iOS 26.5 look-check simulator / Metro `8297`), `X20-6l7i6` (pair-b, iOS only),
`X20-6pbaf` (pair-b: `emulator-5570` + iOS 27.0 `nitro-ui B` / Metro `8293`)

## Summary

**1. Android real-input false green.** `CheckLog.abort` now records which log threw each `AbortedCheck`
(a module-private `WeakMap`, not a field a check could copy). The runner's catch moved into one exported
helper, `runCheck(log, fn)` in `scripts/real-input/report.mjs`: an abort its own log recorded moves on as
before; an `AbortedCheck` the log never recorded (bare, or from another log) becomes a failure on that
control; any other error ends the run. `android.mjs` uses it, and its one bare `throw new AbortedCheck`
(the segmented-control corner probe) is now `t.log.abort`. iOS has no such catch: an abort there reaches
`main().catch` and exits 1, so it needed nothing. A text test keeps every other real-input file free of
`instanceof AbortedCheck` / `new AbortedCheck(`.

**2. The iOS-only lease that touched the emulator.** Cause: `poolHandoff` called `pool.resetPair(pair)` with
no platform, so every `--boot` reset both halves — `pm path` + `pm clear` on the emulator for an iOS lease
(and `simctl uninstall` for an Android one). `resetPair` now takes `platform`, and the hand-off passes the
lease's platform narrowed by the command's (`handoffPlatform`), for the boot as well: a task that leased
iOS and re-runs `acquire --boot` without `--platform` (default `both`) no longer boots or clears the
emulator. Nothing else in `acquire` addresses the other half; `adb devices` (a machine-wide listing for the
unowned-device warning) still runs. Logged run on pair-b after the fix: `--platform ios --boot` printed
one `reset ios:` line and no `reset avd:`.

**3. Older iOS runtimes (D42 item 1).** `devices.json` gains `iosRuntimes: [{ id, ios: { name, udid,
system }, metroPort }]`. `normalizeDevices` folds them into `pairs` as iOS-only entries carrying
`iosRuntime`, so the reaper, an exclusive lease's power-off and holds, `list` and the Metro/unowned checks
cover them unchanged. `decideAcquire` keeps them apart: only `--ios-runtime <v>` gets one, and it never
gets a default pair. `--ios-runtime` implies iOS and refuses `--platform android|both` and `--exclusive`;
a task already holding the other kind of lease is refused with the command to use. The env file exports
`NITRO_UI_LEASE_IOS_RUNTIME`, and `gate.mjs` refuses every device gate under it (only `check` and
`smoke:pack` run). `doctor --setup` creates `nitro-ui iOS <v>` per other available runtime (iPhone 17,
else the runtime's first iPhone — 27.1 lists only "iPhone Duo") and appends it, also to an existing file.
On this machine it created 26.5 and 27.1 and added two entries, nothing else changed; the 26.5 lease
booted it, reset only it, `harness:ios` was refused under it, and `release` left it booted.

**Decision to read:** a look-check lease counts against `maxDeviceLeases` (D13: a simulator boot is the
load the limit exists for). Documented in CONTRIBUTING "Older iOS runtimes, for look checks".

## Gates

Round 1 had `check`, `harness:ios` and `harness:android` green on `04114b070a8f` (lease `X20-6pbaf`);
the ledger keeps those rows. The current generated table is under "Fix round 1".

## Red proofs

- `real-input-suite.test.js` "fails the run for a bare AbortedCheck…" (+2) -> `runCheck` swallows every `AbortedCheck` (the old catch) -> `Expected: 1, Received: 0` (3 red)
- `real-input-suite.test.js` "is the only catch for AbortedCheck…" -> the old `try/catch instanceof AbortedCheck` put back in `android.mjs` -> `+ "android.mjs:4772"`
- `lease-pool-cli.test.js` "touches only the simulator / emulator…" -> `pool.resetPair(pair)` without `platform` -> `Expected substring: not "reset avd:"` / `not "reset ios:"` (3 red)
- `lease-pool-cli.test.js` "keeps a re-acquired iOS lease on iOS…" -> hand-off uses `options.platform` instead of `handoffPlatform` -> `Expected substring: not "emulator @"`
- `lease.test.js` iOS-runtime selection cases -> drop the `iosRuntime` filter in `decideAcquire` -> 5 red, incl. "never hands one out to an ordinary acquire"
- `gate.test.js` "refuses every gate that drives a device…" -> `lookLeaseRefusal` always `null` -> red
- `doctor.test.js` "reuses its own simulator and leaves a runtime already listed alone" -> ignore configured runtimes -> red
- `lease-pool-cli.test.js` look-check lifecycle (2 cases) -> `lease.mjs` stops passing `iosRuntime` to `decideAcquire` -> both red (pair-a handed out, boot timed out)

## Files changed

- `scripts/real-input/report.mjs`, `support.mjs`, `android.mjs` — `runCheck`, recorded aborts, the bare throw.
- `scripts/device-pool.mjs`, `scripts/lease.mjs` — per-platform reset and boot; `--ios-runtime`, lease record, re-acquire rule, `list`.
- `scripts/lease-core.mjs` — `iosRuntimes` validation/normalization, `iosRuntimeKey`, `decideAcquire`, env line.
- `scripts/gate-core.mjs`, `scripts/gate.mjs` — `lookLeaseRefusal`, called first in `runGate`.
- `scripts/doctor-core.mjs`, `scripts/doctor.mjs` — runtime-simulator planning, `--setup` step, config check.
- `scripts/devices.example.json`, `CONTRIBUTING.md` — the new key and section.
- Tests: `real-input-suite`, `lease`, `lease-pool-cli`, `gate`, `doctor` (`scripts/__tests__/`).

## Follow-ups

- gate: `need` treats `scripts/lease*.mjs`, `device-pool.mjs` and `real-input/*` as both platforms, so a pool-only change needs both harness runs; the brief expected otherwise.
- lease: `--ios-runtime` with `NITRO_UI_LEASE_BOOT=1` boots a cold older simulator implicitly (load ~100 here); consider requiring a typed `--boot`.
- doctor: a runtime removed from Xcode leaves its `iosRuntimes` entry; `doctor` flags it, nothing prunes it.
- real-input (iOS): an abort there ends the whole run (`main().catch`), losing the remaining controls' results.
- review: the "only catch" text guard is easy to dodge (an aliased import or `catch (e) { if (e.name …) }`).
- review: `portWait` in `decideAcquire` spans both kinds of pair, so a busy look-check Metro shows in a default acquire's wait reason.
- review: the env file never unsets `NITRO_UI_LEASE_IOS_RUNTIME`, so sourcing a default lease over a look-check one keeps the refusal.
- review: `gate.mjs --background` detaches before the refusal, so the refusal lands in the log and `wait`, not the launching shell.
- review: the refusal reads only the env variable, not the lease record.
- review: the `gate.test.js:2747` comment overstates what the pure cases cover.
- review: committed ledgers carry simulator UDIDs in the device field.

## Fix round 1

Both mutations the review left green are now red, and `resetPair` has no default platform.

1. **CLI refusal tested.** A `describeCli` case runs `gate.mjs harness:ios` in a throwaway checkout
   whose `node` is the fake runner, so no device starts. With `NITRO_UI_LEASE_IOS_RUNTIME=26.5`: exit
   1, `refused before the run`, no runner output, empty ledger. Without it, the same checkout must
   record `harness:ios`.
2. **Doctor fixture.** Pair-b's Metro is 8297, so the new entries must be 8298 and 8299.
3. **`resetPair` requires `platform`.** It throws before asking any device. Every caller passes one,
   and a test pins the throw.

Fix round 1 had `check` green on `3bedd4c64da7`; its rows stay in the ledger, and the merge round's table replaces this one.

`need --for review`: `check` green. The harness rows are stale because `device-pool.mjs` counts as both platforms; both pairs were leased (Questions).

Red proofs:
- `gate.test.js` refusal case -> delete the `lookRefusal` block -> `Expected: 1, Received: 0`
- `doctor.test.js` "above the default floor" -> read only `iosRuntimes` ports -> `+ 8297`
- `device-pool.test.js` "which half" -> `platform = 'both'`, no guard -> `Received function did not throw`

## Questions for orchestrator

- Re-run both harness gates for review, or leave them to the merge run? This round changed one guard in `device-pool.mjs` plus tests, and both pairs are leased. I recommend leaving them to merge, which runs the full harness anyway; otherwise I wait for a pair.

## Merge round

Branch `task/X20-merge`, from `task/X20-gate-and-pool-fixes` at `a1889dce`, with `origin/main` merged in
(`c0c96887`). Main had four docs commits (`FOLLOWUPS.md`, `STATUS.md`). The merge was clean and touched
no generated file. Both apps were rebuilt on the merged tree.
The lease was `X20-9dxb5`, on pair-a (`emulator-5574` + iOS 27.0 `nitro-ui A`, Metro `8295`). It waited
about 20 minutes for E3's pair and is released, and no Metro is left on 8295.

All five merge gates passed on the first run: no flake, no re-run. `real-input:android` is the first real run
through `runCheck`, and it reports `22/22 controls passed · 0 press sequence(s) needed a retry · 20/20
auxiliary checks passed`. So the new catch leaves a green run green.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1812 tests / 70 suites | `3bedd4c64da7` | 2 m 55 s | start 4.4 / med 7.2 / max 11.5 |
| `harness:ios` | **PASS** | 444 tests / 25 suites + isolated 4 tests / 2 suites | `3bedd4c64da7` (ios tree) | 10 m 47 s | start 3.3 / med 4.3 / max 19.1 |
| `harness:android` | **PASS** | 493 tests / 25 suites + isolated 4 tests / 2 suites | `3bedd4c64da7` (android tree) | 14 m 55 s | start 17.6 / med 4.3 / max 17.6 |
| `real-input:ios` | **PASS** | — | `3bedd4c64da7` (ios tree) | 28 m 48 s | start 4.3 / med 6.2 / max 28.1 |
| `real-input:android` | **PASS** | — | `3bedd4c64da7` (android tree) | 40 m 34 s | start 7.6 / med 3.5 / max 7.7 |

`need --for merge`: `need: merge is satisfied on this code tree.`

`gate.mjs export` replaces `docs/tasks/X20/gates.jsonl` with the current branch's ledger. It dropped the task
branch's 6 lines, so they were restored above the merge branch's 5 (11 lines). The fix-round failure
excerpt is kept.

- Follow-up: `gate.mjs export` should append to a task's ledger across branches, not replace it.
- Follow-up: `task-ready` on `task/X20-merge` looks only for `X20-merge.report.md` or `X20.report.md`; run against a temporary copy, it passed all 6 checks.
