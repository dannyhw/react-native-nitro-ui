# G3 — Progress: review (D19 full review)

Branch `task/G3-progress` @ `7928021`. `main` has moved to `d9ad897`, but it only gained docs
(D21, the R1 brief, FOLLOWUPS/STATUS), so the branch's own work is `git diff main...HEAD`
(= `52823a9...HEAD`, 61 files). No devices were used. The review is from the code, the four
screenshots and the committed bench results.

## Verdict: **MERGE-AFTER-SMALL-FIXES**

There are two native correctness bugs (F1, F2). Each fix is a line or two, but F1 touches Kotlin
and F2 changes how the wrapper hands out sizing ids, so D19 calls for a re-review after the fix
round. The rest of the list is docs, report and test corrections.

## Gates

`bun run check` is **green** on `7928021`, all 13 steps (exit 0):
- jest 118/118 in 8 suites;
- `test:native` 262 checks;
- `perf:renders` 4/4 with no redundant renders;
- nitrogen drift, autolinking, `bob build`, api-extractor and `publint --strict` all clean;
- manifest 290 files.

The tree was clean before and after the run.

## Must fix (fix round 1)

### F1. Android: a linear bar does not fill its box (correctness)

**Where:** `android/.../HybridNitroUiProgress.kt:294` and `:296-301`. Both
`LinearProgressIndicator` calls get only `modifier = semantics`.

**Why it happens:**
- M3's own default modifier is `size(240.dp, 4.dp)`.
- The `fillWidth` question sets `minWidth = 0` (`NitroComposeHost.kt:816-817`).
- So the indicator measures at `min(240 dp, box)` and is centred in the box (`:844`).

**Evidence:** `docs/tasks/G3-progress/android-light.png`. Every default-width bar ("60 Hz",
Indeterminate, Determinate, Tinted) is ≈240 dp wide and centred in a ≈378 dp content column.
iOS fills the full width. The 180 dp "caller's box" bar looks right only because 180 < 240.

**False claims this makes:** `docs/components/progress.md:77-79` and `:97` say "width = the box".

**Why no test caught it:** `example/__tests__/Progress.harness.tsx:290-292` asserts the **Yoga**
box width (300) and the *measured height*. It never checks the measured width. On Android that
width is the placeable's, which is 240.

**Fix:**
- Add `Modifier.fillMaxWidth()` to both linear branches. With an unbounded width, `fillMaxWidth`
  is a no-op, so the `else` arm keeps M3's 240 dp.
- Add `expect(Math.abs(linearMeasured.width - 300)).toBeLessThan(1)` to the first test. It should
  go red on current Android and green after the fix. Run it on both platforms.

### F2. A `variant` change reuses the sizing id, and the dropped view's `forget` wipes the new mount's ledger (correctness, high confidence from reading the code; the test below decides)

**The setup:** `Progress.tsx:157` takes one `useSizingId()` per wrapper. `:171` then keys the
*native* view on the variant, and `:182` sends the same `nuiSizingId` to the new view.

**The order of events on a variant change:**
1. The commit lays out first. The new shadow node's `measure` files a ledger entry for id X
   under the new key.
2. The mount runs afterwards, and Fabric orders **Delete before Create**
   (`node_modules/react-native/ReactCommon/react/renderer/mounting/Differentiator.cpp:1342-1346`).
3. Delete reaches `onDropView → host.drop() → releaseSizingInstance() → NitroUiSizing.forget(X)`
   (`ios/core/NitroSwiftUIHost.swift:327-331`, `:346`; `android/.../NitroComposeHost.kt:303-306`,
   `:317-327`).
4. `forgetLocked` erases `ledger_[X]` and `pending_` (`cpp/NitroUiSizingEngine.cpp:303-315`).
5. The new host then reports, and `report()` returns early with "nothing ever laid out"
   (`:512-518`).

**Effect:** when the new configuration is not exact in the cache, nothing ever corrects it. The
box stays at the guess, or at the component's linear-shaped `320×4` `fillWidth` fallback, so a
ring sits in a full-width, 4 pt box. D17 allows that for one frame; here it stays.

