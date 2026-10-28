# A3 — Mint the second machine's bench baselines

**Branch:** `task/A3-baselines-mac2` (from `main` at `9cf95f3`) · **Round:** 1 of 1 (D19 — one
attempt per platform, no `--force`, no retry, not pushed) · **Lease:** `A3-602nd` (`--exclusive`,
`pair-a` + `pair-b`: sim "nitro-ui A" `49D5024D-…1E9F`, AVD `nitroui_a` / `emulator-5574` on adb
server 5043, Metro 8295)

## Summary

**Android minted, iOS refused.** `bench/baselines/maintainer-mac-2/android35-emu-pixel9.json` is
committed in its own commit, and `--check` on Android now gates on `maintainer-mac-2`: 166 nitro-ui
rows within tolerance, 27 noise-suppressed, 7 `new arm` (the `leak` cells, which store no slope),
0 failures. It came from one clean `--plan full --launches 8` run at `9cf95f3`, 1848/1848 launches,
`problems: []`, ART `speed-profile` on the first attempt, and the quietest whole-run sampling in
the repo so far — 2475 samples, median 1.47 against that machine's 5.0 ceiling, **none** over.

iOS was refused by the completeness guard, not by load, and per the brief that is the end of it:
`mount.date-picker` at N=200 presented on 55 of 160 measured iterations on
`expo-ui-host-per-control` and 87 of 160 on `expo-ui-shared-host`, and `baselineBlockers()` will not
write a ratio table with a survivor-biased metric in it. That run did everything else right
(1568/1568, `problems: []`, clean tree for 4 h 24 min, median load 2.19 of 5.0, 11 of 2096 samples
over). `maintainer-mac-1`'s committed iOS file **has** both cells, with `missingPresented: 0` and
0.5 % spread on each — so the frame probe gives up on `@expo/ui`'s DatePicker at N=200 on this
machine's simulator specifically. That is `docs/tasks/FOLLOWUPS.md`'s, and iOS cannot be minted here
until it is closed. A retry of the same run is not a fix, and `--force` is not how a baseline gets
written.

Both platforms' numbers reproduce where a baseline needs them to. Android memory and the D15 UI-CPU
gap match `maintainer-mac-1` within a few percent on the quiet rows (`memory` 2.66 → 2.70,
`memory.button` 2.47 → 2.46, switch/slider memory ~2.4–2.9× on both); iOS memory reproduces within
0.02× on all five 0.1 controls. What does **not** carry across machines is anything measured in
presented frames: this box's iOS `mount` N=50 sits at 44.5 ms where mac-1's sits on the 16 ms frame
floor, ours and `@expo/ui`'s together. `bench/baselines/README.md` now says so where the minting
rules live, next to the per-machine load ceiling (7.0 / 14 cores vs 5.0 / 10 cores) — a
`deviceKey` pair can share a name while their hosts differ, and `machine.cpuModel` is what says
which.

Nothing but `bench/` and `docs/` changed: no source, native, runner or test file. `bench/results/`
stays gitignored, and `maintainer-mac-1`'s two files are untouched.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 665 tests / 33 suites | `35948172d50e` | 2 m 57 s | start 2.2 / med 2.0 / max 2.8 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `bench:--platform:android:--plan:full:--launches:8:--update-baseline` | **PASS** | — | `35948172d50e` | 313 m 29 s | start 1.8 / med 1.4 / max 4.0 |
| `bench:--platform:ios:--plan:full:--launches:8:--update-baseline` | **FAIL** | — | `35948172d50e` | 264 m 01 s | start 1.5 / med 2.2 / max 7.9 |
| `bench:--platform:ios:--plan:full:--launches:8:--update-baseline:--background` | **FAIL** | — | `35948172d50e` | 2 m 60 s | start 1.5 / med 2.6 / max 3.5 |

