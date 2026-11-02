# X16 — Tooling sweep 2

**Branch:** `task/X16-tooling-sweep-2` (from `main` at `3d8cfbf`) · **Rounds:** 1 + fix round 1 of up to 3 (D19) ·
**Lease:** `X16-np3gj` (`pair-a`: iOS `49D5024D-967B-4B93-ACF6-F73BA0A19E9F` / `emulator-5574` / Metro `8295`)

## Summary

Four follow-ups, each shown red before green. Item 4's first version was wrong in a way only a device
run could show (**Fix round 1**).

**1 — a spawned test CLI no longer inherits the shell's lease.** `gate.test.js`'s `runCli`/`spawnCli` and
`gate-logs.test.js`'s `gitEnv` handed children `process.env`, so in a shell that had sourced a lease the
suites read `METRO_PORT`, `ANDROID_SERIAL` and `NITRO_UI_LEASE_ID` as if the test had set them; `check`'s
test step went red on 25 tests. The fix is a shared scrubber, `scripts/__tests__/helpers/scrubbed-env.js`,
applied at every CLI spawn in the four affected suites. A **deny-list, not an allow-list**: the suites need
`PATH`, `HOME` and `ANDROID_HOME`, and a test must still be able to set a lease-scoped name deliberately,
so the scrub runs *before* `extraEnv`. Its guard takes the names from `lease-core.mjs`'s own `exportLine`
calls, so a new lease variable cannot slip past. Red needs a **listener** on the leased port: the Metro
pre-flight's refusal, not the env, is what lost the ledger line.

**2 — `acquire --exclusive --boot` boots the pair it just powered the pool off for.** `poolHandoff`
skipped its body for an exclusive lease, so the documented baseline-mint line left both simulators off.
The power-off happens in `acquire` *before* it, so the ordering the guard protected was already kept. Its
stub answered `adb devices` identically whatever happened, so a killed emulator looked attached; it now
keeps state.

**3 — `gate.mjs bench --help` is usage, not a gate run.** It resolved as `bench:--help`, exited 2, and
appended a FAIL row that `table` sorts first and `export` writes a failure excerpt for; it cost two
reports an explanation paragraph. `main()` now answers a probe with its own usage before anything is
resolved or recorded, either side of `--` included.

**4 — the iOS a11y pass re-reads a control's boxes until two reads agree** (`A11yFrameStability`, new).
It agrees with the *previous read* and nothing else — no expected frame, no reference box — so a control
whose boxes are stably wrong settles at once and prints with its finding intact. The report notes the read
count and the ratio between reads: a fix that retried its way to a green must not look like a clean run.
**On the ⅓-scale read:** unreproduced here, and the rule still fails on a stable disagreement — the brief's
"re-read and keep the failure" branch, not a claim that RN is innocent.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1619 tests / 61 suites | `dac3eaed3f83` | 2 m 36 s | start 2.4 / med 3.8 / max 5.0 |
| `harness:ios` | **PASS** | 233 tests / 16 suites | `dac3eaed3f83` (ios tree) | 3 m 51 s | start 2.2 / med 2.6 / max 3.7 |
| `harness:android` | **PASS** | 284 tests / 16 suites | `dac3eaed3f83` (android tree) | 8 m 17 s | start 8.2 / med 2.0 / max 8.2 |
| `real-input:ios` | **PASS** | — | `dac3eaed3f83` (ios tree) | 16 m 19 s | start 2.5 / med 3.4 / max 10.5 |
| `real-input:android` | missing | — | — | — | — |

