# B1 — Android mount OOM: report

## Summary

`mount.<component>:nitro-ui:200` did not run the heap out because 200 controls are expensive. It ran it
out because **every mount left that control's Compose view registered on the activity's
`LifecycleRegistry`, forever** — a churn loop therefore retained one host per mount, and a 192 MiB heap
died after a handful of cycles.

- **Cause.** `NitroComposeHost.init` installs
  `ViewCompositionStrategy.DisposeOnLifecycleDestroyed(activity)`. In the Compose versions this repo
  resolves — **1.11.4**, which `compose-bom:2026.06.01` gives the library and the example/harness app,
  and **1.12.1**, which the bench app ends up on after Expo raises it — a strategy is
  installed when it is *set*, and the only thing that ever uninstalls it is the next
  `setViewCompositionStrategy` call — neither `disposeComposition()` nor a detach nor a drop does. What
  gets installed is a `LifecycleEventObserver` in the owner's `LifecycleRegistry`, which holds its
  observers strongly. So the activity keeps a strong path
  `mLifecycleRegistry → observerMap → strategy lambda → ComposeView → host` for every control the
  process ever mounted.
- **Fix (~25 lines plus KDoc).** `drop()` now uninstalls the strategy after disposing
  (`DisposeWithTheHost`, a strategy that observes nothing), and `onAttachedToWindow()` arms it again for
  the mount that follows; `drop()` also takes back the sizing engine's two pre-draw listeners, which
  had the same retention shape (fix round 1, review M1/M2). No `largeHeap`, no lower N, no `androidx`
  pin change.
- **Red → green.** The new churn gate measured **8.18 MiB retained per cycle of 200 Switches** before
  the fix and **0.00 / 0.00 / −0.08** after it, the post-GC floors flat run after run
  (7.91/7.91/7.91, 7.89/8.02/7.89, 8.95/8.73/8.79 MiB).
- **Bench.** `mount:nitro-ui:200` went from `no end sentinel within 180s` (the OOM, as in A1) to
  **20 iterations in 5.6 s on every launch**, and the `--plan full` switch/nitro-ui run finished with
  `problems: none`. The `leak N=200` slope went from 16.5 MiB/cycle *MONOTONIC (gated as a leak)* to
  764.4 KiB/cycle *not monotonic (not gated)*.
- **It was ours, not Compose's.** The control in the same pre-fix run on the same AVD —
  `expo-ui-host-per-control`, same Compose, one view per control — measured **359.0 KiB/cycle, not
  monotonic**: ~47x below ours, and not flagged.
- **The A1 stack was a red herring.** `AndroidComposeViewAccessibilityDelegateCompat.boundsUpdatesEventLoop`
  is where the last allocation failed, not what allocated: the AVD has no accessibility service
  (`enabled_accessibility_services = null`, `accessibility_enabled = 0`), and
  `…boundsUpdatesEventLoop$1` appears in the leak dump as *collected*, not retained.

## Files changed

- `android/src/main/java/com/margelo/nitro/nitroui/core/NitroComposeHost.kt` — the fix:
  `armCompositionStrategy()` / `unarmCompositionStrategy()`, armed from `onAttachedToWindow()` and
  unarmed from `drop()`; the `DisposeWithTheHost` strategy; and (fix round 1) `PreDrawWatch`, so each
  pre-draw listener unregisters from the observer that actually holds it and `drop()` removes both; the
  corrected KDoc. The first cut armed in `init` + `prepareForRecycle()` — review M1 moved it.
- `docs/architecture/core.md` — §6 gains "the strategy is a registration, and `drop()` has to undo it";
  §2 and the §6 recycling list no longer claim the strategy survives a drop/recycle; §10 gains the trap.
- `example/__tests__/MountChurn.harness.tsx` — new regression gate (Android): churn 200 Switches
  3 times and gate the *post-GC* Java-heap growth per cycle.
- `example/android/app/src/main/java/nitroui/example/NitroUiProbePackage.kt` — new example-app-only
  TurboModule (`NitroUiProbe.heapStats`): the Java heap after forced collection, which JS cannot ask
  for (Hermes reports only its own heap). Test instrumentation, not library surface.
- `example/android/app/src/main/java/nitroui/example/MainApplication.kt` — registers that package.
- `docs/tasks/B1-android-mount-oom.report.md` — this report.

## Attribution

