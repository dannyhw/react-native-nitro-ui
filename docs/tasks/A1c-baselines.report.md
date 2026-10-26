# A1c — final iOS bench baseline attempt (overnight)

**Branch:** `task/A1c-baselines` from `main` at `6e9e22a` (run recorded at `c9548f6`, the brief
commit). **Round:** 1 of 1 — one attempt, no `--force`, no retry, no push.

## Summary

**Minted.** `bench/baselines/ios27-sim-iphone17.json` is committed, from one clean
`--plan full --launches 8` run on the canonical iPhone 17 (iOS 27) simulator:

- **1344/1344 launches, `problems: none`, `dirty: false`**, 3 h 17 min 45 s.
- **The whole run was quiet:** 1740 load samples, **median 2.93** against the 7.0 ceiling,
  **p90 4.24**, **59 samples (3.4 %) over** it, max 75.64. `machine.quiet: true`, and
  `baselineBlockers()` returned `[]` — no `--force` was used or needed.
- `--check` reads it back **green** (0 failures) and **goes red** on a doctored baseline, so the
  iOS gate can actually fire: 59 nitro-ui rows within tolerance, 107 suppressed by their own
  within-run spread, 6 `new arm`, 0 failures.
- iOS ratios reproduce A1b's memory column to ≤ 0.02× on all five shipped controls (see the
  comparison below), which is the column the gate leans on.

A1 and A1b both completed problem-free and lost the baseline on a single end-of-run load sample
(10.50 and 7.60 against 7.0). R4's whole-run judgement is what let this one through: the same rule
that refused them would refuse this run on its worst second (max 75.64) and accepts it on what the
run actually measured (median 2.93, 3.4 % over).

## Run

| Field | Value |
| --- | --- |
| Command | `bun bench --platform ios --plan full --launches 8 --update-baseline` (exit 0) |
| Result file | `bench/results/c9548f6-ios-20261026T012322Z.json` (+ `.ndjson`, `.md`) — gitignored |
| Baseline | `bench/baselines/ios27-sim-iphone17.json` — own commit, see "Commits" |
| Device | iPhone 17 sim `F08675D3-A32B-4F88-BC81-02D7E0CB797E`, iOS 27 → `ios27-sim-iphone17` |
| Plan / launches | `full` / 8 → 42 cells x 4 implementations x 8 = **1344 launches**, 1344/1344 |
| Completeness | `problems: []`, `dirty: false`, `perfMarks: false`, `baselineBlockers()` = `[]` |
| Duration | 11 864 848 ms = **197.7 min** (8.83 s per launch), 01:23:22Z → 04:41:07Z |
| Machine | Apple M4 Pro, 14 cores, 48 GB, Xcode 27.0, `quiet: true`, end `loadavg1` 2.63 |
| Load samples | `{count: 1740, ceiling: 7, median: 2.9265, p90: 4.2417, max: 75.6416, over: 59, overFraction: 0.0339}` |
| Build | Release, no Metro (D9); `bench/ios` from `expo prebuild --clean` + plain `pod install` |
| Setup | `bun install`; Node 24 via `fnm exec --using 24 --`; pods with plain `pod install` |

The plan is 1344 launches, not A1b's 1120: `full` grew DatePicker's six scenarios after G5. That
is also most of the extra 40 minutes — DatePicker's `N=200` mount costs 52.9–58.6 s per launch on
the two `@expo/ui` arms (nitro-ui 7.3 s, rn-core 5.4 s), and its `leak` cells add 20 s each.

## Gate evidence

