# A1 — Phase A: committed bench baselines

**Branch:** `task/A1-baselines` (from `main` at `29db250`). **Round:** 1 of 1. No push.

## Summary

Neither platform produced a committed baseline.

- **iOS: run completed, `--update-baseline` refused (busy machine).** One `--plan full
  --launches 8` run on the canonical iPhone 17, clean tree, 1120/1120 launches, **0 problems**,
  185.3 min — and the guard refused because `loadavg1` was **10.50 over 14 cores** (ceiling 7.0).
  No `--force`, no retry, per the brief. The data itself is usable and is reported below.
- **Android: no baseline is obtainable at all today — the full plan cannot complete.** One attempt
  ran on the assigned `nitroui_t01` (free this time, ART primed to `speed-profile`), got through
  107 of 1120 launches, and hit three identical failures: every `mount.<component>:nitro-ui:200`
  cell for `Switch`, `Slider` and `Button` died with a Java-heap **OutOfMemoryError** (192 MiB
  growth limit) instead of reporting, so the runner logged `no end sentinel within 180s`. `problems`
  non-empty is itself a baseline blocker, so the attempt was stopped there rather than grinding ~3
  more machine-hours (24 further 180-second timeouts) toward a foregone refusal. No results JSON,
  no Android ratios. Details and options below.

So `bench/baselines/` still holds only `README.md` and `renders.json` (unchanged from T02 round 4),
and `--check` remains inert on both platforms. The machine — not the runner, not the library — is
what is blocking **iOS** minting: this is now the second independent busy-machine refusal on this
host (R2 hit `load average 7.80 over 14 cores` on its Android `switch` run,
`docs/tasks/R2-release-0.1.report.md` §5). **Android has a second, harder blocker, and it is ours:**
the bench app OOMs on three of five controls at `N=200`, so no `--plan full` Android run can finish
on any machine until a heap decision is made (Question 1).

## Files changed

- `docs/tasks/A1-baselines.report.md` — this report. Nothing else: no baseline JSON, no
  `bench/baselines/README.md` Status edit, no README Performance pointer edit (see "Decisions").

## iOS: minted? no — refused, verbatim

Command (clean tree at `29db250`, Release build, no Metro, D9/D18 respected):

```sh
IOS_SIM_UDID=F08675D3-A32B-4F88-BC81-02D7E0CB797E \
  bun bench --platform ios --plan full --launches 8 --update-baseline
```

Refusal, verbatim (`/tmp/a1-ios-bench.log`):

```
--update-baseline refused (pass --force to override):
  - the machine was busy: load average 10.50 over 14 cores (ceiling 7.0)
```

That is the only blocker: plan, launch count, tree cleanliness and `problems` all passed.

| Field | Value |
| --- | --- |
| Result file | `bench/results/29db250-ios-20261024T142215Z.json` (gitignored) |
| Device | iPhone 17 sim `F08675D3-A32B-4F88-BC81-02D7E0CB797E`, iOS 27.0 → `ios27-sim-iphone17` |
| Machine | Apple M4 Pro, 14 cores, 48 GB, Xcode 27.0, macOS 27.0 |
| Plan / launches | `full` / 8 → 35 cells × 4 implementations × 8 launches = **1120 launches** |
| Completeness | 1120/1120, `problems: 0`, `dirty: false` |
| Duration | 11 116 379 ms = **185.3 min** (~9.9 s per launch) |
| Load at guard | **loadavg1 10.4995, loadavg5 14.3477**, `quiet: false` |

### Load, and what caused it

The guard samples load when the run **finishes**, so this is a statement about the whole 3-hour
window, not one moment:

| When | load1 / 5 / 15 | Note |
| --- | --- | --- |
| Run start (~15:22) | ~4.13 | under the 7.0 ceiling, so the run was allowed to start |
| 17:30 (mid-run) | **510.79 / 302.67 / 164.76**, 2002 procs | 66 × `SetStoreUpdateService`, 28 × `clang`, `spindump` |
| Run end (guard) | 10.50 / 14.35 | → refusal |

None of it came from the bench. At the peak the box was running ~2000 processes, four *foreign*
booted simulators, another task's Xcode builds and a `spindump` storm; an unrelated foreground
app has been at 47–120 % CPU for hours and was still running at 18:52. During
this report's own bounded wait the load went 12.76 → 29.04 with that app and the agent host app
dominant. A 14-core desk that a human is actively using cannot satisfy `load1 ≤ 0.5 × cores` for a
three-hour window.

