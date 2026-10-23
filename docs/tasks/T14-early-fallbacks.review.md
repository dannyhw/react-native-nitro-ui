# T14 — Register declared fallbacks before the first measure: review

**Branch:** `task/T14-early-fallbacks` @ `99cb543` (from `main` `19025b1`). Diff: `git diff 19025b1..HEAD`.
**Gate run by the reviewer:** `bun run check`: **green** (`CHECK_EXIT=0`, ending `package-files: tarball matches … (205 files)`). No simulators or emulators were used. Harness claims were checked by reading the code, not by running them.

## Verdict: MERGE-AFTER-SMALL-FIXES

The native fix is correct and safe on both platforms. Three small fixes are needed. All three touch only tests or docs, so under D19 they merge on green gates with no re-review:

1. **The cold Switch's declared-size assertion can never run.** See `example/__tests__/ColdSizing.harness.tsx:379` and `:410-416`.
   - `coldProcessStats()` is called again in test 3. By then tests 1–2 have already measured two Sliders, and `measurements` is a process-wide running total that never resets (`cpp/NitroUiSizingEngine.cpp:369`). So `coldStart.measurements === 0` is false in every invocation, `harness:cold:*` included.
   - The Switch therefore never has to show "frame 1 = the declared box", which is what the brief's acceptance criteria ask for. Only the weaker "> 0" check at `:408` runs.
   - That check still goes red on `main`, so the red/green table stands.
   - Fix: record coldness once, at module scope or in test 1 before anything mounts, and use that value in both cold tests. This is sound because nothing earlier in the file touches the Switch's fallback.
   - Then correct the matching claims: the file header (`:30-33`) and the report (`T14-early-fallbacks.report.md:127`: "the two cold tests assert the full claim").
   - Re-run `harness:cold:ios` and `harness:cold:android` once each.
2. **The Modal analysis states an unproven cause as fact.**
   - Where: report `:196` ("Android's pre-draw cancellation did not suppress the stale frame") and `docs/tasks/FOLLOWUPS.md:13` ("pre-draw cancellation does not cover RN's second window").
   - The first-frame watcher records `drew` only when `NitroUiSizing.hasPendingReports()` is false (`android/.../core/NitroComposeHost.kt:415-420`). So at the frame that was drawn there was no queued report, and nothing for a pre-draw cancellation to cancel.
   - What the trace actually shows: the report arrived after the dialog's first draw, and no later pre-draw flushed it.
   - Reword both places as that observation and leave the cause as an open question.
3. **The proposed D17 wording overclaims** (report `:142` / `:151`).
   - The text "a cold first `intrinsic` instance its declared box, which on both platforms today *is* the control" is false for iOS 26+ apps that set `UIDesignRequiresCompatibility`. Those apps get 61×28 laid over a 51×31 control and one correction, as `docs/architecture/sizing.md:438` already says.
   - Add that exception to the proposed wording.

## Findings by question

**1. iOS `+load` (`ios/core/NitroUiDeclaredFallbacksLoader.m:25-27`) is safe.**
- **ObjC/Swift runtime.** The ObjC runtime is up, because `+load` is called by libobjc itself. The Swift runtime is up too: libswiftCore is a dependency image, so it initialises first and has already registered this image.
- **The Swift path is minimal.** It is a `@_cdecl` free function → `swift_once` statics → `ProcessInfo.operatingSystemVersion` (Foundation; fine before `main`). There are no dynamic casts or conformance lookups, and no UIKit or main-queue calls.
- **C++ static init order.** dyld runs `+load` before the C++ static initialisers of the same image, and with static linkage that image is the whole app. But the code path touches only `NitroUiSizingEngine::shared()`, a leaked pointer in a function-local static (`cpp/NitroUiSizingEngine.cpp:152`), plus constexpr constants. There are no namespace-scope dynamic initialisers anywhere in `cpp/NitroUiSizingEngine.*`, so the order does not matter.
- **The lock and the guesses.** `setFallback` takes the lock and calls `dropGuessesForLocked`, which does nothing on an empty engine.
- **Linkage.** C linkage matches: the caller is a `.m` with `extern void …(void)`, and the callee is a `@_cdecl`.
- **The OS check.** The check at `HybridNitroUiSwitch.swift:132` is the same one `main` ran in `init`, so it gives the same number at load time.
- **Static libraries / static frameworks / Expo prebuild.** All of these are CocoaPods builds, and CocoaPods adds `-ObjC`; the example confirms it (`Pods-NitroUiExample.debug.xcconfig`: `OTHER_LDFLAGS = … -ObjC`). `-ObjC` pulls the `.m` object in, and the `.m` references the Swift symbol.
- **Dynamic frameworks (`use_frameworks!`).** The whole framework is loaded and its `+load` runs before `main`.
- **Dead-stripping.** ObjC classes and `+load` survive `-dead_strip`. This is exactly the mechanism the generated `HybridNitroUiSwitchComponent.mm:43` `+load` already depends on, so if it were stripped, the library would not register its components at all.
- **Podspec.** It globs `ios/**/*.{m,mm}`. No new risk.