`need --for review`: `need: review is satisfied on this code tree.` — with the note the ledger
prints: *the code diff touches no platform-specific code, so no device gate is asked for beyond
`check`*. `need --for merge` asks for the four device gates; A3 changed no platform code, and the
baseline commit is one file under `bench/`, so those belong to whatever round next touches a
platform half.

The last row is mine and explains itself: my first iOS launch put `--background` **after** the
`--`, so `gate.mjs` ran it in the foreground under my 180 s tool timeout and the SIGTERM landed at
launch 18. Left in the ledger on purpose. The 264-min run below it is the real attempt.

## Preflight (`--dry-run`, X9) — both exit 0

iOS, at load 1.39 (ceiling 5.0 for 10 cores):

```
Platform:  ios
Plan:      full (49 cells x 4 implementations x 8 launches = 1568 launches)
Device:    ios27-sim-iphone17 - "nitro-ui A" Booted, iOS 27.0, class iphone17
Machine:   maintainer-mac-2
Load:      1.39 now, ceiling 5.0 for 10 cores
Baseline:  bench/baselines/maintainer-mac-2/ios27-sim-iphone17.json does not exist
Mint:      would start
Dry run:   OK - a mint could start
```

Android, at load 1.73, after the AVD was booted and the box had settled for 6 min (max load1 2.84):

```
Platform:  android
Plan:      full (49 cells x 5 implementations x 8 launches = 1848 launches)
Device:    android35-emu-pixel9 - AVD nitroui_a, API 35, profile pixel_9, attached as emulator-5574
Machine:   maintainer-mac-2
Load:      1.73 now, ceiling 5.0 for 10 cores
Baseline:  bench/baselines/maintainer-mac-2/android35-emu-pixel9.json does not exist
Mint:      would start
Dry run:   OK - a mint could start
```

## iOS run — REFUSED, not minted

### Refusal, verbatim from the run's own output

    --update-baseline refused (pass --force to override):
      - 2 metric(s) are n/a because too few samples arrived: mount.date-picker:expo-ui-host-per-control:200 presentedNs (55 of 160 samples), mount.date-picker:expo-ui-shared-host:200 presentedNs (87 of 160 samples)

and from the log: `gate: bench:--platform:ios:--plan:full:--launches:8:--update-baseline FAIL in
15841.4 s`. Exit 2 (`run.mjs` raises `exitCode` to 2 on a mint refusal); the run itself finished
with `problems: []`.

### Run facts (`bench/results/9cf95f3-ios-20261027T213229Z.json`, gitignored)

| Field | Value |
| --- | --- |
| Command | `bun bench --platform ios --plan full --launches 8 --update-baseline`, via `node scripts/gate.mjs bench --background -- …` |
| sha / dirty | `9cf95f3` / `dirty: false` (clean tree for all 4 h 24 min) |
| Device | iPhone 17 sim `49D5024D-…1E9F` ("nitro-ui A"), iOS 27.0 → key `ios27-sim-iphone17` |
| Plan | `full` / 8 → 49 cells × 4 implementations × 8 = **1568 launches**, 1568/1568, `problems: []` |
| Duration | 15 840 464 ms = **264.0 min** (4 h 24 min), 10.1 s per launch, 21:32:29Z → 01:56:29Z |
| Machine | maintainer-mac-2, Apple M1 Max, 10 cores, 32 GB, macOS 26.6.1, Xcode 27.1, `quiet: true` |
| loadSamples | `{count: 2096, ceiling: 5, median: 2.1929, p90: 2.9971, max: 7.8687, over: 11, overFraction: 0.0052}` |
| End instant | `loadavg1` 2.34, `loadavg5` 2.36 |
| Baseline written | **none** — `bench/baselines/maintainer-mac-2/ios27-sim-iphone17.json` does not exist |

Load is not the reason: median 2.19 against the 5.0 ceiling, 11 of 2 096 samples (0.52 %) over it,
max 7.87. Every other guard passed (`plan: full`, `launches: 8`, no `problems`, clean tree, no perf
marks). The blocker is the completeness rule: a metric with more than `MAX_MISSING_SAMPLE_RATIO`
(10 %) of its samples missing becomes `n/a`, and a mint with an `n/a` on a gated metric is refused —
a ratio whose numerator or denominator is survivor-biased is not baseline material.

