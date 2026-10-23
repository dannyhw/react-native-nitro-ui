# T10 review — core hosting runtime + Switch

Reviewer pass on `task/T10-core-switch` (`fad8e42`, rebased on `main` `30d4a9e`).
`bun run check` re-run: **PASS** (69 unit tests, nitrogen drift clean, api-extractor, publint, manifest).
No device run: the screenshot geometry and the source were enough to settle every point below.

**Verdict: CHANGES-REQUIRED.** The fixes are small. The architecture is right: one host per
instance, a concrete generic root, store/mark/commit, the handshake, and a generated-code patch
that is applied and drift-checked. But the iOS default box is wrong on the target OS, the clock
breaks D1, and the Android recycle story in the guide is false. Every later component would copy
all three.

---

## BLOCKING

**B1. The iOS Switch overflows its Fabric box, leaving dead touch zones.** `src/components/Switch/Switch.tsx:57-61`, `docs/components/switch.md` "Sizing", report "Measured default sizes".
I measured pixels in `docs/tasks/T10-core-switch/ios-light.png` (1206 px = 402 pt at 3x, page padding 16 pt, so a row's content ends at x = 386):

| Row | Fabric box (from styles) | Painted track |
| --- | --- | --- |
| controlled / default / tint / list | 335–386 × 31 (51 wide) | **330.0–392.7 × 28.0** (63 × 28) |
| custom size (90×50) | 296–386 | 310.7–373.3 (63 × 28, centred) |

- The painted track is **63×28 on iOS 27** (the iOS 26+ switch), not 51×31. 51×31 is the
  pre-26 `UISwitch` size. So the report's claim that "the track it paints is 51×31" is wrong.
- SwiftUI's 61×28 is the Toggle's real layout size. The extra ~1 pt per side is the glass
  rendering.
- The hosting view is 51 wide, so SwiftUI proposes 51. The Toggle refuses to shrink and
  overflows, centred: ~5 pt past the box on the left and ~7 pt on the right. That right-hand
  overflow is what the orchestrator saw: the track passes the right padding, while "off"/"0"
  stop at 384.
- Nothing clips it, because `clipsToBounds` is false. But `RCTViewComponentView` hit-tests to its
  bounds (zero `overflowInset`), so taps on the outer ~6 pt of each end fall through to the row.
  Neighbouring layout is also wrong by ~12 pt.

Fix now: make the iOS default `{ width: 61, height: 28 }` when `Platform.Version >= 26`, else
`51×31`. Better still, derive it from the measured `measureContent()`. Correct both docs. Q4
below has the T11 answer.

**B2. D1 clock base is violated on Apple.** `cpp/HybridNitroUiCore.cpp:16`, `cpp/core/NitroUiPerf.hpp:86-89`, comment `cpp/HybridNitroUiCore.hpp:25-27`.
- libc++ `steady_clock` on Apple is `CLOCK_MONOTONIC_RAW`, not `CLOCK_UPTIME_RAW`. I checked on
  this Mac: `steady == CLOCK_MONOTONIC_RAW` exactly, and it is **32 611 s ahead of
  `CLOCK_UPTIME_RAW`**, which is the base of `CACurrentMediaTime` and CADisplayLink.
- The bug predates T10 (`now()` is T01), but T10 builds `propsApplied`/`firstFrame` marks on top
  of it and says they share a base with the frame clocks. T02 will compare against display-link
  timestamps.
- Fix: use `clock_gettime_nsec_np(CLOCK_UPTIME_RAW)` under `__APPLE__` and
  `clock_gettime(CLOCK_MONOTONIC)` elsewhere, in both functions. Correct the comment.

**B3. Android recycling disposes the composition, and the guide says it does not.** `NitroComposeHost.kt:134-142`, `docs/architecture/core.md` §2/§6, `docs/components/switch.md` table.
- RN's `ViewManager.onDropViewInstance` calls `prepareToRecycleView`
  (`node_modules/react-native/.../uimanager/ViewManager.java:245-273`). Nitro's generated
  `onDropViewInstance` calls `hybridView.onDropView()` first.
- So `drop()` → `disposeComposition()` runs **before every recycle**. The kdoc's "never before a
  recycle" is false. A recycled Android view rebuilds its composition on attach, so recycling only
  saves the `View` object.
- This also means report decision 7 (M3 animates after reuse) cannot happen as described, because
  the composition is fresh.
- It works, but the guide that Slider/Picker will copy is wrong. Fix one of two ways:
  - (a) Keep the dispose, and document that the composition does not survive a recycle on
    Android.
  - (b) Don't dispose in `drop()`. Rely on `DisposeOnLifecycleDestroyed` plus the pool being
    cleared on surface stop, and measure the pool's memory.
- Recommend (a) now, with (b) as a T02-measured follow-up.

**B4. The smoke app has no Switch.** `scripts/smoke/App.tsx:62-63`. T03's contract is that it "renders every component the package exports exactly once". Add `<Switch testID="SMOKE-switch" value />`, which also typechecks the public API.

**B5. D11 is not met: no `docs/upstream.md`.** `patches/@react-native-harness%2Fplatform-apple@1.6.0.patch` has two fixes, "always `simctl install`" and "`simctl appinfo` exit 3 → not installed". Record both with issue drafts. Also list the non-patched harness gaps: `findByTestId` has no timeout, and `screen.screenshot(element)` reports 0×0.

## SHOULD-FIX

1. **iOS `accessibilityLabel` never re-renders.** `ios/components/Switch/HybridNitroUiSwitch.swift:187` stores the label without `host.markDirty()`, so a label change alone never reaches SwiftUI. Use the same guard + markDirty as `disabled`.
2. **Android label is on the container, not the control.** `HybridNitroUiSwitch.kt:194-196` puts the label in `host.contentDescription` on the outer `AbstractComposeView`. TalkBack's actionable node, the M3 Switch, probably reads "Switch, off" with no name, plus a separate container stop (not verified with TalkBack). Make it a `mutableStateOf` model field and apply `Modifier.semantics { contentDescription = it }` on the Switch. `core.md` §3 already says labels "belong to the hosted control".
3. **Props written through `hybridRef` are unsupported but publicly typed.** `NitroUiSwitch` (exported) exposes settable `value`/`disabled`/`tintColor`.
   - A JS-thread write runs the Swift/Kotlin setter off main. It mutates unsynchronized model
     state (UIColor/String retain races), sets `View.tag` off the UI thread, and never commits.
     Nitro calls no `afterUpdate` for direct writes, so nothing renders.
   - Getters (used by harness test 2) read the same fields from JS without a lock.
   - `NitroUiMainThread.swift:10-13` puts the burden on "callers", who are app developers.
   - Fix: either export a read-only/methods-only ref type, or make the core handle it: off-main
     setter → `main.async { store; markDirty; commit }`. Document it in `core.md` §5.
4. **Uncontrolled → controlled switching freezes JS writes.** `src/core/useControlled.ts:67-75`.
   - In uncontrolled mode the count is never echoed. After N taps, native has
     `nativeEvents = N, jsEvents = 0`. Once the parent passes `value`, every write is treated as
     stale until the next tap.
   - Related: if the user's `onChange` throws, the echo is skipped and native ignores JS writes
     from then on.
   - Fix: keep the last event count in a ref every time and seed state from it when the mode
     flips, or just always echo. Call `setMostRecentEventCount` before the user handler (or use
     `finally`). Add a dev warning on a mode switch, as React DOM does. Add unit tests.
5. **`wantsContentSize = true` puts `sizeThatFits` on the hot path.** `HybridNitroUiSwitch.swift:104` + `NitroSwiftUIHost.swift:178-181`. Every visual commit (including a rejected-change revert) and every bounds change forces a synchronous SwiftUI layout of an unbounded proposal, right after `objectWillChange.send()`. Nothing uses it except one harness test. Turn it off until T11, or measure it with T02 first (200-row mount).
6. **Android `contentSize` is not intrinsic.** `NitroComposeHost.kt:241-245` measures the child inside the Yoga constraints. iOS uses an unbounded proposal, so the two platforms answer different questions, and T11 would get a size that depends on the box it is computing. Measure with `Constraints()` (or `maxIntrinsicWidth/Height`) for the record, and keep the bounded measure for placement.
7. **The public surface is wider than intended.** `etc/react-native-nitro-ui.api.md` has two `ae-forgotten-export` warnings (`NitroUiSwitchProps`, `AnyFunction`), although the report says 0. It also exports `useControlled`/`useStableCallback`/`useProcessedColor`/`ControlledState`/`NitroCallbackProp`/`NitroUiCore` as `@public`. Mark the building blocks `@internal` (or move them to a later `/core` entry), or accept them as semver surface deliberately. Export `NitroUiSwitchProps` if `NitroUiSwitch` stays public.
8. **The disabled harness test proves nothing.** `example/__tests__/Switch.harness.tsx:238-240` asserts `seen === []` straight after the presses, so an event still in flight would pass. Add a barrier, e.g. a press on an enabled control that is awaited, or a short `waitFor` that must time out. `:294`'s "must not be recorded" comment asserts nothing.
9. **The native handshake has no unit tests.** `NitroUiControlledValue` (Swift/Kotlin) is pure logic, and it is the part a later component modifies. At least mirror the JS vectors: stale drop, rejected revert, rapid double toggle, mode switch. There is also no on-device test for rapid toggles or for a recycled row that keeps `disabled`/`tint`.
10. **Android Modal fallback is incomplete.** `NitroComposeHost.kt:151-153` sets only the `LifecycleOwner`, but Compose also requires a `SavedStateRegistryOwner` (Expo sets both: `ExpoComposeView.kt:250-253`). In RN 0.88, `Modal` is a `ComponentDialog`, which already provides both, so the comment's "the gap is RN Modal" is stale. Set both owners and close R6 with a Modal harness test.
11. **`docs/architecture/core.md` is not enough to build Slider/Progress.** It is missing:
    - continuous events: drag at 60 Hz, how many echoes, an `onSlidingComplete` analogue, float
      equality in `reconcile`;
    - that a native interaction must re-render itself (Switch's binding `set` calls
      `objectWillChange.send()` directly, which is not documented);
    - recomposition scope guidance: read a fast-changing value in the narrowest composable;
    - non-interactive components (Progress has no handshake);
    - registration steps: `src/index.ts` export, `bun run api-extractor`, the smoke-app line,
      `docs/components/<name>.md`;
    - the hybridRef threading rule (SF3).

    Its §6 Android claim is wrong (B3), and §3 "Colours" endorses bit-pattern decoding while the
    Kotlin code uses `raw.toInt()` (NIT 1).

## NIT

1. `HybridNitroUiSwitch.kt:172`: `raw.toInt()` saturates above `Int.MAX`. Use `raw.toLong().toInt()` to match D10's "bit pattern" (Android `processColor` is signed today, so this is latent).
2. `propsApplied` semantics differ by platform. iOS marks every commit (`NitroSwiftUIHost.swift:158`); Android marks only dirty ones (`NitroComposeHost.kt:117-122`). Also iOS `firstFrame` is "first non-empty layout in a window", not a drawn frame. Document both or align them.
3. `NitroUiTheme` rebuilds `dynamicLight/DarkColorScheme(context)` (~50 resource reads) per instance. Wrap it in `remember(context, dark)`.
4. `NitroUiPerf.hpp` uses a mutex, not a lock-free structure. That is fine for diagnostics and correct, but say so. The disabled cost is as claimed: an int compare, then a relaxed load.
5. Android mount is 313 ms / 40 = 7.8 ms per Switch, against 0.7 ms on iOS. It is a debug build on an emulator, so treat it as a lead for T02's release-mode numbers.
6. `useStableCallback` relies on `useMemo` for identity. React may drop memo caches, so `useState(() => …)` is the guaranteed form. Also a changed `hybridRef` function is never re-invoked.
7. `Switch` does not forward `ref`, and does not map `aria-label`/`aria-disabled`. A user `accessible`/`accessibilityRole` on the container can hide the SwiftUI element from VoiceOver.
8. A rejected-change revert on iOS commits without animation, so the thumb snaps back. Consider `withAnimation` for post-mount reverts.

## Checked and fine

- No `rootView =` or `setContent` outside init.
- One `objectWillChange.send()` per visual batch; bookkeeping props don't mark dirty.
- No `main.sync`, and no hops in the props path.
- iOS recycle reset is complete.
- `onDropView` clears callbacks.
- No retain cycles (closures capture the model, never the host or Hybrid).
- Concrete `NitroUiRoot<Content>`; `safeAreaRegions = []` + `.ignoresSafeArea()`; clear backgrounds.
- `DisposeOnLifecycleDestroyed`.
- M3 `Switch` with dynamic colour, a 48 dp target, and `Role.Switch` semantics.
- Recomposition is scoped to `Component` (fine for one control).
- The D7/D7b lint rule is correct; no inline `callback()`.
- `patch-nitrogen` marker present in `HybridNitroUiSwitchComponent.cpp`; drift clean.
- `nitro.json` + `NitroUiPackage` registration.
- The harness uses real native taps (`userEvent.press`), and the tap-twice oracle is sound. The
  `waitForTestId` polling and `beforeAll` warm-up are acceptable under D13: they are bounded, and
  the assertions stay real.
- T02's `bench/src/implementations/nitroUi.tsx` resolves `Switch` at runtime, and T10's
  `SwitchProps` satisfy `BenchSwitchProps`. After merge, T02 should switch to the named import
  and can pass `nuiPerfId`.

## Q4 — iOS intrinsic size: 51×31 or 61×28?

**Neither as a constant. T11 should push the SwiftUI-measured size (`sizeThatFits` with an
unbounded proposal = 61×28 on iOS 27). 51×31 is wrong on the target OS.**

- On iOS 27 the painted track is 63×28 (screenshot measurement in B1), so 51×31 neither matches
  what is drawn nor removes a dead zone. It *creates* ~6 pt dead zones and overflow at both ends.
- The "~10 pt of label spacing" explanation does not hold. 61 is the control's layout width; the
  remaining ~1 pt per side is glass rendering outside the layout frame, which a layout box
  should not include.
- The size is OS-dependent: 51×31 before iOS 26, 61×28 after. Dynamic Type and locale don't
  change it, but future OS releases might. That is exactly why T11 should measure at runtime
  instead of hard-coding.
- Until T11 lands, make the JS default OS-versioned (B1). Then no layout jump happens when T11
  starts pushing the measured 61×28.

---

# Round 2 verification

Re-review of `fad8e42..04b3f2b` (6 commits). `bun run check` re-run: **PASS**. That covers typecheck, lint,
format, 72 jest tests in 7 suites, `test:native` (clock + Swift handshake, every check ok), nitrogen drift (51
files), autolinking, bob, api-extractor (0 warnings), publint, and the manifest (133 files). No device run: the
open question below is settled by Compose's layout contract, not by pixels.

**Verdict: MERGE-AFTER-SMALL-FIXES.** Every BLOCKING item is genuinely fixed. Three small accuracy fixes remain
(R2-1..R2-3). Two of them sit in the guide that Slider and Progress will copy.

## BLOCKING items

- **B1: fixed.** `Switch.tsx:69-104` parses `Platform.constants.osVersion`, which is a string on iOS. It gives
  61×28 from iOS 26 and 51×31 before. Platform.Version is the fallback, and it only matters on the non-iOS branch.
  The harness test (`Switch.harness.tsx:251-292`) has one real oracle on iOS: `measureContent()` (unbounded
  `sizeThatFits`) ≤ box. The box check and the edge presses are weaker. `expectedBox` mirrors the same OS logic, and
  a press 2 pt inside the box hits the control even when it overflows. Still enough. Follow-up for T11 or the docs:
  an iOS 26 app with `UIDesignRequiresCompatibility` gets the old 51×31 control inside a 61×28 box, about 1.5 pt of
  vertical overflow each side. Worth one line under "Limits" in `switch.md`.
- **B2: fixed.** `cpp/core/NitroUiClock.hpp` uses `clock_gettime_nsec_np(CLOCK_UPTIME_RAW)` on Apple and
  `CLOCK_MONOTONIC` elsewhere. `now()` and `NitroUiPerf::nowNs()` both go through it, and every Swift/Kotlin mark
  enters through `NitroUiPerf::mark` (Swift interop, Kotlin JNI), so all marks share that base. `clock.test.mm` checks
  against `CACurrentMediaTime` (0 µs), against `systemUptime` (7 µs), and directly against `CLOCK_UPTIME_RAW`.
  Nit: the "is not `CLOCK_MONOTONIC_RAW`" check (`ours <= raw`) is vacuous, because it also holds for a regressed
  `steady_clock` read first. The UPTIME_RAW `checkNear` is the real guard, and only on a host that has slept. A fresh
  CI VM cannot tell the two clocks apart. **But see R2-2: the public doc comment still says `steady_clock`.**
- **B3: fixed, and the evidence checks out.** I verified it in `node_modules`:
  - `ReactNativeFeatureFlagsDefaults.kt:120` sets `enableViewRecycling() = false`, and I found no OSS override.
  - `ViewManager.setupViewRecycling` allocates the pool only under that flag (`:67-71`).
  - `onDropViewInstance` calls `prepareToRecycleView` only when there is a pool (`:263-272`).
  - The generated manager calls `onDropView()` before `super` (`HybridNitroUiSwitchManager.kt:66-71`).

  The kdoc, the `NitroUiModel.reset` doc, `core.md` §6 and the `switch.md` behaviour notes now all agree.
  Keeping the dispose is the right call.
- **B4: fixed.** `scripts/smoke/App.tsx` imports `Switch` and renders `<Switch testID="SMOKE-switch" defaultValue={true} />`.
- **B5: fixed.** `docs/upstream.md` is good:
  - a status table, then evidence, a paste-ready draft and a Removal line per entry;
  - H1 and H2 match the two patch hunks, and H3 and H4 are the requested non-patched gaps;
  - it adds H9/H10 (the Modal gaps), N1–N4 (nitro) and B1/B2 (bob).

  D11 is satisfied.

## SHOULD-FIX spot-checks

- **SF1: fixed.** The iOS label setter now does guard, then store, then `markDirty()` (`HybridNitroUiSwitch.swift:183-197`).
- **SF2: fixed.** The Android label is a `mutableStateOf` on the model and is applied as
  `Modifier.semantics { contentDescription }` on the M3 `Switch` (`HybridNitroUiSwitch.kt:91-98`). It merges into the
  `toggleable(Role.Switch)` node. The setter marks dirty, `reset()` clears it, and the container is no longer touched.
  TalkBack is still unverified on a device. The code is right by construction.
- **SF4: fixed.** `useControlled.ts`:
  - `seenEvents` is recorded in both modes.
  - The render-phase flip seeds `mostRecentEventCount`, and the setState-during-render is legal for own state.
  - The echo now runs before the user handler.
  - `__DEV__` warns in `useInsertionEffect`.
  - Tests at `useControlled.test.tsx:139,165,192`, plus the Swift/Kotlin "mode switch" vectors.
- **SF3/SF7/D14: fixed.** `src/index.ts` exports only `nitroUiCore`, `NitroUiCore`, `NitroUiPerfEvent`, `Switch` and
  `SwitchProps`. The `exports` map blocks deep imports. `etc/…api.md` has no Hybrid View, hook or `NitroUiSize`, and 0
  warnings. `hybridRef`/`nuiPerfId` are `@internal`, and the handle is read-only.
  - Accepted caveat: `@internal` is not trimmed, because there is no dts rollup, so consumers still see `hybridRef` in
    `lib/typescript`.
  - Nit: the inline handle in `Switch.tsx:45-53` duplicates `NitroUiSwitchHandle` and can drift from it silently.
- **SF5: fixed.** `refreshContentSize()` now runs only when `contentSizeNeedsMeasure` is set
  (`NitroSwiftUIHost.swift:242`). The flag is set by:
  - a bounds change (`:124`);
  - a trait change, via `invalidateContentSize()`;
  - recycle and drop;
  - a commit only while `contentSize == nil` (`:190-192`).

  A steady-state visual commit no longer calls `sizeThatFits`.
- **SF6: not settled, and the new explanation is wrong (R2-1).**

## R2 fixes required

**R2-1. The Android recorded content size is always the Yoga box, not "intrinsic when the box is big enough."**
`NitroComposeHost.kt:431-437` measures the child with the incoming `constraints`. Those constraints are *fixed*: the
host measures the `ComposeContent` child `MATCH_PARENT` → `EXACTLY`, and `AndroidComposeView` turns `EXACTLY` into
`minWidth == maxWidth`. A `Placeable`'s size is always coerced into its constraints, so `placeable.width/height` *is*
the box, whatever the M3 Switch wants. The centring offset is always 0. (The Switch looks centred only because of its
own `requiredSize`.)

So `core.md` §7, the `NitroUiMeasuredRoot` kdoc, and `switch.md`'s "Content measures 52 × 48 dp" for Android are
inaccurate. On Android, `measureContent()` just echoes the box, and the B1 "content ≤ box" assertion is tautological
there. The `fabric=52.19x48 hosted=52.19x48` log cannot tell the two apart: 52 dp rounds to the same 137 px either way.

The fix is still a single measure: `measurables.firstOrNull()?.measure(constraints.copy(minWidth = 0, minHeight = 0))`.
That keeps the existing placement and gives the real size whenever the box is at least that big, which is what the
docs already claim. If it is not changed now, correct the three docs instead. T11 must not build on the current
description.

**R2-2. `src/NitroUiCore.nitro.ts:17-21` still says "`std::chrono::steady_clock` maps to `CLOCK_UPTIME_RAW` on
Apple".** This is the exact false claim B2 asked to correct, and it ships in `lib/typescript/src/NitroUiCore.nitro.d.ts`.
Point it at `cpp/core/NitroUiClock.hpp`.

**R2-3. `core.md` §11 "The handshake at 60 Hz" overstates staleness.** "Every JS `value` write stays stale until
release" is only true while JS lags. Whenever JS echoes the latest count before the next emitted event
(`jsEvents == nativeEvents`), `reconcile()` applies a differing parent `value` mid-drag. Clamping works, but a parent
that writes an unrelated value fights the finger. Say that.

Also make §11 explicit on two points:
- The SwiftUI `Binding.get` must return the in-drag (coalesced) value, or the thumb lags until the next emitted event.
- The platform hooks are `Slider(onEditingChanged:)` on SwiftUI and `onValueChangeFinished` on Compose, and per-frame
  throttling needs a frame source (`CADisplayLink` / `withFrameNanos` or `Choreographer`).

The §11 Android wording "an interaction write is already inside a snapshot" is loose (it is a global-snapshot write
that the GlobalSnapshotManager applies on the next frame), but its conclusion holds.

## core.md sufficiency (§11 Slider, §12 Progress)

With R2-1 and R2-3 corrected, it is sufficient. I spot-checked about 30 `file:line` references against HEAD, and all
of them land on the cited code. The §9 checklists (registration, api-extractor, smoke line, component doc, manifest,
the three handshake twins, the barrier pattern) are complete. §12 correctly lists what Progress must not copy, and
the recycle, a11y and animation rules carry over. §5's hybridRef/threading rule and §6 are accurate.

## Regressions / new problems

- **`react { jsRootDir }`.** No round-2 change was made. `android/build.gradle:42-46` has carried it since T01
  (`3fe8c88`). The report's B4 wording ("It also needed `android/build.gradle` to set …") reads as if it were new.
  The setting is right for consumers: the library applies the RN Gradle plugin for codegen, `src/` is in `files`, so
  `../src/` resolves inside `node_modules/react-native-nitro-ui`, and the tarball smoke release build passed with it.
- `android/src/test` is excluded from `files` and `junit` is `testImplementation`, so nothing leaks into the tarball,
  and the manifest is unchanged apart from `NitroUiClock.hpp`.
- `test:native:android` (Gradle) is not part of `check`. That is acceptable, but CI should run it.
- This review file is now tracked (committed in `04b3f2b`), so this appended section shows up as a modification.

I found no functional regressions.