**Why the suite stays green:** `re-measures when the variant changes` (`:609`) runs warm. The
`beforeAll` (F6) and the first test have already made `'circular'` exact.

**Fix:**
- Give each native mount its own id, e.g. `useMemo(() => nitroUiCore.nextSizingId(), [variant])`,
  or move the `key` onto an inner component that calls `useSizingId()`.
- Prove it with the poison recipe from `:478-491`:
  1. Run `seedSizingSize(COMPONENT, CIRCULAR_KEY, 137, 23)`, then `invalidateSizingEnvironment()`.
  2. Mount a linear bar and `rerender` it as circular.
  3. Poll until the box equals `measureContent()`.

  The prediction is red today (stuck at 137×23) and green with the fix. If it is green today on
  both platforms, drop F2 and keep the test.

### F3. iOS draws `variant="circular"` with a value as an indeterminate spinner (false claims and an undocumented limit)

**Evidence:** `ios-light.png` and `ios-dark.png`. The Determinate row (`value` 0.2 and 0.65) and
the Tinted ring (0.45) are spinners, identical to the indeterminate one. That is SwiftUI's
`.circular` style on iOS.

**What follows:**
- **The API docs are wrong for iOS.** `progress.md:12-14`, the mapping table (`:60-66`), the
  `value` doc in `Progress.tsx:34-48` and `Progress.nitro.ts:35-41` all present a determinate ring
  on both platforms. Only VoiceOver gets the value (`accessibilityValue` "45%").
- **The animation mirror is wrong on iOS.** `nuiTestIsAnimating()` answers `false` for a visibly
  spinning control. So report `:21-27` ("the mirror cannot disagree with the pixels") is false on
  iOS.