Device `nitroui_t01` / `emulator-5570`, API 35, 192 MiB Java-heap growth limit, Metro 8293, private adb
server 5041.

**1. The failure is retention, not peak.** A1's crash is `Failed to allocate a 32 byte allocation with
68 KB until OOM … <1% of heap free after GC`, i.e. the heap was *full of live objects*, and one mount
of 200 controls costs ~28 MB at the measured ~141 KiB/instance. The gate reproduces it in the harness:
post-GC floors climb 24.25 → 32.54 → 40.62 MiB over three cycles of 200 controls (+8.18 MiB each),
while the same loop after the fix returns to 7.89 MiB every time.

**2. What the retained objects are.** `am dumpheap` during the churn (13 batches of 100 controls
mounted = 1300 hosts, at most one batch of 100 live), `hprof-conv`, then a GC-root BFS over the parsed
heap, following nothing that an app author cannot drop: weak `referent` edges and ART's class-table
bookkeeping (`runtimeInternalObjects`, `shadow$_klass_`, class→loader back-links) are excluded, because
a naive BFS reads them as references and reports ~1.9 M "reachable" objects.

| Class | instances in dump | retained | retained via `MainActivity.mLifecycleRegistry → LifecycleRegistry.observerMap` |
| --- | --- | --- | --- |
| `NitroComposeHost$ComposeContent` | 1300 | 1300 | **1300 (all)** |
| `androidx.compose.ui.platform.AndroidComposeView` | 1300 | 1300 | **1300 (all)** |
| `com.margelo.nitro.nitroui.SwitchHost` (the host) | 1300 | 1300 | **1300 (all)** |

Retained count equals *total ever mounted*, not the ~100 that were live: the signature of an
unbalanced registration. Each retained control costs 3 `View`s (host, `ComposeContent`,
`AndroidComposeView`) and ~42 KiB of Java heap — 8.18 MiB per 200-control cycle.

**3. What was not holding them.** In the same dump, 100 copies each of
`NitroComposeHost$watchForFirstFrame$1`, `NitroComposeHost$scheduleSizingFlush$1`,
`NitroComposeHost$$ExternalSyntheticLambda0/1`,
`AndroidComposeView$$ExternalSyntheticLambda2` and
`AndroidComposeViewAccessibilityDelegateCompat$boundsUpdatesEventLoop$1` are present and
**unreachable** — the first-frame and sizing pre-draw listeners and the accessibility coroutine were
already collected, so everything else a mount allocated freed correctly. In the churn this gate
measures — hosts detached a full 300 ms before they are dropped — the strategy registration was the
only per-mount registration that did not free. It was not the only one in the class: a host detached
*before* its first pre-draw left a pre-draw listener on the window's observer the same way, which
round 0's dump could not show and fix round 1 fixes (review M2). Recycling is not involved either:
`ReactNativeFeatureFlags`
`enableViewRecycling` is off, the diagnostic build's drop/recycle counters showed every drop a real
unmount, and the leak reproduces with the flag off (i.e. always).

**4. Why the strategy is the candidate.** Verified against both linked artifacts
(`androidx.compose.ui:ui-android:1.11.4` — the example/harness app's — and `1.12.1` — the bench's —
`javap -c` on `AbstractComposeView`, identical in these methods):
`setViewCompositionStrategy` runs the previous strategy's uninstaller and then calls
`installFor(this)` immediately; `disposeComposition()` touches only the `Composition` and the
`ComposeViewContext`; `onAttachedToWindow` does not re-run the strategy. And `installForLifecycle` in
`ViewCompositionStrategy.android.kt` is `lifecycle.addObserver(observer)` /
`return { lifecycle.removeObserver(observer) }` — the returned closure is reached from nowhere but the
next `setViewCompositionStrategy`.

**5. The control.** Same pre-fix run, same AVD, same plan, `expo-ui-host-per-control`: `mount N=200`
completed (141.27 ms presented) while `mount:nitro-ui:200` timed out, and its leak slope was
359.0 KiB/cycle and non-monotonic. Expo's host does not dodge the activity:
`expo-modules-core` 58.0.24's `ExpoComposeView` installs
`DisposeOnLifecycleDestroyed(activity.lifecycle)` exactly as ours does
(`android/src/compose/expo/modules/kotlin/views/ExpoComposeView.kt:253`), and it does not leak because
its unmount swaps the strategy out — `disposeHostedComposition()` (`:275-289`), whose own comment
reads "disposeComposition() alone leaves the composition strategy's lifecycle observer registered on
the Activity, which leaks this view". Same root cause, same fix, arrived at independently: which
strengthens the attribution, and replaces the reason round 0 gave ("Expo uses the default strategy",
which is false for the linked version).

## Fix and decisions

- **Uninstall on drop, re-arm on recycle** (`DisposeWithTheHost` is the "install something to uninstall
  the thing that observes" idiom — the uninstaller is only ever invoked by `setViewCompositionStrategy`).
  `disposeComposition()` first, then the uninstall: the setter wants no composition in flight, and a
  guard is worthless once the composition is gone.
- **Rejected: `DisposeOnDetachedFromWindowOrReleasedFromPool`** (Compose's default — not what Expo's
  per-control host uses either, which installs `DisposeOnLifecycleDestroyed` and swaps it out on
  unmount). It disposes on *detach*, and RN detaches a mounted view for screen
  transitions, `removeClippedSubviews` and the pool — `docs/architecture/core.md` §6 exists because of
  that. It would also have thrown away the composition on every screen transition.
- **Rejected: a strategy that keeps only a `WeakReference` to the view.** It stops retaining the host
  but keeps one observer in the activity's observer map per mount forever (~150 B/mount, unbounded),
  and a strategy whose job is to dispose a view on activity destroy has to be able to reach that view.
  Uninstalling is both smaller and correct.
- **Arm at attach, not at pool entry** (corrected in fix round 1; review M1). The first cut re-armed in
  `prepareForRecycle()`, because `drop()` is also the front door of recycling and a pooled host must not
  come back without its guard (`docs/architecture/core.md` §6). That is right about reuse and wrong
  about placement: `prepareForRecycle()` is *pool entry*, and `ViewManager`'s pool is an unbounded stack
  per surface that it empties on `trimMemory` and `onSurfaceStopped` without telling the views inside it
  — so every host RN discards instead of reusing was back in the activity's `LifecycleRegistry`, at the
  moment of memory pressure. Arming now happens in `onAttachedToWindow()`, before `super` (the child's
  attach is what creates the composition), behind a `strategyArmed` flag so a re-attach after a detach
  costs no second observer, and `init` arms nothing — a preallocated host that is thrown away without
  ever mounting no longer registers anything.
- **`armCompositionStrategy()` refuses a `DESTROYED` owner.** Compose's `installForLifecycle`
  *throws* on one, and an attach can run while an activity is being torn down (a surface that is
  stopping still lays its tree out), so the guard is cheaper than the exception it prevents —
  and a guard for a dead activity is worth nothing.
- **The gate measures the post-GC floor, not duration** (D21): a transient allocation storm returns to
  its floor and a leak moves it. Bound is 2 MiB/cycle — 4x under the 8.18 MiB bug, ~4x above ART's
  between-collect slack, and warm cycles are *asserted* (0 sizing corrections) so the number cannot be
  the sizing engine's cache learning a size.
- **The probe module lives in the example app**, is `@ReactModule`-legacy (bridgeless reaches it by
  name; every method returns a `Promise` because bridgeless does not expose legacy sync methods), and is
  not reachable from the published package. It forces the collectors itself (`System.gc()` twice,
  with finalisation and a settle wait each time) rather than asking the runtime to trim, because the
  number has to be comparable across cycles of the same run.

## Gate results

Android device `emulator-5570`, Metro 8293, adb 5041. Node 24 via `fnm exec --using 24` (the harness
runner needs ≤ 24).

| Gate | Command | Result |
| --- | --- | --- |
| **Gate red (before the fix)** | `bunx react-native-harness --harnessRunner android MountChurn` on the pre-fix build | **FAIL** — `expected 8.18 to be less than 2`; floors `[24.25, 32.54, 40.62]` MiB, privateDirty `[22.61, 30.85, 38.98]`, `corrections=0`, suite 12.9 s |
| **Gate green** | same command, fixed build | **PASS** ×3 runs — floors `[7.91, 7.91, 7.91]` growth `0`; `[7.89, 8.02, 7.89]` growth `0`; `[8.95, 8.73, 8.79]` growth `-0.08`; privateDirty flat (6.26-7.23 MiB); `corrections=0`; suite 10.8 s (budget 30 s) |
| Full Android harness | `bunx react-native-harness --harnessRunner android` | **PASS** ×2 — 8 suites, 100 tests, 62.3 s then 61.8 s on the final build (`HARNESS_TIMING` unset → wall-clock gates off, load 7.26) |
| `bun run check` | `bun run check` | **PASS** (RC 0) — typecheck, bench typecheck, ESLint, Prettier, 75 s of Jest, native C++ tests, `perf:renders`, nitrogen drift, autolinking, `prepare`, api-extractor, publint, package manifest, README examples |
| Bench, touched component | `node scripts/bench/run.mjs --platform android --plan full --component switch --only nitro-ui` | **PASS** — `problems: none`, 28 launches, 189 s |

The gate's own suite registration was measured too: a harness file whose only `describe` sits behind a
platform check **fails** the other platform's run — `Test suite failed to run: Your test suite must
contain at least one test` (reproduced on Android by inverting the check) — so the file registers a
pending `it.skip` where the gate does not apply, and a pending-only suite was measured to exit 0.

## Benchmark numbers

Pre-fix = `bc8fd7c` (clean), 1 launch/cell, load 12.6 — `bench/results/bc8fd7c-android-20261024T183023Z.*`.
Post-fix = `bc8fd7c` + this change, 4 launches/cell, load 6.8 — `…-dirty-android-20261024T191014Z.*`.

There is a third run that the table does not use, disclosed because it is on disk and because it
corroborates the cause: `bench/results/bc8fd7c-dirty-android-20261024T183944Z.*` is the **pre-fix** code
with temporary drop/recycle counters in it (dirty tree, load 21). It fails the same cell —
`mount:nitro-ui:200` dies, no end sentinel — with the same 16.5 MiB/cycle leak slope. The 16.5 MiB is
therefore not an artefact of one build.

| Cell (android, switch) | pre-fix | post-fix |
| --- | --- | --- |
| `mount N=200` | **`no end sentinel within 180s`** (the OOM; Expo's arm: 141.27 ms) | **54.93 ms presented / 44.62 ms mounted**, 4/4 launches |
| `mount N=50` | 88.63 ms presented | 32.81 ms presented |
| `mount N=1` | 36.54 ms presented | 32.69 ms presented |
| `update N=50` | 25.76 ms presented | 27.98 ms presented |
| `memory N=200` | 131.9 KiB/instance | 141.8 KiB/instance (Expo 156.4) |
| `leak N=200` | **16.5 MiB/cycle, MONOTONIC — gated as a leak** | 764.4 KiB/cycle, not monotonic — not gated (Expo 359.0 is the *pre-fix* run's arm, see below) |

**The 764.4 vs 359.0 KiB/cycle row is cross-run, not same-run.** 359.0 KiB/cycle is Expo's arm of the
*pre-fix* run (1 launch/cell, load 12.6); the post-fix run was `--only nitro-ui` (4 launches/cell, load
6.8) and has no Expo arm. Only the ~47x (our 16.5 MiB/cycle vs Expo's 359.0 KiB/cycle) is same-run:
both arms, pre-fix, one run, one AVD.
**Can `--plan full` on Android now complete?** For `switch` (this run: 7 cells × 1 implementation ×
4 launches) it does: `problems: none`, so the three `mount.<component>:nitro-ui:200` OOMs A1 hit are
gone and the leak gate no longer fires. The full *plan* is all five components (~1120 launches); Slider
and Button failed the same cell for the same reason — the same `NitroComposeHost` — and are not
re-run here. A1's other blocker for minting a baseline is unchanged and not ours: a quiet machine.

## Follow-ups

- Residual leak slope 764.4 KiB/cycle post-fix vs Expo's 359.0 KiB/cycle (non-monotonic, not gated):
  worth one attribution pass before a baseline is minted, in a task that owns the bench.
- Arming now happens at attach, so `enableViewRecycling` off (the RN 0.88 default) exercises the same
  code as the flag on. T02's measurement with the flag on still owns the pool's behaviour, including
  whether a reused host should keep its composition (`docs/architecture/core.md` §6).
- **`drop()` disposes a composition while the view can still be on screen** (pre-existing, review N4):
  react-native-screens drops views during a pop, so a control can blank mid-animation
  (`expo/expo#47086`); Expo defers via `DisposeOnDetachedFromWindow` when attached. Not fixed here —
  out of B1's scope, and the fix is a policy change, not a leak fix.
