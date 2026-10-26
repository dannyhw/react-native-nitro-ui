# A1b — committed bench baselines (overnight retry)

**Branch:** `task/A1b-baselines` from `main` at `3533d64`. **Round:** 1 of 1. No push.

## Summary

**Android minted; iOS refused by the load guard again.**

- **Android: `bench/baselines/android35-emu-pixel9.json` is committed** (`ac7d710`, its own commit,
  diff = that one file). One clean `--plan full --launches 8` run on the assigned `nitroui_t01`
  (API 35 Pixel 9) from a clean tree, **1120/1120 launches, `problems: none`, ART
  `speed-profile` in 1 attempt, load average 2.39 / 3.20 over 14 cores (`quiet: true`)**,
  10 385 s = 173.1 min. `--check` reads it back green (90 nitro-ui rows within tolerance, 44
  suppressed by their own within-run spread, 5 `new arm`, 0 failures) and a doctored copy goes
  red (`FAIL … 2.00x, 95% CI 1.97x-2.03x`).
- **iOS: run completed, `--update-baseline` refused** — again. 1120/1120 launches, `problems:
  none`, 9 241 s = 154.0 min, and the guard refused on `load average 7.60 over 14 cores (ceiling
  7.0)`. No `--force`, no retry, per the brief. The data is complete and is reported below.
- **B1's fix is what made Android mintable at all.** A1 could not finish the Android plan (the
  `mount.<control>:nitro-ui:200` cells OOMed the app). Every one of those cells now completes:
  `20 iterations` in ~5 s, and there is no `no end sentinel` or `OutOfMemoryError` anywhere in the
  173-minute log. The A1 blocker is closed.

## Files changed

- `bench/baselines/android35-emu-pixel9.json` — the new Android baseline (commit `ac7d710`).
- `bench/baselines/README.md` — "Status" now records Android committed / iOS pending, plus the
  prettier rule the mint forced (see "Gate evidence").
- `README.md` — the Performance section's baseline pointer says what exists now.
- `docs/tasks/A1b-baselines.report.md` — this report.

## Android: minted

Clean tree at `3533d64`, Release build, no Metro (D9), device addressed by serial, private adb
server on 5041 only.

```sh
bun bench --platform android --plan full --launches 8 --update-baseline   # exit 0
```

| Field | Value |
| --- | --- |
| Result file | `bench/results/3533d64-android-20261025T031715Z.json` (gitignored) |
| Device | `nitroui_t01` / `emulator-5570`, `android35/google_apis/arm64-v8a`, API 35, `pixel_9` → `android35-emu-pixel9` |
| ART | `speed-profile` for `com.nitroui.bench`, `primed: true`, 1 attempt (D18) |
| Plan / launches | `full` / 8 → 35 cells × 4 implementations × 8 = **1120 launches**, 1120/1120 |
| Completeness | `problems: none`, `dirty: false`, `baselineBlockers()` = `[]` |
| Duration | 10 385 s = **173.1 min** (9.3 s per launch) |
| Load at guard | **loadavg1 2.39**, loadavg5 3.20, `quiet: true` (ceiling 7.0) |
| Noise | 44 of 134 nitro-ui ratio cells over the 10 % spread flag (33 %); `presentedBeforeMount` = 0 on every nitro-ui cell |

### Headline ratios — nitro-ui ÷ `expo-ui-shared-host`

Launch-paired medians, `N=50` for mount `presented` / UI CPU and `N=200` for memory. `ᴺ` = that
cell's within-run spread is over 10 %, so the runner denies it a verdict.

| Component | presented | UI CPU | memory |
| --- | --- | --- | --- |
| `Switch` | 1.01× | 1.51× `ᴺ` | 2.72× ✗ |
| `Slider` | 1.02× ✗ | 1.52× ✗ | 2.42× ✗ |
| `Progress` | 1.00× | 1.02× | 1.44× ✗ |
| `Button` | 1.01× ✗ | 1.59× `ᴺ` | 2.46× ✗ |
| `SegmentedControl` | **0.89× ✓** | 1.39× `ᴺ` | 1.10× ✗ |

Supporting absolutes (`N=50` mount unless stated):

- Memory per instance at `N=200` (`nitro` vs shared host): `Switch` 142.7 vs 52.1 KiB, `Slider`
  147.9 vs 62.3, `Progress` 130.9 vs 91.6, `Button` 188.5 vs 77.0, `SegmentedControl` 311.9 vs
  283.6. The `Switch` figure is the same 141 KiB the README published from R2, reproduced to
  ~1 KiB on a full run.
- Below `expo-ui-host-per-control` on every cell that carries a verdict: presented 0.64–0.97× of
  its own control's arm, UI CPU 0.50–0.70×, memory 0.58–0.82×.
