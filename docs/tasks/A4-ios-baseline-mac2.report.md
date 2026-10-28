# A4 — Why the iOS mint lost frames, the comparison-cell rule, and the iOS re-mint

**Branch:** `task/A4-ios-baseline-mac2` (from `main` at `db9619f`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `A4-297ow` (exclusive; iOS `49D5024D-967B-4B93-ACF6-F73BA0A19E9F`, no Metro port)

## Summary

**Root cause: the wait was shorter than the thing it waits for — and it was not the only cap.**
On this machine's canonical iPhone 17 simulator, `mount.date-picker` at N=200 on the two
`@expo/ui` arms presents its first frame at **p50 2 950 ms** (`expo-ui-host-per-control`) and
**2 702 ms** (`expo-ui-shared-host`), both *above* the 2 000 ms the runner waited. Nothing was
hung: at a 40 s ceiling the same cell completes **40/40** iterations, p90 3 049 ms. Worse and
invisible: the probe's native "no frame" backstop was a **hardcoded 2 s on both platforms**, so
it *was* the timeout however long JS waited. It is a 90 s ceiling now. Recorded reasons show
that timer firing late too (`waited up to 2 920 ms` when asked for 2 000) — it is queued on a
main thread still laying out 200 pickers, a second reason a 2 s rule could never hold.

**Our own cells were nowhere near the limit: no gate was biased.** In the mint, the slowest
`nitro-ui` frame is **302.8 ms** (`mount.segmented-control:200`) — **3.8 %** of the 8 000 ms
rule — and the slowest anywhere in 1 568 launches is **3 565 ms** on `expo-ui-host-per-control`
(44.6 %). A 2-launch sweep of all seven components at N=200 put our worst at 234.5 ms: 11.7 %
of the *old* rule, the brief's question. Nothing is within 25 % of its rule.

**What shipped.** (1) D9 amended: an incomplete metric costs **its own cell** on a comparison
arm (`expo-ui-*`) — left out, recorded in `skippedCells` with counts and reasons — while
`nitro-ui`, `nitro-ui-host` and `rn-core` still refuse the mint. (2) Every missing sample
records *why* (`probe-timeout` with the wait asked and run, `not-awaited`, `probe-error`),
per iteration, tallied per cell, printed in the progress line, quoted by a refusal.
(3) `presented` waits **8 000 ms**; `mounted` stays at 1 500 (measured max 226 ms). Asking
longer is a diagnostic that cannot mint, capped at 80 s against the 90 s backstop. The raise
is value-neutral for any cell already complete — an arriving sample keeps its stamp — and a
committed baseline has no incomplete cells, so mac-1's iOS and mac-2's Android files stay
valid. (4) `--scenario`/`--n` narrow a run; `--update-baseline` refuses a narrowed schedule
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
- `refuses a non-number and a value past the native ceiling` -> `MAX_REQUESTED_TIMEOUT_MS` past 90 s -> `✕`
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

**Cost of the longer wait: none measured.** The mint ran at 10.2 s/launch against A3's 10.1 s
under the 2 s rule — a launch waits for the frame, not for the timeout. Only a launch whose
frames never arrive pays, and the per-launch budget was raised (300 s, 420 s `leak`) so it
records 20 `probe-timeout` reasons instead of being killed as "stalled" with all data lost;
`--check` on the mint: 121 rows within tolerance, 74 noise-suppressed, 7 `new arm` (leak, as on
mac-1), **0 failures**.

**Probe-bias check (the brief's stop condition).** `presentedBeforeMount` — a presenting frame
that predates its own iteration's mount — is **12.5 %** of iterations on the mint, against
**12.3 %** on mac-1's committed file, on all four arms including the control. The wait does not
move it and mac-2 is not an outlier, so it is a pre-existing property of the metric (which frame
gets attributed), normalised away by the rn-core pairing. Not a reason to stop the mint; filed
below.

**Compactness (part 2b).** On the 800-iteration repro: an iteration with a reason is **296
bytes** vs **188** without (~108 per reason); the per-cell tally is 112 bytes for a 104-sample
gap; a healthy cell's `"missing":null` costs 4 bytes; a full-plan results JSON is 60 KB.

## Files changed

- `bench/src/plan.ts` — 8 000 ms default with the measurement beside it, `mountTimeout=`/
  `presentedTimeout=` launch flags, `MAX_TIMEOUT_MS` 80 s.
- `bench/src/probe.ts`, `runner.ts`, `types.ts` — `awaitStamp` returns the reason and the wait
  actually run; per-iteration `missing`; reasons recorded for `not-awaited` without waiting.
- `bench/modules/bench-probe/ios/HybridBenchProbe.mm`, `android/…/HybridBenchProbe.kt` — the
  "no frame" backstop becomes a 90 s ceiling on both instead of a silent 2 s.
- `scripts/bench/lib.mjs` — `COMPARISON_IMPLEMENTATIONS`, `baselineCompleteness`,
  `describeMissing`/`summarizeMissingReasons`, `skippedCellNotes`, `launchBudgetMs` +
  `DEFAULT_SCENARIO_BUDGETS`, `narrowingProblem`, `parseTimeoutFlags`, `--scenario`/`--n`.
- `scripts/bench/run.mjs`, `report.mjs`, `render.mjs`, `dry-run.mjs` — flags, per-cell reason
  lines, refusals that name counts and where the detail lives, launch budgets, narrowed-mint
  refusal at startup and in a dry run.
- `scripts/__tests__/bench-missing-samples.test.js` (44 tests), `bench-dry-run.test.js` (+1).
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
- tooling: pre-existing lint warning `scripts/__tests__/registry.test.js:651` (`manifests` shadow).
- docs: `docs/tasks/RECOVERY.md` still lists mac-2's iOS mint as owed; it is A3-lineage
  orchestration prose, so I left it for the orchestrator rather than editing another task's
  status.

## Questions for orchestrator

**Should mac-2's Android baseline be re-minted under the 8 s wait? Recommendation: no.**
Its committed file has 231 cells and exactly **one** awaited a presenting signal and lost a
sample (`mount.picker:expo-ui-host-per-control:50`, 1 of 9). The other 12 cells with missing
signals never wait at all — `mountSignal: false`, recorded as `not-awaited` — so a longer wait
cannot move them. One row out of 231, at 11 %, inside the 10 % allowance it minted under, is
not worth 5 hours of the only Android baseline this machine gates on. If it is ever re-minted
for another reason, do it under the new rule so its `timeouts` block gets recorded. Same
reasoning for mac-1: its iOS file has **zero** cells that awaited and lost a sample.
