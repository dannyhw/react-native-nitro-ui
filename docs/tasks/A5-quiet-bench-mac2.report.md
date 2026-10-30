# A5 — Quiet bench window on maintainer-mac-2

**Branch:** `task/A5-quiet-bench` (from `main` at `abe68a1`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `A5-tl38i` (`emulator-5574` + `ios27-sim-iphone17`, exclusive) · **Not pushed.**

## Summary

Both platforms ran the full plan quiet on `maintainer-mac-2`, in one exclusive window, in the
order A3 prescribes: exclusive acquire (which powered all four pool devices off), settle to under
4.0 for ten minutes, `--dry-run` preflight, run, release. iOS: 1 792 launches in 4 h 59 min,
`problems: []`, 2 387 load samples against the 5.0 ceiling with **15 over (0.63 %)**. Android:
2 128 launches in 5 h 49 min, `problems: []`, 2 825 samples with **one over (0.04 %)**. Both
`--check` runs are green: **0 FAIL** on each side, 117 within-tolerance rows on iOS / 159 on
Android. No run was refused, so nothing was re-run and no `--force` was used.

Item 3 is a no-op, as the orchestrator pre-answered: `--update-baseline` **replaces** the file
(`writeBaseline()` → `fs.writeFileSync(file, JSON.stringify(buildBaseline(run)))`,
`scripts/bench/report.mjs:100-107`), and `narrowingProblem()` (`scripts/bench/lib.mjs:2150-2153`)
refuses a `--component menu` schedule (224 of 1 792 launches) before such a run even starts. So
Menu's 28 iOS and 35 Android cells stay unminted here and go in through X14's merge mint. I
verified both claims against a scratch copy of the mint path rather than by reading alone.

Item 4 replaced the indicative tables in H2a, H2b, G5, G6, G7b and README "Performance", one commit
each, and cleared the matching "quiet re-run pending" follow-ups. Most conclusions held. Three
things moved, all labelled in place: Android memory is not a miss on *every* control (`Picker`
0.91×, `Menu` 0.85× are under the shared host); the README's iOS frame-floor bullet is
machine-specific and is now scoped to `maintainer-mac-1`, since on this machine only `Button` sits
on the 16 ms floor for both arms; and G5's "unattributed" Android memory move was real — 188.7 KiB
quiet, against the 135.5 KiB the pre-review run read.

The window also turned up something outside the brief: four Android `nitro-ui-host` leak cells are
now **monotonic** (menu 695, date-picker 602, slider 578, button 512 KiB/cycle, 8 launches,
`heapCollected: true`) while every unhosted arm stays non-monotonic. §6 of setup-decisions says
fail on a monotonic increase; no gate can, because a baseline stores no leak slope. Filed, not
chased.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1336 tests / 49 suites | `8767d2e1939d` | 2 m 41 s | start 1.3 / med 2.0 / max 3.4 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `bench:--platform:android:--plan:full:--launches:8:--check` | **PASS** | — | `8767d2e1939d` | 348 m 58 s | start 1.5 / med 1.4 / max 5.1 |
| `bench:--platform:ios:--plan:full:--launches:8:--check` | **PASS** | — | `8767d2e1939d` | 298 m 10 s | start 2.0 / med 2.1 / max 9.4 |

`need --for review is satisfied on this code tree.` — with the note `the code diff touches no
platform-specific code, so no device gate is asked for beyond check (a docs-only commit never
invalidates a gate)`. Every commit on this branch is a markdown file, which is why the harness and
real-input rows stay missing by design rather than by omission; the two `bench:` rows are the
window itself and `need` never requires them.

## Bench

Both runs: `--plan full --launches 8`, `NITRO_UI_MACHINE_LABEL=maintainer-mac-2`, apps cold-built
before the window so no compile load lands inside a measured launch, `dirty: false`, tree
`8767d2e1939d`. `bench/results/` is gitignored; the files are
`abe68a1-ios-20261030T104437Z.json` and `abe68a1-android-20261030T155310Z.json`.

### Run stamps (verbatim `machine.loadSamples`)

| Platform | Device | Duration | Launches | `loadSamples` | `quiet` | `problems` |
| --- | --- | --- | --- | --- | --- | --- |
| iOS | `ios27-sim-iphone17` | 17 837 s (4 h 59 m) | 1 792 / 1 792 | `{count: 2387, ceiling: 5, median: 2.1089, p90: 2.8896, max: 9.376, over: 15, overFraction: 0.0063}` | `true` | `[]` |
| Android | `android35-emu-pixel9` | 20 900 s (5 h 49 m) | 2 128 / 2 128 | `{count: 2825, ceiling: 5, median: 1.4331, p90: 1.9526, max: 5.1323, over: 1, overFraction: 0.0004}` | `true` | `[]` |

`--check` verdicts, counted from each run's own table (815 iOS rows, 941 Android):

| | iOS | Android |
| --- | --- | --- |
| FAIL | **0** | **0** |
| within tolerance | 117 | 159 |
| noisy, no verdict | 69 | 29 |
| noisy and over threshold, not conclusive | 8 | 4 |
| over threshold, not conclusive (CI covers 1.05) | 1 | 1 |
| `new arm` (all `leak:*` — no committed cell to compare against) | 7 | 7 |
| `not measured in base` | 28 | 35 |
| metrics noisy within the run (spread > 10 % MAD) | 157 | 120 |

Every one of the `not measured in base` rows is a `menu` row on both platforms, which is item 3
showing up in the output. The two rows that clear the 1.20× threshold with a usable CI are
`update:nitro-ui:1` UI CPU/op at 1.26× (95 % CI 0.98–1.38×) on Android and
`update.segmented-control:nitro-ui:50` JS CPU/op at 1.25× (CI 0.78–1.36×) on iOS; both CIs cover
1.05, so the runner reports them and does not gate on them. The other over-threshold rows — 8 on
iOS, 4 on Android — all carry "noisy" in their verdict, so they report a number without a finding.
Per the brief nothing was re-minted over any of it.

### `nitro-ui` vs `expo-ui-shared-host` — iOS

| Component | presented | mounted | UI CPU | JS CPU | unmount UI CPU | memory | update presented | update UI CPU |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `switch` | 0.80× ✓ | 5.24× ✗ | 0.75× ✓ | 1.18× ✗ | 0.14× ✓ | 0.99× ✓ | 1.00× | 0.81× ✓ |
| `slider` | 0.63× ✓ | 4.32× ✗ | 0.90× ✓ | 1.32× ✗ | 0.17× ✓ | 1.46× ✗ | 1.00× | 0.70× ✓ `n/v` |
| `button` | 1.00× | 2.89× ✗ | 1.38× ✗ | 0.86× ✓ | 0.41× ✓ | 1.36× ✗ | 1.00× | 1.65× ✗ |
| `progress` | 0.40× ✓ | 3.97× ✗ | 1.13× ✗ | 0.98× ✓ | 0.26× ✓ | 1.35× ✗ | 1.00× | 0.79× ✓ `n/v` |
| `segmented-control` | 0.27× ✓ | 2.02× ✗ | 0.57× ✓ | 0.30× ✓ | 0.13× ✓ | 0.84× ✓ | 0.86× ✓ | 0.86× ✓ |
| `date-picker` | 2.24× ✗ `n/v` | 1.22× ✗ | 0.10× ✓ `n/v` | 1.49× ✗ | 0.02× ✓ `n/v` | 0.90× ✓ | 0.13× ✓ | 0.08× ✓ |
| `picker` | 0.21× ✓ | 1.56× ✗ | 0.29× ✓ | 0.37× ✓ | 0.43× ✓ `n/v` | 0.76× ✓ | 0.96× ✓ | 0.99× ✓ |
| `menu` | 2.04× ✗ `n/v` | 1.68× ✗ | 1.28× ✗ | 0.53× ✓ | 0.45× ✓ | 1.34× ✗ | 2.03× ✗ | 2.19× ✗ |

### `nitro-ui` vs `expo-ui-shared-host` — Android

| Component | presented | mounted | UI CPU | JS CPU | unmount UI CPU | memory | update presented | update UI CPU |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `switch` | 1.12× ✗ | 1.33× ✗ | 1.80× ✗ | 0.98× ✓ | 1.52× ✗ | 2.84× ✗ | 0.98× ✓ | 1.74× ✗ |
| `slider` | 1.23× ✗ | 1.31× ✗ | 1.77× ✗ | 1.06× ✗ | 1.64× ✗ `n/v` | 2.37× ✗ | 1.01× ✗ | 1.24× ✗ `n/v` |
| `button` | 1.25× ✗ | 1.35× ✗ | 1.77× ✗ | 0.62× ✓ | 2.95× ✗ `n/v` | 2.45× ✗ | 0.40× ✓ | 1.82× ✗ |
| `progress` | 0.96× ✓ | 1.01× ✗ | 0.92× ✓ | 0.59× ✓ | 2.24× ✗ `n/v` | 1.70× ✗ `n/v` | no cell | 0.09× ✓ `n/v` |
| `segmented-control` | 1.19× ✗ | 1.25× ✗ | 1.43× ✗ | 0.30× ✓ | 0.99× ✓ `n/v` | 1.15× ✗ | 0.67× ✓ | 0.88× ✓ |
| `date-picker` | no cell | no cell | no cell | no cell | no cell | no cell | no cell | no cell |
| `picker` | 1.03× ✗ | 1.00× | 1.47× ✗ | 0.18× ✓ | 0.98× ✓ `n/v` | 0.91× ✓ | no cell | 0.47× ✓ |
| `menu` | 0.98× ✓ | 0.98× ✓ | 1.26× ✗ | 0.20× ✓ | 1.02× ✗ `n/v` | 0.85× ✓ | 0.36× ✓ | 2.77× ✗ |

### `nitro-ui-host` vs `expo-ui-shared-host` — Android (iOS has no Host arm)

| Component | presented | mounted | UI CPU | JS CPU | unmount UI CPU | memory | update presented | update UI CPU |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `switch` | 1.01× | 0.97× ✓ | 0.84× ✓ | 1.17× ✗ | 0.57× ✓ `n/v` | 0.91× ✓ | 1.00× | 0.84× ✓ |
| `slider` | 1.01× | 0.96× ✓ | 0.85× ✓ | 1.11× ✗ | 0.53× ✓ `n/v` | 1.02× ✗ | 1.00× | 0.76× ✓ `n/v` |
| `button` | 1.00× | 0.99× ✓ | 0.88× ✓ | 0.69× ✓ | 1.05× ✗ `n/v` | 0.80× ✓ | 0.74× ✓ | 0.87× ✓ |
| `progress` | 0.91× ✓ | 0.72× ✓ | 0.40× ✓ | 0.77× ✓ | 0.61× ✓ `n/v` | 0.45× ✓ `n/v` | no cell | 0.06× ✓ `n/v` |
| `segmented-control` | 1.00× | 0.97× ✓ | 1.00× | 0.30× ✓ | 0.60× ✓ `n/v` | 0.56× ✓ | 0.79× ✓ | 0.50× ✓ |
| `date-picker` | no cell | no cell | no cell | no cell | no cell | no cell | no cell | no cell |
| `picker` | 0.71× ✓ | 0.75× ✓ | 0.78× ✓ | 0.18× ✓ | 0.81× ✓ `n/v` | 0.53× ✓ | no cell | 0.21× ✓ |
| `menu` | 0.72× ✓ | 0.68× ✓ | 0.57× ✓ | 0.22× ✓ | 0.44× ✓ `n/v` | 0.31× ✓ | 0.74× ✓ | 1.29× ✗ |

Host ÷ the same control with no Host (memory / mount UI CPU / mount JS CPU): switch 0.32 / 0.46 /
1.20 · slider 0.43 / 0.47 / 1.05 · button 0.33 / 0.50 / 1.12 · progress 0.26 / 0.44 / 1.32 ·
segmented-control 0.49 / 0.70 / 1.02 · date-picker 0.49 / 0.58 / 1.11 · picker 0.58 / 0.53 / 1.05 ·
menu 0.36 / 0.45 / 1.09. Every one inside spread; every unmount cell is `n/v`.

### Leak cells (reported, not gated)

iOS: no monotonic slope on any arm. Android: `leak.menu:nitro-ui-host` 695, `leak.date-picker`
602, `leak.slider` 578, `leak.button` 512 KiB/cycle with `leakMonotonic: true` (8 launches,
`heapCollected: true`); every other Android cell, including all unhosted ones, is non-monotonic.
A committed baseline stores no leak slope, so `--check` cannot gate this. See follow-ups.

## Settle and preflight (A3 items 2b / 2c)

The exclusive acquire powered all four pool devices off, so the window started from an idle
machine. Each platform then settled on its own before its run, and only one device was booted at a
time (simulator down before the emulator came up):

```
iOS:      settled: load1 peak 43.38 over 160 samples (40 over 4), quiet window 10.0 min, ceiling 4 for 10 cores, now 1.47
Android:  settled: load1 peak 2.84 over 97 samples (0 over 4), quiet window 8.0 min, ceiling 4 for 10 cores, now 1.00
```

Both bench apps were cold-built before the window opened (`node scripts/build-app.mjs --platform
<p>`), so no compiler load lands inside a measured launch — A3's iOS run paid that inside its own
window and this one does not.

Preflight, re-run verbatim at the end of the window (it boots, builds and measures nothing):

```
$ node scripts/bench/run.mjs --platform ios --plan full --launches "8" --update-baseline --dry-run
Platform:  ios
Plan:      full (56 cells x 4 implementations x 8 launches = 1792 launches)
Device:    ios27-sim-iphone17 - "nitro-ui A" Shutdown, iOS 27.0, class iphone17
Machine:   maintainer-mac-2
Load:      1.12 now, ceiling 5.0 for 10 cores
Baseline:  bench/baselines/maintainer-mac-2/ios27-sim-iphone17.json exists
Mint:      would start
Dry run:   OK - a mint could start

$ node scripts/bench/run.mjs --platform android --plan full --launches "8" --update-baseline --dry-run
Platform:  android
Plan:      full (56 cells x 5 implementations x 8 launches = 2128 launches)
Device:    android35-emu-pixel9 - AVD nitroui_a, API 35, profile pixel_9, attached as emulator-5574
Machine:   maintainer-mac-2
Load:      1.12 now, ceiling 5.0 for 10 cores
Baseline:  bench/baselines/maintainer-mac-2/android35-emu-pixel9.json exists
Mint:      would start
Dry run:   OK - a mint could start
```

Both exit 0, both print `maintainer-mac-2` and a path under `bench/baselines/maintainer-mac-2/`.
`Mint: would start` is the relevant line for item 3: a *whole-plan* run on this machine would mint
cleanly today, which is why X14's merge mint is the only thing Menu is actually waiting for.

## Red proofs

No new test or gate: A5 ran existing ones and changed no code, so there is nothing of mine to show
red. What I did prove rather than infer, and how:

- item 3's claim "`--update-baseline` replaces the file" -> a scratch script calling the runner's
  own `buildBaseline()` / `mintBaselineFileFor()` with a menu-only cell set -> the output holds 28
  `menu` keys and **zero** of the other 196; the existing file is what `writeBaseline()` would
  overwrite whole. A second probe confirmed the pre-flight refusal: `the schedule is narrowed to 224
  of 1792 launches (--component menu)`. Nothing outside the scratch directory was written.
- the two bench gates are the runner's own, not mine; both went red earlier in this repo's life for
  load (`LOAD_OVER_CEILING_FRACTION`) and this window's job was to be green without `--force`.

## Files changed

- `README.md`: "Performance" — mac-2's quiet table added next to mac-1's, the `<Host>` tables
  replaced with quiet cells, the frame-floor bullet scoped to its machine, and the per-control
  notes labelled by machine.
- `docs/tasks/H2a-host-more-controls.report.md`, `H2b-host-popups.report.md`,
  `G5-datepicker.report.md`, `G6-picker.report.md`, `G7b-menu-finish.report.md`: quiet cells added,
  indicative tables kept for the record, "quiet re-run pending" follow-ups closed.
- `docs/components/host.md`, `docs/architecture/sizing.md`: the pending-rerun sentence replaced
  with the pointer to A5 (these two carried the same indicative claim; leaving them saying
  "pending" would have been a false statement in shipped docs).

## Follow-ups

- bench: Android `nitro-ui-host` leak slopes are monotonic on four controls and no gate can see it —
  written up in `G7b-menu-finish.report.md` "Follow-ups", needs an owner with a heap dump.
- bench: Menu's cells stay unminted until X14's merge mint lands; until then 28 (iOS) + 35
  (Android) rows read `not measured in base` in `--check` on this machine.
- bench: `maintainer-mac-1` still has no `Picker`, no `Menu` and no 0.4.x-era re-run; its table is
  now four releases old. A quiet window there is the same ~11 h, and the two machines' numbers are
  visibly not interchangeable (iOS mount presented 1.00× vs 2.48× on `date-picker`).