### The two cells, in this run

`mount.date-picker` N=200, `presentedNs` (20 measured iterations × 8 launches = 160 expected):

| Arm | samples | reportable | median | `missingPresented` | `presentedBeforeMount` |
| --- | --- | --- | --- | --- | --- |
| `rn-core` | 160/160 | yes | 16.1 ms | 0 | 0 |
| `expo-ui-host-per-control` | **55/160** | **no** | 16.1 ms | 105 | 29 |
| `expo-ui-shared-host` | **87/160** | **no** | 97.5 ms | 73 | 23 |
| `nitro-ui` | 160/160 | yes | 150.5 ms | 0 | 32 |

One component, one size, the two `@expo/ui` arms. Their `N=50` twins were complete (160/160 each),
as were all four arms at every other component and size, and `mountedNs`/`jsCommitNs` plus every
CPU and memory metric in these two cells were whole too — only the frame-presentation signal goes
missing. Note the survivor bias the guard is protecting against: `expo-ui-shared-host`'s median of
97.5 ms is the median of the 87 iterations that *did* present; the 73 that didn't are exactly the
slow ones, so a `--force` mint would have recorded a flattering number for the reference arm and
gated future runs against it.

### Does `maintainer-mac-1`'s iOS baseline have these cells, and with how many samples?

Yes to both. `bench/baselines/maintainer-mac-1/ios27-sim-iphone17.json` records all twelve
`mount.date-picker:*` cells (N=1/50/200 × four arms), and a baseline stores per metric 8
`launchRatios` plus their spread:

| Cell | stored `samples` | stored `noise` | stored ratio (to `rn-core`) | its `sanity.missingPresented` |
| --- | --- | --- | --- | --- |
| `mount.date-picker:expo-ui-host-per-control:200` | 8 | 0.5 % | 123.74× | **0** |
| `mount.date-picker:expo-ui-shared-host:200` | 8 | 0.5 % | 116.26× | **0** |
| `mount.date-picker:nitro-ui:200` | 8 | 66.8 % | 3.01× | 0 |
| `mount.date-picker:rn-core:200` | 1 (control, 1.0 by construction) | 0.0 % | 1.00× | 0 |

