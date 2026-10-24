# B1 — Android mount OOM: report

## Summary

`mount.<component>:nitro-ui:200` did not run the heap out because 200 controls are expensive. It ran it
out because **every mount left that control's Compose view registered on the activity's
`LifecycleRegistry`, forever** — a churn loop therefore retained one host per mount, and a 192 MiB heap
died after a handful of cycles.

- **Cause.** `NitroComposeHost.init` installs
  `ViewCompositionStrategy.DisposeOnLifecycleDestroyed(activity)`. In compose-ui 1.12.1 a strategy is
  installed when it is *set*, and the only thing that ever uninstalls it is the next
  `setViewCompositionStrategy` call — neither `disposeComposition()` nor a detach nor a drop does. What
  gets installed is a `LifecycleEventObserver` in the owner's `LifecycleRegistry`, which holds its
  observers strongly. So the activity keeps a strong path
  `mLifecycleRegistry → observerMap → strategy lambda → ComposeView → host` for every control the
  process ever mounted.
- **Fix (10 lines).** `drop()` now uninstalls the strategy after disposing (`DisposeWithTheHost`, a
  strategy that observes nothing), and `prepareForRecycle()` re-arms it for the mount that follows.
  No `largeHeap`, no lower N, no `androidx` pin change.
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
  `armCompositionStrategy()` / `unarmCompositionStrategy()`, called from `init` +
  `prepareForRecycle()` and from `drop()`; the `DisposeWithTheHost` strategy; the corrected KDoc.
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
already collected, so everything else a mount allocated freed correctly. The strategy registration is
the only per-mount thing that did not. Recycling is not involved either: `ReactNativeFeatureFlags`
`enableViewRecycling` is off, the diagnostic build's drop/recycle counters showed every drop a real
unmount, and the leak reproduces with the flag off (i.e. always).

**4. Why the strategy is the only candidate.** Verified against the linked artifact
(`androidx.compose.ui:ui-android:1.12.1`, `javap -c` on `AbstractComposeView`):
`setViewCompositionStrategy` runs the previous strategy's uninstaller and then calls
`installFor(this)` immediately; `disposeComposition()` touches only the `Composition` and the
`ComposeViewContext`; `onAttachedToWindow` does not re-run the strategy. And `installForLifecycle` in
`ViewCompositionStrategy.android.kt` is `lifecycle.addObserver(observer)` /
`return { lifecycle.removeObserver(observer) }` — the returned closure is reached from nowhere but the
next `setViewCompositionStrategy`.

**5. The control.** Same pre-fix run, same AVD, same plan, `expo-ui-host-per-control`: `mount N=200`
completed (141.27 ms presented) while `mount:nitro-ui:200` timed out, and its leak slope was
359.0 KiB/cycle and non-monotonic. Expo's host uses Compose's default strategy — attach-state
listeners, held by the view — which is why it never touches the activity's observer map.

## Fix and decisions

- **Uninstall on drop, re-arm on recycle** (`DisposeWithTheHost` is the "install something to uninstall
  the thing that observes" idiom — the uninstaller is only ever invoked by `setViewCompositionStrategy`).
  `disposeComposition()` first, then the uninstall: the setter wants no composition in flight, and a
  guard is worthless once the composition is gone.
- **Rejected: `DisposeOnDetachedFromWindowOrReleasedFromPool`** (Compose's default, and what Expo's
  per-control host uses). It disposes on *detach*, and RN detaches a mounted view for screen
  transitions, `removeClippedSubviews` and the pool — `docs/architecture/core.md` §6 exists because of
  that. It would also have thrown away the composition on every screen transition.
- **Rejected: a strategy that keeps only a `WeakReference` to the view.** It stops retaining the host
  but keeps one observer in the activity's observer map per mount forever (~150 B/mount, unbounded),
  and a strategy whose job is to dispose a view on activity destroy has to be able to reach that view.
  Uninstalling is both smaller and correct.
- **`prepareForRecycle()` re-arms** because `drop()` is also the front door of recycling
  (`docs/architecture/core.md` §6): a pooled host must not come back without its guard. With
  `enableViewRecycling` off — the RN 0.88 default — that call site never runs, so it is the one path in
  this change the on-device suite does not exercise (see Follow-ups).
- **`armCompositionStrategy()` refuses a `DESTROYED` owner.** Compose's `installForLifecycle`
  *throws* on one, and the new `prepareForRecycle()` call site can run while an activity is tearing
  down (RN drops views as a surface stops), so the guard is cheaper than the exception it prevents —
  and a guard for a dead activity is worth nothing. `init` had the same assumption and now shares the
  check.
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

| Cell (android, switch) | pre-fix | post-fix |
| --- | --- | --- |
| `mount N=200` | **`no end sentinel within 180s`** (the OOM; Expo's arm: 141.27 ms) | **54.93 ms presented / 44.62 ms mounted**, 4/4 launches |
| `mount N=50` | 88.63 ms presented | 32.81 ms presented |
| `mount N=1` | 36.54 ms presented | 32.69 ms presented |
| `update N=50` | 25.76 ms presented | 27.98 ms presented |
| `memory N=200` | 131.9 KiB/instance | 141.8 KiB/instance (Expo 156.4) |
| `leak N=200` | **16.5 MiB/cycle, MONOTONIC — gated as a leak** | 764.4 KiB/cycle, not monotonic — not gated (Expo 359.0) |

**Can `--plan full` on Android now complete?** For `switch` (this run: 7 cells × 1 implementation ×
4 launches) it does: `problems: none`, so the three `mount.<component>:nitro-ui:200` OOMs A1 hit are
gone and the leak gate no longer fires. The full *plan* is all five components (~1120 launches); Slider
and Button failed the same cell for the same reason — the same `NitroComposeHost` — and are not
re-run here. A1's other blocker for minting a baseline is unchanged and not ours: a quiet machine.

## Follow-ups

- Residual leak slope 764.4 KiB/cycle post-fix vs Expo's 359.0 KiB/cycle (non-monotonic, not gated):
  worth one attribution pass before a baseline is minted, in a task that owns the bench.
- The `prepareForRecycle()` re-arm is dead code while `enableViewRecycling` is off; T02's measurement
  with the flag on should cover it (`docs/architecture/core.md` §6).
- The bench runner still reports a dead app as `no end sentinel within 180s` (already A1's follow-up).
- `memory N=200` reads 131.9 → 141.8 KiB/instance across runs whose launch counts differ (1 vs 4) on a
  busy machine; reported, not gated.

## Questions for orchestrator

1. **One iOS harness run for `example/__tests__/MountChurn.harness.tsx`.** AGENTS.md wants every
   harness file run on both platforms; iPhone 17 is P1's, so I did not run it and there are no shared
   TS/C++ changes in this task (`git show --stat` is Kotlin + docs + Android example + the harness file).
   What I verified instead: the file's iOS branch registers one `it.skip` and no gate, a pending-only
   suite exits 0 and a zero-test suite exits 1 (both measured on Android, where the failure mode is
   identical), and `bun run check` typechecks the file. A one-line `bun harness:ios` confirmation would
   close it.
2. Should `Slider`/`Button` get the same N=200 bench confirmation before A1's baseline attempt is
   retried? The fix is in their shared host, so I expect both to pass; it is a ~15-minute run.
