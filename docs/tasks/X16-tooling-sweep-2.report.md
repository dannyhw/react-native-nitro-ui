# X16 — Tooling sweep 2

**Branch:** `task/X16-tooling-sweep-2` (from `main` at `3d8cfbf`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `X16-np3gj` (`pair-a`: iOS `49D5024D-967B-4B93-ACF6-F73BA0A19E9F` / `emulator-5574` / Metro `8295`)

## Summary

Four follow-ups, each with a test shown red first.

**1 — a spawned test CLI no longer inherits the shell's lease.** `gate.test.js`'s `runCli`/`spawnCli` and
`gate-logs.test.js`'s `gitEnv` handed children `process.env`, so in a shell that had sourced a lease the
suites read `METRO_PORT`, `ANDROID_SERIAL` and `NITRO_UI_LEASE_ID` as if the test had set them. `check`'s
test step went red on 25 tests. The fix is a shared scrubber, `scripts/__tests__/helpers/scrubbed-env.js`,
applied at every CLI spawn in those suites plus `gate-check.test.js` and `ci-workflows.test.js`. A
**deny-list, not an allow-list**: the suites genuinely need `PATH`, `HOME` and `ANDROID_HOME`, and a test
must still be able to set a lease-scoped name deliberately, so the scrub runs *before* `extraEnv`. Its own
guard derives the scrubbed names from `lease-core.mjs`'s own `exportLine` calls, so a new lease variable
cannot slip past it. Reproducing the failure needs a **listener** on the leased port: `gate.mjs`'s Metro
pre-flight refuses the run, and that refusal — not the env itself — is what lost the ledger line.

**2 — `acquire --exclusive --boot` boots the pair it just powered the pool off for.** `poolHandoff`
skipped its body for an exclusive lease, so the documented baseline-mint line left both simulators off.
The power-off runs in `acquire` *before* that function, so the ordering the guard protected was already
kept. The old stub answered `adb devices` with the same text whatever had happened, so a killed emulator
still looked attached and the bug was invisible to the existing fixtures; the stub now keeps state.

**3 — `gate.mjs bench --help` is usage, not a gate run.** It resolved as `bench:--help`, exited 2, and
appended a FAIL row that `table` sorts first and `export` writes a failure excerpt for; it cost two
reports an explanation paragraph. `main()` now answers a probe with its own usage before anything is
resolved or recorded, on either side of `--` and in the colon-packed form.

**4 — the iOS a11y pass re-reads a control's boxes until two reads agree** (`A11yFrameStability`, new).
It agrees with the *previous read* and with nothing else — no expected frame, no reference box — so a
control whose boxes are stably wrong settles at once and prints with its finding intact. Bounded by a
read cap and a wall-clock budget; running out hands back the last read and says so, and the report notes
the read count and the ratio between the discarded box and the kept one, because a fix that retried its
way to a green must not look like a clean run. **On the ⅓-scale read itself:** I did not reproduce it —
it has not appeared on this host, and the rule still fails on a stable disagreement — so this is the
brief's "re-read and keep the failure" branch, not a claim that RN is innocent. The discarded box is now
named in the log and in the report, so the next occurrence is diagnosable rather than just flaky.

## Gates

<!-- `node scripts/gate.mjs table` -- filled in once the device rows are in. -->

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |

`need --for review`: <paste>.

`harness:ios` and `harness:android` are in this round because `need` asks for them, not because the
brief's "harness only if you change harness-side code" was read loosely: item 4 edits
`example/ios/NitroUiExampleUITests/**` (iOS-mapped), and `scripts/lease.mjs`, `scripts/native-tests.sh`
and `scripts/real-input/*` are outside the known prefixes, which counts as both platforms. The table
below is the ledger's answer, and `need --for review` is the bar this round checks itself against.

## Red proofs

- `test-env-scrub.test.js` (new) -> stop scrubbing `METRO_PORT` in `withoutLeaseEnv` -> `isLeaseScopedEnvName` case list.
- 4 suites -> export a lease env **and listen on `METRO_PORT=8295`** -> 25 failures, `gate.test.js`/`gate-check.test.js`/`gate-logs.test.js`: no ledger line, because the Metro pre-flight refuses the run. Green after: 1606 tests with that env exported and the port busy.
- `lease-pool-cli.test.js` "boots the pair an exclusive lease names" -> restore `if (!lease.exclusive)` -> `expect(booted).toBeGreaterThanOrEqual(0)` got `-1`; also red: "shuts unheld pool devices down…" (`booting android device nitro-ui-a:5574` missing), "boots only the platform…".
- `gate.test.js` "records nothing for a usage probe" -> delete the `isUsageProbe` branch -> `status` `2` where `0` was expected (the real runner's help exits 2, which is what made the row a FAIL).
- `a11y-frame-stability.test.swift` (new, in `test:native`) -> `while reads < maxReads` to a single read -> `a stable tree costs two reads` got `1` + 7 more; -> agreement changed to "matches the answer we want" -> `the disagreeing pair is not accepted (got 2)`; -> agreement loosened to the rule's half-point tolerance -> `half a point is a move`; -> budget checked after the read -> `no read is started past the budget`.
- `real-input-a11y-ios.test.js` "does not read a stability line as an element" -> drop the `kind !== 'node'` filter -> the phantom's `NaN` box/empty label; -> `previousAnchor` not read; -> any `key=value` line counts as stability; -> `settled` read as "present"; -> unreadable counts tolerated; -> Swift renames `elapsedMs` -> the print/parse agreement case.
- `describeDiscardedScale` -> a fixture one component off the ⅓ ratio -> the ⅓ sentence must not print.

## Files changed

- `scripts/__tests__/helpers/scrubbed-env.js`, `scripts/__tests__/test-env-scrub.test.js` (new); `gate.test.js`, `gate-check.test.js`, `gate-logs.test.js`, `ci-workflows.test.js`.
- `scripts/lease.mjs`, `scripts/__tests__/lease-pool-cli.test.js`, `scripts/device-pool.mjs`, `CONTRIBUTING.md`.
- `scripts/gate.mjs`, `scripts/gate-core.mjs`, `scripts/__tests__/gate.test.js`.
- `example/ios/NitroUiExampleUITests/A11yFrameStability.swift`, `scripts/native-tests/a11y-frame-stability.test.swift` (new), `RealInputTests.swift`, the project file, `scripts/native-tests.sh`; `scripts/real-input/a11y.mjs`, `scripts/real-input/ios.mjs`, `scripts/__tests__/real-input-a11y-ios.test.js`.
- `docs/tasks/FOLLOWUPS.md`.

## Follow-ups

- real-input: the ⅓-scale wrapper read is unreproduced here; if it comes back on a *stable* pair of reads, it is an RN/XCUITest bug and not a flake, and the log now distinguishes the two.
- gate-core: `scripts/lease.mjs` and `scripts/device-pool.mjs` are unmapped, so a lease-only fix re-owns both harness runs. Left alone deliberately — `lease-core.mjs` is listed as a device run's import for exactly this reason — but a lease-only round is the expensive case.