On `maintainer-mac-1` those two cells presented on **every one** of their 160 measured iterations —
`missingPresented: 0` in the committed file's own `sanity` block — which is why that run minted with
DatePicker in the plan. The 123.74× and 116.26× levels are ratios to `rn-core` and not a defect (a
stock RN date picker at N=200 presents in ~16 ms while `@expo/ui`'s needs dozens of frames); the
0.5 % spread is the number that says its samples were whole. Nothing here is a bug in the guard: it
caught exactly the case it was written for, on the reference arms rather than on ours.

### iOS ratios vs `expo-ui-shared-host` (the refused run)

Launch-paired medians from the run's own results file, mount at N=50 and memory at N=200, with the
gate's own noise rule (spread of the 8 launch-paired ratios over 10 % MAD ⇒ no verdict). ✓ ≤ 1.0×,
✗ over it, ᴺ = denied a verdict, plain = parity within rounding. Nothing that reads `n/a` is
upgraded into a number — `mount.date-picker` at N=200 is `n/a` in the runner's tables and here, for
the two arms above.

| Component | presented | UI CPU | memory |
| --- | --- | --- | --- |
| `switch` | 0.72× `ᴺ ✓` | 0.75× `✓` | 0.99× `✓` |
| `button` | 1.00× | 1.31× `✗` | 1.35× `✗` |
| `date-picker` | 3.02× `✗` | 0.13× `✓` | 0.93× `✓` |
| `picker` | 0.27× `ᴺ ✓` | 0.33× `ᴺ ✓` | 0.77× `✓` |
| `progress` | 0.41× `✓` | 1.14× `✗` | 1.38× `✗` |
| `segmented-control` | 0.26× `✓` | 0.58× `ᴺ ✓` | 0.84× `✓` |
| `slider` | 0.62× `✓` | 0.91× `✓` | 1.46× `✗` |

Supporting absolutes (median of per-launch medians, nitro-ui vs `expo-ui-shared-host`; the runner
prints the same numbers in its own table):

- presented: switch 44.5 vs 61.5 ms, button 16.1 vs 16.1, date-picker 48.6 vs 16.1, picker 42.7 vs
  197.8, progress 16.1 vs 39.0, segmented-control 45.0 vs 170.9, slider 34.9 vs 55.6.
- mount UI CPU per op: switch 32.3 vs 43.0, button 19.8 vs 15.0, date-picker 29.4 vs **237.6**,
  picker 46.4 vs 138.1, progress 25.1 vs 21.7, segmented-control 55.9 vs 95.5, slider 35.2 vs 38.8.
- update UI CPU per op (N=50, medians rather than launch-paired, as in A1c): switch 0.81× (8.59 vs
  10.57 ms), button **1.61×** (14.08 vs 8.71), date-picker 0.08× (8.63 vs 103.65), picker 0.95×
  (44.59 vs 46.88), progress 0.78× (5.79 vs 7.43), segmented-control 0.87× (93.71 vs 107.76),
  slider 0.70× (10.59 vs 15.04).
- memory per instance at N=200: switch 263.2 vs 265.6 KiB, button 206.5 vs 153.9, date-picker 199.1
  vs 213.3, picker 624.4 vs 813.9, progress 168.7 vs 122.1, segmented-control 366.8 vs 435.6,
  slider 261.6 vs 178.2.

Read against `maintainer-mac-1`'s published iOS table: the memory column reproduces within 0.02× on
the five 0.1-surface controls — switch 0.99 vs 1.00, slider 1.46 vs 1.48, progress 1.38 vs 1.38,
button 1.35 vs 1.34, segmented-control 0.84 vs 0.83 — which is the column a baseline gates on.
`date-picker`'s memory does not (0.93× here, 0.70× there), and `picker` has no mac-1 figure at all:
that file has 168 cells, none of them `*picker*`, so all 28 of this run's Picker cells have nothing
to regress against. `presented` and `UI CPU` do **not** reproduce: this machine's `mount` N=50 sits
at 44.5 ms of presented wall-clock for nitro-ui against 16.2 ms there, i.e. both arms span several
frames here where mac-1's both sat on one 16 ms frame. The whole column moves, ours and `@expo/ui`'s
together, which is why these ratios must not be gated against the other machine's — the per-machine
rule in this directory exists for exactly that. One update-path miss repeats across machines:
`button` at 1.61× (mac-1: 1.52×).

`date-picker`'s 3.02× reads like a new 3× regression and is the same frame-floor artefact A1c
documented, from the other side: mac-1 measured nitro-ui at 16.15 ms and the shared host at 16.17 ms
(one frame each, so 1.00× with nothing to measure), while here ours spans three frames at 48.6 ms
and the shared host still sits on the 16 ms floor. Whether that is this simulator's host-GPU path or
a real behaviour change cannot be told from one refused run, and it is not what a baseline is for.

## Android run — MINTED

`bench/baselines/maintainer-mac-2/android35-emu-pixel9.json`, one file, its own commit.

| Field | Value |
| --- | --- |
| Command | `bun bench --platform android --plan full --launches 8 --update-baseline`, via `node scripts/gate.mjs bench --background -- …` (pid 17639) |
| Results | `bench/results/9cf95f3-android-20261028T021336Z.json` (+ `.ndjson`, `.md`) — gitignored |
| sha / dirty | `9cf95f3` / `dirty: false` (clean tree for all 5 h 13 min) |
| Device | AVD `nitroui_a`, API 35, profile `pixel_9`, `emulator-5574` on adb server 5043 → key `android35-emu-pixel9` |
| Plan | `full` / 8 → 49 cells × 5 implementations × 8 = **1848 launches**, 1848/1848, `problems: []`; the file stores 231 cells (14 are never scheduled: `@expo/ui` has no Android DatePicker — see below) |
| Duration | 18 806 260 ms = **313.4 min** (5 h 13 min), 10.2 s per launch, 02:13:36 → 07:27:02 WET |
| ART | `com.nitroui.bench` → `speed-profile`, `primed: true`, **attempts: 1** |
| Machine | maintainer-mac-2, Apple M1 Max, 10 cores, 32 GB, `quiet: true` |
| loadSamples | `{count: 2475, ceiling: 5, median: 1.4702, p90: 2.1138, max: 3.8149, over: 0, overFraction: 0}` |
| End instant | `loadavg1` 1.43, `loadavg5` 1.57 |
| Baseline | 368 698 bytes, sha256 `584787fb85a53d2a572b72ca21c0c1e8230c58ed0fff25be49ffe394abc21256`, 231 cells, `bunx prettier --check` clean (the mint self-formats) |

Zero of 2475 whole-run samples over the ceiling and `max` 3.81: the run sat below the guard rather
than only its median. `sanity.mjs --only-missing` lists 46 of the 231 cells and none of them is a
gated signal with a hole: 33 `leak.*` cells report `bytesPerInstance 0/8` because that scenario
stores a slope and no memory figure (those are the `new arm` rows), 12 `update.*` cells at N=1/50 on
the three reference arms recorded 160/160 missing because an update cycle on those arms presents no
new frame on this emulator at all, and one cell lost a single frame of 160
(`mount.picker:expo-ui-host-per-control:50`, well inside the 10 % budget the iOS run tripped over).
`nitro-ui`'s 7 listed cells are all `leak`, with `missingMount 0, missingPresented 0`.

### Boot mode (comparability note)

The pool's `~/.android/avd/nitroui_a.avd/config.ini` carries `hw.gpu.enabled=no`, so the lease's AVD
was booted explicitly with `-gpu host` (plus `-port 5574 -no-window -no-audio -no-boot-anim
-no-snapshot-save`) on the lease's private adb server — the mode `docs/architecture/benchmarks.md`,
`scripts/real-input/android.mjs` and T12 use; `sys.boot_completed` in 15 s. A software-rendered
emulator would have measured something else entirely in `presentedNs`. mac-1's file does not record
its boot flags, so this is stated rather than assumed to match.

### Android ratios vs `expo-ui-shared-host`

| Component | presented | UI CPU | memory |
| --- | --- | --- | --- |
| `switch` | 1.12× `✗` | 1.84× `✗` | 2.88× `✗` |
| `button` | 1.25× `✗` | 1.80× `✗` | 2.46× `✗` |
| `picker` | 1.03× `✗` | 1.48× `✗` | 0.94× `✓` |
| `progress` | 0.94× `✓` | 0.90× `✓` | 1.67× `✗` |
| `segmented-control` | 1.18× `✗` | 1.46× `✗` | 1.15× `✗` |
| `slider` | 1.23× `✗` | 1.80× `✗` | 2.41× `✗` |

Android has no `date-picker` row here, and not because it is missing: `@expo/ui` cannot mount a
DatePicker on Android at all (`ARMS_WITHOUT_COMPONENT`, which the run prints as `Arms: no
expo-ui-host-per-control, expo-ui-shared-host cell on android`), so that component's cells belong to
`rn-core`, `nitro-ui` and `nitro-ui-host` only — the reason the file has 231 cells rather than 245.
With no shared host to divide by it cannot appear in this table; what it does have, and what
`--check` gates on this machine, is its ratio to `rn-core`: mount presented 1.38× (0.5 % spread),
mount UI CPU 2.50×, update presented 1.54×, memory **6.66×** — our worst memory number on the
platform. mac-1's Android file has neither DatePicker nor Picker (140 cells; it predates both).

Supporting absolutes (median of per-launch medians, nitro-ui vs `expo-ui-shared-host`):

- presented: switch 35.6 vs 31.7 ms, button 40.4 vs 32.4, picker 65.4 vs 63.4, progress 32.8 vs
  35.0, segmented-control 57.3 vs 48.9, slider 39.5 vs 32.5 — all six within one to two frames of
  the reference, spreads 0.9–3.5 %.
- mount UI CPU per op: switch 16.7 vs 9.1, button 21.7 vs 12.0, picker 48.0 vs 32.4, progress 14.6
  vs 16.2, segmented-control 36.3 vs 24.9, slider 20.2 vs 11.2.
- update UI CPU per op (N=50): switch 1.77× (9.60 vs 5.41 ms), button 1.86× (12.01 vs 6.49), picker
  **0.46×** (25.33 vs 55.65), progress **0.09×** (4.20 vs 47.92), segmented-control 0.88× (30.01 vs
  34.07), slider 1.24× (7.08 vs 5.69).
- memory per instance at N=200: switch 143.7 vs 50.0 KiB, button 188.6 vs 76.6, picker 291.8 vs
  312.8, progress 131.6 vs 78.7, segmented-control 329.6 vs 287.8, slider 148.2 vs 61.6.

Read against `maintainer-mac-1`'s committed Android file — 133 rows both machines measured with ≥ 8
samples each, ordered by the worse of their two spreads — the memory column reproduces: `memory`
2.66 → 2.70 (1.02×), `memory.button` 2.47 → 2.46 (1.00×), `memory.segmented-control` 1.25 → 1.31
(1.05×), `update:50 presented` 0.94 → 0.95 (1.01×). The D15 gap is the same gap on both machines:
mount `mainNsPerOp` is 1.5–1.8× the shared host on switch/button/slider, switch and slider memory
2.4–2.9×. What moves between machines is the frame-bound latency — `mount.slider:200 presented` 1.77
there vs 2.56 here, `mount.progress:200 presented` 1.33 vs 1.88 — the same host-GPU/frame-floor
effect the iOS section describes, on the Android emulator. `update.progress` 0.09× and `update.picker`
0.46× are `@expo/ui`'s weak spots on both machines, so they are not levers to bank on, same caveat
A1c wrote for iOS `date-picker`.

## Red proofs

- `report.mjs --check` against the new Android baseline -> halve the quietest gated row
  (`update.date-picker:nitro-ui:50 presentedNs`, 0.17 % MAD over its 8 launch-paired ratios) in
  **both** `ratio` and all 8 `launchRatios` -> exit **1**: ``- FAIL `update.date-picker:nitro-ui:50`
  presented: 2.00x, 95% CI 1.98x-2.02x (launch bootstrap over 16 launches)``, and the row count
  moves 166 → 165 within tolerance with 1 FAIL.
- same guard -> **double** that same row instead -> exit **0**, the row reads `0.50x`. Recorded
  because the direction matters: `--check` divides this run's ratio by the stored one, so a baseline
  entry twice too generous reads as a 2× improvement and stays green. Only the halving goes red, and
  `ratio` alone is not enough — halving it while leaving the 8 `launchRatios` keeps the CI green
  (A1b's finding, reproduced on this file).
- picking a quiet row is what makes the proof conclusive: 27 of the 200 nitro-ui rows are
  noise-suppressed and cannot fail at any doctored value.
- restore by copy: sha256 identical to `584787fb85a53d2a…`, `--check` exit 0 again, prettier clean.
  The file that was committed is the file the mint wrote.

No new test or guard was written by this task, so nothing else needed a red proof; the guards that
decided both platforms (completeness, load, cleanliness) each demonstrated themselves on a real run
this round — one let a mint through with 0 of 2475 samples over, the other refused one with 11 of
2096 over, on a metric neither of them liked.

## What was on the machine

Nothing of mine but the bench, and one task at a time: the sim was shut down before the AVD was
booted, and no other task's process was running during either run (`ps` checked at both launches;
no gate, build, Metro or Gradle daemon of another task appeared at any point). `pmset` shows sleep
disabled on AC. Both apps were cold-built *before* the runs (`/tmp/a3/build-ios.log`,
`/tmp/a3/build-android.log`, both exit 0) so no compile load landed inside a measured launch — both
bench runs logged `reused`.

Background noise observed in the 15 s sample log (`/tmp/a3/load-logger.log`: 2 513 samples from
21:10:44 to 07:39:42, both runs and the gap between them): `mds`/`mds_stores`/`mdworker` and the
Spotlight agents, `backupd`, and a resident `ScreenSharingSubscriber` XPC service with no active
session (`who` reported the console user only). The one excursion inside the iOS run is 22:27:06 to
22:28:37 — 7 samples over 5.0, peak 8.23 — which is the runner's own 11-over count and `max` 7.87
seen a few seconds apart; I have no per-process attribution for it, and 11 of 2 096 samples is
nowhere near the 10 % share the guard carries. The sim boot at 21:11 spiked my log to 59.93 for a
handful of samples, well outside the measured window; the headless `-gpu host` AVD boot at 02:07 did
not spike it at all (max 2.84 across the whole settle window), and the Android run recorded nothing
over its ceiling. The settle discipline before each launch: 15 min of samples under load1 4 for iOS
(max 3.29), 6+ min for Android (max 2.84), both re-checked with `--dry-run` immediately before
launching.

## Files changed

- `bench/baselines/maintainer-mac-2/android35-emu-pixel9.json` — the Android baseline, in its own
  commit (`95f209d`), one file, 11 459 lines.
- `bench/baselines/README.md` — header and Status now record both machines: what mac-2 gates, why
  its iOS file does not exist and that a retry would not produce one; the `new arm` paragraph is now
  explicitly mac-1's situation; the Minting section says the load ceiling and the frame floor belong
  to the measuring machine (`cpuModel` is what says which).
- `docs/tasks/FOLLOWUPS.md` — one line on the two `@expo/ui` DatePicker N=200 `presentedNs` cells.
- `docs/tasks/A3-baselines-mac2.report.md` — this report, + `docs/tasks/A3/gates.jsonl` from
  `gate.mjs export --task A3`.
- Nothing else: no source, native, runner or test file changed; `bench/results/` stays gitignored and
  `maintainer-mac-1`'s two files are untouched.

## Merge note

The branch base is `9cf95f3`; `main` has moved to `c47a280` with docs-only commits since (Q1–Q4
research, the Q4 FOLLOWUPS triage, the 0.4 plan, X4's brief). One file changed in both:
`docs/tasks/FOLLOWUPS.md` — Q4 rewrote it and A3 appends two lines at the end, so expect a conflict
there and resolve by keeping Q4's triaged file plus A3's two new lines. Nothing else collides, and
nothing in either direction touches platform code, so `check` carries over: the code-tree digest is
unchanged by `docs/` and `bench/` edits, which is why the three commits here still show
`35948172d50e`.

## Follow-ups

- bench/iOS: `@expo/ui`'s two DatePicker cells at N=200 present on only 55/160 and 87/160 measured
  iterations on `maintainer-mac-2`'s simulator (`missingPresented` 105 and 73) where mac-1's file has
  0 on both — the round-4 completeness rule refused A3's iOS mint over it; find why the frame probe
  gives up there (`FRAME_TIMEOUT_MS` is 2 s; the N=50 twins are whole) or that machine cannot mint
  iOS.
- bench: `--check` cannot see a baseline entry that is too *generous* (doubling one row read 0.50× and
  stayed green). If that matters, the fix is a sanity bound on stored ratios at mint time, not a
  change to the read path.
