**Branch:** `task/X38-lease-unused-features` (from `task/W3-tooling-removal` at `a13e64d0`) ·
**Round:** 1 of up to 3 (D19) · **Lease:** none — the brief forbids one and no device gate ran.

## Summary

Both features are gone. `--ios-runtime` / `NITRO_UI_LEASE_IOS_RUNTIME`, the `iosRuntimes` pool
config, the doctor runtime-simulator setup, and the one `lookLeaseRefusal` in the gate exist only
for that option; `git grep` finds no reference to any of them outside other tasks' briefs and one
unrelated smoke-test log filename. The between-task app reset is gone with it: `resetPair` /
`resetAndroid` / `resetIos` / `busyDevices` and the five device operations they called (`clearAppData`, `deviceAppInstalled`,
`uninstallSimulatorApp`, `installSimulatorApp`, `simulatorDataContainer`), `EXAMPLE_APP_ID`,
`--no-reset` and the reset block in `poolHandoff`. 2,541 lines out, 90 in — the addition is
reworded comments.

**The reset's keep-or-delete evidence.** The brief asks for a run that inherited app state and went
wrong. There is none: `git log --all --grep` for inherit / stale-app-data / app-data finds only
lease-env inheritance and React Native recycle bugs, and no report blames a failure on a previous
task's storage. X29 listed "stale app data" as a *candidate* for Form's pair-a-only E4 failure and
its own report rules it out — the cause was a content-width/adoption bug. What the reset did
produce is recorded three times: X11 re-review M2 (it wiped the app under a live gate claim), X20
item 2 (an iOS-only lease ran `pm clear` on an emulator another task was using), and X11 re-review
N5 (a fresh AVD read as a failed reset). X11's own commit `da0b31f9` says the honest part: an
uncleared device is usable, it just inherits state. So it went.

**Two deviations.** The G16 FOLLOWUPS line was *trimmed*, not deleted: only the "add an iOS 26.x
pair to the pool … prove the reset red there" clause went, so the unrelated "G16 touch cancel is
unproven below iOS 27" gap record survives. And `docs/DECISIONS.md` D42 item 1 gets a bracketed
withdrawal note rather than a rewrite, because that paragraph records an owner decision the pool no
longer implements but the ControlGroup probe still refers to.

Nothing else moved: `acquire`, `release`, `list`, `reap`, exclusive leases, the queue, `--boot` and
the gate's lease check pass unchanged, apart from the deleted tests. No lease was acquired and no
device gate ran.

## Gates

`gate.mjs status` still reads `check` **green** at this branch's tip: the report and its ledger
export are outside the 1,285-file tree that row is keyed to, so committing them re-owns nothing.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1947 tests / 88 suites | `b1b892bb1575` | 1 m 58 s | start 8.6 / med 22.5 / max 31.6 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

`need --for review`: `need: 2 gate(s) missing for review: harness:ios, harness:android` — expected
and deliberate. Lease and pool code is not on the check-only list in `scripts/gate-core.mjs`, so
`need` asks for a device run of both halves; the brief withholds both pairs (in use by other tasks)
and leaves those runs to the merge.

## Red proofs

No new test was added — this task deletes behaviour — so the mutation rule was exercised only on
the three tests that had to be rewritten to keep their teeth without the reset:

- `lease-pool-cli.test.js` "boots the pair it hands out…" -> re-add a `-s <serial> shell pm clear`
  to the hand-off's device check -> `expect(line).toContain('getprop sys.boot_completed')` red with
  `Received: "adb -P 5043 -s emulator-5574 shell pm clear nitroui.example"`.
- "touches only the simulator for an iOS-only lease" -> `handoffPlatform` always returns `both` ->
  `expect(log()).not.toContain('emulator @')` red.
- "touches only the emulator for an Android-only lease" -> same mutation ->
  `expect(log()).not.toContain('simctl boot')` red.

Both mutations are recorded as data in `docs/tasks/X38/mutations.json`, with the source text each
one replaced. Every deleted test is deleted because what it asserted no longer exists. The two `handoffPlatform`
cases that predate this task — "keeps a re-acquired iOS lease on iOS when the second acquire names
no platform" and "boots only the platform an exclusive lease was taken for" — go red under the same
mutation, so the narrowing lost no coverage with the reset tests.

## Files changed

- `scripts/lease.mjs`, `scripts/lease-core.mjs`, `scripts/device-pool.mjs` — the two features.
- `scripts/doctor.mjs`, `scripts/doctor-core.mjs`, `scripts/devices.example.json` — runtime sims.
- `scripts/gate.mjs`, `scripts/gate-core.mjs` — the `--ios-runtime` look-lease refusal only.
- `scripts/__tests__/{lease,lease-queue,lease-pool-cli,device-pool,device-ops,doctor,gate}.test.js`
  — deletions, plus the three rewritten cases.
- `CONTRIBUTING.md`, `docs/DECISIONS.md`, `docs/tasks/FOLLOWUPS.md` — the two sections and rows.

## Follow-ups

- `scripts/smoke/common.sh:376`: `ios-runtime.log` is an artefact filename, not the removed flag —
  left alone, but the name now reads like a reference to it.
- CONTRIBUTING now says a warm pooled device keeps app data, keychain and TCC grants; a test that
  needs clean app state must create its own device. Nothing in the harness does that today.
- `docs/DECISIONS.md` D42 item 1 is annotated, not amended — the owner may want the entry rewritten.