`need --for review`: `need: review is satisfied on this code tree.` (check + both harnesses; it names
`real-input:android` under merge, not review — this diff's Android half is the harness, which is green.)

`harness:ios` and `harness:android` are in this round because `need` asks for them, not because the
brief's "harness only if you change harness-side code" was read loosely: item 4 edits
`example/ios/NitroUiExampleUITests/**` (iOS-mapped), and `scripts/lease.mjs`, `scripts/native-tests.sh`
and `scripts/real-input/*` are outside the known prefixes, which counts as both platforms. The table
above is the ledger's answer, and `need --for review` is the bar this round checks itself against.

## Red proofs

- `test-env-scrub.test.js` (new) -> stop scrubbing `METRO_PORT` in `withoutLeaseEnv` -> `isLeaseScopedEnvName` case list.
- 4 suites -> export a lease env **and listen on `METRO_PORT=8295`** -> 25 failures, `gate.test.js`/`gate-check.test.js`/`gate-logs.test.js`: no ledger line, because the Metro pre-flight refuses the run. Green after: 1619 tests with that env exported and the port busy.
- `lease-pool-cli.test.js` "boots the pair an exclusive lease names" -> restore `if (!lease.exclusive)` -> `expect(booted).toBeGreaterThanOrEqual(0)` got `-1`; also red: "shuts unheld pool devices down…" (`booting android device nitro-ui-a:5574` missing), "boots only the platform…".
- `gate.test.js` "records nothing for a usage probe" -> delete the `isUsageProbe` branch -> `status` `2` where `0` was expected (the real runner's help exits 2, which is what made the row a FAIL).
- `a11y-frame-stability.test.swift` (new, in `test:native`) -> the budget checked before *every* read,
  exactly as first shipped -> `a budget smaller than one read's cost still buys the second read (reads=1)`
  + 2 more. This is the mutation the device found, and it needed a charging clock (`slowScript`) to see:
  with the original free-read fake it stays green. -> the loop never re-reading -> `a stable tree costs
  two reads, not six (got 1)` + 22 more; -> `Outcome.first` set to the previous read -> "`first` is the
  stale read, not the agreeing read that preceded the settle"; -> `moved` measured last-vs-previous ->
  `moved counts first-vs-last frames (got 0)`; -> agreement loosened to the rule's own half-point
  tolerance -> `half a point is a move`; -> agreement widened to also accept the wrapper's box matching
  the control's, i.e. waiting for the answer -> `the disagreeing pair is not accepted (got 2)` + 4 more;
  -> the budget checked after paying for each read -> `a budget smaller than one read's cost still buys
  the second read (reads=3)` + 1 more. The binary is deleted before each build: one "proof" I first
  recorded was a stale binary for a mutation that never compiled.
- `real-input-a11y-ios.test.js` (new cases) -> drop the `kind !== 'node'` filter -> the phantom's `NaN`
  box and empty label; -> the parser ignores `firstAnchor*` -> `reads how many re-reads a case cost, and
  what the first read said` + 1 more; -> any `key=value` line counts as stability; -> `settled` read as
  "present"; -> unreadable counts tolerated; -> the Swift print renames `elapsedMs` -> the print/parse
  agreement case. `iosStabilityNote` claiming the ⅓-scale incident unconditionally -> `will not call the
  first read a scaled one unless every component says so`. That one is the bug I wrote and then checked
  for: the note is now only allowed to name a ratio it measured.

## Files changed

- `scripts/__tests__/helpers/scrubbed-env.js`, `scripts/__tests__/test-env-scrub.test.js` (new); `gate.test.js`, `gate-check.test.js`, `gate-logs.test.js`, `ci-workflows.test.js`.
- `scripts/lease.mjs`, `scripts/__tests__/lease-pool-cli.test.js`, `scripts/device-pool.mjs`, `CONTRIBUTING.md`.
- `scripts/gate.mjs`, `scripts/gate-core.mjs`, `scripts/__tests__/gate.test.js`.
- `example/ios/NitroUiExampleUITests/A11yFrameStability.swift`, `scripts/native-tests/a11y-frame-stability.test.swift` (new), `RealInputTests.swift`, the project file, `scripts/native-tests.sh`; `scripts/real-input/a11y.mjs`, `scripts/real-input/ios.mjs`, `scripts/__tests__/real-input-a11y-ios.test.js`.
- `docs/tasks/FOLLOWUPS.md`.

## Follow-ups

- real-input: the ⅓-scale wrapper read is unreproduced here; if it comes back on a *stable* pair of reads, it is an RN/XCUITest bug and not a flake, and the log now distinguishes the two.
- gate-core: `scripts/lease.mjs` and `scripts/device-pool.mjs` are unmapped, so a lease-only fix re-owns both harness runs. Left alone deliberately — `lease-core.mjs` is listed as a device run's import for exactly this reason — but a lease-only round is the expensive case.

## Fix round 1

`real-input:ios` ran 918 s and died on `iosStabilityNote is not defined` — never imported. Its log then
said the guard did not work: **`reads=1 settled=false`, fourteen times.** The budget was checked before
*every* read, and one read is a round trip for a whole subtree (measured 2.0–7.9 s; 63.8 s for the
fourteen first reads), so every case stopped after read one — the single-sample behaviour the type
exists to remove, with a note attached. `minReads` now pays for the pair whatever the clock says. The
unit tests could not see it: the fake clock advanced only on `pause`, so a read was free and every
budget looked generous. `Clock`/`slowScript` charge the clock per read.

The diagnostic was wrong too, in the way that wastes the next occurrence: the outcome carried *the read
before this one*, so a case settled by a third read printed an agreeing box and lost the stale one —
the ⅓-scale box the report exists to capture. It carries the **first** read now (`firstAnchor*`).

`harness:android`'s refusal was mine: `ANDROID_HOME` unset in my shell, not a code fault. Re-ran `check`,
both harnesses and `real-input:ios`: **zero** stability lines, all fourteen settling on reads one and
two.
