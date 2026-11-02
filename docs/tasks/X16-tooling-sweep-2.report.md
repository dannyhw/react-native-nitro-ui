# X16 — Tooling sweep 2

**Branch:** `task/X16-tooling-sweep-2` (from `main` at `3d8cfbf`) · **Rounds:** 1 (plus its own gate retry) + fix round 1
of up to 2 (D19) ·
**Lease:** `X16-np3gj`, then `X16-taq77` (`--exclusive --boot --platform both`, boot wait 209 s; `pair-a`: iOS
`49D5024D-967B-4B93-ACF6-F73BA0A19E9F` / `emulator-5574` / Metro `8295`)

## Summary

Round 1's four follow-ups plus a review round, each change shown red before green. Item 4's first version was wrong in a
way only a device run could show; item 2's fix, in a way only re-reading the contract showed.

**1 — a spawned test CLI no longer inherits the shell's lease.** `gate.test.js`'s `runCli`/`spawnCli` and
`gate-logs.test.js`'s `gitEnv` handed children `process.env`, so in a lease-sourced shell the suites read `METRO_PORT`,
`ANDROID_SERIAL` and `NITRO_UI_LEASE_ID` as if the test had set them; `check`'s test step went red on 25 tests. The fix
is a shared scrubber at every CLI spawn in those suites — a **deny-list, not an allow-list**: they need `PATH`, `HOME`
and `ANDROID_HOME`, and a test may still set a lease name, so the scrub runs *before* `extraEnv`. Its guard reads the
names from `lease-core.mjs`'s `exportLine` calls. Red needs a **listener** on the leased port: the Metro refusal, not the
env, lost the ledger line.

**2 — what `--exclusive` owes a bench.** `poolHandoff` skipped its body for an exclusive lease, so the documented
baseline-mint line powered the pool off and booted nothing (A6b booted by hand). Fixing that exposed three more faults,
all fixed here: it obeyed `--platform`'s `both` *default*, so an Android bench cold-booted a simulator (now refused,
before the lease exists); `NITRO_UI_LEASE_BOOT` could boot one, where only a typed `--boot` may; and `exceptLeaseId` had
it kill and restart the bench's own warm device, which an up device of the named platform is now spared.

**3 — `gate.mjs bench --help` is usage, not a gate run.** It resolved as `bench:--help`, exited 2, and appended a FAIL
row that `table` sorts first and `export` writes an excerpt for. `main()` now answers a probe before recording anything.

**4 — the iOS a11y pass re-reads a control's boxes until two reads agree** (`A11yFrameStability`, new). It agrees with
the *previous read* and nothing else — no expected frame — so a control whose boxes are stably wrong settles at once and
prints with its finding intact. The report notes the read count and the ratio between reads: a fix that retried its way
to a green must not look clean, and a ⅓-scale first read now reaches the summary as a WARN. That shape is unreproduced
here, and the rule still fails on a stable disagreement — the brief's "re-read and keep the failure" branch, not a claim
of innocence.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1640 tests / 62 suites | `1ff5330cba29` | 2 m 34 s | start 1.6 / med 3.3 / max 5.8 |
| `harness:ios` | **PASS** | 233 tests / 16 suites | `1ff5330cba29` (ios tree) | 3 m 57 s | start 2.2 / med 2.3 / max 2.7 |
| `harness:android` | **PASS** | 284 tests / 16 suites | `1ff5330cba29` (android tree) | 8 m 12 s | start 2.8 / med 2.0 / max 3.8 |
| `real-input:ios` | **PASS** | — | `1ff5330cba29` (ios tree) | 16 m 17 s | start 2.8 / med 3.9 / max 20.3 |
| `real-input:android` | missing | — | — | — | — |