## Android: minted? no — the full plan cannot complete on Android

The device was not the blocker this time. `nitroui_t01` restored its `default_boot` snapshot in 2 s
and reached `sys.boot_completed=1` on the first try (Android 15, `sdk_gphone64_arm64`, `pixel_9`
AVD, `system-images/android-35/google_apis/arm64-v8a`) → device key **`android35-emu-pixel9`**, the
same key R2's `--check` resolved. The boot failures earlier in this round (`Running multiple
emulators with the same AVD is an experimental feature`, `Failed to load userdata image file with
overlay: no items in group`) were contention/stale-overlay artefacts, not a broken AVD.

Load before the run, from the brief's bounded wait (5-minute steps): `12.76` → `29.04` → `2.84`, so
the attempt started at **load1 3.41** (ceiling 7.0) with the emulator already booted:

```sh
ANDROID_AVD=nitroui_t01 ANDROID_ADB_SERVER_PORT=5041 \
  node scripts/bench/run.mjs --platform android --plan full --launches 8 --update-baseline --skip-build
```

`ART: attempt 1: com.nitroui.bench -> speed-profile` (D18 satisfied), 35 cells × 4 implementations ×
8 launches = 1120 launches, device resolved by AVD name to `emulator-5570`. `--skip-build` reused the
Release APK built from this same clean tree at `29db250` (newer than every tracked source), the way
R2 reused its artifact across runs.

It ran 18:47:43 → 19:13:26 (25.7 min, 107/1120 launches) and was then stopped deliberately, because
three cells had already failed in the identical way and would fail on all eight launches:

```
[12/1120] mount:nitro-ui:200        launch 1/8 ... 0 iterations (180.2s)
  ! no end sentinel within 180s
[40/1120] mount.slider:nitro-ui:200 launch 1/8 ... 0 iterations (180.2s)
  ! no end sentinel within 180s
[68/1120] mount.button:nitro-ui:200 launch 1/8 ... 0 iterations (180.5s)
  ! no end sentinel within 180s
```

The app is dying, not being slow. `dumpsys dropbox` on that device, first entry:

```
2026-10-24 18:54:57 data_app_crash (text, 847 bytes)
Process: com.nitroui.bench   PID: 19707   Foreground: Yes   Process-Runtime: 11948
java.lang.OutOfMemoryError: Failed to allocate a 32 byte allocation with 69904 free bytes and 68KB
until OOM, target footprint 201326592, growth limit 201326592; giving up on allocation because
<1% of heap free after GC.
    at androidx.compose.ui.platform.AndroidComposeViewAccessibilityDelegateCompat
     .boundsUpdatesEventLoop$ui(AndroidComposeViewAccessibilityDelegateCompat.android.kt:2378)
