# T12 — Android Compose host performance: report

**Status: Phase 1 (profile + breakdown) done. Phase 2 (optimising) not started — it needs host/core
edits and T11 has not merged yet. See [Questions for the orchestrator](#questions-for-the-orchestrator).**

No library or core file is changed by this report. It adds profiling tooling under
`bench/tools/` and writes down where the Android UI-thread time and the per-instance bytes go,
which is what the brief asks for before optimising.

## Summary

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
| 1 | One composition + `Recomposer` + frame loop per control (`initializeView`, `recompose`, `applyChanges`) | mount UI CPU, mount `presented`, update UI CPU, 68.8 KiB Java/control | architecture (core.md §2) |
| 2 | One native view tree per control (4 `View`s, `INSERT` 3.82 vs 0.53) | mount `presented`, 50.1 KiB native/control | architecture |
| 3 | A fresh `SwitchColors` per recomposition per instance | recompose on update, allocation; `SwitchColors` is a plain class, so the `Switch` subtree cannot skip | `HybridNitroUiSwitch.kt:104-110` — ours, fixable |
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

## D15 verdict

**Not met on Android.** Against `expo-ui-shared-host`, at `c5be9af` on `nitroui_t02`:

| Metric          | measured | target | verdict |
| --------------- | -------- | ------ | ------- |
| mount presented | 1.47x (1.88x at round-4 load) | <= 1.0x | **miss** |
| mount UI CPU    | 1.48x (1.80x)                 | <= 1.0x | **miss** |
| memory          | 2.33x (2.64x)                 | <= 1.0x | **miss** |
| update presented| 0.99x (1.14x)                 | <= 1.0x | pass (not gated by D15) |
| update UI CPU   | 1.34x                         | —       | reported |

The D15 explanation, per `docs/architecture/benchmarks.md`: the library mounts N Compose
compositions, N recomposers and N native view trees where the shared host mounts one of each, and at
N=200 that turns into 167 ms/iteration of ART reclaim on the UI thread. What remains after the
contained fixes (A, B) is expected to be that architecture gap, and the recommended next step is
§7, decided at orchestrator level.

## Questions for the orchestrator

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

## Repro

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