- Update path ÷ shared host: `presented` 0.32–0.61× (Switch 0.61, Button 0.46, SegCtrl 0.32), UI
  CPU above the shared host on `Switch` (1.24×) and `Button` (1.94×) and below it on
  `SegmentedControl` (0.74×). `update.slider` UI CPU is noise-flagged (58 %) and
  `update.progress`'s shared-host arm never mounted (see Follow-ups), so neither carries a number.

## iOS: minted? no — refused, verbatim

```sh
bun bench --platform ios --plan full --launches 8 --update-baseline       # exit 2
```

Refusal, verbatim (`/private/tmp/a1b-ios-run.log`, the only reason `baselineBlockers()` returned):

```
--update-baseline refused (pass --force to override):
  - the machine was busy: load average 7.60 over 14 cores (ceiling 7.0)
```

| Field | Value |
| --- | --- |
| Result file | `bench/results/3533d64-ios-20261025T003822Z.json` (gitignored) |
| Device | iPhone 17 sim `F08675D3-A32B-4F88-BC81-02D7E0CB797E`, iOS 27 → `ios27-sim-iphone17` |
| Plan / launches | `full` / 8 → **1120 launches**, 1120/1120, `problems: none`, `dirty: false` |
| Duration | 9 241 s = **154.0 min** (8.25 s per launch; A1's same run took 185.3 min) |
| Load at guard | **loadavg1 7.60**, loadavg5 **4.06**, `quiet: false` |

The guard samples once, when the run ends (A1's Q5), so this is one instant at 03:12Z: `load1` 7.60
against `load5` 4.06 says the spike had only just started — the preceding minutes averaged 4.06,
well under the 7.0 ceiling. Nothing of mine was running (the iOS run had just torn down and the
Android emulator had not yet booted). Three hours later the same box sampled **2.39** at the end of
the Android run and minted. That contrast is the whole iOS story: the run was complete and
problem-free, and it died on the load of its own final minute.

### iOS headline ratios (same refused run — not baseline material)

| Component | presented | UI CPU | memory |
| --- | --- | --- | --- |
| `Switch` | 0.33× `ᴺ` | 0.67× `ᴺ` | 0.99× ✓ |
| `Slider` | 0.36× `ᴺ` | 0.89× `ᴺ` | 1.46× ✗ |
| `Progress` | 0.47× `ᴺ` | 1.12× `ᴺ` ✗ | 1.39× ✗ |
| `Button` | 0.99× | 1.88× `ᴺ` ✗ | 1.34× ✗ |
| `SegmentedControl` | 0.24× `ᴺ` | 0.65× ✓ | 0.83× ✓ |

82 of 137 nitro-ui ratio cells are noise-flagged (60 %, vs Android's 33 %), and
`presentedBeforeMount` totals 855 across the nitro-ui cells, so iOS `presented` still never carries
a verdict — both exactly as in A1 and R2.

## Differences from A1 and R2

**iOS vs A1** (same commit family, same device, `--plan full --launches 8`, A1 at `29db250`):

| Component | presented A1 → A1b | UI CPU A1 → A1b | memory A1 → A1b |
| --- | --- | --- | --- |
| `Switch` | 0.41 → 0.33 | 0.70 → 0.67 `ᴺ` | 0.99 → 0.99 |
| `Slider` | 0.90 → 0.36 | 0.84 → 0.89 `ᴺ` | 1.45 → 1.46 |
| `Progress` | 0.62 → 0.47 | 1.29 → 1.12 `ᴺ` | 1.39 → 1.39 |
| `Button` | 0.49 → 0.99 | 1.22 → 1.88 `ᴺ` | 1.36 → 1.34 |
| `SegmentedControl` | 0.39 → 0.24 | 0.53 → 0.65 | 0.82 → 0.83 |

Memory reproduces to ≤ 0.02× on all five controls again, which is the metric the gate leans on. The
`presented` column moves because it cannot resolve anything: at `N=50` most arms land inside one
16 ms frame on this device (Button's shared host is 16.2 ms, Slider's per-control arm is 16.2 ms),
so `Button`'s 0.49 → 0.99 and `Slider`'s 0.90 → 0.36 are the frame floor moving, not the library.
`Button` UI CPU (1.22 → 1.88, noise-flagged) is the only real-looking move and it is a
noise-flagged cell; direction unchanged (a miss). New detail this run: per-control iOS memory
absolutes — `nitro` 262.5 / 262.9 / 170.4 / 206.1 / 362.0 KiB against the shared host's
265.1 / 179.3 / 120.8 / 153.9 / 437.4 (`Switch` at parity, `SegmentedControl` 17 % below, the other
three +50…+82 KiB), which is what the README already describes.

**Android vs R2's published quick runs** (`--plan quick --launches 4`, same AVD class, same ART regime):

| Component | presented R2 → A1b | UI CPU R2 → A1b | memory R2 → A1b |
| --- | --- | --- | --- |
| `Switch` | 1.00 → 1.01 | 1.64 → 1.51 `ᴺ` | 2.74 → 2.72 |
| `Slider` | 1.01 → 1.02 | 1.56 → 1.52 | 2.57 → 2.42 |
| `Progress` | 0.95 → 1.00 | 0.93 → 1.02 | 1.61 → 1.44 |
| `Button` | 1.01 → 1.01 | 1.52 → 1.59 `ᴺ` | 2.50 → 2.46 |
| `SegmentedControl` | 1.31 → 0.89 | 1.28 → 1.39 `ᴺ` | 1.09 → 1.10 |

Nothing here contradicts what 0.1 shipped: memory reproduces within 0.17× on all five (≤ 0.05× on
four), and
mount `presented` is tighter than R2's (Android `presented` carries verdicts — 0
`presentedBeforeMount`). Two honest deltas to know about:

- `Progress` is the control that moved *against* us: R2 published it as the one control meeting both
  Android targets (0.95× presented, 0.93× UI CPU); on the full run it sits at 1.00× and **1.02×**,
  i.e. just above the ≤ 1.0 target rather than under it.
- `SegmentedControl` moved *for* us on presented: 1.31× (a published miss) → **0.89×**, the only
  control that now beats the shared host on Android mount latency. Its UI CPU stayed a miss (1.39×).

## Android leak slopes, now that B1 is in

B1's diagnosis was that every mount left its Compose view registered on the activity's
`LifecycleRegistry`, so churn retained one host per mount: A1's plan OOMed, and the `leak N=200`
cell climbed **16.5 MiB/cycle MONOTONIC** (the runner gates that as a leak). In this run, with B1's
`armCompositionStrategy` / `unarmCompositionStrategy` fix in `main`:

| Component | rn-core | shared host | per-control | nitro-ui | gated? |
| --- | --- | --- | --- | --- | --- |
| `Switch` | 111.9 | 156.3 | 162.4 | **771.7** | no — not monotonic |
| `Slider` | 139.6 | 190.2 | 252.8 | **834.9** | no |
| `Progress` | 315.1 | 55.4 | 54.4 | **694.4** | no |
| `Button` | 354.9 | 308.5 | 283.0 | **592.9** | no |
| `SegmentedControl` | 1312.3 | 665.1 | 552.4 | **46.0** | no |

KiB per cycle of 200 controls, from this run. **No leak cell is monotonic on any arm**, so nothing
is gated as a leak, `--update-baseline` records no slope for any of the 20 leak cells (they carry
zero metrics), and `--check` prints `new arm` for the five nitro-ui leak rows. `Switch`'s 771.7
KiB/cycle matches B1's own post-fix measurement (764.4 KiB, not monotonic), and the N=200 mount
cells that used to die now run 20 iterations in ~5 s. The retention is gone.

What is left is a sawtooth, not a leak: nitro-ui's climb is still the largest on four of the five
controls (≈2–13× the shared host's slope). It is collectable — that is the whole difference from
B1's pre-fix 16.5 MiB/cycle — and the bench cannot gate a non-monotonic climb by design. The
instrument for it is B1's post-GC-floor churn gate in
`example/__tests__/MountChurn.harness.tsx`, which is where I would watch this, not `--check`.

## Gate evidence: `--check` reads back, and can fail

Run from the same build, against the same results file the baseline came from. The baseline is
untracked-then-committed once, so the doctored copy was made from a pristine `/private/tmp` copy
and restored; `git status --short` is empty apart from the intended files.

| What | Command | Result |
| --- | --- | --- |
| Reads back green | `node scripts/bench/report.mjs bench/results/3533d64-android-20261025T031715Z.json --check` | exit **0**, "No gated metric exceeded the 1.20x threshold against the baseline."; nitro-ui rows: 90 `within tolerance`, 44 `noisy`, 5 `new arm` (the leak cells), 0 failures |
| Can go red | same command, baseline's `update:nitro-ui:50` **`mounted`** ratio halved (the quietest nitro-ui cell, 0.35 % spread) in both `ratio` and all 8 `launchRatios` | exit **1**, `- FAIL update:nitro-ui:50 mounted: 2.00x, 95% CI 1.97x-2.03x (launch bootstrap over 16 launches)` |
| Restored | copy the pristine file back, re-run `--check` | sha256 identical to pre-doctor, exit **0** again |

A1's finding reproduced: halving only `ratio` stays "over threshold, not conclusive"; the CI is
launch-paired, so the `launchRatios` have to move for a verdict. Picking a quiet cell matters too —
every one of the 44 noise-flagged cells is, correctly, unable to fail.

**Formatting gate, found the hard way:** the runner writes 2-space JSON with one `launchRatios`
entry per line, and `bun run check` runs `prettier --check .`, which rejects it. `prettier --write`
on the minted file is required before committing (244 017 → 216 717 bytes, `JSON.stringify` of the
parsed object identical, `--check` still green). Recorded as a rule in `bench/baselines/README.md`
so the next refresh does not rediscover it.

## Device and process hygiene

- Booted/used only my own devices: iPhone 17 sim `F08675D3-A32B-4F88-BC81-02D7E0CB797E` and AVD
  `nitroui_t01` (`emulator-5570`), always addressed by serial, private adb server on port 5041
  (`ANDROID_ADB_SERVER_PORT=5041`) only. Never `adb kill-server` on the default port.
- Never touched `emulator-5560`, iPhone Air, `nitroui_t02` / `emulator-5572`, nor
  the other project's booted `iPhone 17 (RNSB 26.4)` / `iPhone 17 (RNSB starter)` simulators. No
  `pkill`/`killall` by process name.
- One platform at a time: iOS 00:38Z→03:12Z, then Android 03:17Z→06:10Z (which is also why the
  Android sample is quiet — nothing else was on the box).
- No Metro was started (release benches do not use one, D9).

End state: iPhone 17 sim shut down with `xcrun simctl shutdown F08675D3-…`, `nitroui_t01` stopped
with `adb -s emulator-5570 emu kill`, private adb server stopped with
`ANDROID_ADB_SERVER_PORT=5041 adb kill-server`. Both were started by this task and both were mine.

## Known issues / follow-ups

- `update.progress:expo-ui-shared-host:50` on Android reported `missingMount: 160,
  missingPresented: 160`: that reference arm never mounted in that cell, so its 51.9 ms/op UI CPU
  is not comparable and the 0.06× "nitro-ui beats the shared host on Progress updates" reading is an
  artefact. Only `nitro-ui` arms gate, so the baseline is unaffected — but the number should not be
  quoted. Not touched (D19).
- In the same cell, `rn-core`'s UI CPU per op is ~5 µs (a stock `ActivityIndicator` prop change), so
  nitro-ui's ratio-to-control is **830×** and meaningless in level terms. It is noise-flagged (23 %)
  and therefore cannot gate; it is in the baseline as recorded. Same for any future cell whose
  control does almost nothing.
- The committed baseline carries no leak expectation at all (all 20 leak cells have zero metrics
  because no arm climbed monotonically), so `--check` can never catch an Android memory-trend
  regression. A1 noted this for iOS; it is now confirmed on Android with a healthy run.
- `bench/baselines/README.md` and `docs/architecture/benchmarks.md` still use `ios27-sim-iphoneair`
  as the device-key example while the canonical iOS bench device is the iPhone 17
  (`ios27-sim-iphone17`, as `--check` resolves it). Carried over from A1, still a one-line doc fix,
  still not mine to make (D19).
- The runner records one load sample, at the end of a 2.5–3 h run. iOS died on it twice now, and
  this round shows how marginal it is: 7.60 vs a 7.0 ceiling with `load5` at 4.06, and 2.39 three
  hours later. Sampling at the start too (or refusing to start above the ceiling) would make the
  rule cheap to honour. A1's Q5, unchanged; not touched here.
- `bun run check` was not run: this task adds one generated JSON and three documentation edits. The
  gates that could notice were run directly: `bun run readme:check` (passes),
  `prettier --check` on every touched file (passes after the mint fix), and
  `report.mjs --check` green/red/green as above.

## Questions for orchestrator

Nothing is blocked — Android shipped its baseline and iOS was refused exactly as the brief
anticipated. One scheduling decision is yours:

**iOS: schedule one more attempt, or accept no iOS baseline for now?** The evidence says a mint is
reachable: the A1b run was 154 min, problem-free, and reproduced A1's memory within 0.02×; it lost
only on the load sample of its final minute (7.60 vs 7.0), while the same machine sampled 2.39
three hours later. Options:

- **(a) recommended** — one more single attempt in a window that *ends* comfortably inside the
  quiet hours (start ≥ 3 h before the human returns, so the final sample is quiet too). Cost is one
  night, and the guard is unchanged.
- (b) `--force` the existing A1b iOS run into a baseline. Not recommended: it would carry
  `quiet: false` and 60 % noise-flagged nitro-ui cells, i.e. a gate that mostly cannot fire — the
  same objection A1 raised, and the reason `--force` is not in this task's rules.
- (c) leave iOS unbaselined until the guard samples at the start as well (a small runner change,
  someone else's task), and use `--compare <ref>` on iOS meanwhile, which is what D9 prescribes for
  non-canonical setups.
