# Review: B1, Android mount OOM (`task/B1-android-mount-oom` @ `e0efb23`, base `bc8fd7c`)

## Verdict: MERGE-AFTER-SMALL-FIXES

The root cause is right and verified in bytecode. The fix is right for the default path (recycling flag off),
which is the path the bench died on. Two must-fixes remain, both in `NitroComposeHost.kt`, so **the fix round
changes native code and needs a re-review under D19**:

- M1: the recycle-path re-arm puts the leak back for pooled views.
- M2: a pre-existing pre-draw listener leak of the same shape, which the new docs say does not exist.

The other required items are doc, test-comment and process fixes.

## Gate result

- `bun run check` in the B1 worktree: **PASS** (RC 0; typecheck, lint, Jest, native tests, nitrogen drift, api-extractor, publint, package files, README examples). `git status` empty, HEAD `e0efb23`. The tree was clean afterwards.
- On-device gates were not re-run (read-only review: no emulator, Metro or harness). The reported red and
  green numbers are self-consistent. The pre-fix first floor of 24.25 MiB matches the post-fix floor of
  ~7.9 MiB plus two leaked cycles (warm-up + cycle 0) of 8.18 MiB each, which is 24.26 MiB. So the red run
  measured this leak and not noise.
- Gate design is sound:
  - It measures the post-GC Java heap floor. ART's explicit `System.gc()` is a blocking collection, and the
    probe runs it twice with finalisation.
  - It is independent of the implementation, so it is not tautological, and it asserts warm cycles
    (0 corrections).
  - The bound of 2 MiB/cycle sits about 4x under the bug and about 15x over the observed noise (±0.13 MiB).
  - It only sees leaks of roughly 10 KiB/control or more, and it never exercises the recycle path (flag off).
- **The iOS harness run is missing.** AGENTS.md says "Any change to a harness test file must be run on both
  platforms before you report". `MountChurn.harness.tsx` was never run on iOS. The `it.skip` pattern itself
  is acceptable: it is visible, honest, and the report measured that a zero-test suite fails. But it needs
  one `bun harness:ios` run (filtered to MountChurn) before merge. No code change is expected.

## 1. Root cause: confirmed

Bytecode checked with `javap -c` on both `ui-android` AARs in `~/.gradle/caches`:

- **1.11.4** is what the library's BOM `2026.06.01` pins and what the example/harness app links
  (`example/android/app/build/outputs/logs/manifest-merger-debug-report.txt`).
- **1.12.1** is what the bench app links (`bench/android/app/build/outputs/logs/manifest-merger-release-report.txt`,
  pulled up by Expo).

What both versions do (identical in the relevant methods):

- `AbstractComposeView.disposeViewCompositionStrategy` is written only in the constructor (the default
  strategy) and in `setViewCompositionStrategy`.
- `setViewCompositionStrategy` invokes the previous uninstaller and then calls `installFor(this)`.
- `disposeComposition()` only calls `removeConnectionToComposeViewContext`, `composition.dispose()`,
  `composition = null` and `requestLayout()`. Neither it nor `onAttachedToWindow`/`attachedToWindow` touches
  the strategy.
- `installForLifecycle` throws `IllegalStateException` on a DESTROYED lifecycle. Otherwise it calls
  `addObserver(observer)` and returns `{ removeObserver }`, and the observer calls `view.disposeComposition()`
  on `ON_DESTROY`.
- In lifecycle-runtime 2.9.4, `LifecycleRegistry.observerMap` is a strong `FastSafeIterableMap`, and
  `add/removeObserver` enforce the main thread.

So "activity → registry → observer → ComposeContent → host, one per mount" is exact.

Independent corroboration: Expo has the same bug and fixes it the same way. `expo-modules-core` 58.0.24,
`android/src/compose/expo/modules/kotlin/views/ExpoComposeView.kt:253` installs
`DisposeOnLifecycleDestroyed(activity.lifecycle)`, and `:275-289` (`disposeHostedComposition`) swaps the
strategy on unmount, with the comment "disposeComposition() alone leaves the composition strategy's lifecycle
observer registered on the Activity, which leaks this view."

## 2. Lifecycle paths

| Path | Result |
| --- | --- |
| Normal drop (flag off) | Correct. Dispose, then uninstall; nothing is left in the registry. Main thread (Fabric `@UiThread`). |
| Host never composed / preallocated then deleted | Correct. Dispose is a no-op and the uninstall still removes the observer. |
| Re-attach after detach without drop (Modal, reparenting, screens, `removeClippedSubviews`) | Unchanged. The strategy stays armed and the composition survives detach, as before. |
| Activity destroyed before drop | Correct. `ON_DESTROY` disposes, then `drop()` re-disposes (null-safe, pre-existing) and `removeObserver` on a DESTROYED registry is legal. The new DESTROYED guard prevents the `installFor` throw on a later re-arm. `LifecycleRegistry` sets `DESTROYED` before dispatching `ON_DESTROY`, so the guard also holds mid-dispatch. |
| Config change (RN handles it in place) | No lifecycle effect. If the activity is recreated, the old hosts get `ON_DESTROY`, then drop. Fine. |
| Recycling (`enableViewRecycling` on) | **Wrong, see M1.** |
| Dispose of an on-screen composition? | The uninstall never disposes anything. `drop()` disposing immediately is pre-existing (see non-blocking N4). |
| Double-dispose / use-after-dispose | None introduced. |

