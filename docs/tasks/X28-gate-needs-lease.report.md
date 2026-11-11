# X28 — A device gate refuses to run without a lease

**Branch:** `task/X28-gate-needs-lease` (from `main` at `54563e53`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** none — the brief assigns no devices (tooling + unit tests only).

## Summary

`gate.mjs` now refuses a device gate before it starts unless `NITRO_UI_LEASE_ID` names a
lease that is still live in `leases.json`, belongs to the task and platform the run names,
and holds the device the environment names. That is `harness:*`, `real-input:*`,
`smoke:expo`, `smoke:rn-cli` and `bench`, filtered runs included (`isDeviceGate` reads
`resolveGate`'s answer, so a filter cannot slip past). `check` and `smoke:pack` touch no
device and still run from any shell.

The check is `deviceGateLeaseRefusal` in `scripts/gate-core.mjs` — pure, handed the store
rather than reading `~/.nitro-ui`, so every case is unit-testable. `gate.mjs` loads the same
two files `lease.mjs list` prints and prints `gate: refused before the run - …`, exit 1,
ahead of the build, the Metro pre-flight, the device claim and the ledger; a refusal records
nothing, because it is not evidence about a tree. There is no flag: an exclusive lease is
the bench host's way through, because it holds every pair — which is a state the check
reads, not an exemption.

Two decisions a reviewer needs:

- **The lease record is the authority, not the environment.** Device variables outlive a
  `release`, so a gate compares `IOS_SIM_UDID` / `ANDROID_SERIAL` / `ANDROID_AVD` /
  `ANDROID_ADB_SERVER_PORT` against the pair the lease holds. The serial is re-derived from
  the pair's console port, which is why `ANDROID_SERIAL=emulator-5554` with a lease for
  pair-a is refused. An unreadable pool is its own refusal — "cannot prove you own a
  device" must not read as "use any device".
- **The runners have no fallback left** (brief item 2). `requireLeaseDevice`
  (`scripts/lease-core.mjs`) answers "which device" from the lease and refuses a
  half-sourced env; `real-input/android.mjs` no longer scans `adb devices` for an AVD or
  defaults to `nitroui`, `bench/devices.mjs` refuses instead of printing "…; using
  emulator-55xx", and the harness config reads its simulator/AVD from the lease. CI keeps
  working: it names an AVD with no lease and is not a gate.

## Gates

```
ledger: code tree 78642b4db2af at HEAD 54563e5 (branch task/X28-gate-needs-lease, 1239 files)
ledger: platform trees ios 9ea1ff1b7e93 android 790ccb9680c3
```

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2075 tests / 87 suites | `78642b4db2af` | 2 m 57 s | start 6.9 / med 13.9 / max 25.3 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

`need --for review`: `need: 2 gate(s) missing for review: harness:ios,
harness:android` — deliberately left for the merge round, which the brief says runs the
device gates once. `check` is green; the two rows are owed because the diff touches
`example/rn-harness.config.mjs` and `scripts/real-input/android.mjs`, which map to both
platforms and are not on the check-only tooling list.

## Red proofs

Every new guard, one mutation each, reverted after:

- `gate-lease-required.test.js › refuses harness:android, runs nothing, and records nothing` -> `gate.mjs`: drop the `deviceGateLeaseBlock(resolved, process.env)` call -> `expect(run.stderr).toContain('gate: refused before the run')` (`scripts/__tests__/gate-lease-required.test.js:416`)
- `› refuses with no lease in the environment, and says how to get one` -> `gate-core.mjs`: `if (leaseId === '')` -> `expect(refusal).toContain('NITRO_UI_LEASE_ID is not set')` (:247)
- `› refuses an expired lease, by its own ttl` -> ignore `leaseIsLive` -> `expect(run.stderr).toContain('is outlived')` (:470)
- `› refuses a lease taken by another task` -> delete the task guard -> `expect(refusal).toContain('but NITRO_UI_LEASE_TASK says G6')` (:272)
- `› refuses a lease taken for the other platform` -> `leaseCoversPlatform` returns `true` -> `expect(refusal).toContain('taken for ios devices')` (:280)
- `› refuses a serial that is not the lease's, including a stranger's emulator` -> delete `if (bySerial.length === 0)` -> `expect({ over, status: run.status }).toEqual({ …, status: 1 })` (:516)
- `› refuses the machine's own adb server under a leased serial` -> delete the adb-server guard -> `expect(refusal).toContain("address the machine's own adb server")` (:313)
- `› runs check from a shell with no lease at all` -> `isDeviceGate` returns `true` for every gate -> `expect(run.ran).toBe(true)` (:571)
- `requireLeaseDevice › refuses an Android runner that names no serial — the incident's shape` -> `const strict = leased` (drop `requireDevice`) -> `expect(call).toThrow(/lease\.mjs acquire/)` (:630)
- `the Android runners have no device-list fallback › scripts/real-input/android.mjs` -> `requireDevice: false` -> `expect(body).toContain('requireDevice: true')` (:792)
- `the bench runner › refuses to switch to another emulator when its serial and AVD disagree` -> `if (false)` around the bench refusal -> `expect(out).toContain('is not the emulator running AVD')` (:757)
- `the harness config › declares the lease answer above the first thing that reads a device` -> move `const leaseDevice` below the `emulatorBoot` block (the shape it shipped in) -> the thrown `… reads a device before leaseDevice … is declared: TDZ at config time` (:857)
- the new refusal, seen from existing suites: `gate-check.test.js` and `lease-metro-port.test.js` both went red on their own fixtures (a harness run with no lease in the store) before they were given one — the same guard, on tests that predate it.

## Files changed

- `scripts/gate-core.mjs`: `isDeviceGate`, `deviceGatePlatform`, `deviceGateLeaseRefusal` (+ leased iOS/Android device checks).
- `scripts/gate.mjs`: `leaseStoreForGate`, `deviceGateLeaseBlock`, the refusal in `main()` after `resolveGate`.
- `scripts/lease-core.mjs`: `requireLeaseDevice`, `ACQUIRE_HINT`.
- `scripts/real-input/android.mjs`, `scripts/bench/devices.mjs`, `example/rn-harness.config.mjs`: device from the lease; no device-list fallback, no silent switch.
- `scripts/__tests__/gate-lease-required.test.js` (new, 45 tests), `scripts/__tests__/helpers/lease-store.js` (new), and the fixtures of `gate.test.js`, `gate-logs.test.js`, `gate-check.test.js`, `lease-metro-port.test.js`.
- `AGENTS.md`, `CONTRIBUTING.md`: the gate enforces the lease rule now.

## Follow-ups

- `scripts/smoke/common.sh`: still defaults `EMULATOR_PORT=5554` and boots its own emulator; the CI smoke job relies on it while `gate.mjs smoke:*` now refuses an unleased run — worth a look at how that job should lease.
- `scripts/__tests__/gate-logs.test.js`: `leaseHomeFor`'s `lease: false` option has no caller left now that an unleased device run cannot start.
- `scripts/gate.mjs`: `collectDeviceContext`'s "no lease id" branch is defence-in-depth only — a device run that reaches it is already refused at start.
- `scripts/__tests__/gate-lease-required.test.js`: the harness-config cases read the file as text because it refuses to load without a stamped app; a fixture-stamped config would let them run it instead.
