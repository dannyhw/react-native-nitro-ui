# A4 — Why the iOS mint lost frames, the comparison-cell rule, and the iOS re-mint

**Branch:** `task/A4-ios-baseline-mac2` (from `main` at `db9619f`) · **Round:** 1, plus a fix
round (D19 cap 3) · **Lease:** `A4-297ow` (exclusive; iOS `49D5024D-967B-4B93-ACF6-F73BA0A19E9F`,
no Metro port) — round 1 only; the fix round leased no device (tooling, proven by `check`).

## Summary

**Root cause: the wait was shorter than the thing it waits for — and it was not the only cap.**
On this machine's canonical iPhone 17 simulator, `mount.date-picker` at N=200 on the two
`@expo/ui` arms presents its first frame at **p50 2 950 ms** (`expo-ui-host-per-control`) and
**2 702 ms** (`expo-ui-shared-host`), both *above* the 2 000 ms the runner waited. Nothing was
hung: at a 40 s ceiling the same cell completes **40/40** iterations, p90 3 049 ms. Worse and
Worse: the probe's native "no frame" backstop was a **hardcoded 2 s**, so it *was* the timeout
however long JS waited. iOS's is a named 90 s ceiling now; Android's stays 2 s (round 1, M1).
Recorded reasons show it firing late too (`waited up to 2 920 ms` when asked for 2 000): it is
queued on a main thread still laying out 200 pickers.

**Our own cells were nowhere near the limit: no gate was biased.** In the mint, the slowest
`nitro-ui` frame is **302.8 ms** (`mount.segmented-control:200`) — **3.8 %** of the 8 000 ms
rule — and the slowest anywhere in 1 568 launches is **3 565 ms** on `expo-ui-host-per-control`
(44.6 %). A 2-launch sweep of all seven components at N=200 put our worst at 234.5 ms — 11.7 %
of the *old* rule, the brief's question.

**What shipped.** (1) D9 amended: an incomplete metric costs **its own cell** on a comparison
arm (`expo-ui-*`) — left out, recorded in `skippedCells` with counts and reasons — while
`nitro-ui`, `nitro-ui-host` and `rn-core` still refuse the mint. (2) Every missing sample
records *why* (`probe-timeout` with the wait asked and run, `not-awaited`, `probe-error`),
per iteration, tallied per cell, printed in the progress line, quoted by a refusal.
(3) `presented` waits **8 000 ms on iOS**; `mounted` stays at 1 500 on both (measured max 226
ms). Android keeps 2 000 ms (round 1, M1 — see the Question). Asking for anything but the
platform's default is a diagnostic that cannot mint, capped at 80 s on iOS and 1 900 ms on
Android. The raise is value-neutral for any iOS cell already complete (an arriving sample keeps
its stamp), so mac-1's iOS file stays valid. (4) `--scenario`/`--n` narrow a run; `--update-baseline` refuses a narrowed schedule
before booting, because a baseline *is* the table `--check` gates.

**Re-mint:** `bench/baselines/maintainer-mac-2/ios27-sim-iphone17.json` — 196 cells, none
skipped, both DatePicker cells now 160/160.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 710 tests / 34 suites | `27419b695217` | 2 m 52 s | start 1.5 / med 2.7 / max 3.3 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `bench:--platform:ios:--plan:full:--launches:8:--update-baseline` | **PASS** | — | `27419b695217` | 266 m 07 s | start 1.8 / med 3.1 / max 8.8 |

`need --for review`: **satisfied on this code tree** — the diff is check-only tooling
(`scripts/bench/*`, `scripts/__tests__/*`, `bench/src/*` per the note), so no device gate beyond
`check` is asked for; the mint above is the device evidence and it is green on the same tree.
`gate.mjs export --task A4` commits the ledger.

## Red proofs

`node /tmp/a4/red.mjs <i|all>`, log `/tmp/a4/red-proofs-full.log`. 26 mutations, 25 red in the
suite; the 26th is runner CLI wiring no unit test can see and is proven at the CLI below.