## Must-fix

### M1: `prepareForRecycle()` re-arms a view that is going into an unbounded pool RN evicts silently, so the leak returns (native)

**Where:** `android/src/main/java/com/margelo/nitro/nitroui/core/NitroComposeHost.kt:283-287`

**Failure scenario:**

1. The app turns on `enableViewRecycling`.
2. Every unmounted Switch goes through `onDropView → drop()` (unarm), then `prepareToRecycleView →
   prepareForRecycle()` (re-arm). It is pushed onto `ViewManager.mRecyclableViews`, an unbounded `Stack` per
   surface (`node_modules/react-native/ReactAndroid/.../uimanager/ViewManager.java:264-273`). Each pooled host
   is now back in the activity's `LifecycleRegistry` with no composition to guard.
3. RN drops the pool without telling any view:
   - `trimMemory()` replaces the map "with even slight memory pressure" (`:473-479`);
   - `onSurfaceStopped()` removes the surface's stack (`:467-471`).
4. Every evicted host stays retained by the activity, about 42 KiB each (the leak this task fixes). Under
   memory pressure, the worst possible moment.

The report's reason for the re-arm ("a pooled host must not come back without its guard") is right about
*reuse*, but it arms at *pool entry*.

**Fix:** arm when the host is about to compose, not when it is pooled:

- add a `strategyArmed` flag, set by `armCompositionStrategy()` and cleared by `unarmCompositionStrategy()`;
- call `if (!strategyArmed) armCompositionStrategy()` at the top of `NitroComposeHost.onAttachedToWindow()`,
  before `super`, because the child's `AbstractComposeView.attachedToWindow` creates the composition;
- remove the call from `prepareForRecycle()`;
- keep the `init` call, or drop it, since attach-time arming covers it.

A pooled host then holds no registration, and a reused one is armed before it composes. Update core.md §6 /
§6 checklist and the report accordingly. The path is untestable on-device with the flag off. Say so; do not
claim it is covered.

### M2: pre-draw listeners outlive a host that detaches before its first pre-draw: same retention shape, pre-existing, contradicted by the new docs (native)

**Where:**

- `NitroComposeHost.kt:540-546`: `watchForFirstFrame`'s `unregister()`.
- `NitroComposeHost.kt:638-643`: `scheduleSizingFlush`'s listener.
- `NitroComposeHost.kt:623-625`: a comment that states the opposite of what happens.

**Mechanism:**

- Both listeners are registered while attached, so they land on the **window's** `ViewTreeObserver`.
- Both remove themselves via the host's *current* `viewTreeObserver`.
- After a detach, `View.getViewTreeObserver()` returns a fresh floating observer that is alive, so
  `removeOnPreDrawListener` is a no-op on the wrong observer.
- The window observer keeps the anonymous listener, and the listener keeps the host (and with it
  `ComposeContent` and `AndroidComposeView`) for the life of the window.
- It also runs on every frame. The first-frame listener re-marks `firstFrame` and calls `recordDrawnSize`
  every frame forever.

**When it triggers:** a host that is detached before the window's next pre-draw. Examples:

- mount and unmount within one frame;
- JS mounting/unmounting while the activity is stopped and not traversing;
- the first-frame listener deliberately staying registered while `NitroUiSizing.hasPendingReports()`, then
  the row being removed (FlatList windowing during a fast scroll).

The B1 churn gate settles 300 ms before unmount, so it cannot see this. The report's dump (listeners
"unreachable") is consistent with that and does not disprove it.

**Why must-fix here:**

