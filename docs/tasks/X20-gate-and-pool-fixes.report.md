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

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1808 tests / 70 suites | `04114b070a8f` | 3 m 16 s | start 26.8 / med 32.0 / max 71.5 |
| `harness:ios` | **PASS** | 444 tests / 25 suites + isolated 4 tests / 2 suites | `04114b070a8f` (ios tree) | 11 m 01 s | start 203.1 / med 40.8 / max 203.1 |
| `harness:android` | **PASS** | 493 tests / 25 suites + isolated 4 tests / 2 suites | `04114b070a8f` (android tree) | 15 m 07 s | start 39.0 / med 6.1 / max 39.0 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

`need --for review`: `need: review is satisfied on this code tree.` `real-input:ios`/`:android` are the merge bar and were not run here; the `--ios-runtime` refusal of `harness:ios` was a by-hand check under lease `X20-6gxmv` (refused, exit 1, no ledger line), not a recorded gate

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

The reviewer's two surviving mutations are now red, and `resetPair` has no default platform.

1. **The CLI refusal is tested.** A `describeCli` case in `gate.test.js` runs `gate.mjs harness:ios` in a throwaway checkout whose `node` is the fake runner, so no device or harness ever starts. With `NITRO_UI_LEASE_IOS_RUNTIME=26.5` it asserts exit 1, `refused before the run`, no runner output and an empty ledger. Without the variable, the same checkout must run and record `harness:ios`, so "no line" cannot pass by accident.
2. **The doctor fixture no longer matches the answer.** A new case gives pair-b Metro 8297 and expects 8298 and 8299.
3. **`resetPair` requires `platform`.** It throws on a missing or unknown platform before asking any device. Every caller passes one, and a test pins the throw and the single-half resets.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1812 tests / 70 suites | `3bedd4c64da7` | 2 m 41 s | start 6.5 / med 6.7 / max 8.1 |
| `harness:ios` | stale | 444 tests / 25 suites + isolated 4 tests / 2 suites | 04114b070a8f (not this tree) | 11 m 01 s | start 203.1 / med 40.8 / max 203.1 |
| `harness:android` | stale | 493 tests / 25 suites + isolated 4 tests / 2 suites | 04114b070a8f (not this tree) | 15 m 07 s | start 39.0 / med 6.1 / max 39.0 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

`need --for review`: `check` green; `harness:ios`/`:android` are stale, because `device-pool.mjs` counts as both platforms. Both pairs were leased (E3, G19), so I did not re-run them — see Questions.

Red proofs:
- `gate.test.js` "exits 1 before the run…" -> delete the `if (lookRefusal != null)` block -> `Expected: 1, Received: 0`
- `doctor.test.js` "starts past a pair whose Metro is above the default floor" -> `addRuntimeSims` reads only `iosRuntimes` ports -> `+ 8297`
- `device-pool.test.js` "refuses to reset without being told which half" -> `platform = 'both'` default, no guard -> `Received function did not throw`

## Questions for orchestrator

- Re-run both harness gates for review, or leave them to the merge run? This round changed one guard in `device-pool.mjs` plus tests, and both pairs are leased. I recommend leaving them to merge, which runs the full harness anyway; otherwise I wait for a pair.