```

What the pattern says (all from this one pass):

- It is specific to the **mount scenario at N=200**, and only for the controls with the heaviest
  per-instance cost: R2 measured Android memory at 2.74× (`Switch`), 2.57× (`Slider`) and 2.50×
  (`Button`) the shared host versus 1.61× for `Progress` — and `mount.progress:nitro-ui:200`
  completed normally in **6.7 s** in the same pass.
- Heap pressure in the mount scenario grows with the number of iterations in one process. The mount
  protocol is 5 warmup + 20 measured iterations (`bench/src/runner.ts:12`), and that is what dies; the
  `leak.*:200` cells for the same components, which do **10** cycles
  (`LEAK_CYCLES`, `bench/src/runner.ts:18`), and the single-measurement `memory.*:200` cells finished
  in 4–20 s. So 10 cycles of 200 controls fit under the limit and 25 do not. The bench app does not
  set `android:largeHeap` (`bench/android/app/src/main/AndroidManifest.xml:14`), so its growth limit is
  the 192 MiB the AVD gives a normal app.
- Whether the heap is **retained** per iteration (a leak in disguise, which would be a component bug) or
  simply not collected fast enough (a harness artefact) cannot be told from this data and needs a
  profile — out of A1's scope, filed as a follow-up. The distinction decides between Question 1(a) and
  1(c), so it is worth answering before anyone schedules a mint.
- `segmented-control` is untested: its N=200 cell is launch 124 and the attempt stopped at 107.

Consequences:

1. **A non-empty `problems` list is itself a blocker** — `baselineBlockers()` adds
   `"${n} launch(es) did not complete in this run"` (`scripts/bench/lib.mjs:1382`), so
   `--update-baseline` could not have accepted this run whatever the load. No Android refusal text was
   printed, because I stopped the run before the guard ran: this is a code-backed inference, stated as
   such. It was determined by launch 12, before the cause was even known, and continuing to 1120 would
   have cost ~3 more hours (24 more of those launches are 180 s timeouts each, ≈72 min of dead time)
   for a refusal that was already certain. There is therefore no Android results file and no Android
   ratio table in this report.
2. **No Android baseline can be minted today even on a perfectly idle machine.** R2 only ever ran
   `--plan quick`, whose mount cells stop at N=50, and the one Android baseline T02 committed
   self-skipped — so `mount.<component>:nitro-ui:200` on Android has never completed anywhere in
   this repo's history. This is the real obstacle, and it is a bigger deal than the load guard.
3. Load drifted out from under the run again anyway: 3.41 at start, and by 18:58 the unrelated
   foreground app (30–80 % for hours) had company from a second one (105 % + 42 %), pushing load1 back
   to 10.4.

## Headline ratios — nitro-ui ÷ `expo-ui-shared-host`

Launch-paired medians from this full run, `N=50` for mount `presented`/UI CPU and `N=200` for
memory. `ᴺ` = the within-run spread of that cell's launch-paired ratios is over 10 %, so the
runner gives it **no verdict** — that is 58 % of nitro-ui ratio cells (79 of 136) on this run, and
45 % of all 544 ratio cells including the reference arms. Numbers are reported anyway because the
direction is what R2 published.

| Component | presented | UI CPU | memory | mount UI CPU absolute (nitro vs shared host) |
| --- | --- | --- | --- | --- |
| `Switch` | 0.41× `ᴺ` | 0.70× | 0.99× | 27.3 ms vs 39.9 ms |
| `Slider` | 0.90× `ᴺ` | 0.84× | 1.45× | 29.0 ms vs 32.7 ms |
| `Progress` | 0.62× `ᴺ` | 1.29× `ᴺ` | 1.39× | 21.0 ms vs 15.0 ms |
| `Button` | 0.49× `ᴺ` | 1.22× | 1.36× | 15.1 ms vs 12.9 ms |
| `SegmentedControl` | 0.39× `ᴺ` | 0.53× | 0.82× | 80.6 ms vs 141.6 ms |

Fuller table (nitro-ui ÷ each arm, same run) — `rn-core` is the control and gates, the `expo-ui-*`
arms are reference arms:

| Component | presented ÷ shared / per-control / rn-core | UI CPU ÷ shared / per-control / rn-core | memory ÷ shared / per-control / rn-core |
| --- | --- | --- | --- |
| `switch` | 0.41ᴺ / 0.17 / 1.53ᴺ | 0.70 / 0.23ᴺ / 4.19ᴺ | 0.99 / 0.67 / 2.44 |
| `slider` | 0.90ᴺ / 0.29ᴺ / 2.74ᴺ | 0.84 / 0.40ᴺ / 26.76ᴺ | 1.45 / 0.87 / 38.23 |
| `progress` | 0.62ᴺ / 0.29 / 1.01 | 1.29ᴺ / 0.45 / 9.40ᴺ | 1.39 / 0.77 / 8.53 |
| `button` | 0.49 / 0.35ᴺ / 1.00 | 1.22 / 0.37ᴺ / 7.71ᴺ | 1.36 / 0.77 / 4.17 |
| `segmented-control` | 0.39ᴺ / 0.33ᴺ / 3.23ᴺ | 0.53 / 0.48ᴺ / 3.82ᴺ | 0.82 / 0.67 / 2.35 |

Supporting absolutes from the same run:

- Memory per instance, `N=200`: `rn-core` 106.5 KiB, `expo-ui-shared-host` 264.9 KiB,
  `expo-ui-host-per-control` 389.7 KiB, **nitro-ui 261.5 KiB** — nitro-ui sits at the shared host's
  memory and below the per-control arm, and the per-launch spread is tight (257–263 KiB over 8
  launches), which is why memory still carries a verdict on a noisy machine.
- Mount `presented` medians, `N=50`: `rn-core` 16.1 ms, shared host 59.4 ms, per-control host
  142.7 ms, nitro-ui 24.6 ms.
- Leak: all 20 leak cells recorded a **non-monotonic** climb (nitro-ui slopes 62–215 KiB/cycle), so
  `--update-baseline` records no leak slope at all (`scripts/bench/lib.mjs:958` skips a slope whose
  series does not climb monotonically) and `--check` prints `new arm` for all five leak cells.

## Does this differ materially from R2's quick runs? No.

R2's published iOS numbers (`README.md` Performance, from `--plan quick --launches 4` on the same
device) against the same arm, same three metrics:

| Component | presented R2 → A1 | UI CPU R2 → A1 | memory R2 → A1 |
| --- | --- | --- | --- |
| `Switch` | 0.31 → 0.41 `ᴺ` | 0.74 → 0.70 | 0.99 → 0.99 |
| `Slider` | 0.34 → 0.90 `ᴺ` | 0.81 → 0.84 | 1.44 → 1.45 |
| `Progress` | 0.45 → 0.62 `ᴺ` | 1.11 → 1.29 `ᴺ` | 1.36 → 1.39 |
| `Button` | 0.49 → 0.49 `ᴺ` | 1.23 → 1.22 | 1.35 → 1.36 |
| `SegmentedControl` | 1.00 → 0.39 `ᴺ` | 0.68 → 0.53 | 0.83 → 0.82 |

**Memory and mount UI CPU reproduce to within a few percent on every control** — the two metrics
the gate leans on are stable even on a saturated machine. Only `presented` moves, and only in the
noise-flagged column: `presented` is wall-clock to a frame, and `presentedBeforeMount` totals 1670
samples across the run (e.g. 99 of 160 in `mount:nitro-ui:50`), so the frame probe denies every iOS
`presented` cell a verdict — exactly as in R2 (`n/v` on all five controls). Nothing here
contradicts what 0.1 shipped; the `Progress` UI-CPU miss (1.11× R2, 1.29× here and noise-flagged
here) stays the documented D15 miss it is.

## `--check` plumbing: proven to read back and proven to fail

Because no baseline may be committed, these ran against a **derived** baseline written to
`bench/baselines/ios27-sim-iphone17.json` with `--force` purely to exercise the read path; the file
was **deleted again**, so the tree is clean and `bench/baselines/` is untouched (`git status
--short` empty). It is derived from the same results file, so it is the content a quiet run would
have written — and it carries `quiet: false`, `loadavg1: 10.4995`.

| What | Command | Result |
| --- | --- | --- |
| No baseline (today's reality) | `node scripts/bench/report.mjs bench/results/29db250-ios-20261024T142215Z.json --check` | exit **1**, `--check: no baseline at bench/baselines/ios27-sim-iphone17.json. Create it with --update-baseline.` |
| Reads back green | same command, derived baseline present | exit **0**; 141 nitro-ui rows: 57 `within tolerance`, 79 `noisy` (suppressed), 5 `new arm` (leaks), **0 failures** |
| Can go red | same command, one quiet nitro-ui ratio halved in the baseline (`mount.segmented-control:nitro-ui:1` UI CPU/op) | exit **1**, `- FAIL mount.segmented-control:nitro-ui:1 UI CPU/op: 2.00x, 95% CI 1.73x-2.32x (launch bootstrap over 16 launches)` |

The red demo is worth reading closely, because it says something about the gate: halving only the
baseline's `ratio` field moves the printed `head/base` to 2.00× and still yields `over threshold,
not conclusive` (exit 0) — the bootstrap CI is computed **launch-paired**, from the baseline's
`launchRatios`, so it correctly refuses a verdict. Halving the `launchRatios` as a real regression
would is what makes it `FAIL`. Median bookkeeping alone cannot satisfy the gate.

## Decisions made

- **Did not** edit `bench/baselines/README.md` "Status" or the README Performance pointer. Both say
  no baselines exist, which is still true; the brief conditions those edits on committing a baseline
  JSON. A one-line correction to the README's device-key example is a follow-up instead.
- **No `--force` on any run.** `--force` appears only in the throw-away derived baseline used to
  exercise `--check`, and nothing derived was committed.
- **One attempt per platform**, then stop (D19). The bounded wait is the brief's, not a retry loop.
- Device hygiene: booted only my own iPhone 17 sim and my assigned `nitroui_t01`; both shut down at
  the end. Never touched `emulator-5560`, iPhone Air `331EF109…`,
  `nitroui_t02`/`emulator-5572`/adb 5042/Metro 8294. Private adb server only (5041), devices always
  addressed by serial.

End state: iPhone 17 sim `F08675D3…` shut down (I booted it), `nitroui_t01` stopped with
`adb -s emulator-5570 emu kill`, and my private adb server stopped with
`ANDROID_ADB_SERVER_PORT=5041 adb kill-server` (never the default port, never `pkill`). No Metro was
started — release benches do not use one (D9). The other project's `nitroui_t02` emulator and its
Metro on 8298 were already gone before I touched anything (that AVD's last disk write is 18:40; my
first `emu kill` was 19:13). No simulator or emulator I did not start was shut down, wiped or killed,
and the simulators still booted at the end (`RNSB 26.4`, `RNSB starter`) are not mine.

## Known issues / follow-ups

- `bench/baselines/README.md` and `docs/architecture/benchmarks.md` use `ios27-sim-iphoneair` as the
  iOS device-key example, but the canonical iOS bench device is the iPhone 17
  (`ios27-sim-iphone17`, as `--check` resolves it). One-line doc fix, not done here (D19).
- `report.mjs --check` exits **1** for "no baseline" while `run.mjs --check` exits **2** for the same
  condition, and the documented exit-code table says 2 = "the run could not be judged". Cosmetic
  inconsistency between two call sites of the same gate.
- On a saturated machine `--check` degrades quietly: 79 of 141 nitro-ui rows were `noisy`, so a
  baseline minted from a busy run would gate far less than the quieter R2 runs would. Load guard
  first, always.
- `mount.<component>:nitro-ui:200` on Android OOMs the bench app (192 MiB Java heap) on `Switch`,
  `Slider` and `Button`. Bench-side heap headroom would let `--plan full` finish, but the honest
  reading is that the per-instance Compose bill that D19 already documents is what is doing it —
  profile before deciding which. Not touched here.
- The runner reports these as `no end sentinel within 180s` with no hint that the process died. A
  dead-app check (or surfacing the dropbox entry) would turn a 3-minute mystery into a one-line
  error. Not touched here.

## Questions for orchestrator

**1. Android needs a heap decision, not a device or a quieter machine.** Recommendation is (a):

- **(a) recommended** — add `android:largeHeap="true"` to the **bench app manifest only**
  (`bench/android/app/src/main/AndroidManifest.xml`, a test-harness file with no public-API surface)
  so `--plan full` can finish, then mint. One line plus a ~2.5 h quiet window, and both platforms'
  cells stay the same measurement.
- (b) lower `mount.<component>` to N=100 for Android in `full` — cheap, but then the two platforms'
  `N=200` cells are different measurements, exactly the drift D9 exists to prevent.
- (c) treat the OOM as a component bug and profile it (retention vs churn) before minting anything.
  Most honest, slowest, and arguably where the 0.2 shared-`<Host>` decision (D19/D22) should start.

**2. Who owns that fix?** It is a bench-manifest change plus a re-run, and A1's round is spent. Suggest
a small new task (or a fix round for A1, your call) with a scheduled multi-hour hold on one owned AVD.

**3. iOS: may I re-run once in a genuinely idle window?** The run I have is complete, problem-free and
reproduces R2 within a few percent; it only failed the load guard, at 10.50 against a 7.0 ceiling while
an unrelated app held a core for hours. Recommendation: one re-run overnight on the same commit (~3 h),
**not** `--force` on the existing run — a `--force`-minted baseline would carry `quiet: false` and
~58 % noise-flagged nitro-ui cells, i.e. a gate that mostly cannot fire. If you would rather accept
this run than schedule one, say so explicitly and I will do it with the reasons in the commit message.

**4. Confirm the Android device key and ownership.** Verified identity is API 35
(`system-images/android-35/google_apis/arm64-v8a`, `hw.device.name=pixel_9`), so the key is
`android35-emu-pixel9` — matching D9's example and R2's `--check` output. There is no API 36 image on
this machine, and both `nitroui_t01` and `nitroui_t02` are API 35 Pixel 9 AVDs. Minting needs one AVD
held for hours; this round `nitroui_t01` was free for 25 minutes and `t02` belonged to another project.

**5. Worth knowing before you schedule anything:** the guard samples load only when the run *ends*, so
a three-hour run that starts legal can still be refused at the door — and a run that starts illegal can
sneak through if the box quietens. Both shapes bit today (iOS refused after a legal start; Android
started at load1 3.41 and was back at 10.4 within ten minutes). Sampling at the start too, or refusing
to start above the ceiling, would make the guard cheaper to honour. Out of A1's scope; your call
whether it becomes a task.