- `tallies the reasons a cell lost its signals for` -> aggregator ignores `record.missing` -> `✕ … expect(received).toEqual`, 6 tests red
- `emits a reason per missing signal, per iteration` -> runner stops emitting the array -> `✕` that one test
- `round-trips the launch string into the app plan` -> app ignores `presentedTimeout=` -> `✕` round-trip + malformed-flag
- `refuses an rn-core gap, because it is every ratio denominator` -> `rn-core` counted as a comparison arm -> `✕` (2 tests)
- `refuses a nitro-ui gap, because that is the gated arm` -> every gap becomes a skipped cell -> `✕` (4 tests)
- `leaves a comparison arm with an incomplete metric out of the baseline` -> skipped cell still written into the table -> `✕`
- `points the refusal at where the per-iteration detail lives` -> left-out cell records no counts/reasons; refusal stops pointing at the detail -> `✕` (2 mutations)
- `refuses a run that waited longer than the rule the baseline records` -> mint no longer refuses a longer wait -> `✕` at `+1 ms` over the rule (a 10×-weakened guard needed the boundary value to show red)
- `caps a requested wait below the native backstop on both platforms` -> iOS backstop back to 2 s; Android backstop back to 2 s -> `✕` both
- `describes a pre-A4 gap as having no reason` -> pre-A4 gap reported as none-needed -> `✕`
- `counts the reasons for one launch, for the run progress line` -> progress line counts warmups -> `✕`
- `grows by the extra wait for every iteration of the launch` -> budget ignores the requested waits; and `Math.min` instead of `Math.max` -> `✕` both
- `refuses the mint for each filter, and names it` -> `narrowingProblem` inverts; `--n`/`--scenario` stop filtering -> `✕` three mutations
- `refuses to mint from a narrowed schedule, and says a plain run is fine` -> dry-run drops the guard -> `✕`
- `waits by the same defaults the baseline is minted under` -> app's presented wait reverts to 2 s -> `✕`
- `leaves the default run at the table value` -> runner's presented rule reverts to 2 s -> `✕` (4 tests)
- `starts above the most a default launch can spend waiting` -> budget base back to 180 s -> `✕`
- `tallies the reasons …` (+5 more) -> a missing sample filled with the timeout instead of dropped -> `✕` 6 tests
- `is the same table, read from the runner that uses it` -> runner raises only its own copy of the budgets -> `✕`
- `refuses a non-number and a value past the native ceiling` -> the cap past the ceiling -> `✕`
- **runner call site (not suite-visible):** `preflight.push(narrowed)` -> `if (false)` -> the CLI stops printing `the schedule is narrowed to 32 of 1568 launches` and proceeds toward a mint; restored and re-verified

Baseline readback, `node /tmp/a4/verify-mint.mjs`: prettier `--check` clean; `--check` exit 0;
`update.button:nitro-ui:50 presentedNs` divided by three (ratio **and** all eight
`launchRatios`) -> **exit 1**; file restored, sha256 `3a4233b7ab6ca17f` before and after.
(Tripling it instead exits 0 — the gate fails regressions, so the file has to claim the arm
used to be faster. My first attempt did that and passed, which is correct, not a bug.)

## The measurement

Four runs on the leased simulator, all at `a381aef`, load sustained under 4 before each
(`bench/results/*.ndjson`, gitignored):

| Run | Asked | Result |
| --- | --- | --- |
| default-wait repro | `mount.date-picker` N=200, 4 arms × 8 launches, 2 000 ms | `expo-ui-host-per-control` **56/160**, `expo-ui-shared-host` **69/160**, `nitro-ui` + `rn-core` 160/160 |
| 40 s ceiling | same cell, 4 arms × 2 launches, 40 000 ms | **40/40 all four arms**; p50 2 950 / 2 702 / 153 / 16 ms |
| our arm, all components | `--scenario mount --n 200 --only nitro-ui`, 2 launches | 280/280, worst 234.5 ms |
| **the mint** | `--plan full --launches 8 --update-baseline` | **1568/1568, 0 problems, 196 cells, `skippedCells: {}`**, timeouts recorded, `dirty: false` |