- It is the same class as the task: per-mount retention via a registration held by something longer-lived.
- The brief lists "a listener … keeping the view".
- The new core.md text (`docs/architecture/core.md:284-285`: "A host that is dropped and never reused then
  holds no registration anywhere") and the report ("The strategy registration is the only per-mount thing
  that did not [free]") are false as written.

**Fix (~10 lines):**

- capture the observer at registration (`val observer = viewTreeObserver`) and remove from *that* one when it
  is alive, falling back to the current one;
- keep both listeners in fields and remove them in `drop()` as well;
- fix the `:623-625` comment.

**Gate:** if a cheap red/green is possible, add a churn variant that unmounts before the first draw. If not,
say so and note it as untested.

If the orchestrator would rather not widen B1, the minimum is:

- correct core.md:284-285, the KDoc and the report claim;
- file M2 as its own task, not a one-line follow-up, since it is a correctness leak.

## Non-blocking (one line each)

- N1: core.md:274 and the report say "1.12.1 … verified against the linked bytecode". The harness/example app
  links **1.11.4** (BOM `2026.06.01`) and only the bench links 1.12.1. The behaviour is identical in both;
  name both versions.
- N2: core.md line refs are off by a few: drop `:323-330` (not `:321-328`), prepareForRecycle `:282-298`,
  arm/unarm `:344-369`, `DisposeWithTheHost` `:923-925` (not `:914-916`). "~43 KiB" (core.md:278) vs "~42 KiB"
  elsewhere.
- N3: `NitroComposeHost.kt:335-338`: "`DisposeOnViewTreeLifecycleDestroyed` … is the same activity anyway" is
  not true under react-native-screens, where the view-tree owner is the screen fragment (Expo's comment at
  `ExpoComposeView.kt:241-248`). Reword.
- N4 (follow-up, pre-existing): `drop()` disposes even while the view is still attached. react-native-screens
  drops views during a pop transition (expo/expo#47086), which blanks the control mid-animation. Expo defers
  via `DisposeOnDetachedFromWindow` when attached.
- N5 (follow-up hardening): after `drop()` the host can still build a fresh, now unguarded composition if
  anything measures it while attached (e.g. `stopSurface` drops views before the root is removed). RN parents
  do not measure children, so this is unlikely. A `dropped` flag that makes `onMeasure`/`onLayout` decline
  until `prepareForRecycle` would close it.
- N6: `MountChurn.harness.tsx:24-25` says "the suite registers no test there", but the file registers a
  pending `it.skip` on iOS. Fix the header.
- N7: `MountChurn.harness.tsx:51`: "Two MiB per cycle is 12x below the bug". It is about 4x (8.18 / 2); the
  report says 4x.
- N8: `MountChurn.harness.tsx:7`: "~84 KiB of the ~132 KiB" is the bench's 16.5 MiB/cycle slope. The gate
  itself measured ~42 KiB/control, and the 2x gap between the bench slope and the gate is unexplained. Cite
  which number, or explain.
- N9: the probe is legacy `@ReactMethod` via the bridgeless interop. That is fine for example-only
  instrumentation and is not reachable from the published package.

## Report claims to correct

1. **Expo control:** "Expo's host uses Compose's default strategy — attach-state listeners, held by the view"
   and "`DisposeOnDetachedFromWindowOrReleasedFromPool` (… what Expo's per-control host uses)" are **false**
   for the linked `expo-modules-core` 58.0.24. Expo's `Host` (`@expo/ui` `HostView` →
   `ExpoComposeView(withHostingView = true)`) installs `DisposeOnLifecycleDestroyed(activity.lifecycle)`, the
   same as ours, and does not leak because `disposeHostedComposition()` swaps the strategy on unmount. This
   strengthens the attribution but replaces the stated reason.
2. "Verified against the linked artifact (`ui-android:1.12.1`)": the gate ran against 1.11.4 (see N1).
3. "The strategy registration is the only per-mount thing that did not [free]": true for the measured churn
   only. False in general (M2).
4. "`prepareForRecycle()` re-arms because … a pooled host must not come back without its guard": the
   rationale is fine, but the placement leaks (M1).
5. Bench table: "(Expo 359.0)" in the post-fix column is the **pre-fix** run's Expo number (1 launch, load
   12.6), and the post-fix run is `--only nitro-ui` (4 launches, load 6.8). Label the 764 vs 359 KiB/cycle
   comparison as cross-run. The "~47x" (16.5 MiB vs 359 KiB) is arithmetically right and same-run.
6. An intermediate run, `bench/results/bc8fd7c-dirty-android-20261024T183944Z.*` (dirty tree, load 21), also
   OOM'd at `mount:nitro-ui:200` and also shows 16.5 MiB/cycle. The report does not mention it. Say what build
   it was (diagnostic or pre-fix).
7. The bench numbers quoted (no end sentinel → 54.93 ms presented / 44.62 ms mounted with 4/4 launches;
   16.5 MiB → 764.4 KiB/cycle; memory 131.9 → 141.8 KiB/instance; `problems: none`) match the result files.
   The heap-dump table (1300/1300/1300) and the accessibility-settings claim could not be checked: no dump or
   adb access in this review. They are consistent with the arithmetic (13 × 100).
8. "Fix (10 lines)": about 25 lines of code plus KDoc. Cosmetic.

## Does any must-fix change native code?

**Yes.** M1 and M2 both change `android/src/main/java/com/margelo/nitro/nitroui/core/NitroComposeHost.kt`, so
under D19 the fix round needs an Opus re-review. If M2 is split out per the orchestrator's call, M1 alone
still touches native code. The doc, test-comment and iOS-run items do not.
