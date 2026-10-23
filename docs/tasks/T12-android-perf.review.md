# T12 — Android Compose host performance: review

**Branch** `task/T12-android-perf` @ `eff5c66`, rebased on `main` `26d335f`. The branch's own work is
`git diff main...HEAD` (21 files, +1647/−51). I reviewed it against the brief (including "Orchestrator
answers" and "Added scope"), the report, AGENTS.md, DECISIONS D9/D13/D15/D17, and
`docs/architecture/{sizing,core,benchmarks}.md`. No tracked file was edited.

## Verdict: **MERGE-AFTER-SMALL-FIXES**

The code is small, correct where it counts, and the measurements are mostly well done: the budget
plumbing is thread-safe and leaves iOS untouched, the library profile really is in the AAR and really is
merged and expanded into the bench APK, the bench priming lands on every arm identically, and the one
fail-demo I re-ran reproduces exactly. The ART-profile finding is the most useful result of the task.

What stops a plain MERGE is one small code defect (F1) and several documented claims that the code or
the framework contradicts (F2–F6). Four of those claims go into permanent docs (DECISIONS D17,
`core.md`, `sizing.md`, `benchmarks.md`) and would mislead the next task, and two would mislead the human
on the shared-composition decision. None needs new measurement, only rewording, and F1 is a few lines.

## Gate results (run by me)

| Gate | Command | Result |
| ---- | ------- | ------ |
| Full check | `bun run check` (in the worktree) | **pass**, `EXIT=0`: jest 109/109, `test:native` 172/172 plain and 172/172 ASan+UBSan, clock + handshake pass, perf:renders 1/1, nitrogen no drift, autolinking, bob, api-extractor, publint, package-files (154 files, includes `baseline-prof.txt`) |
| iOS build | `pod install` + `xcodebuild … -derivedDataPath build CODE_SIGNING_ALLOWED=NO build` | **BUILD SUCCEEDED** |
| iOS harness | `HARNESS_APP_PATH=…/Debug-iphonesimulator/NitroUiExample.app IOS_SIM_UDID=331EF109-21DD-422B-AEF8-DFFFC6998DC3 METRO_PORT=8295 bunx react-native-harness --harnessRunner ios` | **pass**, 33/33 ([details](#ios-harness)) |
| Fail-demo (native budget gate) | scratch copy of `cpp/` in `/tmp`, `applyReports` made to ignore its argument (`remaining = kImmediateBudgetPerTurn`), compiled with `sizing.test.cpp` | **5 of 172 FAILED**, the same five messages the report lists (`one correction was synchronous (got 2, want 1)` … `which means none synchronous (got 2, want 0)`); unmutated copy 172 pass. Reproduces P2e's row exactly. |
| Android harness | not run (optional) | The Android-only claims I could not check on a device are flagged as such below. |

## Claim-by-claim

### 1. H: Android immediate budget 2 → 1

**Correct.**

- **Thread safety:** nothing is "set". The budget is a per-call argument:
  `NitroUiSizing.kt:79` is a `const val`, passed to `nFlush(int)` (`NitroUiSizingJni.cpp:76-77,120`) and
  then down to `applyReports(reports, immediateBudget)` (`cpp/NitroUiSizingEngine.cpp:369-378`). There
  is no shared mutable state, so there is nothing to race. The JNI signature `(I)Z` matches the Kotlin
  `external fun nFlush(immediateBudget: Int): Boolean`.
- **Default when unset:** `flush()` forwards `kImmediateBudgetPerTurn` (2)
  (`NitroUiSizingEngine.cpp:365-367`). Negative input is clamped (`:581`).
- **iOS unchanged:** the only iOS caller is the run-loop observer at `NitroUiSizingEngine.cpp:90`, which
  calls `NitroUiSizing::flush()` with no argument, so the budget stays 2. No Swift file changed.
- **The numbers:** the arithmetic is right. Medians of 3 are 18.88 → 12.84 ms (−32%) and 42.51 → 26.77 ms
  (−37%), and all six pairs are lower. Doing one synchronous commit fewer per flush is a sound change on
  its own merits.

Two problems, both about how the numbers are written up (F2, F3). The in-code comments give a different
number from the report's headline. And the docs now explain `stale=0` with a cause that the shadow-node
code contradicts.

### 2. G / A / B

- **G (`ColorScheme` per process) is correct on theme switches.** The key is context identity, the
  `dark` flag from `isSystemInDarkTheme()` (Compose's `LocalConfiguration`) and the live
  `resources.configuration.uiMode` (`NitroComposeHost.kt:609-627`). On top of that,
  `onConfigurationChanged` drops the entry (`:545`). So a dark-mode toggle, an `Appearance.setColorScheme`
  (AppCompat night mode) or any other config change rebuilds it. On API 31+, a wallpaper/Monet change
  arrives as an asset-path config change: it either recreates the activity (new context, so a miss) or
  reaches `onConfigurationChanged` (invalidated). The "residual" the KDoc admits (`:592-597`) is real but
  narrow. The `@Volatile` single-entry publish is safe, and a racing double build is harmless.
  **But see F1: the entry holds the `Context` strongly.**
- **A (`SwitchColors` per scheme + tint) is correct.** The cache is keyed on scheme *identity*, and
  `adopt()` clears everything when the identity changes (`HybridNitroUiSwitch.kt:173-181`). Since G builds
  a new scheme on every dark/config change, A is invalidated whenever G is. It is bounded at 8 tints and
  synchronized. The early `return` from a `@Composable` is fine. Two of the stated reasons are wrong,
  though (F5).
- **B (library `baseline-prof.txt`) is correct, scoped and merged.** One wildcard rule,
  `HSPLcom/margelo/nitro/nitroui/**->**(**)**`, is valid HRF syntax.
  - **Packaged in the AAR:** `android/build/outputs/aar/react-native-nitro-ui-debug.aar` contains
    `baseline-prof.txt` (1538 bytes, the same file), and `etc/package-files.txt` lists it for npm.
  - **Merged into the bench APK:** line 26 of
    `bench/android/app/build/intermediates/merged_art_profile/release/…/baseline-prof.txt` is the rule.
  - **Expanded:** `expandReleaseArtProfileWildcards` turns it into 398 class+method lines, all under
    `com/margelo/nitro/nitroui`, with zero lines for any other package. After R8, 182 lines survive.
  - **Not just Switch-specific code:** the generated `Func_*`/`*_cxx` bridges are covered too, which is
    what the comment promises.

### 3. The ART-profile finding

- **Priming is applied identically to all arms.** `primeArtProfile` runs once, from `install()`
  (`scripts/bench/run.mjs:343-346`, called once at `:624`). Every arm is in the same APK, and every launch
  is `am start -S`, so all launches of all arms see the same compiled state. The finding itself (`verify`
  after install, after `bg-dexopt-job`, and after a pre-launch `-m speed-profile -f`) is well reasoned and
  well documented in `core.md` §13.
- **"Historical ratios stay comparable, absolutes don't" is wrong, and the report's own P1 table
  disproves it.** The same code, verify → speed-profile, moved the ratios against the shared host:
  mount presented 1.22x → 0.99x, memory 2.28x → 2.45x, update UI CPU 1.36x → 1.41x
  (report l.460-467). The arms gain unequally from compiled Compose/RN, so priming is a **regime change
  for ratios too**. Historical ratios are comparable only with other `verify`-regime runs.
  `benchmarks.md:122-123` makes this worse: *"what it can change is only the effect of a library's own
  `baseline-prof.txt`"*. P0 → P1 had no library profile at all (it was added in P2) and every ratio moved.
- **The mechanism in the report is also misstated** (report l.469-473: "our host view … interpreted,
  while `expo-ui`'s Compose code and `rn-core`'s Java were partly covered by the profiles their AARs
  ship"). In `verify` *nothing* is AOT-compiled, for any arm. In P1 our own classes were *still* not in
  any profile. And `@expo/ui` ships no profile: the merged profile has 0 `expo` lines. The likely reading
  is that once Compose and RN are compiled, the arm that runs more Compose framework code per op (N
  owners) gains the most. That is a regime effect, not "we were interpreted and they weren't".
- **What should change.** `benchmarks.md` §"Baselines and gating" already says *"a runtime change is a
  comparability break"*, and ART compile state is one:
  1. **`benchmarks.md`.** Replace l.122-123 with: priming changes every arm's absolutes *and* the ratios
     between arms. Runs before T12 (`verify`) and after are separate regimes, and neither absolutes nor
     ratios should be compared across the boundary. Add the ART status to the list of run metadata at
     l.272-275.
  2. **`scripts/bench/run.mjs:302-337`.** Persist the final ART status in the results JSON/MD; today it
     only goes to stdout, and `bench/results/ed620cb-…json` has no trace of it. Make
     `--update-baseline` refuse a run that is not `speed-profile`, the same way it refuses a busy machine.
     If the human prefers a follow-up for this, it should be the first one.
  3. **`docs/tasks/T02-bench.report.md`.** Add a dated note at the top of the Android round 3/4 results:
     "measured at ART `status=verify` (interpreter + JIT). Superseded for Android by T12 P1. These ratios
     compare only with other `verify` runs." The T12 brief's own "Why" (1.95× / 2.67× / 1.51×) carries
     the same caveat.
  4. **Report Outcome bullet 1 / follow-up 1** (l.13-17, l.689-690). Drop "(ratios stay comparable;
     absolutes do not)". Also make clear that "half the gap" is the gap in absolute ms: as a *ratio*, the
     mount UI CPU gap did not move with priming (1.40x → 1.42x).

### 4. Rejected options, checked against the sources

- **"RN commits one `StateUpdate` at a time" — confirmed.** `UIManager.cpp:406` is
  `UIManager::updateState`, which does a `shadowTree.commit` per update.
  `EventQueueProcessor::flushStateUpdates` loops `statePipe_(stateUpdate)` once per update
  (`EventQueueProcessor.cpp:132-136`). `EventQueue::enqueueStateUpdate(…, unstable_Immediate)` drains the
  whole queue synchronously (`EventQueue.cpp:64-83`). One nuance: "no caller uses `cloneMultiple`" is true
  for UIManager/Scheduler, but `animationbackend/AnimationBackend.cpp:193` and
  `AnimationBackendCommitHook.cpp:40` do use it, and they are the closest existing upstream precedent for
  a one-commit batch API. Worth one line in follow-up 4.
- **"`AbstractComposeView.onMeasure`/`onLayout` are `final`" — confirmed.** `javap` on
  `ui-android-1.11.4` gives `protected final void onMeasure(int, int)` and
  `protected final void onLayout(boolean, int, int, int, int)`.
- **"All-async breaks D17" — confirmed as far as the code goes.** At budget 0 no correction is
  synchronous and the frame is still cancelled, so the cold-control test must go red. I accept the
  report's harness evidence for that; it is consistent with the code.

### 5. D15 verdict and §P2f

The verdict table (report l.665-671) is honest on the miss: 1.35x mount UI CPU and 2.52x memory, stated
as misses, with `presented` called parity inside the noise floor. I recomputed the ratios from
`bench/results/ed620cb-android-20261023T055207Z.json` with `arm-ratios.mjs`: 1.01x / 1.35x / 0.59x, and
update 0.88x / 1.24x, all matching. Three things are stated less honestly than the table:

- **The "Plainly" paragraph** (l.683-685) credits "the contained fixes plus a one-line build change" with
  taking `presented` from 1.22x to parity. The build change is a *measurement* correction, not something a
  consumer gets. By the report's own P0/P1 rows, the library changes moved `presented` by ≈0 within
  noise. Say that.
- **Memory got worse over the task** (2.40x at `f99efb9` → 2.52x final, 130.2 → 134.2 KiB), and the
  verdict does not say so. It is within the ±4 % cross-build floor the report itself defines, which is
  the point: see F4 on G's memory claim.
- **B is undersold.** P2d says "every P1 → P2 delta here is inside the noise floor". By the floor the
  report defines at l.430-434 (UI CPU ±2 %), update UI CPU 6.02 → 5.58 ms (−7.3 %) and mount UI CPU
  9.16 → 8.92 ms (−2.6 %) are outside it. That is conservative, but it is inconsistent.

**§P2f is not sound enough for the human to decide on yet** (F6). It has two factual errors that
change the cost/benefit, and it leaves out the main feasibility constraint.

## Findings

### F1 (code, small): process-wide `ColorScheme` cache leaks the `Context`

`NitroComposeHost.kt:600-607,625`: `Entry.context` is a strong reference held by a process-wide
`object`. `LocalContext.current` in the host is the view's context, i.e. RN's `ThemedReactContext`,
whose base context is the `Activity`. After the activity is destroyed (back-press, reload, recreation),
the static keeps the destroyed `Activity` and its view hierarchy alive until some later control composes
with a different context, which may be never. LeakCanary would flag it. **Fix:** hold
`WeakReference<Context>` and compare `entry.context.get() === context`. Alternatively, clear the entry
when the last host detaches. The `ColorScheme` itself holds no context, so `SwitchColorsCache` is fine.

### F2 (docs, small): the H numbers in code comments contradict the report's headline

`NitroUiSizing.kt:73-76`, `NitroUiSizingEngine.hpp:~318-324` and `Sizing.harness.tsx:509,537` say
*"36.2-38.5 ms with two and 36.6 ms with one"*. `sizing.md:100` says *"37.99 ms vs 38.05 ms — noise"*,
with no indication of which number is which budget. Both read as "no measurable gain". The report says
−32 %/−37 %, and both are true of different rounds: round 1, the first batch in the process (the one the
committed test sits in), is 38.80 → 36.76 ms (−5 %) at 200 rows, and the median is driven by rounds 2-3.
**Fix:** use one set of numbers everywhere, e.g. "first batch in a process: −5 % at 200 / −28 % at 500;
median of 3: −32 % / −37 %", and cite the report table.

### F3 (docs, must fix before it becomes a rule): D17's new `stale=0` sentence asserts an unproven cause

DECISIONS `D17` (l.67-69), `sizing.md:103-107`, `NitroUiSizing.kt:67-71` and `Sizing.harness.tsx:505-508`
now say that at budget 1 a cold batch draws `stale=0` *"because the correction is shared by the
configuration … the other 199 ride the same commit"*. The code says otherwise:

- the synchronous push clones one family (`UIManager::updateState` → `cloneTree(*family, …)`);
- `IntrinsicShadowNode::shouldNewRevisionDirtyMeasurement` (`cpp/NitroUiIntrinsic.hpp:217-248`) only
  dirties a node whose own state or sizing props changed;
- so Yoga reuses the cached (wrong) measurement of the 99 untouched siblings in that commit.

T11 round 2 (S6) documented exactly that: "2 land in the cancelled frame, 198 arrive after it redraws".
The more likely reading of the measured `stale=0` is timing. The 99 asynchronous state updates commit on
the JS thread *while* the UI thread spends ~38 ms in the synchronous commit, and their mount runs in the
Choreographer callback before the next traversal. At budget 0 the flush is 0.09 ms, so there is no such
window, which gives `stale=100`. If that is right, budget 1 *shrinks* the window that budget 2 gave. A
bigger batch, a busy JS thread or a faster UI thread could then draw stale boxes. Nothing would notice,
because the batch test logs `stale` and does not assert it (`Sizing.harness.tsx:546-603`, by design).

**Fix (wording only, unless the implementer wants to prove the mechanism):**
- Revert D17's added clause to: "Android spends 1 (T12). The batch remainder may land after the cancelled
  frame, as before; T12 *measured* `stale=0` for a 100-instance batch on `nitroui_t02`, which is not
  gated."
- Make the same change in `sizing.md` §3 and the two code comments.
- Update the batch test's docblock (`Sizing.harness.tsx:548-563`), which still says "only
  `kImmediateBudgetPerTurn` (2) … false for the batch".
- Also, D17 is an orchestrator decision. The implementer amended its text, which should be the
  orchestrator's call.

### F4 (report, small): G's memory win is stated against the wrong noise floor

P2b (l.525) says −1.1 KiB "clears its noise floor" (±0.3 %). That floor is *within one build*, and A
(`990e66a`) → G (`77c4437`) is *across* builds, where the report's own floor is ±4 %. G is "measured ≈0,
kept on reasoning", like A and B. The reasoning is sound, so keep it, but the Outcome bullet (l.21) and
P2b should say ≈0.

### F5 (docs, small): `core.md` "Shared objects" rule has wrong names and a wrong reason

- `core.md:129` cites `colorSchemeFor` and `core.md:133` cites `switchColorsFor`. Neither exists: the code
  has `NitroUiColorSchemes.forContext` and `switchColors`. The report repeats `colorSchemeFor` (l.513).
  `core.md:133` also says the cache is keyed on "scheme identity and the appearance"; it is scheme
  identity and **tint**.
- `core.md:132` (and report l.487, l.275) says *"`SwitchColors` is a plain class, so Compose could not skip
  the `Switch` subtree"*. In the resolved Material 3 1.4.0, `SwitchColors` is `@Immutable` with
  `equals`/`hashCode` (`javap -v`), so a fresh-but-equal instance does not defeat skipping. The cost was
  only the allocation, which is consistent with A measuring ≈0. Since this is now a rule for future
  components, the reason must be right.
- Nit: `HybridNitroUiSwitch.kt:113` says the cache "cannot be a `remember`". A per-instance
  `val base = SwitchDefaults.colors(); remember(base, tint) { base.copy(checkedTrackColor = …) }` works,
  because `SwitchColors.copy` is public and non-composable in 1.4.0. The global cache is fine and slightly
  better across instances, but the comment's premise is wrong. Correct the sentence, and keep the code.
- Nit: the `flush(-4)` clamp test (`sizing.test.cpp`, last block) cannot fail. Without the clamp,
  `remaining > 0` is false anyway, so a negative budget already means none synchronous. Either drop it or
  call it documentation.

### F6 (report §P2f + D15 verdict): two factual errors and a missing constraint

1. **"N recomposers, N frame loops" is wrong** (P2f l.627, verdict l.681 "its own Compose composition,
   recomposer and native view tree", phase 1 §5 row 1). Every `AbstractComposeView` resolves its parent
   `CompositionContext` from the *window* recomposer, and `NitroComposeHost.kt:41-43` says so itself. All
   hosts in a window therefore already share one `Recomposer` and one frame clock. Per control, we pay one
   `Composition` (slot table) and one `AndroidComposeView` owner, with its LayoutNode root,
   measure/layout delegate, snapshot observer, semantics owner, accessibility delegate and per-view
   services. This matters for the decision because "one shared recomposer" is not on offer: it is already
   there.
2. **"`AbstractComposeView` does not expose a `CompositionContext` seam" is wrong** (l.637). Both
   `setParentCompositionContext(CompositionContext)` and `createComposition()` are public. More
   importantly, Compose UI 1.11.4 ships `ComposeViewContext` (public constructor
   `ComposeViewContext(View, CompositionContext, LifecycleOwner, SavedStateRegistryOwner,
   ViewModelStoreOwner)`) and `AbstractComposeView.createComposition(ComposeViewContext)`, annotated
   `@ExperimentalComposeViewContextApi`. That object holds exactly the per-owner services that are
   duplicated today: accessibility manager, clipboard, font loader/resolver, haptics, view configuration,
   shared draw scope, window info and the configuration state. It is the concrete "cheaper intermediate
   step" the orchestrator asked for, it keeps `core.md` §2's one-host-per-view contract, and P2f should
   name it, with its experimental status, as the thing to spike first. Follow-up 3 should be rewritten
   around it.
3. **The feasibility constraint the human most needs is missing.** "One Compose host per window
   rendering many controls" cannot render controls that sit inside RN `ScrollView`s, interleaved with RN
   views in z-order, under RN clipping, transforms or opacity, or in a `Modal` window. A single
   composition is one rectangle in one place in the view tree. The realistic structural option is
   Expo's: an explicit container (`<Host>`) whose children are nitro-ui-only. That is a **public API
   change and a change of product premise** (drop-in controls anywhere, which iOS already delivers below
   the Expo arms). P2f should say this, and should also cover:
   - what happens to T11's per-Fabric-node intrinsic sizing (it moves into Compose layout);
   - iOS/Android architectural divergence;
   - a rough effort size.

   As written, P2f presents a rewrite of the internals; it is really a rewrite of the API.

With F6 fixed, the recommendation is sound and I agree with it: do not build the shared composition for
0.1; accept the documented D15 miss on mount UI CPU and memory; spike `ComposeViewContext` sharing as the
next contained step.

## Small fixes, precisely

1. **F1:** `android/src/main/java/com/margelo/nitro/nitroui/core/NitroComposeHost.kt:600-627`: hold the
   context weakly (or clear on last detach).
2. **F2:** one consistent set of H numbers in `NitroUiSizing.kt:73-76`, `cpp/NitroUiSizingEngine.hpp`
   (the `flush(int32_t)` doc, ~l.318-324), `docs/architecture/sizing.md:96-101` and
   `example/__tests__/Sizing.harness.tsx:509,537`.
3. **F3:** reword the causal `stale=0` claim in `docs/DECISIONS.md` D17 (l.67-69),
   `docs/architecture/sizing.md:103-107`, `NitroUiSizing.kt:67-71` and `Sizing.harness.tsx:505-508`, and
   update the stale docblock at `Sizing.harness.tsx:548-563`. Get the D17 text approved by the
   orchestrator.
4. **ART regime:** `docs/architecture/benchmarks.md:122-123` (priming changes ratios too; the pre-T12
   Android results are a separate regime) and l.272-275 (record the ART status). Add a dated regime note
   to `docs/tasks/T02-bench.report.md` Android rounds 3/4. Fix report l.13-17, l.469-473, l.481-482 and
   follow-up 1.
5. **F5:** `docs/architecture/core.md:129,132-133` (real names; key is scheme + tint; drop the "plain
   class / could not skip" reason), report l.275, l.487, l.513, and `HybridNitroUiSwitch.kt:113`.
6. **F4 + D15 wording:** report l.21, l.525 (G ≈0 against the cross-build floor), l.592 (B: UI CPU deltas
   exceed the ±2 % floor), and l.683-685 (priming is a measurement correction; memory moved 2.40x →
   2.52x).
7. **F6:** report §P2f (l.624-645), the verdict sentence at l.681, and follow-up 3: shared window
   recomposer, `setParentCompositionContext` / `ComposeViewContext` (`@ExperimentalComposeViewContextApi`,
   Compose UI 1.11.4), and the interleaving/API-change constraint.

Recommended, can be a follow-up: persist the ART status in bench results and make `--update-baseline`
refuse a non-`speed-profile` run (`scripts/bench/run.mjs:302-337`).

## iOS harness

**Pass: 2 suites, 33/33 tests, 39.9 s, `EXIT=0`.** The run was on iPhone Air
`331EF109-21DD-422B-AEF8-DFFFC6998DC3`, `METRO_PORT=8295`, using a Debug build of this branch
(`pod install` + `xcodebuild` as in CONTRIBUTING). The harness booted the simulator and shut it down
afterwards, and no Metro process was left running. The shared C++ change (`flush(int32_t)` overload, iOS
still on `flush()` = 2) does not regress the iOS sizing suite. That includes the cold-batch
`immediate ≤ 2 × flushes` gate and the `lastFlushMs` < 40 ms bar. iPhone 17, `nitroui_t01`,
`emulator-5560` and the default adb server were not touched, and no emulator was started.