| What | Command | Result |
| --- | --- | --- |
| Tree green before the run | `bun run check` (Node 24, clean tree at `c9548f6`) | exit **0** — typecheck, bench typecheck, lint, `prettier --check .`, jest, native ASan, renders, nitrogen drift, autolinking, bob, api-extractor, publint, manifest, readme |
| Run refused nothing | the command above | exit **0**, `Baseline written: bench/baselines/ios27-sim-iphone17.json` |
| Tree green after the mint | `bun run check` with the minted JSON and both README edits in the tree | exit **0** |
| Reads back green | `node scripts/bench/report.mjs bench/results/c9548f6-ios-20261026T012322Z.json --check` | exit **0**, "No gated metric exceeded the 1.20x threshold against the baseline."; nitro-ui rows: 59 `within tolerance`, 107 `noisy`, 6 `new arm` (the leak cells), **0 failures** |
| Can go red | same command, baseline's `mount.segmented-control:nitro-ui:50` **`presented`** ratio **halved** (the quietest nitro-ui cell: 0.06 % spread) in `ratio` **and** all 8 `launchRatios` | exit **1**, `- FAIL mount.segmented-control:nitro-ui:50 presented: 2.00x, 95% CI 1.32x-6.57x (launch bootstrap over 16 launches)` |
| Restored | copy the pristine file back, re-run `--check` | sha256 `15c8ff3c…` identical to pre-doctor (that sha is the un-formatted 298 779-byte mint), exit **0** again |
| Prettier-clean | `prettier --write` then `--check` on the minted file | 298 779 → **265 071 bytes**, `JSON.stringify` of the parsed object identical, `--check` still exit 0; the committed file is sha256 `775c0460…` |