What survivor bias cost, in one row: at 2 000 ms `expo-ui-shared-host` reported **presented
97.3 ms** — the median of the iterations fast enough to answer — while the arm's real median is
**2 076 ms** (160/160, mint run). The mint rule's objection was that such a number is not a
measurement of the arm. It was right, and the fix is the wait, not an exception.

Same cell, one day apart, same machine, same tree:

```
2 000 ms  [2/32]  …expo-ui-host-per-control:200 launch 1/8 ... 20 iterations, 10 presented probe-timeout (2000 ms)
8 000 ms  [150/1568] …expo-ui-host-per-control:200 launch 1/8 ... 20 iterations (83.3s)
```

**Cost of the longer wait: none measured, on iOS.** The mint ran at 10.2 s/launch against A3's
10.1 s under the 2 s rule — a launch waits for the frame, not for the timeout. Only a launch
whose frames never arrive pays, and iOS's per-launch budget was raised (300 s, 420 s `leak`) so
it records 20 `probe-timeout` reasons instead of being killed as "stalled" with all data lost
(Android's table stays at 180 s / 300 s because its waits never changed). On Android the cost
was measured, and it is what scoped the change to iOS: its 8 losing `update.progress` /
`update.picker` `@expo/ui` cells await both signals and time out on **every** iteration, so 6 s
x 8 cells x 8 launches x 25 iterations is ~2.7 h added to a ~5.2 h run at ~80 % of that
platform's launch budget — for cells whose arms never draw a frame there. See the Question
below, which this round answers differently.
`--check` on the mint: 121 rows within tolerance, 74 noise-suppressed, 7 `new arm` — one per
leak scenario, because no arm climbed monotonically in any run so those cells store no slope
(mac-1's file shows the same 6, one fewer only because it was minted before `Picker`), **0
failures**.

**Probe-bias check (the brief's stop condition).** `presentedBeforeMount` — a presenting frame
that predates its own iteration's mount — is **11.9 %** of the mint's iterations that have a
presented sample (10.6 % over all measured iterations), against **12.3 %** on mac-1's committed
file, on all four arms including the control. The wait does not
move it and mac-2 is not an outlier, so it is a pre-existing property of the metric (which frame
gets attributed), normalised away by the rn-core pairing. Not a reason to stop the mint; filed
below.

**Compactness (part 2b).** On the 800-iteration repro: an iteration with a reason is **296
bytes** vs **188** without (~108 per reason); the per-cell tally is 112 bytes for a 104-sample
gap; a healthy cell's `"missing":null` costs 4 bytes. Measured against the mint instead of the
repro (round 1): that results JSON is **2.32 MB** (the 60 KB figure was the 32-launch repro),
and 800 `iter` records carry a reason at a total of 133.6 KB — **~84 bytes per entry, 2.0 %** of
the 6.79 MB NDJSON. Every healthy run pays that 2.0 %, because its reasons are all
`not-awaited`.

## Files changed

- `bench/src/plan.ts` — `BENCH_DEFAULT_TIMEOUTS`, per platform (iOS 8 000 ms with the
  measurement beside it, Android unchanged at 2 000 ms) with each platform's native ceiling and
  requested-wait cap, `mountTimeout=`/`presentedTimeout=` launch flags, `parsePlan` now takes
  the platform.
- `bench/src/probe.ts`, `runner.ts`, `types.ts` — `awaitStamp` returns the reason and the wait
  actually run; per-iteration `missing`; reasons recorded for `not-awaited` without waiting.
- `bench/modules/bench-probe/ios/HybridBenchProbe.mm` — the "no frame" backstop becomes a named
  90 s ceiling instead of a silent 2 s, and the pacing timer gets its own constant.
  `android/…/HybridBenchProbe.kt` — the same rename, with the ceiling **left at 2 s** (M1).
- `scripts/bench/lib.mjs` — `COMPARISON_IMPLEMENTATIONS`, `baselineCompleteness`,
  `describeMissing`/`summarizeMissingReasons`, `skippedCellNotes`, `launchBudgetMs` +
  per-platform `DEFAULT_SCENARIO_BUDGETS`, `narrowingProblem`, `parseTimeoutFlags`,
  `BASELINE_TIMEOUTS_MS`, `timeoutRuleProblem`, `--scenario`/`--n`.
- `scripts/bench/run.mjs`, `report.mjs`, `render.mjs`, `dry-run.mjs` — flags, per-cell reason
  lines, refusals that name counts and where the detail lives, launch budgets, narrowed-mint
  refusal at startup and in a dry run.
- `scripts/__tests__/bench-missing-samples.test.js` (55 tests) and
  `bench-dry-run.test.js` (22, two of them A4's).
- `docs/DECISIONS.md` (four D9 amendments), `docs/architecture/benchmarks.md`,
  `bench/baselines/README.md` (Status + the 8 s rule), and the new baseline file.

## Follow-ups

- bench: the native give-up can fire ~46 % late on a saturated main thread, so `waitedMs`
  measures a queue delay, not a precision clock. Harmless at a 90 s ceiling.
- bench: `presentedBeforeMount` reaches 98.8 % on `mount.button:nitro-ui:50` (mac-1: 33.1 %)
  while the run-wide mean matches mac-1's — per-cell it varies a lot across machines. The probe
  attributes *a* frame, not necessarily *this* transaction's. Outside A4's brief; a per-cell
  guard would need its own investigation.
- bench: `leak *:N=200` still records no slope on either machine and stays `new arm` (A1c's
  item, unchanged).
- bench (from M1, needs its own task): the 8 Android `update.{progress,picker}:expo-ui-*`
  cells that never produce a Fabric transaction should be declared platform-scoped
  `NO_MOUNT_SIGNAL` entries (not awaited, Android only), which retires 160 x 160 timeouts and
  the CPU rows that measure them. Round 1 scoped the wait to iOS instead of doing this, so the
  cells still measure what they measured before.
- bench (N6): iOS's 90 s ceiling now keeps each mount's `CADisplayLink`, its target and the
  capture alive for 90 s instead of 2 s, including during `memory`/`leak` launches, because
  `gCapture` is never cleared and every mount transaction arms a presentation. Each set is
  sub-KB so `bytesPerInstance` should not move, but it changes what is resident when the
  footprint is sampled; a future `memory`/`leak` refresh should re-measure before trusting a
  delta, or the timer should be cancelled when the display link fires.
- bench (N7): with Android reverted to its old ceiling and no behaviour change left in the
  Kotlin probe beyond the constant rename, the next Android bench run executes nothing new —
  the `stopFrameCapture`-on-timeout path added in round 1 was dropped in round 1 for that
  reason.
- tooling: pre-existing lint warning `scripts/__tests__/registry.test.js:651` (`manifests` shadow).
- docs: `docs/tasks/RECOVERY.md` still lists mac-2's iOS mint as owed; it is A3-lineage
  orchestration prose, so I left it for the orchestrator rather than editing another task's
  status.

## Questions for orchestrator

**Should mac-2's Android baseline be re-minted under the 8 s wait? Now moot: Android never
took the 8 s wait (round 1, M1).** The question as first answered here rested on a wrong
premise, which the review caught. What the committed Android file actually says (231 cells,
13 with a missing signal): 4 are `rn-core update.slider`/`update.progress` at N=1 and N=50,
which the runner does not await (`not-awaited`); 8 are `update.progress` and `update.picker`
on both `@expo/ui` arms at N=1 and N=50, which **await and time out on both signals on every
one of their 160 iterations** (`missingMount: 160`, `missingPresented: 160`) because those arms
never produce a Fabric transaction there (A3, "never mounted"); and exactly **one** is a real
partial loss — `mount.picker:expo-ui-host-per-control:50`, `missingPresented: 1` of **160**
(0.6 %), not "1 of 9 … 11 %" as this section said. So the 8 are not cells a longer wait could
fix — waiting 6 s longer per iteration changes their CPU rows (`opBatch` brackets the wait) and
adds ~2.7 h per Android run without recovering one sample — and the one 1-of-160 row is well
inside the completeness allowance. Nothing about Android's numbers, budgets or run times
changed, so its baseline stays valid as minted. If Android is ever re-minted for another
reason, its `timeouts` block will then record 1 500/2 000.

## Fix round 1

Review verdict **merge with fixes**; M1 and N1–N7, five commits.

**M1 (orchestrator: option c).** The 8 s wait is iOS-only. `BENCH_DEFAULT_TIMEOUTS`
(`bench/src/plan.ts`) is the one source, per platform; the budget table, mint rule and
requested-wait cap follow it. Android is back to 1 500/2 000 ms, a 2 s backstop and 180 s/300 s
budgets — pre-A4 — so its baseline and run times are as minted; its probe change is a rename and
the unexercised `stopFrameCapture` was dropped (N7). iOS keeps 8 s + 90 s (N6, Follow-ups).
**N1:** a mint is refused for any wait but the platform's, either direction, or none recorded;
`timeouts` reports what the app said or `null` — at startup and by `--dry-run` too. **N2:** the
test reads each armed timer's delay argument. **N3–N5:** numbers and stale comments corrected
(1 of 160; 4 un-awaited + 8 timing out). The never-mounting Android cells: `FOLLOWUPS.md`.

Red proofs (`test -> mutation -> red`; reverted, all green after):

- Android's effective waits -> app default to 8 000 (3 red), mint rule to 8 000 (5), ceiling
  constant to 90 s (2), either copy of the budget table (2 / 1), a shared 80 s flag cap (1),
  `launchBudgetMs` defaulting to iOS (1).
- N2's own mutation -> `}, PRESENTATION_CEILING_MS)` to `}, FRAME_TIMEOUT_MS)`, and iOS's
  `kBenchPresentationCeilingSeconds * NSEC_PER_SEC` to a literal `2.0` -> `arms each platform's
  measured presenting capture…` red (1 each); the reverse pairing (pacing onto 90 s) too.
- N1 -> upward-only guard, accepting a no-rule run, stamping today's default into a forced file
  -> the three mint-rule tests red (1 each); the dry-run CLI refusal red with the first.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 722 tests / 34 suites | `1ead5a49307f` | 2 m 57 s | start 2.5 / med 3.5 / max 6.4 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `bench:--platform:ios:--plan:full:--launches:8:--update-baseline` | stale | — | 27419b695217 (not this tree) | 266 m 07 s | start 1.8 / med 3.1 / max 8.8 |

`need --for review`: **satisfied on this code tree** — "the code diff is tooling (check-only)
only: `scripts/bench/*`, `scripts/__tests__/*` … no device gate is asked for beyond `check`".
The round's `check` is on `1ead5a49307f`. The mint row reads stale because a `bench:` gate is
keyed on the whole code tree at review (only `harness:`/`real-input:` use the per-platform
halves), and this round edited `scripts/`; `trees.ios` is byte-identical to the mint's run, and
`need` does not ask for it. No device was leased this round, so nothing was re-minted.

`need --for review`: **satisfied on this tree** — "the code diff is tooling (check-only) only:
`scripts/bench/*`, `scripts/__tests__/*` … no device gate is asked for beyond `check`". The mint
row is stale only because a `bench:` gate keys on the whole tree at review (`harness:` /
`real-input:` use the platform halves) and this round edited `scripts/`; `trees.ios` is identical
to the mint's run. No device leased this round, so nothing was re-minted.