`need --for review`: `need: review is satisfied on this code tree.` (check + both harnesses; it names
`real-input:android` under merge, not review — this diff's Android half is the harness, which is green.)
`real-input:ios` printed **zero** stability lines: all fourteen cases settled on two agreeing reads, which is the quiet
case `shouldReport` exists to keep quiet (it is proved red on the host, not here).

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

### Fix round 1

- `lease-pool-cli.test.js` "refuses an exclusive boot that did not name a platform" -> drop the
  `platformGiven` check in `exclusiveBootMisuse` -> that one case (`status` 0 where 2 was expected). Proved
  narrowly: the first mutation dropped the whole guard and went red on 14 unrelated cases, which is a broken
  mutation, not a proof.
- "boots nothing for an exclusive lease when only the environment asked" + "says the environment was ignored"
  -> `bootForLease` stops special-casing `--exclusive` -> 2 red. The same mutation first failed for the wrong
  reason: `bootForLease(options, exclusive)` was called with one argument, so `exclusive` was `undefined` and
  the env booted every lease. Fixed, and the case is what caught it.
- "leaves the bench's own warm device up…", "spares only the named platform's own device", "spares both of the
  pair…" -> `spare = []` -> 3 red; -> `upKeysFor(pair, 'both')`, sparing past `--platform` -> 3 red, two of
  them different cases. The first M3 attempt **did not apply** (prettier had joined the ternary onto one line,
  so the 45 passes proved nothing) — every mutation from here asserts its own substitution landed.
- "documents an exclusive boot the CLI actually accepts" -> CONTRIBUTING's bench line back to
  `--exclusive --boot` -> 1 red. Written by running the doc's own lines through the real CLI, so a doc fix that
  never happened cannot pass it. Restored files are checked by SHA after every mutation.
- `a11y-frame-stability.test.swift` -> `shouldReport` loses `reads > 2` -> `a flapped-back tree is still
  reported` + `five quiet reads are reported`. Binary deleted before each build, as above.
- `real-input-a11y-ios.test.js` "reports the re-read onto the check" -> the reporter computes the warning and
  never publishes it -> 1 red; -> `check.warn` downgraded to `check.note` (the item-4 failure exactly) -> 1 red.
  -> `iosStabilityWarning` returns for any ratio -> `warns nothing for a re-read that is not the screen-scale
  shape` + 1 more. This test replaced a text assertion on the call site that **stayed green** under the
  `if (false)` mutation: the text was still in the file, which is why the publish step moved into `a11y.mjs`.
- `real-input-suite.test.js` (new) is red by construction before the feature: `check.warn` did not exist, and
  the suite could not even import `Suite` — `support.mjs`'s `import.meta` is unparseable to jest, which is the
  reason `report.mjs` was split out. It asserts the re-export so the four existing importers cannot silently
  lose it.

## Files changed

- `scripts/__tests__/helpers/scrubbed-env.js`, `scripts/__tests__/test-env-scrub.test.js` (new); `gate.test.js`, `gate-check.test.js`, `gate-logs.test.js`, `ci-workflows.test.js`.
- `scripts/lease.mjs`, `scripts/__tests__/lease-pool-cli.test.js`, `scripts/device-pool.mjs`, `CONTRIBUTING.md`.
- `scripts/gate.mjs`, `scripts/gate-core.mjs`, `scripts/__tests__/gate.test.js`.
- `example/ios/NitroUiExampleUITests/A11yFrameStability.swift`, `scripts/native-tests/a11y-frame-stability.test.swift` (new), `RealInputTests.swift`, the project file, `scripts/native-tests.sh`; `scripts/real-input/a11y.mjs`, `scripts/real-input/ios.mjs`, `scripts/__tests__/real-input-a11y-ios.test.js`.
- `docs/tasks/FOLLOWUPS.md`.
- **Fix round 1:** `scripts/real-input/report.mjs` (new: `Suite`/`CheckLog`/`AbortedCheck`, moved from `support.mjs`, which re-exports them and gains `warn`), `scripts/__tests__/real-input-suite.test.js` (new), `scripts/lease.mjs` (`bootForLease`, `exclusiveBootMisuse`, the spare), `scripts/device-pool.mjs` (`devicesFor`/`isDeviceUp`/`upKeysFor`, factored out of `ensureBooted` so warm reuse and the spare cannot disagree), `CONTRIBUTING.md`, the two Swift files, and the three test suites above.

## Follow-ups

- real-input: the ⅓-scale wrapper read is unreproduced here; if it comes back on a *stable* pair of reads, it is an RN/XCUITest bug and not a flake, and the log now distinguishes the two.
- real-input: a WARN never moves the exit code, on purpose (the case passed), so a host that reads only exit codes still misses it. A `--strict-warn` flag, or a gate that records the WARN count in its ledger row, is the way to close that without making a transient finding red.
- gate-core: `scripts/lease.mjs` and `scripts/device-pool.mjs` are unmapped, so a lease-only fix re-owns both harness runs. Left alone deliberately — `lease-core.mjs` is listed as a device run's import for exactly this reason — but a lease-only round is the expensive case.

## Round 1, gate retry (the device run round 1 did not get)

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

`harness:android`'s refusal was mine but not for the reason the last report gave: the committed excerpt
says `no app to test`, and `ANDROID_HOME` being unset in my shell is what made `build-app.mjs` fail to
produce the `app.stamp` that message reads — one failure, two lines. Re-ran `check`,
both harnesses and `real-input:ios`, which prints **zero** stability lines — all fourteen settled on
reads one and two.

## Fix round 1 — the review's follow-ups

**Exclusive boot (MUST FIX).** `--exclusive --boot` with no typed `--platform` is refused *before the lease exists*:
`--platform`'s `both` default reached `ensureBooted`, so the documented bench line cold-booted a simulator under an
Android measurement. `NITRO_UI_LEASE_BOOT` no longer boots an exclusive lease — only a typed `--boot` does, and the
"devices not booted" line no longer suggests the variable that cannot. One up device of the leased pair is now spared the
power-off, for the named platform only, by leaving its key out of `shutdownKeys`; `exceptLeaseId` had the bench rebooting
the device it was handed. CONTRIBUTING says the power-off happens either way and the boot only with `--boot`, the bench
line names a platform, and a test runs every exclusive doc line through the real CLI.

**6.** Unset `ANDROID_HOME` is why no `app.stamp` was written — the excerpt's `no app to test`: one failure, two lines.

**WARN/print.** A ⅓-scale first read reaches the summary through `reportIosStability` (never a failure, the case passes
honestly); `shouldReport` prints on `reads > 2`, since A, B, A, A settles with `moved=0` and printed nothing.