**2. The Android companion `init` (`NitroUiPackage.kt:46-54`) is fine.**
- **When it runs.** Kotlin puts the companion's `init` in `NitroUiPackage.<clinit>`, which runs when `PackageList` constructs the package. That happens when the ReactHost/ReactNativeHost is built, and therefore before any JS, render or measure. This holds for both the RN CLI and Expo: Expo's `ReactNativeHostWrapper` still takes `PackageList(this).packages`.
- **`BaseReactPackage` laziness.** It defers *modules* (`getModule`), not construction of the package object, so it does not change this.
- **Thread-safety.** JVM class init is run once, under a lock, and publishes its results safely. `initializeNative()` runs `System.loadLibrary`, whose `JNI_OnLoad` registers the `NitroUiSizing` natives (`android/src/main/cpp/cpp-adapter.cpp:43-58`) before `registerAll()` makes the JNI call.
- **The atomic.** `compareAndSet` before `setFallback` is fine. The `init` backstop can only run after a view is created, and that happens after the package's `<clinit>` has finished.
- **No deadlock.** There is no class-init cycle: `HybridNitroUiSwitch` and `HybridNitroUiSwitchSpec` never reference `NitroUiPackage`.
- **If the package class never loads before a measure.** Then `libnitroui.so`'s `JNI_OnLoad` never ran and the `nitroUiCore` HybridObject is not registered. JS fails on `nextSizingId()` before anything can render, so this case is not reachable in practice. The `init` backstop covers manual or partial setups at `main`'s old behaviour.

**3. D16/D17 semantics are preserved.**
- **Provisional until a report.** The startup path is the same `setFallback` as before (`cpp/NitroUiSizingEngine.cpp:443`). Fallbacks carry an empty key, so `measure` marks the instance inexact and queues it for correction (`:391-401`, `:428`).
- **Poisoned fallbacks are still corrected.** The poisoned tests assert this.
- **Environment bumps keep declarations.** `invalidateEnvironment` never touches `fallbacks_` (`:216-243`). Test 1 relies on this: it bumps the epoch before its first measure.
- **The backstop is harmless.** In `init` it is now a no-op because the static has already run. So it can no longer drop `guesses_` or overwrite seeded values after startup.

**4. OS-specific numbers (D14).**
- They are computed correctly at load time.
- iOS 26+ gives 61×28, older iOS gives 51×31, the Slider is 351×31, and Android gives 52×48 and 328×48. All are unchanged from `main`.
- `UIDesignRequiresCompatibility` is not considered. That is the same as `main`, it is provisional and gets corrected, and it is no regression (follow-up below).

**5. The cold tests do fail on `main`, and `1f6d0d8` is right.**
- **Slider on `main`.** The first measure hits a cache miss with no guess and no fallback, so `measure` returns `NitroUiMeasuredSize{}` and the trace records `laidOut 0×0`. That fails at `:305`.
- **Switch on `main`.** No Switch has been created in the process (only Sliders have), so the same thing happens and it fails at `:408`. This agrees with the reported 2 failed / 4.
- **The gap.** As fix 1 explains, the Switch's *declared-size* claim is not asserted anywhere.
- **The manifest fix.** `1f6d0d8` restores `lib/typescript/src/tsdoc-metadata.json`, which is on `main`'s list. The net manifest diff against `main` is exactly the three new native files, and `manifest:check` passes inside the reviewer's `bun run check`.

**6. The Modal flake is not a T14 bug, but it should be fixed before 0.1.**
- **It is not caused by T14.** That test seeds its own guess, so the startup table is never consulted.
- **Plausible mechanism, beyond the over-stated sub-claim in fix 2:** `scheduleSizingFlush` (`NitroComposeHost.kt:503-523`) adds a pre-draw listener but never requests a traversal (no `invalidate()` or `postOnAnimation`). So a report that lands after a window's last draw waits for an unrelated redraw. That matches `queued=1, flushes=0` in an idle dialog.
- **Why it matters for 0.1.** It is a potential stuck wrong size, not just a test-oracle problem. Today it is invisible only because the Switch and Slider fallbacks equal their real sizes. Button and SegmentedControl fallbacks will not.
- **Recommendation:** its own small task before G2 or G4 ship.

## Follow-ups (one line each)

- iOS Switch fallback could read `Bundle.main` `UIDesignRequiresCompatibility` at `+load` and declare 51×31 for those apps (`HybridNitroUiSwitch.swift:131-136`).
- Android `scheduleSizingFlush` should also request a traversal (e.g. `invalidate()`), so a late report in an idle window (a Modal) is applied. This should be fixed before Button/SegmentedControl ship.
- `ColdSizing.harness.tsx:370` restores the Slider fallback with Android's width, 328, on iOS too, where the declared width is 351.
- `Sizing.harness.tsx`'s new per-instance check uses `collectTrace(hasDrawnSample)`, which stops at *any* instance's `drew`. It could stop before this instance's `corrected` and become a new flake.
- `docs/architecture/core.md:295` cites `HybridNitroUiSwitch.swift:104-113`, but the code is now at `:131-136` (the reference was already stale on `main`).
- No harness or smoke run covered the new `+load` under `use_frameworks!` (dynamic/static) or Expo prebuild. Reasoned safe above; `smoke:expo` would confirm it.
- Startup cost of initialising the `HybridNitroUi*` Kotlin classes in `NitroUiPackage.<clinit>` was not measured (expected to be negligible).