- **The off-window gate does nothing for a circular on iOS.** The gate swaps a spinner for a
  spinner (`HybridNitroUiProgress.swift:72-83`, `progress.md:143-146`, "the one determinate state
  that needs no motion").
- **iOS indeterminate linear may not animate either.** It shows as an empty track, identical to
  `value={0}`, in both screenshots (Indeterminate row vs the first Determinate bar). Check whether
  it animates and say which it is.

**Fix (docs only):**
- Add an iOS limit to `progress.md` Limits and the mapping table: the circular style is
  indeterminate-looking on iOS, and the value reaches assistive tech only. Add the linear
  indeterminate finding as well.
- Correct the `value` JSDoc on both files.
- Correct the report's gate and mirror claims.

A determinate ring on iOS (`Gauge` or a custom style) is a follow-up, not this round.

### F4. Bench claims the runner does not support (false claims)

**(a) Android update UI CPU "0.09×" is an artefact, not a win.**

- `@expo/ui`'s update writes a shared-object state, so there is no Fabric transaction
  (`missingMount=80` in both expo cells).
- `update.progress:expo-ui-*` still declares `mountSignal: true`; only `rn-core` is in
  `NO_MOUNT_SIGNAL` (`bench/src/plan.ts`).
- So every measured iteration waits out `awaitMountNs(1500)` + `awaitPresentedNs(2000)`
  (`bench/src/probe.ts:41`, `:52`) **inside** the CPU bracket (`bench/src/runner.ts:66-68`,
  `:332-334`).
- The result: expo's 59.9 / 70.7 ms UI CPU/op is spread over about 3.5 s of wall time. Nitro's
  6.27 ms is over about 50 ms. The two arms also draw different things (M3 expressive
  `LoadingIndicator` vs a linear bar).
- **Fix:** retract the comparison, at report `:179-181` ("an 11× gap is far outside that noise")
  and `:201-203` ("Update path: wins … Android UI CPU 0.09×"). Say the Android update cells are
  not comparable, and add a follow-up (below).

**(b) "Run A mount mounted: verdictable (both cells clean) → MISS" is wrong.**

- This claim is at report `:156` and `:196-197`.
- The run A nitro mount cell carries `presentedBeforeMount=25`
  (`bench/results/b734ed6-dirty-ios-20261023T204649Z.md:108`). The brief says no verdict on such
  a cell, and the report itself calls that latency pair probe-suspect at `:195`.
- **Fix:** mark it as not verdictable. `mounted` is not a D15 target metric anyway.

The other verdicts follow the runner's rules:
- iOS update mounted PASS (run A update cells clean);
- memory MISS on both platforms (all cells clean);
- the iOS presented tie.

### F5. `commits once per update at 60 Hz` cannot fail on the claim it makes (test / false claim)

`Progress.harness.tsx:910` asserts `applied.length >= updates`, but `progress.md:166-169` and the
report say 20 writes cost exactly 20 `propsApplied` marks. A wrapper or native path that commits
twice per update passes.

**Fix:**
- After the 20 updates, settle and assert `toBe(updates)`. Updates are 1.00 per instance on both
  platforms (core.md §3).
- Show it red, e.g. with a JS-only mutation: a wrapper effect that re-sends a changed internal
  prop once per render.
- Run it on both platforms.

### F6. A suite-local `beforeAll` warm-up, which the brief bans (brief violation that hides F2)

`Progress.harness.tsx:237-250` is exactly what the brief's Lessons forbid ("no suite-local
`beforeAll` warm-ups"). It also pre-warms the circular configuration, which is why F2 is
invisible.

**Fix:** remove it, and give the first test its own `{ timeout }` the way `mounts many instances`
does. Run on both platforms.

### F7. Report and doc wording (false claims)

- **Report `:114`** says `mounts many instances at once` is "200 instances, the D17 cold-batch
  scenario". The test mounts **40** (`harness:821`), and the log line says 40.
- **The memory explanation** at report `:190-193` lists "the window observer per control" in the
  price, but Android has no observer.
  - Android's 130.9 KiB/instance equals the library's existing per-host floor: Switch was
    128.9–134.2 KiB in T12.
  - A zero-frame `UIView` is on the order of 1 KiB, not 45.
  - So the cause is "one hosting controller / composition per control", as for every component.
    The follow-up should not start at the observer.
- **`progress.md:150-152`** says "a hidden or pooled indicator costs no frames". Nothing measures
  that: the brief's "check CPU when a hidden indicator exists" does not appear in the report. The
  test covers only unmount (`:747-784`). Say what is tested (the flag closes on drop and recycle)
  and move the CPU claim to a follow-up.

## Answers to the review focus

**1. Correctness**

- **Determinate ↔ indeterminate switching:** correct on both platforms and tested (`:335`).
  Android swaps M3 overloads, with per-state track defaults (`kt:269-302`).
- **Clamping, NaN and null:** correct on both and tested (`:302`). Each platform has a single
  `drawnValue`; the getters round-trip the raw value.
- **`trackColor`:** honest. It is a no-op on iOS and documented as one, and the iOS setter does
  not even mark dirty.
- **`tintColor`:** fine on both platforms.
- **Accessibility, Android:** one `clearAndSetSemantics` node on the indicator, with
  `ProgressBarRangeInfo(value)` or `Indeterminate` plus the label. That is correct.
- **Accessibility, iOS:** label plus a percentage `accessibilityValue`, and no busy trait (none is
  public). This is documented.
- **Where it breaks:** F3 (the iOS circular value is not drawn) and F1 (Android width).

**2. The animation gate**

- **Android:** yes, it is driven by window membership.
  - `onAttachedToWindow` and `onDetachedFromWindow` (`kt:201-223`) flip an observed flag, plus the
    `reset()`/`onDropView` paths.
  - Off-window the determinate overload is composed, so M3's internal `rememberInfiniteTransition`
    leaves the composition. No infinite transition outlives the gate.
  - Re-attach recomposes it back.
- **iOS:** the sibling `didMoveToWindow` observer (`swift:135-142`, `:298-302`) drives the flag.
  There is no display link or timer of our own.
  - For a circular the gate changes nothing (F3).
  - On a detach without drop, the observer does not call `refreshAnimationReport()`, so the mirror
    updates only if SwiftUI re-runs the body off-window.
- **What no test exercises:** detach-without-drop and re-attach, on either platform. No runaway is
  visible in the code, and no CPU was measured.

**3. The perf contract**

- **The basics hold:** `afterUpdate()` is a single `host.commit()`, nothing recreates the host (no
  `rootView =` / `setContent`), and `nuiSizingKey` is the variant only.
- **Per-update allocation:** there is no `*Defaults` factory allocation. `ComposeColor` is a value
  class, and the `ProgressIndicatorDefaults.*` reads come from the scheme. Small allocations do
  remain per update: the `clearAndSetSemantics` modifier and the `progress` lambda on Android, and
  `Color(UIColor)` in the iOS body. These are a follow-up.
- **D20:**
  - A linear bar is never corrected. iOS declares 4 = 4. Android declares 4 dp against 4.19 dp,
    which is under `kEpsilon` 0.5.
  - A circular's cold first mount is always corrected. The only declaration is the linear
    `320×4` with the `fillWidth` flag, and differing flags fail `sameSizeForPush`. Each such mount
    is flagged `answerChanged` for life.
  - Who pays: the first ring per process, every ring in that cold batch, and rings after an
    environment change that moved the guess.
  - The cost: one measure plus a Yoga pass per props turn, measured at 8–48 µs on host. At 60 Hz
    that is about 0.5–3 ms/s per flagged ring. It is not a correctness issue, so it goes in the
    follow-ups.

**4. Sizing**

- Both platforms register through `NitroUiDeclaredFallbacks` (Swift `:33`, Kotlin `:37`), with the
  init backstop.
- The numbers are right for the linear default. The circular falls back to the linear box (it is
  keyed by component), which is documented.
- `alignSelf: 'stretch'` is the linear default (`Progress.tsx:118`, `:185`), and the circular gets
  `flex-start`.
- Defects: F1 and F2.

**5. Tests can fail**

- `draws the fraction…` reads a body/Composable-written mirror, and the `Math.min(value, 0.5)`
  wrapper mutation is a real red proof.
- `ProgressModelTest` covers the model rule, and its red proof is credible (the report records 2
  failures).
- `commits once per update` cannot catch over-commit (F5).
- `mounts many instances at once` was never driven red, as noted. It also carries a 10 s
  wall-clock bar, which D21 moves behind `HARNESS_TIMING`.

**6. Bench honesty**

- F4 covers the 0.09× comparison and the run A mounted verdict.
- The memory miss is right in kind (host-per-control) but wrong in its attribution (F7).
- Every other verdict is within the runner's rules.

## Follow-ups (one line each, for `docs/tasks/FOLLOWUPS.md`)

- Bench: declare `mountSignal: false` for `update.progress:expo-ui-*` on Android (or give the expo arm a probe-visible signal) and re-run, so the update CPU bracket is not padded by two probe timeouts.
- iOS: a determinate circular (`Gauge` `.accessoryCircularCapacity` or a custom `ProgressViewStyle`) if the ring's value must be visible.
- Harness: a detach-without-drop and re-attach test for the animation gate (e.g. `removeClippedSubviews` or a screen detach), on both platforms.
- Measure UI-thread CPU with N hidden indeterminate indicators on both platforms (the brief's CPU check).
- iOS: have the window observer call `refreshAnimationReport()` so the mirror does not depend on an off-window body re-run.
- D20 cost for a cold-corrected ring at 60 Hz: declare per-configuration fallbacks, or document `prewarm` with the `'circular'` key.
- Android: read `model.value` inside the `progress` lambda (draw-phase read) and hoist the semantics modifier, so a 60 Hz write skips recomposition and allocates nothing.
- iOS: cache the SwiftUI `Color` for the tint in the setter instead of building `Color(UIColor)` per body run.
- iOS: a fresh indeterminate mount draws one empty-determinate frame before `didMoveToWindow` flips `inWindow`. Check whether it is visible.
- `mounts many instances at once`: move the 10 s wall-clock bar behind `HARNESS_TIMING` (D21), or replace it with a structural count.
- `bench/src/implementations/shared.ts:22` says SwiftUI's circular is 32 pt; the docs and harness measure 20 pt. Reconcile.
- The example screenshots show a LogBox "Open debugger to view warnings" toast on iOS; identify the warning.
- Carry over from the report: mint a quiet-machine `progress` baseline, and add a render-check control kind to the real-input runner.