**Direction matters, and the brief's wording is a trap:** `--check` compares *this run's* ratio to
*the baseline's*, so multiplying the baseline ratio by 2 makes the run look 2x **better** and
correctly stays green (seen: exit 0). Red is the inverse edit — halve the baseline entry and the
same run reads `2.00x` against it. Halving `ratio` alone is not enough either: the CI is
launch-paired, so the 8 `launchRatios` have to move with it (A1b's finding, reproduced here).

Picking a quiet cell is what makes the proof conclusive: 107 of the 172 nitro-ui rows are
noise-suppressed and, correctly, cannot fail at any doctored value.

## iOS ratios vs `expo-ui-shared-host` (the minted run)

Launch-paired medians from `bench/tools/arm-ratios.mjs`, mount at `N=50` (the D15 cell) and memory
at `N=200`. `✓` / `✗` against D15's ≤ 1.0x target; `ᴺ` = that ratio's within-run spread is over
10 %, so the runner denies it a verdict; no mark = parity within rounding. Nothing that reads `n/a`
is upgraded into a number.

| Component | presented | UI CPU | memory |
| --- | --- | --- | --- |
| `Switch` | 1.00× | 0.88× ✓ | 1.00× |
| `Slider` | 1.00× | 1.07× `ᴺ` ✗ | 1.48× ✗ |
| `Progress` | 0.47× ✓ | 1.20× `ᴺ` ✗ | 1.38× ✗ |
| `Button` | 1.00× | 1.13× `ᴺ` ✗ | 1.34× ✗ |
| `SegmentedControl` | 0.24× `ᴺ` ✓ | 0.66× ✓ | 0.83× ✓ |
| `DatePicker` | 1.00× | 0.08× ✓ | 0.70× ✓ |

Four of the 18 headline rows are noise-flagged. `DatePicker` is in the plan (and therefore in the
baseline) for the first time; the five controls above it are the 0.1 surface.

Supporting absolutes (medians, this run, `nitro-ui` vs `expo-ui-shared-host`, `N=50` unless
stated):

- `presented`: Switch 16.15 vs 16.18 ms, Slider 16.14 vs 16.17, Button 16.16 vs 16.18,
  DatePicker 16.15 vs 16.17 — every one of those sits on the same 16 ms frame, which is why the
  column says 1.00× rather than measuring anything; Progress 16.15 vs 34.40 ms and
  SegmentedControl 16.17 vs 67.35 ms are the two cells where the shared host spans frames and the
  ratio means something.
- UI CPU per op: Switch 21.52 vs 24.31 ms, Slider 22.91 vs 21.42, Progress 17.54 vs 14.58,
  Button 12.92 vs 10.87, SegmentedControl 39.09 vs 57.89. DatePicker 16.76 vs **217.50 ms** — a
  real 12x gap in our favour, but the level is the story: `@expo/ui`'s shared-host DatePicker costs
  217 ms of UI CPU per op at `N=50`, so 0.08× is not a lever anyone should bank on.
- Memory per instance at `N=200`: Switch 265.4 vs 266.6 KiB (parity), Slider 263.1 vs 178.0,
  Progress 170.2 vs 123.3, Button 207.3 vs 154.6, SegmentedControl 367.4 vs 439.8 (we are below),
  DatePicker 200.6 vs 288.4.
- Against `expo-ui-host-per-control` we are below on every cell, launch-paired: presented
  0.10–1.00× (the 1.00× entries are the frame floor again), UI CPU 0.07–0.52×, memory 0.64–0.87×.
- Update path at `N=50`, UI CPU per op, **medians** rather than launch-paired ratios, because
  `arm-ratios` pairs against `rn-core` only: Switch 0.84× (6.11 vs 7.25 ms), Slider 0.67× (6.95 vs
  10.31), Progress 0.69× (3.70 vs 5.33), Button **1.52×** (9.76 vs 6.41 — the one update-path
  miss), SegmentedControl 0.82× (60.85 vs 74.14), DatePicker 0.08× (5.65 vs 70.72).

## What this run says next to A1 and A1b

Same device, same plan shape, same commit family; A1 at `29db250`, A1b at `3533d64`.

| Component | presented A1 → A1b → **A1c** | UI CPU A1 → A1b → **A1c** | memory A1 → A1b → **A1c** |
| --- | --- | --- | --- |
| `Switch` | 0.41 → 0.33 → **1.00** | 0.70 → 0.67 → **0.88** | 0.99 → 0.99 → **1.00** |
| `Slider` | 0.90 → 0.36 → **1.00** | 0.84 → 0.89 → **1.07** `ᴺ` | 1.45 → 1.46 → **1.48** |
| `Progress` | 0.62 → 0.47 → **0.47** | 1.29 → 1.12 → **1.20** `ᴺ` | 1.39 → 1.39 → **1.38** |
| `Button` | 0.49 → 0.99 → **1.00** | 1.22 → 1.88 → **1.13** `ᴺ` | 1.36 → 1.34 → **1.34** |
| `SegmentedControl` | 0.39 → 0.24 → **0.24** `ᴺ` | 0.53 → 0.65 → **0.66** | 0.82 → 0.83 → **0.83** |

- **Memory is stable** across three runs two days apart: ≤ 0.02× on all five controls. That is the
  column `--check` will actually catch regressions in, and it is now committed.
- **`presented` at `N=50` is not a measurement** on this device for the cheap controls: nitro-ui
  and the shared host all land in the same 16 ms frame, so the column reports 1.00× and moves only
  when the frame floor does (A1b said the same about its 0.33/0.36 — those were the same floor seen
  from the other side). Progress and SegmentedControl remain real.
- **UI CPU stays the honest miss** on Slider/Progress/Button (1.07–1.20×, all three noise-flagged),
  and Switch/SegmentedControl stay under the shared host. `Button` moved 1.88 → 1.13 against A1b —
  a noise-flagged cell moving toward the A1 figure (1.22), so read it as the same miss, not a fix.
- **The noise story improved**: 4 of 18 headline rows are flagged here, against 82 of 137 nitro-ui
  ratio cells (60 %) in A1b's run — the difference is that this run was quiet for its whole length
  rather than quiet in patches. Across every cell and metric the run still flagged 310 metrics over
  the 10 % MAD line, which is why only 59 nitro-ui rows carry a verdict today.

## Files changed

- `bench/baselines/ios27-sim-iphone17.json` — the iOS baseline (own commit, 168 cells, prettier
  formatted, 265 071 bytes, sha256 `775c04604986e242…`).
- `bench/baselines/README.md` — "Status" now records both canonical devices committed, with the
  load-sample summary and the green/red proof.
- `README.md` — the Performance baseline pointer no longer says iOS has none, and carries the iOS
  reproduction ranges.
- `docs/tasks/A1c-baselines.report.md` — this report.

No source, native, bench-runner or test file changed; nothing in `bench/results/` is committed.

FOLLOWUPS needed no line: step 4 of the brief applies only to a refusal, and this attempt
minted.

**Commits** (this branch, nothing pushed):

- `a4d9514` — `perf(bench): mint the iOS ratio baseline (ios27-sim-iphone17)` — the baseline alone.
- `56079c0` — `docs(bench): record both canonical devices as baselined` — the two READMEs.
- `(this commit)` — `docs(bench): A1c report` — this report.


## Device and process hygiene

- Touched exactly one device: iPhone 17 `F08675D3-A32B-4F88-BC81-02D7E0CB797E`, which the runner
  booted and which I shut down with `xcrun simctl shutdown F08675D3-…` after the gates. No Android
  emulator at all — no adb, no emulator, so `emulator-5560` was never in scope.
- Never touched the booted `iPhone 17 (RNSB 26.4)` / `iPhone 17 (RNSB starter)` sims, `iPhone 17e`,
  or `PR1492 iPhone 17`.
- No `pkill`/`killall` by name, and no process I did not start was killed. The only process I
  started outside the runner was `caffeinate -is` wrapping the run (idle sleep on AC would have
  cost the single attempt); it exited with the run. Metro was never started (D9).
- The worktree stayed clean for the whole run: no file was written into it between 01:23Z and the
  baseline landing, so `dirty: false` is not a lucky sample. Scratch work (scripts, pristine
  baseline copy, logs) lived in `/tmp`.

## Known issues / follow-ups

- **The committed iOS baseline still carries no leak expectation.** All six `leak *:N=200` cells
  have zero metrics and `leakMonotonic: null` on every arm, so `--check` prints `new arm` for them
  and can never catch an iOS memory-trend regression. A1 raised this, A1b confirmed it on Android,
  and a minted baseline does not change it — it is a property of the metric, not of the file.
- **62 % of the gated iOS rows are noise-suppressed** (107 of 172), so the iOS gate is real but
  narrower than Android's (44 of 139). It is widest on `N=1` cells and on `jsCommitNs`, where
  sub-millisecond medians make a launch-paired MAD useless. Narrower than hoped, not cosmetic: 59
  rows can fire.
- **`update.slider:rn-core` and `update.progress:rn-core` never emit a mount/presented signal**
  (160 iterations each at `N=1` and `N=50`, `missingMount`/`missingPresented` = 160), so the
  `presented`/`mounted` ratio to `rn-core` in those two scenarios is `n/a` in the file. Only
  `nitro-ui` arms gate, so the baseline is unaffected, but nobody should quote an `rn-core`
  `presented` for those two scenarios. Same class as A1b's Android `update.progress` note.
- **Several gated ratios-to-`rn-core` are huge because the control does almost nothing**, which is
  why the gate is a ratio against the recorded baseline rather than against `rn-core` in the
  abstract: mount UI CPU per op is 13.47× `rn-core` on Slider and 16.96× on DatePicker (a stock
  RN control costs microseconds there), and mount memory is 38.80× on Slider. A1b hit the same on
  Android and reached the same conclusion; recorded so nobody reads those levels as a defect.
- `mountBeforeCommit` totals 46 across the run (21 on `update.segmented-control:expo-ui-host-per-control:50`,
  12 on its shared-host twin, 8 on `update.date-picker:expo-ui-host-per-control:50`, 2 on
  `update.segmented-control:nitro-ui:50`, 1 on `update.button:expo-ui-host-per-control:50`,
  2 elsewhere) — the update scenario occasionally commits before the mount signal of the frame it
  is measuring. Reported, not gated, and `nitro-ui` is nearly clean there.
- `presentedBeforeMount` totals 1057 across nitro-ui cells (2052 across all arms), so iOS
  `presented` at `N=50` still describes a frame boundary rather than our work. That is the P1
  follow-up in FOLLOWUPS (re-scope the gate to total main-thread work per mount), unchanged.
- The `full` plan is now 1344 launches and ~3 h 18 min on iOS, because DatePicker at `N=200` costs
  50–59 s per launch per arm. Worth knowing before scheduling another baseline window (A1b's
  "start ≥ 3 h before the human returns" is now ≥ 3 h 20 min, with margin).
