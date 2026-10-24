# B1 — Android: OutOfMemoryError when mounting 200 controls repeatedly

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/B1` (branch `task/B1-android-mount-oom`, from `main`).
**Devices / env:** assigned in the delegation message. **Round cap (D19):** 1 + 2 fix rounds.

## Problem (A1 report, "Android")

In the bench `--plan full` Android run, every `mount.<component>:nitro-ui:200` cell for Switch, Slider
and Button dies with `java.lang.OutOfMemoryError` (192 MiB growth limit, `<1% of heap free after GC`)
at `AndroidComposeViewAccessibilityDelegateCompat.boundsUpdatesEventLoop`. Progress at N=200 finishes in
6.7 s. One mount of 200 controls is ~28 MB at the measured ~141 KiB/instance, so a 192 MiB heap
running out over repeated mount/unmount iterations points at **retention across iterations** (or an
accessibility-driven allocation storm), not a heap that is simply too small. A user app that mounts and
unmounts a long settings list repeatedly could hit the same thing.

## Scope

1. **Reproduce and attribute.** Run the mount N=200 loop for `nitro-ui` and, as the control,
   `expo-ui-host-per-control` (same Compose, one view per control) on the same AVD. Take heap dumps
   (`am dumpheap`) after iteration 1, 5 and 10; diff retained `AndroidComposeView` / `Composition` /
   `NitroComposeHost` / Hybrid View counts. Check whether an accessibility service is enabled on the
   AVD (`settings get secure enabled_accessibility_services`, `accessibility_enabled`; uiautomator from
   earlier runs can leave it on) and whether the OOM depends on it.
2. **Fix if it is ours** (e.g. a dropped/recycled host not disposing its composition, a listener or
   coroutine scope keeping the view, a static/cache holding views). Do **not** paper over it with
   `largeHeap` or by lowering N. If it is Compose's own behaviour that Expo's arm hits equally, show
   that and stop — that becomes a bench-config decision for the orchestrator.
3. **Regression test** (shown red before the fix): a harness test that mounts and unmounts a few
   hundred controls K times and asserts retained host/composition counts return to baseline (or the
   Java heap after GC stays within a bound), Android. Run the full Android harness and, if any shared
   TS/C++ changes, the iOS harness.
4. One `mount` N=200 run of the touched components with the bench (quick enough to prove no OOM).

Report: the attribution (with heap-dump numbers), the fix, red/green proof, and whether `--plan full`
on Android can now complete.