- **A host can build a fresh, unguarded composition after `drop()`** (pre-existing hardening, review
  N5): `stopSurface` drops views before the root is removed, so anything that measures a dropped host
  while it is attached composes again with no strategy armed. RN parents do not measure children, so
  this is unlikely; a `dropped` flag making `onMeasure`/`onLayout` decline until `prepareForRecycle()`
  would close it.
- The bench runner still reports a dead app as `no end sentinel within 180s` (already A1's follow-up).
- `memory N=200` reads 131.9 → 141.8 KiB/instance across runs whose launch counts differ (1 vs 4) on a
  busy machine; reported, not gated.

## Questions for orchestrator

*Both answered in fix round 1 — see "What the two round-0 questions needed" at the end of this report.
Nothing here is open.*

1. **One iOS harness run for `example/__tests__/MountChurn.harness.tsx`.** AGENTS.md wants every
   harness file run on both platforms; iPhone 17 is P1's, so I did not run it and there are no shared
   TS/C++ changes in this task (`git show --stat` is Kotlin + docs + Android example + the harness file).
   What I verified instead: the file's iOS branch registers one `it.skip` and no gate, a pending-only
   suite exits 0 and a zero-test suite exits 1 (both measured on Android, where the failure mode is
   identical), and `bun run check` typechecks the file. A one-line `bun harness:ios` confirmation would
   close it.
2. Should `Slider`/`Button` get the same N=200 bench confirmation before A1's baseline attempt is
   retried? The fix is in their shared host, so I expect both to pass; it is a ~15-minute run.

---

## Fix round 1

Review: `docs/tasks/B1-android-mount-oom.review.md` (verdict *merge-after-small-fixes*). Fix commit
`d15ad28`. Both must-fixes are in `NitroComposeHost.kt`, so this round changes native code and needs a
re-review under D19.

### M1 — the strategy is armed at attach, not at pool entry

`prepareForRecycle()` re-armed the guard `drop()` had just taken off, which put the leak back for pooled
views: `prepareForRecycle()` is *pool entry*, and RN's pool is an unbounded `Stack` per surface
(`ViewManager.java:264-273`) that it empties on `trimMemory` (`:473-479`) and `onSurfaceStopped`
(`:467-471`) without telling the views inside it. Every host discarded rather than reused was back in
the activity's `LifecycleRegistry` with no composition to guard — ~42 KiB each, at the one moment the
process has said it is short of memory.

The fix is a `strategyArmed` flag (set by `armCompositionStrategy()`, cleared by
`unarmCompositionStrategy()`), one arming call, in `onAttachedToWindow()` **before `super`** — the
child's `AbstractComposeView.attachedToWindow` is what creates the composition, and `super` dispatches
it, so the guard is on before anything it guards exists. `init` and `prepareForRecycle()` arm nothing.
The flag is what makes arming idempotent, which is what the re-attach-without-drop path (a screen
transition, `removeClippedSubviews`) needs so it does not install a second observer on the activity.

**How the recycling path is covered: it is not, and no heap-floor gate can cover it.**
`enableViewRecycling` is off in the example app, so `prepareForRecycle()` runs in no harness or bench run
at all. `ReactNativeFeatureFlags.override` *could* turn it on app-wide, and that would still not make
this gate discriminate: pooling retains hosts *by design*, so a churn loop with the flag on has a
legitimate floor of pooled controls and the 2 MiB/cycle bound would be measuring pooling and leaks at
once — a gate that is red for the feature is not a gate. What round 1 does instead is delete the shape:
arming has exactly one call site, immediately before the only thing it guards, and there is no remaining
site where a host can register without a mount following it. A pooled host now holds no registration.
The suite is green with the arming site moved (below); T02 owns the flag-on measurement, including
whether a reused host should keep its composition.

### M2 — pre-draw listeners come off the observer that holds them

Both pre-draw listeners (first-frame, sizing flush) were registered while attached — so they landed on
the **window's** `ViewTreeObserver` — and removed themselves through the host's *current* one. After a
detach that is a fresh floating observer, so the removal removed nothing and the window kept the
listener, and the host through it, for the life of the window — and ran it every frame, since the
first-frame listener re-marked `firstFrame` each time. Same retention shape as the strategy, one mount
earlier to break, and it contradicted the `core.md` sentence "a host that is dropped and never reused
then holds no registration anywhere".

Each listener is now held in a `PreDrawWatch` together with the observer it went on
(`NitroComposeHost.kt:1009`), unregisters through `unregisterPreDraw()` (`:433`), which asks the
captured observer while it is alive, falls back to the current one only for a view that is attached
again (a merge copies listeners into the live destination), and returns without touching anything when
neither applies; `ViewTreeObserver` throws for a listener it does not hold, so the call is wrapped —
the worst case must not be a crashed unmount. `drop()` removes both listeners and clears the flags
(`:355`), which is what makes that `core.md` sentence true.

**No red-first gate is reachable from the harness — measured, not assumed.** Two churn shapes that
should hit it both passed on the *buggy* code: 200 controls unmounted as soon as `render` resolves, and
50 rounds × 4 controls with no settle between mount and unmount. So the leak path was instrumented
(temporary `Log.i` at registration and inside the unregister, since reverted): over a churn run, of
**1600 registrations every one of the 3200 removal attempts found the host's current observer to be the
same object as the one captured at registration — the divergent case, a detached host whose current
observer is a different object, happened 0 times** (two attempts per listener: its own unregistration
and `drop()`'s).
Every pre-draw listener a harness can reach runs while its host is still attached, before anything
detaches it, so round 0's code cannot be made red from JS — and per AGENTS.md a gate that cannot be
shown red does not get added. The one route left was to stop the window's traversals from app code
(`activity.moveTaskToBack` behind an example-only probe); `react-native-harness` 1.6.0 exposes no
background/foreground control, and writing one is a new example-app surface plus a new probe method,
outside this round's budget. It is noted as untested, as the review allows.

What M2 *is* verified by:

- the mechanism is `View`'s own documented behaviour (`getViewTreeObserver()` hands out the floating
  observer once detached, and the merge into a window's observer is one-way), and the pre-fix code
  removed from the wrong object by inspection;
- the flush path is not dead code: on Android that listener is the *only* call site of
  `NitroUiSizing.flush()` (`rg '\.flush\(' android/src/main/java` → one hit), so every sizing correction
  in the suite passes through it — a listener that stopped running, or a removal that threw, turns the
  existing sizing gates red. They are green, on the same build;
- `sizingStats()` cannot be the signal for a red test, checked while designing it: the C++ `flush()`
  returns early without counting when it has nothing pending, so "no flush happened" and "no flush was
  needed" read the same.

### Corrections applied in place (review's list)

- **Expo control** (§Attribution 5, §Fix and decisions): round 0 claimed Expo's host uses Compose's
  default strategy. It does not — `ExpoComposeView.kt:253` installs `DisposeOnLifecycleDestroyed` on the
  activity's lifecycle like ours, and `disposeHostedComposition()` (`:275-289`) swaps the strategy out on
  unmount. The claim is replaced with that, which strengthens the attribution rather than weakening it.
  `DisposeOnDetachedFromWindowOrReleasedFromPool` is no longer described as Expo's choice.
- **Compose version** (§Summary, §Attribution 4): 1.11.4 (library + example/harness app via
  `compose-bom:2026.06.01`) and 1.12.1 (bench app, after Expo raises it) are both named; the churn gate
  ran on 1.11.4, and the bytecode was read in both.
- **"the only per-mount thing that did not free"** (§Attribution 3) is scoped to the churn this gate
  measures; M2 is named as the counter-example round 0 could not see.
- **Bench table**: the 764.4 vs 359.0 KiB/cycle row is labelled cross-run (359.0 is the pre-fix run's
  Expo arm; the post-fix run is `--only nitro-ui` and has no Expo arm), and the ~47x is labelled
  same-run.
- **`bc8fd7c-dirty-android-20261024T183944Z`** is disclosed under §Benchmark numbers: it is the pre-fix
  tree with temporary counters (load 21), it also OOMs at `mount:nitro-ui:200`, and its slope is the
  same 16.5 MiB/cycle — so the red number is not one build's artefact.
- **"Fix (10 lines)"** is now ~25 lines plus KDoc.
- `armCompositionStrategy()`'s `DESTROYED` rationale no longer cites the removed `prepareForRecycle()`
  call site.
- N3 (code + docs): the `DisposeOnViewTreeLifecycleDestroyed` note no longer says the view-tree owner is
  "the same activity anyway" — under react-native-screens it is the screen's fragment.
- N6/N7/N8 (gate header): the iOS branch registers a pending `it.skip` rather than "no test"; the 2 MiB
  bound is ~4x under the measured 8.18 MiB (was "12x"); the bench's 16.5 MiB/cycle is no longer
  conflated with this gate's 8.18 MiB / ~42 KiB-per-control, and the gap between them is stated as
  unattributed.
- N1/N2 (`core.md`): both Compose versions named, the §6 line refs re-derived for this tree, and "~43
  KiB" unified to ~42 KiB.

Two pre-existing findings are filed rather than fixed (N4: `drop()` disposes while the view may still be
on screen, which blanks controls during a react-native-screens pop — `expo/expo#47086`; N5: a dropped
host can build a fresh, unguarded composition if it is measured while still attached, e.g. during
`stopSurface`). Both are in Follow-ups.

### Gate results (fix round 1)

On `d15ad28`, AVD `nitroui_t01` / `emulator-5570`, private adb server 5041, Metro 8293, iPhone 17
`F08675D3-…`, harness under Node 24 with an absolute `HARNESS_APP_PATH`:

| Gate | Command | Result |
| --- | --- | --- |
| `bun run check` | `bun run check` | **PASS** (RC 0) — typecheck, lint, Prettier, Jest, native tests, `perf:renders`, nitrogen drift, autolinking, `prepare`, api-extractor, publint, package files, README examples |
| Churn gate, re-run on the fix | `… bun run harness:android MountChurn` | **PASS** ×2 — 1 suite, 1 test, 11.1-11.6 s (post-GC floor slope under the 2 MiB/cycle bound) |
| Full Android harness | `… bun run harness:android` | **PASS** — 8 suites, 100 tests, 60.8 s |
| Full iOS harness | `IOS_SIM_UDID=F08675D3-… METRO_PORT=8293 HARNESS_APP_PATH=$PWD/example/ios/build/…/NitroUiExample.app bun run harness:ios` | **PASS** — 7 suites passed + MountChurn skipped, 99 passed / 1 skipped, 63.2 s |
| Bench, switch | `node scripts/bench/run.mjs --platform android --plan full --component switch --only nitro-ui --launches 2` | **PASS** — `problems: none`; `mount N=200` 50.62 ms presented / 41.47 ms mounted, 2/2 launches; leak 797.3 KiB/cycle, not monotonic (not gated); memory 142.3 KiB/instance — `bench/results/d15ad28-dirty-android-20261024T201336Z.*` |
| Bench, slider | same, `--component slider --skip-build` | **PASS** — `problems: none`; `mount.slider N=200` 58.84 / 46.04 ms; leak 891.0 KiB/cycle not monotonic; memory 163.0 KiB/instance — `…T201548Z.*` |
| Bench, button | same, `--component button --skip-build` | **PASS** — `problems: none`; `mount.button N=200` 61.49 / 51.49 ms; leak 508.0 KiB/cycle not monotonic; memory 194.0 KiB/instance — `…T201726Z.*` |

Notes on those runs, so the numbers are read correctly:

- All three bench result files are named `d15ad28-dirty-…` because the report edit was uncommitted when
  they ran; the compiled code is exactly `d15ad28`, and one APK (built from it) served all three, so the
  three components are directly comparable to each other.
- Machine load was not quiet for the switch run (load1 8.55 over 14 cores, marked **busy**); slider and
  button ran at 5.64 and 4.41. `problems: none` is about sentinels and gates, and this task needs
  "did the OOM go away", which holds at every load; no baseline is being minted from these.
- The earlier iOS confirmation the review asked for also exists independently: the orchestrator ran the
  full iOS suite on `e0efb23` with this harness file — 7 suites + MountChurn skipped, 99 passed / 1
  skipped, exit 0. Round 1's run above repeats that on the fix tree.
- An attempt to pass `--verbose` through to Jest (`harness:android MountChurn -- --verbose`) fails the
  suite at import time — the runner's argument handling, not the code under test. Recorded so a future
  reader does not mistake it for a red gate; the plain command is green.

### What the two round-0 questions needed

Both are answered by this round: the iOS run for the harness file exists (twice, above), and `Slider` and
`Button` now have their own N=200 confirmation — no OOM, `problems: none`, same host, same build.
