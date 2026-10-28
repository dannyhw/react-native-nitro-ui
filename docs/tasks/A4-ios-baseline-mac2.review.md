# A4 review — why the iOS mint lost frames, the comparison-cell rule, the iOS re-mint

**Branch:** `task/A4-ios-baseline-mac2` at `d4db8b8` (11 commits on `main`'s `db9619f`) ·
**Reviewer scope:** `git diff main...HEAD`, read-only. No devices, benches or builds were run.

## Verdict: MERGE WITH FIXES

The iOS work holds up. The root cause comes from recorded reasons and real measurements. The
comparison-arm rule is correct. The mint is clean, and I reproduced its readback. One premise
on the Android side is wrong, though, and the report's answer to the brief's Android question
rests on it. It does not affect gating: only `nitro-ui` gates, and no `nitro-ui` row on either
machine has ever lost a sample. But it is a false claim in three committed docs, and the next
Android run will pay for it. The fixes are wording plus one decision for the orchestrator (M1).
No code change is required to merge.

## What I verified

- **Tests:** `bench-missing-samples`, `bench-dry-run`, `bench-gate` and
  `bench-baseline-machine` pass under Node 24 (161/161).
- **Red proofs, re-run by mutating and reverting with `git checkout -- .`:**
  - `rn-core` counted as a comparison arm → 2 tests red.
  - A skipped cell still written into `cells` → `leaves a comparison arm … out` red.
  - `nitro-ui-host` treated as a comparison arm → `refuses a nitro-ui-host gap` red.
  - The runner stops emitting `missing` → `emits a reason per missing signal` red.
  - `narrowingProblem` never fires → 2 tests red.
  - `--n` stops filtering → 1 test red.
  - The progress line counts warmups → 1 test red.
  - Exception: reverting the native backstop at its call site stayed green on both platforms
    (N2).
- **Mint (`bench/results/99ec3a0-ios-20261028T160344Z.*`):**
  - Run: `dirty: false`, `problems: []`, plan `full`, 8 launches, 1 568 `meta` records,
    196 cells.
  - Waits: every launch waited 8 000 / 1 500 ms.
  - Missing samples: the only ones are the 4 `rn-core` cells declared `mountSignal: false`
    (all `not-awaited`). `skippedCells: {}`.
  - Worst frames: `nitro-ui` 302.8 ms (`mount.segmented-control:200`); all arms 3 564.7 ms;
    slowest mount 225.8 ms. All match the report.
  - The 3.9 s "slowest frame anywhere" can be traced to the 40 s diagnostic run (3 850.0 ms).
  - The 2 000 ms repro (`a381aef-…144850Z`) shows 104 and 91 `probe-timeout` reasons, i.e.
    56/160 and 69/160 arrived, as the report says.
- **Baseline file:**
  - Prettier is clean.
  - `report.mjs <mint> --check` with the `maintainer-mac-2` label exits 0 ("No gated metric
    exceeded").
  - Dividing `update.button:nitro-ui:50 presentedNs` (ratio and all 8 `launchRatios`) by
    three exits 1: `FAIL … presented: 3.00x`.
  - sha256 `3a4233b7ab6ca17f` before and after, as reported.
  - The `machine` block holds the label `maintainer-mac-2` for `hostname` and no home path
    (D25 is fine).
- **Value-neutral on iOS:** the stamp is the first display-link `targetTimestamp` after the
  mount, armed in the mount turn. The wait only decides whether that stamp is reported, so an
  arriving sample is unchanged.
  - mac-1's iOS file: the only cells with missing samples are the 4 `rn-core`
    `NO_MOUNT_SIGNAL` cells. The claim "stays valid" holds.
  - mac-2's Android file: see M1.
- **Comparison rule:** `baselineCompleteness` keys on the arm, as the brief asks.
  - `nitro-ui`, `nitro-ui-host` and `rn-core` refuse.
  - An `expo-ui-*` cell is left out, with `skipReason` plus `skipReasons` (counts and
    reasons), and the mint prints one line per left-out cell.
- **Gates:** `need --for review` is satisfied on `27419b695217`, and the ledger is exported.

## Findings

### M1 — The Android cells the report calls "never awaited" do await, so the longer wait changes their values and costs ~2.7 h per Android run

**Where:**
- `docs/tasks/A4-ios-baseline-mac2.report.md:169-170`
- `bench/baselines/README.md:195-197`
- `docs/DECISIONS.md:63`
- `docs/architecture/benchmarks.md` (the "value-neutral … every cell in it is one the longer
  wait leaves alone" paragraph)
- Mechanism: `bench/src/runner.ts:397` and `scripts/bench/run.mjs:116`

**Wrong premises:**
- The report says that, of the 13 Android cells with missing signals, the 12 besides
  `mount.picker` "never wait at all — `mountSignal: false`, recorded as `not-awaited`".
- `NO_MOUNT_SIGNAL` (`bench/src/plan.ts:84-91`) holds only `update.slider:rn-core` and
  `update.progress:rn-core`. That covers 4 of the 12.
- The other 8 are `update.progress` and `update.picker` on both `@expo/ui` arms at N=1 and
  N=50. They have `missingMount: 160` and `missingPresented: 160`, and they **await and time
  out** on both signals every iteration: `@expo/ui` never produces a Fabric transaction there
  (A3 report, "never mounted").
- The same report line gives `mount.picker:expo-ui-host-per-control:50` as "1 of 9 … 11 %,
  inside the 10 % allowance". The file says `missingPresented: 1` of 160 (0.6 %).

**Consequences on the next Android run under the 8 s rule:**
1. **The values change.** `runUpdateScenario` brackets CPU around `measureLatency`
   (`opBatch.start()` → waits → `stop()`), so `mainNsPerOp` and `jsNsPerOp` for those cells
   integrate main-thread work over the whole wait.
   - Today's wait is 1.5 + 2 s; under the new rule it is 1.5 + 8 s.
   - mac-2's Android `update.progress:expo-ui-shared-host:50` is already at 8 291× main CPU
     against `rn-core`, because `rn-core` is not awaited. A3 called its 47.9 ms/op "what an
     arm charges for work it never displayed".
   - Expect roughly 2.7× on those rows. mac-1's Android file has the same `update.progress`
     cells.
   - So the README, DECISIONS and benchmarks.md sentence "every cell in it answered inside
     the shorter wait, so it answers identically" is false for these committed rows. They are
     ungated comparison rows, so `--check` will not fail, but the quoted 0.09×/0.46× figures
     will move.
2. **Cost.** 8 cells × 8 launches × 25 iterations × 6 s of extra waiting is about 9 600 s,
   i.e. **~2.7 h added to a ~5.2 h Android full run**. "Cost of the longer wait: none
   measured" is an iOS-only measurement; the branch applies the wait to both platforms.
3. **Budget headroom.** Each of those launches now waits about 25 × 9.5 s = 237.5 s against
   the 300 s budget, which is ~80 % of it before app start and pacing. The report itself
   measured native give-ups firing up to ~46 % late on a busy main thread. On Android one
   late-firing stretch could kill such a launch as "stalled", which is a `problem` and refuses
   the Android mint. The budget raise in `ab12959` is what keeps this from failing outright;
   its comment cites a slow arm, not these cells.

**Fix:** correct the four docs and the report's Question.
- Name the 8 awaited cells, give the 1/160 figure, and state that comparison-arm CPU rows on
  those 8 cells move under 8 s.
- Put the Android cost and the budget headroom to the orchestrator as a decision. Options:
  - (a) add the Android `update.{progress,picker}:expo-ui-*` pairs to a platform-scoped
    `NO_MOUNT_SIGNAL`. This changes those rows once and removes the cost.
  - (b) keep 8 s on Android and accept the cost, with more budget headroom.
  - (c) scope 8 s to iOS.
- My recommendation is (a), done in a follow-up task, with an Android re-mint at the next
  convenient window. Gated rows are unaffected, so the mac-2 Android re-mint is not urgent,
  and the report's "no re-mint now" stands, but for the corrected reason.

### N1 — A shorter wait can mint, though the run says it cannot; a stale app is stamped 8 s

**Where:** `scripts/bench/run.mjs:760` and `scripts/bench/lib.mjs:2303`.

- `baselineBlockers` refuses only a wait *longer* than the rule. The test at
  `bench-missing-samples.test.js:608` asserts that a 1 000 ms run mints.
- The startup line says any `--timeout-*` run is "DIAGNOSTIC … cannot mint a baseline".
- Scenario: `--timeout-presented 1000 --update-baseline` mints. The DatePicker comparison
  cells become `skippedCells` rather than a refusal, which contradicts the message and D9's
  "the waiting rule … is 8 s".
- Separately, a run whose app predates the flag records `timeouts` of 0. `buildBaseline` then
  stamps the file 8 000 ms, although that app waited 2 s. Only a run that passed a flag gets
  the stale-app problem.
- **Fix:** refuse any non-default rule, or reword the message. Refuse a mint whose recorded
  timeouts are 0.

### N2 — The backstop test reads the constants, not the code that uses them

**Where:** `scripts/__tests__/bench-missing-samples.test.js:930`.

- Restoring the root cause at the call site stays green: Android `}, PRESENTATION_CEILING_MS)`
  → `}, FRAME_TIMEOUT_MS)`, and iOS `kBenchPresentationCeilingSeconds * NSEC_PER_SEC` →
  `2.0 * NSEC_PER_SEC`. I ran both; 44/44 passed.
- The report's red proof mutated the constants.
- **Fix:** also assert that the `postDelayed` in `armFrameCapture` and the `dispatch_after` in
  `BenchProbeArmPresentation` use the ceiling identifiers.

### N3 — Part 2b's size claims do not match the mint

**Where:** `docs/tasks/A4-ios-baseline-mac2.report.md:130` and `bench/src/types.ts:142`.

- The report says "a full-plan results JSON is 60 KB". The mint's JSON is 2.32 MB; 60 KB is
  the 32-launch repro.
- `types.ts` says "about 40 bytes … under 1 %". In the mint, 800 `iter` records carry
  `missing` (all `not-awaited`), costing 133.6 KB (~84 B per entry). That is 2.0 % of the
  6.79 MB NDJSON, and it is paid on every healthy run.
- Small in absolute terms; the stated numbers are what is wrong.

### N4 — Numbers in committed docs that the data does not support

- **`docs/DECISIONS.md:59`, `docs/architecture/benchmarks.md:84`:** "lost 40 % and 54 %".
  A3 lost 66 % and 46 % (55/160 and 87/160 arrived). The A4 repro lost 65 % and 57 %.
- **`bench/baselines/README.md:112`:** "4 h 24 min" is A3's figure. The ledger and the
  results give 15 967 s, i.e. 4 h 26 min.
- **`docs/tasks/A4-ios-baseline-mac2.report.md:122`:** `presentedBeforeMount` "12.5 %". The
  mint's file gives 11.9 % over iterations with a presented sample (10.6 % over all measured
  iterations). mac-1's 12.3 % reproduces. The conclusion is unchanged.

### N5 — Comments and docs left stale by the change

- **`scripts/bench/lib.mjs:2170`:** lists `nitro-ui-host` as a comparison arm that "leaves just
  that cell out". The code, D9 and `a381aef` say it refuses. This comment sits on the rule
  itself.
- **`bench/src/plan.ts:115`:** "Android: `FRAME_TIMEOUT_MS`". It is now
  `PRESENTATION_CEILING_MS`.
- **`bench/src/types.ts`:**
  - line 198: "default 2000".
  - line 232: the flag name `timeout=<ms>`; the flag is `mountTimeout=`.
  - line 150: "null when nothing was waited". `not-awaited` records the plan's timeout,
    e.g. `timeoutMs: [8000]` in the mint.
- **`scripts/bench/run.mjs:841`:** cites `staleTimeoutApp()`, which does not exist; the check
  is inline.
- **`docs/architecture/benchmarks.md:113`:** "the default 180 s budget … A default run's
  budget is unchanged". Defaults went 180 → 300 s and 300 → 420 s (`leak`).
- **`docs/architecture/benchmarks.md:579`:** still says "both platforms give up after 2 s
  (`FRAME_TIMEOUT_MS`)".

### N6 — The iOS backstop now holds each capture's objects for 90 s

**Where:** `bench/modules/bench-probe/ios/HybridBenchProbe.mm:197`.

- `gCapture` is never cleared, and `BenchProbeDidMount` arms a presentation on *every* mount
  transaction.
- Each one leaves a `dispatch_after` block retaining the `CADisplayLink`, its target and the
  capture for 90 s instead of 2 s, including during `memory` and `leak` launches.
- Each set is sub-KB, so the effect on bytes per instance should be negligible. But it is a
  change in what is resident when footprint is sampled, and the report does not mention it.
- **Fix:** cancel the timer, or drop `link` from the block once the display link has fired.
  Otherwise one line in the report saying it was considered.

### N7 — The Android probe change has never been built or run

**Where:** `bench/modules/bench-probe/android/.../HybridBenchProbe.kt`.

- The gate tool classes the diff as check-only, and nothing in the task compiled the Android
  bench app. The new `stopFrameCapture` on the JS-timeout path and the 90 s ceiling will first
  execute on the next Android bench run, which is also where M1 lands.
- Worth one line in Follow-ups, so whoever runs Android next knows.

## Verdict

**MERGE WITH FIXES**

- M1 — The Android `update.{progress,picker}:expo-ui-*` cells (8) await and time out rather than being `not-awaited`, so 8 s changes their CPU rows and adds ~2.7 h per Android run at ~80 % of the launch budget; fix the 4 docs and the Question (1/160, not 1 of 9) and escalate options (a)/(b)/(c).
- N1 — A shorter `--timeout-presented` mints although `run.mjs:760` says it cannot, and a stale app's results are stamped 8 000 ms.
- N2 — The backstop test reads the constants only; reverting either native call site to 2 s stays green.
- N3 — Size claims are wrong: the mint's JSON is 2.32 MB, not 60 KB, and reasons are ~84 B per entry and 2.0 %, not 40 B and under 1 %.
- N4 — Wrong figures: "40 % and 54 %" lost, the "4 h 24 min" duration, and "12.5 %" `presentedBeforeMount`.
- N5 — Stale comments and docs: `lib.mjs:2170` (`nitro-ui-host`), `plan.ts:115`, `types.ts:150/198/232`, `run.mjs:841`, `benchmarks.md:113/579`.
- N6 — The iOS 90 s backstop retains each mount's display link, target and capture 45× longer; likely negligible, but unstated.
- N7 — The Android probe change has not been built or run; the next Android bench is its first execution.
