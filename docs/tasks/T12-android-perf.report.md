# T12 — Android Compose host performance: report

**Status: both phases done.** Phase 1 (below) is the profile and the breakdown, written before
optimising; [Phase 2](#phase-2--measured-per-change) is the optimising, measured one change at a time
on post-T11 code, with the final D15 verdict at the end. Phase 1's verdict is superseded by phase 2's;
phase 1 is kept unchanged as the record of what was measured when.

Phase 1 changed no library or core file: it added profiling tooling under `bench/tools/` and wrote
down where the Android UI-thread time and the per-instance bytes go. Phase 2 changes the library.

## Outcome (phase 2, in five bullets)

- **Half the gap was the bench measuring the ART interpreter.** No Android number this project
  published had the app's baseline profile in force (`status=verify`, and `-m speed-profile -f` before
  the first launch falls back to `verify`). The bench now primes it for every arm and reads the status
  back: mount UI CPU 14.85 → 8.92 ms, mount `presented` 39.53 → 32.60 ms, and mount `presented`
  against the shared host goes 1.22x → **1.01x** ([P1](#p1-the-change-that-was-hiding-all-the-others-art-was-interpreting-the-library)).
  "Half the gap" is the gap in **absolute ms**; priming is a regime change and moves the ratios too,
  so it is not a like-for-like before/after — and the mount UI CPU *ratio* did not move at all
  (1.40x → 1.42x). Nothing measured before T12, absolute or ratio, compares with a primed run.
- **Kept: four changes**, each measured separately. The `SwitchColors` cache and the library baseline
  profile measure ≈0 at this plan's resolution and stay for the reasons given in
  [P2a](#p2a-change-a--switchcolors-once-per-scheme-and-tint) and [P2d](#p2d-change-b--the-library-baseline-profile-as-its-own-row);
  the process-wide `ColorScheme` measured -1.1 KiB per instance — across builds, where this report's
  own floor is ±4%, so it is ≈0 and stays on the reasoning in [P2b](#p2b-change-g--the-material-colour-scheme-once-per-process);
  the Android synchronous correction budget of 1 cuts the cold-batch flush by 32% at 200 rows and 37%
  at 500 on the median of three rounds (-5% / -28% on the first batch in a process), in 6 of 6 rounds.
- **The cold-batch flush is one Fabric commit**, not engine work: 0.086 ms of engine around a 38 ms
  commit for 200 rows. D17's floor is one commit, and at zero the batch draws `stale=100`. Coalescing
  the 199 batched pushes is not reachable from a Hybrid View - RN commits one `StateUpdate` at a time.
- **Not reachable at all: fewer views per control.** `AbstractComposeView.onMeasure`/`onLayout` are
  `final`, so the RN host cannot also be the Compose view; the four `View`s per control stay.
- **D15 is still missed on mount UI CPU (1.35x) and memory (2.52x)**, with `presented` at parity,
  against a shared host that has one composition where we have N. Both are the architecture, and
  [P2f](#p2f-structural-option-with-the-measured-residual) is the write-up of what would remove them.

## Summary (phase 1)

- **D15 is not met on Android, and the gap has a single shape: one Compose composition per
  control.** On a quiet-ish machine, `nitro-ui` at 50 Switches is **1.47× the shared host on mount
  `presented`, 1.48× on mount UI CPU and 2.33× on memory** (round 4 read 1.88× / 1.80× / 2.64× —
  the ratios move with machine load, the sign does not). `update presented` passes at 0.99×;
  `update` UI CPU misses at 1.34×.
- **The double `updateState` is not the cost centre.** `propsApplied` is 2.00 per instance on mount
  as `docs/architecture/core.md` §3 predicts, but the second delivery is a perf mark plus a no-op
  props diff, and our JS commit is *faster* than rn-core's (0.90×). The generator short-circuit for
  N5 would remove ~1 ms/launch of JNI diff, not a 15 ms gap.
- **What the traces show instead** (mount N=50, self ms per iteration on the app UI thread): per-host
  composition init `Compose:initializeView` **3.21 vs 0.49**, recomposition
  `Compose:recompose` **5.45 vs 2.41**, and native view insertion
  `mountInstructions::INSERT` **3.82 vs 0.53**. Those three are the same fact seen three ways: 50
  hosts, 50 compositions, 50 view trees, where the shared host has one of each.
- **At N=200 the same fact turns into GC**: the app UI thread spends **167 ms per iteration** in
  ART reclaim (`GC: Wait For Completion Alloc` 85.3, `ProcessMarkStack` 36.0,
  `CompactMovingSpace` 35.8) against **1.7 ms** for the shared host. Our 68.8 KiB of Java heap per
  instance is what feeds it.
- The one host-side allocation that is unambiguously ours and clearly wrong is
  `SwitchDefaults.colors()` inside the composable — a fresh `SwitchColors` per recomposition per
  instance, which also defeats skipping for the `Switch` subtree (`HybridNitroUiSwitch.kt:104-110`).
- Everything that could plausibly close the remaining gap to ≤1.0× is in the files T11 is editing.

## Method

- Device: AVD `nitroui_t02` (`android35-emu-pixel9`, API 35), `-gpu host`, private adb server on
  `ANDROID_ADB_SERVER_PORT=5042`, per D13. Release bench build, no Metro, per D9.
- Commit under test: `c5be9af`, clean tree. Bench `bun bench --platform android --plan quick`,
  `problems: none`, results `bench/results/c5be9af-android-20261023T024344Z`,
  load average **1.69 / 5.58** over 14 cores, 209 s wall.
- Marks run `--perf-marks`, results `c5be9af-android-20261023T024729Z-marks`, load average
  **1.41 / 4.66**, 53 s. Instrumented, so it explains the other run rather than gating.
- Attribution: `bench/tools/android-trace.sh` (atrace around one cold launch of one cell) plus
  `bench/tools/android-trace-report.py` (`self-time`, `buckets`, `meminfo`). One launch = 5 warmup +
  20 measured iterations, so every trace number below is ms per iteration (÷25) and includes
  amortised process start. Self time is wall-clock inside traced slices, so it counts lock waits —
  that is why GC shows up as UI-thread cost. It attributes a shape; the bench's own CPU columns stay
  the measurement.
- Load average for every run is in the table above and in each results file. The device was shut down
  afterwards.

## 1. Before — quick plan at `c5be9af`

Absolute (median of launch medians, 4 launches × 20 iterations):

| Cell         | Implementation           | presented | mounted  | JS commit | JS CPU/op | UI CPU/op | bytes/inst |
| ------------ | ------------------------ | --------- | -------- | --------- | --------- | --------- | ---------- |
| mount N=50   | rn-core                  | 32.61 ms  | 22.97 ms | 1.83 ms   | 2.24 ms   | 8.46 ms   | n/a        |
| mount N=50   | expo-ui-host-per-control | 38.08 ms  | 29.82 ms | 8.70 ms   | 9.18 ms   | 20.82 ms  | n/a        |
| mount N=50   | expo-ui-shared-host      | 32.85 ms  | 24.79 ms | 2.02 ms   | 2.50 ms   | 10.99 ms  | n/a        |
| mount N=50   | nitro-ui                 | 48.29 ms  | 30.37 ms | 1.65 ms   | 2.06 ms   | 16.29 ms  | n/a        |
| update N=50  | rn-core                  | 31.92 ms  | 16.18 ms | 1.53 ms   | 1.66 ms   | 2.34 ms   | n/a        |
| update N=50  | expo-ui-host-per-control | 29.58 ms  | 14.89 ms | 2.27 ms   | 2.37 ms   | 8.22 ms   | n/a        |
| update N=50  | expo-ui-shared-host      | 30.01 ms  | 14.85 ms | 1.26 ms   | 1.37 ms   | 6.14 ms   | n/a        |
| update N=50  | nitro-ui                 | 29.72 ms  | 15.29 ms | 1.15 ms   | 1.34 ms   | 8.25 ms   | n/a        |
| memory N=200 | rn-core                  | n/a       | n/a      | n/a       | n/a       | n/a       | 53.3 KiB   |
| memory N=200 | expo-ui-host-per-control | n/a       | n/a      | n/a       | n/a       | n/a       | 193.7 KiB  |
| memory N=200 | expo-ui-shared-host      | n/a       | n/a      | n/a       | n/a       | n/a       | 55.3 KiB   |
| memory N=200 | nitro-ui                 | n/a       | n/a      | n/a       | n/a       | n/a       | 128.9 KiB  |

`nitro-ui` against the two arms that matter, launch-paired ratios from the run above, with T02
round 4 (`7929130-dirty`, load 1.99) next to them:

| Metric          | this run vs shared-host | T02 rounds 3-4 | this run vs rn-core | D15 |
| --------------- | ----------------------- | -------------- | ------------------- | --- |
| mount presented | 1.47x                   | 1.88x                  | 1.48x               | miss |
| mount UI CPU    | 1.48x                   | 1.80x                  | 1.92x               | miss |
| memory          | 2.33x                   | 2.64x                  | 2.42x               | miss |
| mount mounted   | 1.23x                   | 1.27x                  | 1.32x               | —   |
| update presented| 0.99x                   | 1.14x                  | 0.93x               | pass |
| update UI CPU   | 1.34x                   | 1.37x                  | 3.55x               | —   |
| JS commit       | 0.82x                   | 1.01x                  | 0.90x               | —   |
| JS CPU/op       | 0.82x                   | 0.94x                  | 0.92x               | —   |

Two things are stable across the two runs and one is not. The **sign** of every gap to the shared
host is stable. The **size** of the mount gaps is not: round 4 ran at load 1.99 with a colder tree and
read 1.88×, this run at 1.69 read 1.47×, so `mount presented` should be quoted as 1.5-1.9× and not as
one number. And the JS columns are the interesting exception: our JS side is *better* than rn-core's
and about par with the shared host's in both runs, so none of the gap is in the wrapper, the props
path or the event handshake. It is all on the UI thread.

Against `expo-ui-host-per-control` the library wins where it is supposed to win — mount UI CPU
0.78× it, memory 0.67× it, JS commit 0.19× it — but **loses on mount `presented` this run (1.27×)**,
where round 4 read 0.90×. Both arms are paying for N native view trees; ours is the cheaper tree and
the more expensive composition, and which one dominates `presented` moves with machine load. Quote
`mount presented` against that arm as 0.9-1.3×, not as a win.

The `T02 rounds 3-4` column is the nearest published comparison, and it is not a clean run-for-run
pair: `mount presented` 1.88x and `update presented` 1.14x are round 4's launch-paired ratios,
`memory` 2.64x and `mount UI CPU` 1.80x are the round-3 numbers that round 4's verdict carried
forward, and `mount mounted` 1.27x, `update UI CPU` 1.37x, `JS commit` 1.01x and `JS CPU/op` 0.94x
are derived here from round 4's absolute table (T02 publishes ratios only to rn-core). It is enough
to show the sign is stable and the size is not; it is not a paired comparison.

## 2. The second `updateState` costs one mark, not one composition

Scope 2 asked whether the Android double delivery is worth fixing. Measured, it is not the gap.

| Cell        | `propsApplied`/op | per instance | `props landed` | `props -> draw` |
| ----------- | ----------------- | ------------ | -------------- | --------------- |
| mount N=50  | 100               | 2.00         | 26.36 ms       | 3.20 ms         |
| update N=50 | 50                | 1.00         | —              | —               |

2.00 on mount is exactly the Fabric floor in `docs/architecture/core.md` §3, not a component bug,
and `NitroComposeHost.commit()` is where its cost lands: it marks unconditionally and then returns
when nothing is dirty (`NitroComposeHost.kt:207-214`), so the second delivery buys one perf mark and
one JNI props diff against an unchanged snapshot, and **no second composition**. The bench agrees:
our `jsCommitNs` is 1.65 ms vs rn-core's 1.83 ms and the shared host's 2.02 ms, and `mounted`
(30.37 ms) already includes both deliveries. Even if a generator short-circuit removed the diff
entirely it would be a sub-millisecond win per launch against a 15.4 ms UI-CPU gap. Recommendation:
do not spend the nitrogen patch surface on it in this task (see the questions).

## 3. Where the UI-thread time goes

Self time on the app UI thread folded into cost buckets, ms per iteration, mount N=50:

| Bucket                                | nitro-ui | shared-host | rn-core | per-control |
| ------------------------------------- | -------- | ----------- | ------- | ----------- |
| Compose content (recompose/apply)     | 8.90     | 4.90        | 0.00    | 9.51        |
| Compose host init                     | **3.21** | **0.49**    | 0.00    | 2.51        |
| Compose measure/layout/draw           | 4.51     | 2.83        | 0.00    | 4.47        |
| Fabric mount instructions             | 9.00     | 6.45        | 6.90    | 10.67       |
| View traverse / draw (whole screen)   | 3.79     | 9.78        | 5.29    | 7.19        |
| ART / dex / class loading             | 0.79     | 0.73        | 0.32    | 0.34        |
| App startup & lifecycle               | 1.87     | 5.20        | 0.97    | 1.18        |
| other / unclassified                  | 4.99     | 7.66        | 5.49    | 5.47        |
| **TOTAL traced**                      | **37.05**| **38.04**   | 18.95   | 41.47       |

Read the total first: over a whole launch our UI thread does *less* traced work than the shared host
(37.05 vs 38.04) and the bench still reports 16.29 vs 10.99 ms UI CPU per op. So this is not "we burn
more CPU in aggregate" — the shared host's launch is dominated by one long first composition and a
longer presenting frame (`HwcPresentDisplay` 4.11 vs our 1.46), while our work is spread across 50
serialised host setups inside the mount transaction that `presented` measures. Same total, worse tail,
and `presented` measures the tail.

The slices that make our tail long, mount N=50:

| Slice                                          | nitro-ui | shared-host |
| ---------------------------------------------- | -------- | ----------- |
| `Compose:recompose`                            | **5.45** | **2.41**    |
| `Compose:initializeView`                       | **3.21** | **0.49**    |
| `IntBufferBatchMountItem::mountInstructions::INSERT` | **3.82** | **0.53** |
| `Compose:applyChanges`                         | 2.74     | 2.27        |
| `AndroidOwner:onLayout`                        | 1.92     | 0.70        |
| `SurfaceMountingManager::createViewUnsafe(NitroUiSwitch)` | 1.63 | —      |
| `AndroidOwner:onMeasure`                       | 1.50     | 1.18        |
| `AndroidOwner:draw`                            | 1.03     | 0.82        |
| `IntBufferBatchMountItem::mountInstructions::DELETE` | 1.55 | 1.21      |
| `SurfaceMountingManager::createViewUnsafe(ViewManager)` | — | 2.80    |
| `postAndWait`                                  | 0.90     | 1.56        |

- `initializeView` is `AbstractComposeView` resolving and initialising a composition against a
  window — once per control for us, once per screen for them. 2.7 ms/iteration ÷ 50 ≈ 54 µs per
  control, and it sits directly on the mount path.
- `recompose` at 2.3× the shared host is per-instance composition work, not more state changes: both
  arms are asked to render the same 50 Switches.
- `INSERT` 3.82 vs 0.53 is Fabric attaching 50 `FrameLayout`+`AbstractComposeView` trees instead of
  one. Our `createViewUnsafe(NitroUiSwitch)` (1.63) is *cheaper* than the shared host's
  `createViewUnsafe(ViewManager)` (2.80), so the host object itself is not the problem — the number
  of native nodes is.
- The measured-root `Layout` (T11's file) is inside `Compose:recompose`/`onMeasure`, which is why the
  two slices cannot be separated from here.

Update N=50 (controls mount once, then 20 prop updates):

| Bucket                                | nitro-ui | shared-host | rn-core |
| ------------------------------------- | -------- | ----------- | ------- |
| Compose content (recompose/apply)     | 3.66     | 3.31        | 0.00    |
| Compose host init                     | 0.40     | 0.04        | 0.00    |
| Compose measure/layout/draw           | **3.83** | **2.67**    | 0.00    |
| Fabric mount instructions             | 1.71     | 2.05        | 1.47    |
| View traverse / draw (whole screen)   | 2.98     | 2.73        | 4.67    |
| other / unclassified                  | 6.01     | 4.67        | 5.03    |
| **TOTAL traced**                      | **20.07**| **17.59**   | 13.06   |

Once the compositions exist, the per-update difference is small: recompose 3.66 vs 3.31. The
remainder is our extra layout/draw pass (`measureAndLayout` 1.96 vs 1.62, `AndroidOwner:draw` 1.43 vs
0.86, `Recomposer:animation` 1.32 vs 0.63) — 50 independent frame loops and 50 measure passes
against one tree. This is the cheapest gap to attack and the one where `SwitchColors` churn is a
direct suspect.

## 4. Where the bytes go

The bench's own heap-delta measurement (allocated bytes ÷ N, after `Runtime.gc()`), split the way
`dumpsys` does:

| Implementation           | total KiB/control | Dalvik heap | Native heap | ratio to shared-host |
| ------------------------ | ----------------- | ----------- | ----------- | -------------------- |
| rn-core                  | 53.3              | 10.8        | 40.1        | 0.96x                |
| expo-ui-shared-host      | 55.3              | 31.5        | 9.3         | 1.00x                |
| expo-ui-host-per-control | 193.7             | 101.3       | 69.9        | 3.50x                |
| nitro-ui                 | 128.9             | 68.8        | 50.1        | **2.33x**            |

A cold-start `dumpsys meminfo` pair around the same window (the `meminfo` subcommand, `full - empty`
÷ 200) says the same thing from outside the process and adds the object count:

| Implementation           | TOTAL Pss KiB/control | Dalvik Pss | Native Pss | Views/control |
| ------------------------ | --------------------- | ---------- | ---------- | ------------- |
| rn-core                  | 93.2                  | 36.5       | 39.3       | 1.0           |
| expo-ui-shared-host      | 6.4                   | -14.3      | 2.7        | 1.0           |
| expo-ui-host-per-control | 236.7                 | 137.9      | 69.6       | 5.0           |
| nitro-ui                 | 168.5                 | 97.3       | 50.8       | **4.0**       |

(The shared host's negative Dalvik Pss is the baseline's own GC landing inside the window — read that
row as "no measurable growth". The two methods agree on our split within a few KiB, which is why both
are here.)

Three findings:

1. **We retain ~4 `View` objects per control; the shared host retains ~1.** Our tree per control is a
   `FrameLayout` host plus its `AbstractComposeView` plus the holder views Compose adds
   (`NitroComposeHost.kt:137-148, 171-174`). Views are expensive in Dalvik heap and in traversal.
2. **Our native heap per control (50.1 KiB) is close to rn-core's (40.1) and 5× the shared host's
   (9.3)** — that is the Fabric shadow node plus the Nitro hybrid-object cost of having 200 native
   components instead of 1. It is inherent to the one-hybrid-view-per-control model, and it is the
   part a shared composition would *not* remove on its own.
3. **At N=200 the Java heap feeds a UI-thread GC stall.** Mount N=200 buckets, ms per iteration:

   | Bucket                             | nitro-ui | shared-host |
   | ---------------------------------- | -------- | ----------- |
   | GC / ART reclaim                   | **167.05** | **1.67**  |
   | Compose content (recompose/apply)  | 12.88    | 16.70       |
   | Compose host init                  | 5.06     | 0.73        |
   | Compose measure/layout/draw        | 8.10     | 15.75       |
   | Fabric mount instructions          | 17.94    | 18.41       |
   | View traverse / draw               | 4.92     | 22.87       |
   | other / unclassified               | 6.68     | 17.64       |
   | **TOTAL traced**                   | **224.56** | **96.84** |

   `GC: Wait For Completion Alloc` alone is 85.3 ms/iteration: the UI thread is blocking on a GC it
   provoked. `ProcessMarkStack` 36.0 and `CompactMovingSpace` 35.8 are the mark-compact of a heap we
   filled. The shared host never gets there because its 31.5 KiB/control does not push the heap over
   the compaction threshold. Any memory win here is also a mount-time win at N≥200, and it is the
   same 68.8 KiB of per-instance Java objects.

## 5. Cost centres, ranked

| # | Cost centre                                       | Costs | Owned by |
| - | ------------------------------------------------- | ----- | -------- |
| 1 | One composition + `AndroidComposeView` owner per control (`initializeView`, `recompose`, `applyChanges`) — corrected in round 3: the `Recomposer` and frame clock are per **window** and already shared | mount UI CPU, mount `presented`, update UI CPU, 68.8 KiB Java/control | architecture (core.md §2) |
| 2 | One native view tree per control (4 `View`s, `INSERT` 3.82 vs 0.53) | mount `presented`, 50.1 KiB native/control | architecture |
| 3 | A fresh `SwitchColors` per recomposition per instance | recompose on update, allocation (in Material 1.4 `SwitchColors` is `@Immutable` with `equals`, so a fresh-but-equal instance does not by itself defeat skipping — corrected in round 3) | `HybridNitroUiSwitch.kt:104-110` — ours, fixable |
| 4 | Second measure/layout pass per control (measured root + `AndroidOwner:onLayout` 1.92 vs 0.70) | mount + update UI CPU | T11's file |
| 5 | No AOT profile for library hot paths (all arms pay, we have more distinct hot methods) | mount, init | build config |
| 6 | Double `updateState` (N5) | one mark + JNI diff | measured negligible |

## 6. Candidate optimisations, and what each one touches

Measured separately per the brief, keeping only what helps. `T11 overlap` is from
`git diff --stat main..task/T11-intrinsic-sizing`:

| # | Change                                                                 | Targets        | Files | T11 overlap |
| - | ---------------------------------------------------------------------- | -------------- | ----- | ----------- |
| A | Hoist `SwitchDefaults.colors()` out of `Component` — cache per tint, `@Immutable` holder, remember per host | update UI CPU, memory | `HybridNitroUiSwitch.kt` | **90 lines changed there** |
| B | Baseline profile for the bench APK + library `baseline-prof.txt` (`androidx.profileinstaller`) | mount, host init | `bench/android/app/build.gradle`, library proguard | none |
| C | Drop the `NitroUiMeasuredRoot` wrapper when the control has a fixed size / `wantsContentSize` is off | cost centre 4 | `core/NitroComposeHost.kt` | **251 lines changed there** |
| D | Cut per-instance retained objects (host/ComposeLocals/semantics)         | memory, GC     | `core/NitroComposeHost.kt` | **251 lines changed there** |
| E | Per-transaction batching of `Snapshot.sendApplyNotifications()`         | mount UI CPU   | `core/NitroComposeHost.kt` | **251 lines changed there** |
| F | Shared composition per window ("virtual control")                       | 1, 2, 3 at once | architecture | core.md §2 contract |

E is the one the T02 report named as T12's follow-up, and it is worth naming honestly: it is *not*
supported by these traces. The recompose/apply buckets are sublinear in N per control
(0.178 ms/control at N=50 vs 0.064 at N=200), which is the opposite of the O(N²) a per-control global
apply would produce. It stays a candidate because it is cheap to test, not because the data asks for
it — and `commit()`'s current call has a documented job (`core.md` §3, §"Interactions").

## 7. Structural option (scope 4) — evaluate, do not ship

One Compose host per window rendering many controls would remove cost centres 1 and 3 outright:
`initializeView` and `recompose` collapse from N to 1, `INSERT` collapses from N to 1, one frame loop
instead of N, and the Java heap per control drops toward the shared host's 31.5 KiB. It is the only
option on the list that plausibly reaches ≤1.0× on all three D15 metrics, because all three are
counting N.

It does not remove cost centre 2's native side: in that model a control is a virtual node inside one
Fabric host view, so the 50.1 KiB of native heap per control and the Fabric per-node state disappear
too — which is precisely why it is a rewrite rather than an optimisation. It contradicts
`docs/architecture/core.md` §2 (one host per view, `view` is the host, no `setContent` after
construction), it changes recycling semantics (`RecyclableView` detaches must not dispose the wrong
control's subcomposition), it moves hit-testing and accessibility ordering onto us, and every
component's host would need the same treatment. That is a D-level decision, not a T12 one.

**Recommendation:** do not ship it in this task; do not spike it yet either. Run A and B first — they
are contained, A is a genuine bug, and if A+B+T11's sizing work leave memory or mount UI CPU above
1.0× then the residual is architectural and the shared-composition proposal should go to the
reviewer as its own decision with these traces attached.

## D15 verdict (phase 1 — superseded by [phase 2](#d15-verdict-phase-2-final))

**Not met on Android.** Against `expo-ui-shared-host`, at `c5be9af` on `nitroui_t02`:

| Metric          | measured | target | verdict |
| --------------- | -------- | ------ | ------- |
| mount presented | 1.47x (1.88x at round-4 load) | <= 1.0x | **miss** |
| mount UI CPU    | 1.48x (1.80x)                 | <= 1.0x | **miss** |
| memory          | 2.33x (2.64x)                 | <= 1.0x | **miss** |
| update presented| 0.99x (1.14x)                 | <= 1.0x | pass (not gated by D15) |
| update UI CPU   | 1.34x                         | —       | reported |

The D15 explanation, per `docs/architecture/benchmarks.md`: the library mounts N Compose
compositions, N `AndroidComposeView` owners and N native view trees where the shared host mounts one of
each — the `Recomposer` and frame clock are per window and already shared (corrected in round 3; see
§P2f) — and at N=200 that turns into 167 ms/iteration of ART reclaim on the UI thread. What remains
after the contained fixes (A, B) is expected to be that architecture gap, and the recommended next step
is §7, decided at orchestrator level.

## Questions for the orchestrator

All five were answered in `docs/tasks/T12-android-perf.md` ("Orchestrator answers to round 1"):
sequence (a) then re-measure post-T11; do not patch nitrogen for N5, record it as
quantified-negligible; fix `SwitchDefaults.colors()` first and measure it alone; ship a library
`baseline-prof.txt` and compile every arm identically; write up the structural option without
building it; a documented miss is acceptable. What each answer produced is in
[Phase 2](#phase-2--measured-per-change).

1. **T11 has not merged, and it is standing in both doors.** `git log main --oneline | grep -i T11`
   is docs-only; `main..task/T11-intrinsic-sizing` is 9 279 insertions across 148 files, including
   **251 lines in `core/NitroComposeHost.kt` and 90 in `HybridNitroUiSwitch.kt`** — the two files
   every remaining optimisation (A, C, D, E) has to be written in. I have not edited host or core
   code, per the delegation. Which do you want?
   - **(a) Hold T12 Phase 2 until T11 merges, then rebase and measure there** (my recommendation).
     T11 rewrites the sizing path that sits inside the very slices I attributed (`recompose`,
     `onMeasure`, `onLayout`), so a before/after table I mint on `main` measures code that is about
     to be replaced, and A/C/D/E would all need re-measuring afterwards anyway.
   - (b) I rebase onto `task/T11-intrinsic-sizing` and work there — fastest, but my commits land on
     an unmerged branch and T11 is still moving.
   - (c) I implement A (component-local, ~5 lines) on `main` now and accept the conflict, keeping the
     measured table from `main`. Cheap, but its numbers will not be T11-final either.
2. **Is the N5 generator short-circuit mine?** `docs/architecture/core.md` §3 says the snapshot-equals-
   `lastState` short-circuit "belongs to whoever touches the generated path (T12)", but
   `scripts/patch-nitrogen.mjs` is +442 lines in T11. Measured, the second `updateState` is worth well
   under a millisecond per launch (§2), so I would rather not spend a nitrogen patch on it at all and
   instead record in `docs/upstream.md` that N5's cost is now quantified as negligible — confirm that
   is acceptable, or tell me to implement it.
3. **Baseline profile methodology (candidate B).** Adding `androidx.profileinstaller` plus a
   baseline profile to the bench APK would speed up every arm in the same APK, so the ratios move
   even though nothing about the library changed. Do you want (i) library-only `baseline-prof.txt`
   consumer rules measured through the library's own AAR, (ii) a generated profile for the whole APK
   reported as a separate "warm" run, or (iii) neither in 0.1? I did not want to change the bench
   build contract (D9) unilaterally.
4. **Scope 4 sign-off.** §7 has the cost/benefit and the recommendation (evaluate, don't spike, decide
   after A+B). If you would rather see a spike in this task, say so and tell me whether
   `core.md` §2's one-host-per-view contract is negotiable for it — that is the part I cannot decide
   from inside T12.
5. **If the residual is architectural, is a documented miss acceptable?** D15 allows "an explanation
   and a follow-up item; the reviewer decides". §5 and §7 are that explanation. Confirm that is the
   intended path rather than a required rewrite inside T12.

## Repro (phase 1)

```sh
# 1. Boot the assigned AVD on the assigned private adb server (keep it in a live shell).
ANDROID_ADB_SERVER_PORT=5042 emulator -avd nitroui_t02 -port 5572 -gpu host \
  -no-snapshot-save -no-audio -no-boot-anim -no-window
ANDROID_ADB_SERVER_PORT=5042 bun bench --platform android --plan quick
ANDROID_ADB_SERVER_PORT=5042 bun bench --platform android --plan quick --perf-marks

# 2. Attribute one cell. One process holds the device; run these serially.
cd bench/tools
ANDROID_ADB_SERVER_PORT=5042 SERIAL=emulator-5572 ./android-trace.sh mount:nitro-ui:50 mount-nitro-50
./android-trace-report.py self-time nitro=android-trace/mount-nitro-50.atrace
./android-trace-report.py buckets nitro=… shared=…
N=200 ./android-trace-report.py meminfo nitro=android-trace/memory-nitro-ui-200-mem

# 3. Done.
ANDROID_ADB_SERVER_PORT=5042 adb -s emulator-5572 emu kill
```

`android-trace.sh` takes `<scenario>:<implementation>:<n>` — the same string the bench's `--cell`
takes — and force-stops the app first so every capture starts cold. Traces are ~20-55 MB and are not
committed; the tables above are the durable output.

---

# Phase 2 — measured, per change

**Rebased on `main` at `26d335f` (T11 merged).** Everything in the phase-1 breakdown above is a
profile of code T11 then rewrote, so phase 2 re-took the "before" numbers on post-T11 code
(`f99efb9`, clean tree, load 2.80 / 14 cores) and measures one change per bench run after that.

## P0. What the "before" row became

Post-T11, pre-optimisation, quick plan, 4 launches (`f99efb9`), ratios nitro-ui ÷ arm:

| Cell               | metric      | nitro-ui   | ÷ rn-core | ÷ host-per-control | ÷ shared-host |
| ------------------ | ----------- | ---------- | --------- | ------------------ | ------------- |
| mount N=50         | presented   | 35.96 ms   | 1.10x     | 1.01x              | 1.11x         |
| mount N=50         | UI CPU/op   | 15.03 ms   | 1.94x     | 0.72x              | 1.52x         |
| update N=50        | presented   | 29.88 ms   | 0.93x     | 1.00x              | 0.99x         |
| update N=50        | UI CPU/op   | 8.21 ms    | 3.77x     | 1.01x              | 1.40x         |
| memory N=200       | bytes/inst  | 130.2 KiB  | 2.46x     | 0.67x              | 2.40x         |

Every ratio column in this section is launch-paired (`bench/tools/arm-ratios.mjs` pairs each arm's
median with nitro-ui's from the same launch order), which is why they survive machine load better than
the absolutes do; the absolutes are medians of launch medians. `node bench/tools/arm-ratios.mjs
bench/results/<run>.json` prints the full three-arm table for any run named here.

**Noise floor, measured across the runs below:** `presented` moves ±10 per cent run to run (its MAD
in a single run is ~0.5 ms at N=50, so this is machine state, not sampling), UI CPU ±2 per cent,
`bytes/inst` ±0.3 per cent inside one build and ±4 per cent across builds. So: a `presented` change
under ~3 ms at N=50 is not a result, a UI CPU change under ~0.3 ms is not a result, and only the
memory column can carry a small claim.

## P1. The change that was hiding all the others: ART was interpreting the library

**This is the row the whole phase turns on, so it is reported first.** The bench had never put the
ART profile in force: `dumpsys package dexopt` reads `status=verify` after `adb install -r` on the
bench APK, `cmd package bg-dexopt-job` leaves it at `verify`, and `-m speed-profile -f` before the
first launch *also* leaves it at `verify` — the compiler reads the app's *profile file*, which
profileinstaller only writes a few seconds after process start (all four steps measured;
`docs/architecture/core.md` §13). Every Android number this project has published — T02, T10, T11,
phase 1 of this task — therefore measured **the interpreter**.

`scripts/bench/run.mjs` now primes through profileinstaller's own `INSTALL_PROFILE` hook, waits for
the status to become `speed-profile`, and logs it. **The same priming is applied to every arm**, so
the ratios compare compiled with compiled.

| Run | Library code                  | ART state        | load | mount presented | mount UI CPU | update UI CPU | bytes/inst |
| --- | ----------------------------- | ---------------- | ---- | --------------- | ------------ | ------------- | ---------- |
| P0  | A + G + H (`b7b6acb`)         | `verify`         | 4.06 | 39.53 ms        | 14.85 ms     | 8.17 ms       | 130.2 KiB  |
| P1  | A + G + H (`5ea41eb`)         | `speed-profile`  | 3.01 | 32.23 ms        | 9.16 ms      | 6.02 ms       | 135.7 KiB  |
| P2  | A + G + H + our rules (`ed620cb`) | `speed-profile` | 3.05 | 32.60 ms      | 8.92 ms      | 5.58 ms       | 134.2 KiB  |

Same library code in P0 and P1: **mount presented −18 per cent, mount UI CPU −38 per cent, update UI
CPU −26 per cent.** The arms move too (shared-host UI CPU 10.48 → 6.25 ms), so the ratios are the
only fair reading of the table — and they move as well, which is the point: priming is a **regime
change for the ratios, not only for the absolutes**. Read the two columns as two regimes, not as a
before/after of one library:

| Ratio vs shared-host   | verify (P0) | speed-profile (P1) | speed-profile + our rules (P2) |
| ---------------------- | ----------- | ------------------ | ------------------------------ |
| mount presented        | 1.22x       | 0.99x              | **1.01x**                      |
| mount UI CPU           | 1.40x       | 1.42x              | **1.35x**                      |
| update UI CPU          | 1.36x       | 1.41x              | **1.24x**                      |
| memory                 | 2.28x       | 2.45x              | **2.52x**                      |
| mount presented vs host-per-control | 1.09x | 0.98x         | **0.99x**                      |
| mount UI CPU vs host-per-control    | 0.70x | 0.62x         | **0.59x**                      |

**Interpretation.** Much of the gap this task was sent to close was a build-configuration artefact:
nothing was AOT-compiled in the `verify` state — not our host view, and not `expo-ui`'s Compose code
or `rn-core`'s Java either. (The earlier draft of this paragraph claimed the other arms were partly
covered by profiles their AARs ship; that is wrong on both counts — in `verify` there is no AOT for
anyone, our own classes were *still* absent from any profile in P1, and the merged profile of the
bench APK has zero `expo` lines because `@expo/ui` ships none.) What the corrected reading leaves is
a regime effect: once Compose and RN are compiled, the arm that runs more of that framework code per
unit of work gains the most, and the ratios between arms move with it — mount `presented` 1.22x →
0.99x and memory 2.28x → 2.45x are the same code on both sides.

In absolute terms the gap to the shared host shrank from **7.02 ms to 0.22 ms** on mount `presented`
and from **4.37 ms to 2.38 ms** on mount UI CPU (45 per cent). With the profile in force, mount
`presented` is at parity with the shared host (1.01x, 32.60 ms against 32.38 ms) and we are 41 per
cent *cheaper* than the per-control arm on mount UI CPU — though note the mount UI CPU *ratio* to the
shared host did not move across the regime change (1.40x → 1.42x), so "half the gap" is a statement
about milliseconds. `rn-core`'s own UI CPU is the noisiest column here (6.0–7.9 ms across three
runs), so the `÷ rn-core` ratios (1.15x–1.45x for the same code) are not a signal worth reading; the
D15 gate is vs the shared host.

**Consequence for the repo:** no committed latency baselines exist (`bench/baselines/README.md`), so
default-on priming breaks no gate — and it invalidates every historical Android number, **as absolutes
*and* as ratios**, because the arms do not gain equally from compiled Compose and RN. Round 2 acted on
this rather than leaving it as a question: the run's final ART status is now persisted in the results
JSON and the report header (`art`), `--update-baseline` refuses anything but `speed-profile` (shown to
refuse, below), and `docs/architecture/benchmarks.md` and `docs/tasks/T02-bench.report.md` carry the
regime note. What is still the orchestrator's call is whether the Android numbers that any doc cites
get re-recorded or merely labelled.

## P2a. Change A — `SwitchColors` once per scheme and tint

`SwitchDefaults.colors(checkedTrackColor = …)` returns a fresh 18-colour object per call, so a tinted
`Switch` allocated one per recomposition per instance. Cost centre 3 in §5, and the one thing phase 1
called a bug. What it was *not*: phase 1 also wrote that Compose therefore could not skip the `Switch`
subtree, because `SwitchColors` is a plain class. Round 2 checked the resolved artifact — in Material
3 1.4.0 `SwitchColors` is annotated `@Immutable` and has generated `equals`/`hashCode` (`javap` on
`material3-android-1.4.0`), so a fresh-but-equal instance does not by itself defeat skipping, and the
cost was the allocation. That is consistent with the ≈0 below.
Measured alone, on top of the post-T11 "before", in the `verify` state the rest of the phase had not
yet changed:

| Metric          | before (`f99efb9`) | A (`990e66a`) | change        | noise floor |
| --------------- | ------------------ | ------------- | ------------- | ----------- |
| mount presented | 35.96 ms           | 40.81 ms      | +13.5%        | ±10%        |
| mount UI CPU    | 15.03 ms           | 14.73 ms      | -2.0%         | ±2%         |
| update UI CPU   | 8.21 ms            | 8.18 ms       | -0.4%         | ±2%         |
| mount ÷ shared  | 1.11x              | 1.25x         | -             | -           |
| bytes/inst      | 130.2 KiB          | 130.3 KiB     | +0.1%         | ±0.3%       |

**Kept, with an honest "measured ≈ 0".** The bench's `update` cell changes one prop, which is the
path where a fresh `SwitchColors` hurts least; the allocation lands on the recomposition path the
quick plan barely exercises, so this run cannot see it either way. It stays because (i) it is a real
per-recomposition allocation on the UI thread, (ii) the process-wide colour-scheme cache in change G
only hits because Material memoises its
untinted path on the `ColorScheme` the theme hands out. The `presented` swing is the noise floor, and
P0–P2 above (which all include A) is where its cost really shows up: it is not measurable at this
plan's resolution.

## P2b. Change G — the Material colour scheme once per process

A `remember` lives in one composition and every hosted control is its own composition, so the dynamic
M3 `ColorScheme` — about fifty framework resource reads plus a fresh object graph — was built once
per mounted control. `NitroUiColorSchemes.forContext` keys one process-wide entry on the context, the
dark flag and the live `uiMode`, and drops it on a configuration change (`NitroComposeHost.kt`). Since
round 2 the context half of that key is a `WeakReference` (`WeakKey`), because the entry is process
state and the context is an `Activity`: keyed strongly it pinned a destroyed `Activity` and its view
hierarchy until some later control composed against a different context. Measured on top of A, still
`verify`:

| Metric          | A (`990e66a`) | G (`77c4437`) | change   | noise floor |
| --------------- | ------------- | ------------- | -------- | ----------- |
| mount presented | 40.81 ms      | 39.90 ms      | -2.2%    | ±10%        |
| mount UI CPU    | 14.73 ms      | 14.74 ms      | +0.1%    | ±2%         |
| update UI CPU   | 8.18 ms       | 8.14 ms       | -0.5%    | ±2%         |
| bytes/inst      | 130.3 KiB     | 129.1 KiB     | **-0.9%** | ±0.3%      |
| mount ÷ shared  | 1.25x         | 1.26x         | -        | -           |

**Kept, and honestly this is a "measured ≈ 0" too.** The `-0.9%` in the table is `-1.1 KiB` per
instance, and the `±0.3%` printed next to it is this report's *within-one-build* floor — A → G is two
builds, where the floor P0 defines above is ±4%. Against the floor that applies, the memory delta does
not clear it either, so G is ≈0 on every column and stays for the same kind of reason A and B do. The
reasoning is still worth having on the record: the mount builds one scheme instead of fifty, the work
is per mounted control and per theme expense, it is the prerequisite for A's cache to hit across
controls at all, and a retained-object win is the right shape for the metric D15 misses hardest. Time
at N=50 is microseconds either way. Rule recorded in `docs/architecture/core.md` §3 ("Shared objects").

## P2c. Change H — the synchronous correction budget, per platform

The added scope from T11 round 3: Android's cold-batch flush costs 84–125 ms for 200 corrections on a
loaded machine (iOS 8.5 ms). Attributed on the T11 harness test, debug build, `nitroui_t02`:

| One cold batch of 200, `lastFlushMs`         | Cost          |
| -------------------------------------------- | ------------- |
| Engine only - budget 0: 200 reports, 1 correction, 199 async enqueues, no synchronous commit | **0.086 ms** |
| The same batch with one synchronous commit (budget 1) | **38.05 ms** |
| What budget 0 costs elsewhere                | `stale=100` over 100 instances, and the harness's own cold-control test fails |

T11's 84-125 ms on a loaded machine is the same 38 ms waiting for CPU. So the flush is **one
synchronous Fabric commit** and the engine is 0.2 per cent of it: capping instances per flush would
keep the milliseconds and lose the correction, because the engine's work is already nothing. The knob
is how many commits, which is what `flush(immediateBudget)` (31438d5) makes settable. Before/after,
three rounds each, same probe, budget 2 rebuilt from the same tree as budget 1. **Round 1 is the first
batch in that process** — the one the committed test sits in, and by far the most expensive — so quote
both halves of this rather than one number:

| N   | Budget 2 (before) | Budget 1 (after) | Per round            | Median      |
| --- | ----------------- | ---------------- | -------------------- | ----------- |
| 200 | 38.80 / 18.88 / 14.08 ms | 36.76 / 12.84 / 9.57 ms | 3 of 3 lower | **-32%** |
| 500 | 75.38 / 42.51 / 38.03 ms | 53.97 / 26.77 / 25.11 ms | 3 of 3 lower | **-37%** |

**Kept.** Every one of the six pairs is lower at budget 1. On the **first batch in a process** the gain
is -5% at 200 rows (38.80 → 36.76 ms) and -28% at 500 (75.38 → 53.97); on the **median of three rounds**
it is -32% and -37%. Both are true and they are different measurements: the first batch pays for a tree
that has only just been built, and the in-code comments and `docs/architecture/sizing.md` now quote it
that way. The effect is bigger at 500 rows, which is what "cost scales with tree size, not correction
count" predicts: the second synchronous push re-lays out a tree the first commit has just measured.

D17's floor still holds: at budget 1 a single cold control is corrected inside the frame that gets
cancelled, and at budget 0 the harness's own cold-control test goes red (`expected false to be true` at
`boxMatches(…)`) and the batch measures `stale=100`. What budget 1 also measured was `stale=0` for a
100-instance batch on `nitroui_t02` — and round 2 corrected what this section claimed about *why*. The
draft said one correction "carries the answer for the whole configuration"; the code says one
synchronous push clones one family, and `IntrinsicShadowNode::shouldNewRevisionDirtyMeasurement`
(`cpp/NitroUiIntrinsic.hpp:217-248`) dirties only a node whose own state or sizing props changed, so the
untouched siblings ride a commit that still holds their cached measurement. T11 round 2's S6 predicted
exactly that ("2 land in the cancelled frame, 198 arrive after it redraws"). The likelier reading of the
measured `stale=0` is timing — the batched updates commit on the JS thread while the UI thread is inside
the ~38 ms synchronous commit, and their mount runs in the Choreographer callback before the next
traversal; at budget 0 that window does not exist, which is consistent with `stale=100`. If that is
right, a bigger batch, a busier JS thread or a faster UI thread could draw stale boxes at budget 1, and
nothing would notice, because the batch test logs `stale` and deliberately does not assert it. That is
why this is reported as a measurement and why the proposed D17 wording (below) says "measured", not
"because". The remaining 25–54 ms is one commit of a 200–500-host tree spent inside a pre-draw pass that
then cancels the frame: it is the price of correcting the reporting instance on Android, not slack.

**Not kept: coalescing the batched pushes into one commit.** Unreachable from a Hybrid View. RN's
`EventQueue::enqueueStateUpdate` flushes per `StateUpdate` and `UIManager::updateState` does one
`shadowTree.commit` each (`node_modules/react-native/ReactCommon/react/renderer/uimanager/UIManager.cpp:406`);
`ShadowNode::cloneMultiple` exists but no caller in UIManager or Scheduler uses it. This is an
upstream API question (worth an N-entry if the orchestrator wants it pursued), not a library change.

**Not kept: "all-async above a batch size".** At budget 0 the flush is 0.086 ms and the same batch
draws `stale=100` — D17's rule, broken. Rejected by the gate, and shown to break it in the table below.

**Attribution of the O(N × tree) JS-thread commits.** Warm-vs-cold, same process, N=500: warm (no
corrections) 771.8 ms vs cold 768.8 ms, and 572.0 vs 608.2 ms in the second round. The 499 batched
pushes are real work on the JS thread but they are **off the measured mount path**: `mountedIn` ends
when the last host appears, and the corrections land afterwards. What is *not* noise is first touch:
the first cold 500-row mount in a process measured 1.0–4.6 s against 0.41–0.77 s for the same batch
in later rounds (six samples each side across the probes in this section). A cold list's cost in a real app is the first one, and that is ART interpreting the
host, not our bookkeeping — which is the same finding as P1, seen from the harness.

## P2d. Change B — the library baseline profile, as its own row

`android/src/main/baseline-prof.txt`: `HSPLcom/margelo/nitro/nitroui/**->**(**)**`, scoped to our own
classes so no other arm's code is affected. AGP merges it into the bench APK's
`assets/dexopt/baseline.prof` (10825 → 10885 bytes, `baseline.profm` 1566 → 1606: 60 bytes of merged rules,
because ART rules for a wildcard are compact).

| Run                        | ART state       | mount presented | mount UI CPU | update UI CPU | bytes/inst |
| -------------------------- | --------------- | --------------- | ------------ | ------------- | ---------- |
| P1 (upstream profile only) | `speed-profile` | 32.23 ms        | 9.16 ms      | 6.02 ms       | 135.7 KiB  |
| P2 (+ our rules)           | `speed-profile` | 32.60 ms        | 8.92 ms      | 5.58 ms       | 134.2 KiB  |

**Kept, with "measured small" on two columns rather than a blanket "all noise".** Checked against the
floors P0 defines, P1 → P2 is: mount `presented` +1.1% (inside ±10%), memory -1.1% (inside ±4% across
builds), mount UI CPU **-2.6%** and update UI CPU **-7.3%** — and both of those are *outside* the ±2%
floor this report sets for UI CPU. The earlier draft said every delta was inside the floor, which was
conservative in the wrong direction and inconsistent with the floor itself. Two caveats on those two
numbers, honestly stated: they come from one 4-launch run on each side with no repeated A/B for B
alone, and UI CPU is the column with ±2% run-to-run spread but no measured bias term across builds, so
-7.3% is "plausibly real, not established". The claim this row is asked to carry does not need them: by
the mechanism below the file is ~60 bytes with no runtime cost, and it is the only route to AOT for
classes no other profile mentions. If B is worth a number, it needs its own repeat runs — a follow-up,
not a re-labelling.

The reason a large part of it is small is visible in the mechanism: by the time our
rules are merged, the *upstream* profile has already compiled Compose and RN, which is where the
time is; our glue is thin and mostly calls into code that was already compiled. It is kept because
it is 60 bytes with no runtime cost, because it is the only route to AOT for classes no other profile
mentions (`NitroUiSizing`'s JNI bridge, the generated managers, `NitroUiPerf`), and because without it
those classes are only compiled if the app happens to collect a runtime profile. A generated profile
for the whole APK would do more and is explicitly not this change: it would move every arm's numbers
and the ratios with them.

Consumers get the file for free (no new dependency, `profileinstaller` already arrives through
Compose) — `docs/architecture/core.md` §13 records what does and does not happen on its own.

## P2e. What was measured and rejected, or could not be measured

| Candidate                              | Outcome |
| -------------------------------------- | ------- |
| Fewer retained views per control (phase-1 candidates C/D) | **Impossible, shown by the framework.** `javap -p` on `androidx.compose.ui.platform.AbstractComposeView` (both 1.11.4 and 1.12.1) shows `protected final void onMeasure(int, int)` and `protected final void onLayout(boolean, int, int, int, int)`, and `addView(View, int, LayoutParams)` rejects children. The RN host cannot *be* the Compose view — it must intercept measure and layout to feed `contentSize` and Fabric — so the four `View`s per control (host, `AbstractComposeView`, `AndroidComposeView`, `RelayoutWatcher`) cannot be collapsed from outside, and the last two are `internal`. Cost centre 2 stands. |
| Java heap per control by trimming retained objects (D) | Not attempted as a blind trim: §4 attributes 68.8 KiB of Java heap per control to the composition, the slot table and `CompositionLocals`, all of which Compose owns. The two measurable wins in this phase (G: -1.1 KiB; A: 0) are the parts we allocate. |
| Per-transaction `sendApplyNotifications` (E) | Unchanged from phase 1: the traces show sublinear recompose per control, not the O(N²) a per-control global apply would produce. Still not supported by data; not built. |
| Tighter `lastFlushMs` bar in the harness | **Deliberately not tightened** — kept at T11's 250 ms Android bar. The flush is load-bound (36–38 ms quiet, 84–125 ms loaded per T11, and 9.6–75.4 ms across the probes in this phase), so a tighter bar is a flaky test, not a guarantee. The structural guarantee — "not N synchronous commits" — is carried by the `immediate` gates, which *can* be shown to fail. |

### Gate evidence (every new test shown to fail)

| Gate | Mutation | Result |
| ---- | -------- | ------ |
| Native: `flush(budget)` obeys the budget it is handed | engine ignores the passed budget | **5 of 172 checks fail**: `one correction was synchronous (got 2, want 1)`, `the other five are batched (got 4, want 5)`, `and the push flags agree with the budget it was given (got 2, want 1)`, `and none of its pushes claims a synchronous commit (got 2, want 0)`, `which means none synchronous (got 2, want 0)`. Mutant reverted; 172 pass, ASan included. |
| Harness: `immediate ≤ budget × flushes` | build with Android budget 2 | `expected 2 to be less than or equal to 1` |
| Harness: `immediate ≥ 1` (D17 floor) | build with budget 0 | `expected 0 to be greater than or equal to 1`, and the existing D17 cold-control test fails too: `expected false to be true` at `boxMatches(…)` — a real stale frame, not just a counter |
| JVM: the cached colour-scheme key is reachable only through a `WeakReference` (`NitroUiWeakKeyTest`) | `WeakKey` given a second, strong `private val strong = value` field | **2 of 10 fail**: `keyHoldsNothingButAWeakReference` (`AssertionError` at `NitroUiWeakKeyTest.kt:44`, naming the offending field type) and `droppedContextBecomesCollectable` (`AssertionError` at `:100` — the referent survives every `System.gc()`). Mutant reverted; `bun run test:native:android` → `BUILD SUCCESSFUL`, 10 tests. Round 3, review F1. |
| Bench: `--update-baseline` refuses an Android app that was never compiled | the Android clause removed from `baselineBlockers()` | **1 failed**: `refuses to mint an Android baseline from an uncompiled app` → `expected false to be true` at `bench-gate.test.js:523`. Clause restored; `bunx jest scripts/__tests__/bench-gate.test.js` → 28/28. Round 3. |

The refusal was also shown on real run files, without a device, by calling the guard
`--update-baseline` itself calls (`baselineBlockers`) on them:

```sh
node /tmp/art-gate-probe.mjs /tmp/nonprimed.json \
  bench/results/f99efb9-android-20261023T044221Z.json /tmp/primed.json
# /tmp/nonprimed.json            -> the app was still at ART status "verify", so this run measured the interpreter…
# f99efb9-android-…21Z.json      -> the run did not record an ART compile state, so its regime is unknown…
#                                   (plus its two pre-existing reasons: quick plan, 4 launches)
# /tmp/primed.json               -> 0 blocker(s)
```

and the header renders on both sides: `- ART: `speed-profile` for `com.nitroui.bench` (1 attempt(s))` for
the primed run, and `ART: **not recorded** — … interpreter regime` for the pre-T12 file. Both fixtures are
a copy of a real Android run with only the `art` metadata changed. `bench/baselines/` was never written
by any of this.

## P2f. Structural option, with the measured residual

Rewritten in round 3: the first version of this section got two facts wrong, and both changed the
cost/benefit the human has to read. They are corrected here and the missing feasibility constraint is
added.

**The residual.** After T11 + A + G + H + the profile, what remains against the shared host is
**mount UI CPU 1.35x** (8.92 ms against 6.54 ms at N=50) and **memory 2.52x** (134.2 KiB against 53.1
KiB per instance), with `presented` at parity (1.01x). Both are counting N — but N of fewer things than
the first version of this section claimed:

- **What is already shared, and cannot be won back:** one `Recomposer` and one frame clock per
  **window**. Every `AbstractComposeView` resolves its parent `CompositionContext` from the window
  recomposer, so all hosts in a window already sit on the same recomposer — the first version's "N
  recomposers, N frame loops" was wrong, and `NitroComposeHost.kt:41-43` says as much. "One shared
  recomposer" is therefore not on offer: it is what we have.
- **What is actually per control:** one `Composition` (and its slot table) plus one
  `AndroidComposeView` **owner** — with its LayoutNode root, measure/layout delegate, snapshot
  observer, semantics owner, accessibility delegate and per-view services — and one native view tree
  (the four `View`s P2e showed cannot be collapsed from outside). That, plus the 50.1 KiB of native
  heap per Fabric node, is what the 1.35x and 2.52x are paying for.

**The cheap intermediate step, and it exists: `ComposeViewContext`.** Round 2's correction to
"`AbstractComposeView` does not expose a `CompositionContext` seam" — that sentence was wrong twice.
`setParentCompositionContext(CompositionContext)` and `createComposition()` are both public. More
usefully, **Compose UI 1.11.4 ships an experimental seam built for exactly this job**: a public
`ComposeViewContext(View, CompositionContext, LifecycleOwner, SavedStateRegistryOwner,
ViewModelStoreOwner)` constructor and `AbstractComposeView.createComposition(ComposeViewContext)`,
annotated `@ExperimentalComposeViewContextApi`. That object carries the per-owner services we duplicate
today — accessibility manager, clipboard, font loader/resolver, haptics, view configuration, shared
draw scope, window info, configuration state — so hosts can share them while each keeps its own
composition and its own view.

That is the concrete "cheaper intermediate step" the orchestrator asked for: it keeps `core.md` §2's
one-host-per-view contract, touches neither recycling nor hit-testing, and attacks the per-host
`initializeView` (3.21 ms against 0.49 ms in §3) and part of the per-owner memory. Its risks are named:
an **experimental** API (opt-in annotation, shape can change under us) and a **BOM pin** consequence per
D8, since using it means committing to a Compose UI version that has it. Expected size: a fraction of
the per-control cost, not all of it — the composition, slot table and view tree stay per control.
**Not built in T12; this is follow-up task T13 and it should be spiked before anything larger is
considered.**

**The feasibility constraint the decision needs (missing from the first version).** "One Compose host
per window rendering many controls" is not a faster implementation of what we have; it is a different
product. A single composition is **one rectangle in one place in the view tree**, so it cannot host:

- a control inside an RN `ScrollView` (the composition is not scrolled by RN, and virtualising it
  becomes our job);
- controls **interleaved with RN views** in z-order or layout order — a nitro-ui `Switch` between two
  RN `Text`s is impossible if all Switches live in one container;
- controls under RN **clipping, transforms or opacity** applied by an ancestor RN view;
- controls in a **`Modal`** (a separate window with its own recomposer).

The realistic structural option is therefore Expo's shape: an explicit container — call it `<Host>` —
whose children are nitro-ui controls and nothing else. **That is a public API change and a change of
product premise** (drop-in controls anywhere, in any RN tree, which iOS already delivers *below* the
Expo arms), and it is not fixable by trimming our allocations. What it would also have to answer:

- **T11's per-Fabric-node intrinsic sizing** (`docs/architecture/sizing.md`) has no Fabric node per
  control any more, so the sizing path moves into Compose layout and D17/D14's per-instance frame
  reasoning has to be re-derived;
- **iOS/Android divergence**: iOS keeps one host per control (it already wins both Expo arms), so the
  two platforms stop sharing an architecture, and every component's host is written twice;
- recycling (`RecyclableView` reset must not dispose the wrong control's subtree), hit-testing and
  accessibility ordering, which move onto us;
- an effort size that is not a task: every component's host, the sizing path, the bench arms, and a
  public API review.

**Recommendation (unchanged in conclusion, corrected in reasoning).** Do not build the shared
composition for 0.1. Accept the documented D15 miss on mount UI CPU and memory with the residual above,
and take the contained next step first: spike `ComposeViewContext` service-sharing as T13. If 0.1 must
clear memory or mount UI CPU against a shared host, then the `<Host>` decision — API change, product
premise, both-platform rewrite — goes to review with this section attached.

## P2g. N5 closed as quantified-negligible

Per §2 and the post-T11 absolutes: our `jsCommitNs` on `mount:50` is 1.60 ms against the shared host's
1.89 ms and rn-core's 1.37 ms, while the same cell's gap is 14.85 ms of UI CPU against 10.48 ms -
and in the compiled state that gap is 2.38 ms, still several times what the second delivery costs. The
second `updateState` is one perf mark and one JNI diff; no generator patch was spent on it. Recorded
in `docs/upstream.md` (N5) and `docs/architecture/core.md` §3.

## D15 verdict (phase 2, final)

**Not met on Android — but the remaining gap is narrower than phase 1 measured, and it is one thing:
N compositions and N view trees.**

Against `expo-ui-shared-host`, on `nitroui_t02`, quick plan, 4 launches, all arms primed
(`ed620cb`, load 3.05 — this is the state a user gets after the app has been opened once). The eight
commits after it change docs, the tool's formatting and the package manifest - no Kotlin, C++ or
TypeScript that the APK contains - so this row is HEAD's code.

| Metric          | measured | target  | verdict |
| --------------- | -------- | ------- | ------- |
| mount presented | 1.01x    | ≤ 1.0x  | **parity** (32.60 ms vs 32.38 ms; inside the ±10% floor) |
| mount UI CPU    | 1.35x    | ≤ 1.0x  | **miss** (8.92 ms vs 6.54 ms) |
| memory          | 2.52x    | ≤ 1.0x  | **miss** (134.2 KiB vs 53.1 KiB per instance) |
| update presented| 0.88x    | —       | better than the shared host |
| update UI CPU   | 1.24x    | —       | reported |

Against `expo-ui-host-per-control` we are below on every gated metric — mount presented 0.99x, mount
UI CPU 0.59x, memory 0.74x — so D15's "well below the per-control arm" half is met, and clearly so.

In the state this project measured before today (ART `verify`, `f99efb9` post-T11): 1.11x presented,
1.51x mount UI CPU, 2.40x memory. Phase 1's 1.47x / 1.48x / 2.33x was that state on a loaded machine.

Say it precisely, because the tempting version of this paragraph is a story about the library.
**Mount `presented` reached parity because of a bench correction, not a library change**: the 1.22x →
1.01x move is the ART regime, which is a measurement fix that a consumer of this library does not get
(and priming is a regime change, so 1.22x and 1.01x are two readings of two regimes rather than one
series). What the library's own changes moved is inside the noise: by this report's own P0/P1/P2 rows,
A, G and H changed `presented` by ≈0 (P1 → P2 +1.1%, floor ±10%), and update UI CPU by an amount only
B plausibly contributed to (-7.3%, outside the ±2% floor but measured once). **Memory also got worse
over the task**, not better: 130.2 KiB / 2.40x at the post-T11 "before" → 135.7 KiB / 2.45x → 134.2 KiB
/ 2.52x now. Every step of that is inside this report's own ±4% cross-build floor, so the honest
statement is "memory did not improve, and the ratio moved with machine state", not "memory regressed".

What is not noise is the shape: every control still carries its own Compose **composition and owner**
(`AndroidComposeView`) and its own native view tree — about 134 KiB and 0.18 ms of UI CPU per control
at N=50, against 53 KiB and 0.13 ms for a host that has one of each per window. (Round 3's correction:
the `Recomposer` and frame clock are already shared per window, so they are not part of the per-control
bill.) That is the whole miss. It is architectural (§P2f), it is not fixable by trimming our own
allocations — the two allocations we could trim measured -1.1 KiB and 0 — and per D15 this is an
explanation plus a follow-up item: §P2f and §7, for the reviewer to decide.

**Follow-up items, in the order I would do them:**
1. Re-record or re-label the historical Android numbers now that the bench primes by default. **Both
   the absolutes and the ratios break** across the `verify` → `speed-profile` line, so labelling is the
   cheap half of this and T02's report now carries it; re-recording is still open. The run metadata and
   the `--update-baseline` guard from round 3 make future runs self-identifying.
2. Spike the `ComposeViewContext` service-sharing step (§P2f) as T13 if anything is to be built —
   public experimental API in Compose UI 1.11.4, keeps §2's one-host-per-view contract, no recycling or
   hit-testing risk, at the price of an experimental-API and BOM-pin commitment (D8). It is the only
   contained thing left, and its ceiling is a fraction of the per-control cost.
3. Decide on shared composition — as §P2f now states it, an explicit `<Host>` container, which is a
   public API change and a change of product premise, not an internal rewrite — only if 0.1 must clear
   memory or mount UI CPU. Nothing on the contained list can.
4. Upstream: a batch API for coalescing `updateState` commits would make the batched half of a cold
   list one commit instead of N (see P2c). Note for whoever writes the entry: RN has a closer precedent
   than UIManager — `animationbackend/AnimationBackend.cpp:193` and `AnimationBackendCommitHook.cpp:40`
   do use `cloneMultiple`, which is the shape a one-commit batch API needs.

## Repro (phase 2)

```sh
# Device (D13): AVD nitroui_t02 on adb server 5042. Never the default adb port.
export ANDROID_ADB_SERVER_PORT=5042 ANDROID_HOME=$HOME/Library/Android/sdk
export ANDROID_SERIAL=emulator-5572 METRO_PORT=8294
emulator -avd nitroui_t02 -port 5572 -gpu host -no-snapshot-save -no-audio \
  -no-boot-anim -no-window > /dev/null 2>&1 &

# 1. Bench. The run primes the ART profile and logs `ART: … -> speed-profile`;
#    a run that ends at `verify` measured the interpreter and must not be cited.
bun bench --platform android --plan quick
node bench/tools/arm-ratios.mjs bench/results/<run>.json   # ratios vs all three arms

# 2. Is the profile really in force?
adb -s emulator-5572 shell dumpsys package dexopt | grep -A2 com.nitroui.bench

# 3. Cold-batch flush (lastFlushMs). Debug build; jest is silent, so print from a
#    test and read it out of the failure, or run the cold-batch test alone:
cd example
HARNESS_APP_PATH=$PWD/android/app/build/outputs/apk/debug/app-debug.apk \
  bunx react-native-harness --harnessRunner android -t "cold batch of 200"

# 4. Done.
adb -s emulator-5572 emu kill
```

## Round 3 (small fixes before merge)

The review's verdict was MERGE-AFTER-SMALL-FIXES. Everything below is what its six findings asked
for. **No new bench run** — nothing here changes a measured number, so every number in phase 2 is the
same one that was reviewed, only described differently where the description was wrong.

- **F1 (the one code fix).** The process-wide `NitroUiColorSchemes` entry held its `Context`
  (`ThemedReactContext`, whose base is the `Activity`) strongly, so a destroyed activity stayed alive
  in every process that ever mounted a control. The key is now a `WeakKey` (`NitroComposeHost.kt`),
  which holds only a `WeakReference` and compares the referent; the value stays strong, because a
  `ColorScheme` is colour longs and reaches nothing. A collected key is a miss, not a wrong answer,
  so nothing needs unregistering. Covered by `NitroUiWeakKeyTest` (see the gate table): one test
  asserts structurally that no instance field is a strong path to the context, one asserts the
  identity semantics, one shows the referent becomes collectable.
- **F2/F3 (numbers and cause).** One set of H numbers now appears in `NitroUiSizing.kt`,
  `NitroUiSizingEngine.hpp`, `sizing.md` §3 and `Sizing.harness.tsx`: first batch in a process
  38.80 → 36.76 ms (−5 %) and 75.38 → 53.97 ms (−28 %); median of three rounds 18.88 → 12.84 ms
  (−32 %) and 42.51 → 26.77 ms (−37 %). The `stale=0` explanation is gone everywhere it appeared, and
  with it the causal claim — one synchronous push clones one family, so untouched siblings are not
  corrected by it, which is why the count stays a log rather than an assertion.
- **F4.** G's memory change is stated as measured ≈0 against the ±4 % cross-build floor, in the
  Outcome bullet and in P2b, keeping the reasoning that is why it stays.
- **F5.** `core.md` names the real functions (`NitroUiColorSchemes.forContext`, `switchColors`), keys
  A on scheme identity plus **tint**, and drops the wrong reason: in the resolved Material 3 1.4.0
  `SwitchColors` is `@Immutable` with `equals`/`hashCode` (`javap` on the resolved AAR), so a
  fresh-but-equal instance does not defeat skipping and the cost was only the allocation. The same
  correction is applied in the report at §5, P2a and P2b, and the "`remember` cannot work" premise in
  `HybridNitroUiSwitch.kt` is fixed with the code left alone.
- **F6.** §P2f is rewritten around what the framework actually offers, and the verdict sentence and
  follow-up 3 with it: one `Recomposer` and frame clock **per window**, already shared; per control we
  pay a `Composition` and an `AndroidComposeView` owner; `setParentCompositionContext` and
  `createComposition` are public; `ComposeViewContext` is the cheap intermediate step and is named as
  T13 rather than built here; and the constraint that decides the shape — one composition is one
  rectangle, so it cannot host `ScrollView` children, interleaved RN views, clipping or transforms, or
  `Modal`s, which makes the real option an explicit `<Host>` container and therefore a public API
  change.
- **Bench.** Every Android run persists its ART state, the markdown header prints it, and
  `--update-baseline` refuses a run that is not `speed-profile` (or that predates the field) the same
  way it refuses a busy machine. Both are shown to fail above.
- **Docs.** `benchmarks.md` says priming breaks ratios as well as absolutes and lists `art` as run
  metadata; `T02-bench.report.md` carries a dated note that Android rounds 3 and 4 are `verify`
  numbers; and the D15 "Plainly" paragraph now says parity came from the measurement correction, with
  the library changes at ≈0 and memory at 2.40× → 2.52× inside the floor.

**Gates after these fixes.** `bun run check` green. `bun run test:native:android` green (10 tests,
including the 3 new ones). Android harness rebuilt and re-run on `nitroui_t02` / adb 5042 / Metro 8294:
**2 suites, 33/33**, because Kotlin changed. The emulator was started and stopped by this task and is
shut down; `emulator-5560`, `nitroui_t01` and iPhone 17 were not touched, and no Metro was left running.

**`docs/DECISIONS.md` is byte-identical to `main`.** D17 is the orchestrator's decision and my round-2
edit to it is reverted; what I would write is below.

## Questions for orchestrator

1. **D17 needs one sentence changed, and it is your call, not mine.** Main still says the Android
   immediate budget is 2; the branch ships 1, and round 3 removed the (unproven) reason round 2 gave
   for why that was safe for a whole batch. My proposed replacement for the sentence *"On Android a
   cold batch corrects up to the immediate budget (2) inside the cancelled frame and the rest on the
   next frame — same rule, documented"*:

   > On Android the immediate budget is 1 since T12 (it was 2 in T11): the instance that reported is
   > corrected inside the frame that gets cancelled, and the rest of a cold batch lands on a later
   > frame — same rule, documented. What the harness gates is the number of synchronous pushes
   > (`1 ≤ immediate ≤ budget × flushes`) and the never-stale cold control, one instance. It does not
   > gate a whole batch: the batch `stale` count is logged and not asserted. T12 *measured* `stale=0`
   > for a 100-instance cold batch at budget 1 on `nitroui_t02`, against `stale=100` at budget 0; the
   > budget-1 result is one measurement on one device, and no mechanism is claimed for it — one
   > synchronous push clones one family, so an untouched sibling is not corrected by it at all.

   The alternative is to leave D17 exactly as main has it and let `sizing.md` §3 carry the platform
   budget, which I would not recommend: D17's "(2)" would then be a factually wrong number in the file
   agents are told to read first.
2. **Is T13 the right home for the `ComposeViewContext` spike?** §P2f and follow-up 2 describe it and
   deliberately do not build it: it is a public experimental API
   (`@ExperimentalComposeViewContextApi`, Compose UI 1.11.4) and adopting it means committing to a BOM
   pin per D8. That is a dependency-policy decision as much as a perf one, so I have left it as a task
   rather than spending the branch's remaining time on it.
3. **Who re-records the pre-T12 Android baselines, and when?** They are now self-identifying — the T02
   report says `verify`, the run metadata says `verify`, and the baseline writer refuses to mint a
   baseline from such a run — but `bench/baselines/` still has no Android entry recorded in the primed
   regime. That needs a full-plan Android run, which is bench time rather than fix time.
