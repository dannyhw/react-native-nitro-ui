# G1 — Slider — review

**Branch:** `task/G1-slider` @ `9b583d8` (base `26d335f`). Reviewed `git diff 26d335f..HEAD`.
**Method:** code, tests, logs, the bench result files in `bench/results/`, and the screenshots. No
simulators or emulators were used. `bun run check` was run on the tip and **passes** (exit 0). Two
spot-checks were run against copies in `/tmp`; no tracked file was edited.

## Verdict: CHANGES-REQUIRED (one focused round)

The four core and sizing fixes are correct, minimal and safe for Switch. They can go to main as
they are. The component itself has four correctness problems that block merging: a handshake race
on iOS, Swift and Kotlin rounding ties differently, accessibility increments that get stuck, and an
unpaired `onSlidingComplete`. The iOS D15 verdict table also rests on a probe column the bench
guide itself calls broken. Each item is listed below with file:line and the fix. The round is
small-to-medium. Only the a11y item (R3) needs design work.

---

## Required fixes (round 2)

### R1. iOS: a JS commit between a touch sample and the next tick snaps the thumb back (handshake race)

`ios/components/Slider/HybridNitroUiSlider.swift:179` writes `state.displayed` when the finger
moves, but `nativeEvents` only goes up at the tick (`:215`). In between, `displayed` is ahead of
the event count, and the handshake cannot see that. Suppose a commit lands in that window: the echo
of the previous event, or any parent re-render that passes `value` again. Then `reconcile()` at
`:517` sees `jsEvents >= nativeEvents` and `js != displayed`, and accepts the old value. The commit
sends `objectWillChange`, so the thumb jumps back for a frame until the tick re-emits `pending`. In
a controlled drag this is exactly the "stutter" the brief forbids.

Android does not have this race. `dragTo` writes only the snapshot `displayed` and `pending`, and
`state.displayed` moves only in `state.user()` (`HybridNitroUiSlider.kt:139-141, 190`). So
`reconcile()` compares against the last *emitted* value.

- **Fix (one line):** in `afterUpdate()`, skip `reconcile()` while `model.pending != nil`. An
  un-emitted native change exists, so by definition JS cannot have seen it. The alternative is to
  keep the in-flight value out of `state.displayed`, as Android does.
- **Test:** add a JS-write-during-drag case. The brief asks for it ("JS writes during a drag are
  reconciled… document the behaviour"), and no test covers it today: the "slow JS" test
  (`example/__tests__/Slider.harness.tsx:765`) is **uncontrolled**, so `reconcile()` never runs
  there. Render `NativeNitroUiSlider` directly, start a spread drag, and re-render mid-drag:
  - an up-to-date `mostRecentEventCount` must win;
  - a stale count must be dropped.

  Also add a host-side Swift test of the rule, next to `handshake.test.swift`, if the decision is
  pulled into a pure function.

### R2. Swift and Kotlin quantise ties differently (a cross-platform value divergence)

Swift `.rounded()` rounds ties away from zero. `kotlin.math.round` is `@InlineOnly`, compiles to
`Math.rint`, and rounds ties to **even**.

- **Affected code:** `android/.../NitroUiSliderValue.kt:132` (snapping), and also `:82` and `:164`.
- **Measured:** Swift `quantize(0.5, 0…2, step 1) = 1`, `quantize(2.5, 0…10, 1) = 3`,
  `quantize(0.25, 0…1, 0.5) = 0.5`. `Math.rint(0.5) = 0` and `Math.rint(2.5) = 2`, so Android gives
  0, 2 and 0.
- **Consequence:** a JS `value={2.5}` with `step={1}` shows 3 on iOS and 2 on Android.
- **Why no test caught it:** the "a tie goes up" vector (`slider-value.test.swift:70`,
  `NitroUiSliderValueTest.kt:84`) goes through the *maximum* branch, not through `round()`.
- **Spot-check:** I mutated a copy of the Swift quantiser to `.rounded(.toNearestOrEven)` and the
  whole Swift suite still passed (42/42 ok). The tie path is unguarded on both sides.
- **Fix:** use `floor(x + 0.5)` in Kotlin. Every snapped quantity is >= 0, so that matches Swift.
  Use it for `tidy` too. Add a mid-range tie vector, e.g. `(0.5, 0, 2, 1) -> 1` and
  `(2.5, 0, 10, 1) -> 3`, to both suites.

### R3. Accessibility increment/decrement is unverified, and broken for ranges that don't end on a step

The brief requires "a11y increment/decrement works on both platforms". No test covers it, and the
claims at `docs/components/slider.md:173-182` are unverified. Reasoning from the platform sources
turns up two problems.

- **Stuck increments on non-aligned ranges, both platforms.** When the range doesn't end on a step,
  the platform control is continuous and native quantises the value.
  - *Android:* Compose's a11y delegate turns TalkBack scroll forward/back into
    `SetProgress(current ± range/20)` when `steps == 0`. With `0…10 step 3` (the docs' own example),
    +0.5 quantises back to 0. The control can never be incremented, and every attempt still emits
    a start/change/complete triple with the unchanged value.
  - *iOS:* a continuous SwiftUI `Slider` steps by a fraction of the range. The same "snap back to
    where it was" outcome is expected (to verify).
- **iOS: a binding write with no editing callbacks opens a drag that never ends.** VoiceOver
  adjusts the binding. If that write arrives without `onEditingChanged`, `drag(to:)` calls
  `beginDrag()` (`HybridNitroUiSlider.swift:176-177`) and nothing ever calls `endDrag()`. The
  results:
  - the `CADisplayLink` runs until recycle;
  - `onSlidingComplete` never fires;
  - the next real drag's `onSlidingStart` is suppressed, because `dragging` is already true.

  Android is fine here: M3's `setProgress` calls `onValueChangeFinished`.
- **Fix:** make an a11y step move to the next legal value in its direction.
  - iOS: `.accessibilityAdjustableAction` on `SliderContent`, calling a model method that does
    begin → directional-quantised value → end.
  - Android: a `semantics { setProgress { … } }` that converts the target into a directional step,
    and that actually overrides M3's own setProgress. Verify the merge order.
  - Pull the "next stop up/down from v" rule into `NitroUiSliderValue` on both platforms, with
    shared vectors.
- **Test:** a test seam (`nuiTestAccessibilityStep(direction)`) that drives the *platform* a11y
  path:
  - iOS: `accessibilityIncrement()` on the hosted element;
  - Android: perform the semantics action through `ViewRootForTest.semanticsOwner`.

  Assert value movement and exactly one start/complete pair, on an aligned range and a non-aligned
  range.

### R4. `endDrag()` must be idempotent

`endDrag()` has no `guard dragging` (iOS `:186`, Android `:146`). On Android, M3 calls
`onValueChangeFinished` after a tap that changed nothing, so a complete arrives with no start. This
is documented as a limit at `slider.md:190-192`, but it is a contract break that one guard fixes.

On iOS, a late `onEditingChanged(false)` after `cancelDrag()` can deliver a complete to the *next*
owner of a recycled instance. Add `guard dragging` to `endDrag()` on both platforms. Optionally,
also drop the documented limit.

### R5. Correct the iOS D15 table. Re-run on the final tip, and caveat the Android run.

See "Bench honesty" below. Required changes to `docs/tasks/G1-slider.report.md:288-322`:

- `mount presented` cannot carry a "meets" verdict for `nitro-ui`. The quoted run has
  `presentedBeforeMount=78` of 80 on that cell (`efba374-dirty-ios-20261023T064108Z.md:108`). The
  report quotes the marks run's 40 instead, and calls `presented` "clean" at `:320`.
- Restate `mounted` as a real UI-thread cost, not as a metric that favours the wrong arm.
- The runs were taken on `efba374-dirty`, which is **before** `2825825` (the iOS measure gate).
  Re-run iOS on the clean final tip.
- Label the Android table "ART `verify`, pre-T12 host (D18): not comparable to main", or re-run it
  after the merge with priming.

### R6. After merging main: share the M3 colours (main's core.md "Shared objects" rule)

`HybridNitroUiSlider.kt:244-253` builds `SliderDefaults.colors(...)` inline in `Component()` on
every recomposition. Main now forbids this ("objects derived from the theme, a colour, or a
defaults factory are **shared**… never constructed inline in `Content()`"). Cache it on scheme
identity and tint, as `SwitchColorsCache` does. This is a semantic conflict that only appears after
the merge (see "Merge with main").

### R7. Example and doc corrections (small)

- **Android tab bar under the status bar.** `example/src/App.tsx` (new in G1) uses RN's
  `SafeAreaView`, which only works on iOS. The tab bar draws under the clock in both Android
  screenshots ("Switch" overlaps "8:31"). D12 allows `react-native-safe-area-context` in `example/`.
- **Wrong label on the tinted example.** `example/src/SliderScreen.tsx:168-175` shows a hard-coded
  `72` for `0…120 step 5`. Native shows 70 (the thumb in `ios-light.png` sits at ~0.57 of the
  track), which contradicts the page's own "JS is told what the thumb shows". Use `defaultValue={70}`
  or display a live value.
- **The pump does not stop when idle on iOS.** `slider.md:141-142` and the report (`:91`) say "the
  pump only runs while a drag has something to report". On iOS it runs for the whole drag
  (`beginDrag` → `endDrag`). Either stop the link on an empty tick and restart it in `drag(to:)`
  (cheap), or fix the wording. Android's kdoc (`HybridNitroUiSlider.kt:176`, "at most one post per
  tick") is also inaccurate: every sample re-posts. That is harmless because `pending` dedupes, but
  a `posted` flag would avoid one `CallbackRecord` per sample.
- **Wrong comment.** `HybridNitroUiSlider.swift:95-97` says `pending` "is both what an interaction
  writes and what the Binding reads". The Binding reads `state.displayed`.

---

## 1. Slider correctness

| Area | iOS | Android |
| --- | --- | --- |
| Native drag ownership | Yes: Binding → `drag(to:)`, no JS on the path. | Yes: `onValueChange` → `dragTo`, snapshot `displayed`, `SliderTrack` scoped recomposition. |
| Coalescing ≤ 1/frame | `CADisplayLink` in `.common` modes (correct: tracking mode). | `Choreographer` callback, consumes `pending`. Multiple posts per frame, but one emit. |
| Pump lifecycle / leaks | Proxy breaks the link→target retain cycle (`:19-29`); `pump.onFrame` holds `[weak self]`; `deinit` invalidates. Stopped in `endDrag`/`cancelDrag`, and `cancelDrag` runs on recycle and drop. Not stopped when idle mid-drag, and not stopped off-window (no hook). Probably fine because a removed view cancels tracking, but unverified. | `removeFrameCallback` in `cancelDrag`/`endDrag`. Stops when idle. OK. |
| Final value in `onSlidingComplete` | Yes: `endDrag` flushes `pending` first. | Yes: same. |
| Handshake during a drag | **R1 race.** | Correct by construction. |
| Rejection | Tested (`:665`); the mutation was proven red. | Same. |
| Step / min / max / NaN | Rule is sound: clamp → snap → tidy, max reachable, NaN → min, inverted → min. `min == max` on iOS passes `2...2` to SwiftUI (Android widens by +1); no device test renders it. Add one render with `min == max` and one with `min > max`. | **R2 ties.** Otherwise mirrors iOS. |
| a11y | **R3.** | **R3** (non-aligned ranges). |
| Recycling | Full reset, `cancelDrag` first, generation counter for queued test moves. | `reset()` via `host.prepareForRecycle()`; same rules. |

Observations that are not blocking:

- Android `steps = wholeSteps - 1` makes M3 draw a tick per step. `0…100 step 1` draws 99 dots,
  which is a crowded track. Consider using the existing continuous-plus-native-quantise path above
  a tick budget. This is a product call.
- iOS non-aligned stepped mode: SwiftUI shows the raw finger position, and each tick's `send()`
  pushes the quantised value back. Check on a device that the thumb does not flicker between the
  finger and the stop.

## 2. Core and sizing changes (`882465b`, `14e100b`, `aa78f73`, `2825825`)

All four are correct and minimal. All four are no-ops for `intrinsic` (Switch).

- **`882465b` `sameSizeForPush`** (`cpp/NitroUiSizingEngine.cpp:99-107`, used at `:493` and
  `:724`) ignores the width only when `kFlagFillWidth` is set. That is the right reading of the
  policy, because the shadow node replaces the width with the box's anyway. It strengthens D17:
  warm `fillWidth` instances in boxes of different widths now cost 0 corrections, where before
  each one cost a push and rewrote the cache to its own box width. The C++ tests (`sizing.test.cpp:865,
  898`) are meaningful and were proven red.
  - Nit: they register the fallback under `"NitroUiSwitch"` with the fillWidth flag. Rename it to
    `"NitroUiSlider"` to avoid confusion.
  - Residual to document: in an **unbounded** parent (a horizontal scroller), the width is
    whatever box the cache last saw and is never corrected, because width is ignored. That is not
    the declared 351/328 and not the control's own width. Add it to `sizing.md` §5 as a known limit
    or a follow-up.
- **`14e100b` per-policy proposal.** `intrinsic` keeps `(∞, ∞)`. `fillWidth` proposes
  `(bounds.width, ∞)` and reports `proposal.width`. The iOS 15 fallback path answers intrinsically,
  but the shadow node overrides that width, as the comment says. Correct.
- **`aa78f73` Android `maxHeight = Infinity`** for `fillWidth` with a bounded width. It falls back
  to `Constraints()` when the width is unbounded. It touches only the measure policy, so it adds no
  hot-path cost. The 12 dp poison mutation proves it.
- **`2825825` gate on width** (`ios/core/NitroSwiftUIHost.swift:356`). Right rule: the width is the
  input, the height is the answer. For Switch, `boundsIndependent ||` short-circuits, so nothing
  changes.
- **Hot path for prop updates that don't change size:** iOS adds one `bounds.width` read inside the
  existing guard, and `contentSizeNeedsMeasure` is false, so it returns before SwiftUI is touched.
  Android adds nothing per commit. The engine adds one flag test per report.
- **D17:** preserved, with one honest gap. A cold first `fillWidth` instance is laid out at
  **height 0**, not at the declared fallback that D17's wording promises. It is still one frame
  (see Q5).

## 3. Perf contract (AGENTS.md)

Met:

- Setters store and compare. Rendered props `markDirty` only on change. Bookkeeping props (`value`,
  `defaultValue`, `mostRecentEventCount`, callbacks, `nuiSizingKey`) never mark dirty.
- Everything is interpreted in `afterUpdate()`. The numeric props are deliberately unordered,
  which is a good catch that is now written into core.md §3.
- One `commit()` per batch. No `rootView =` or `setContent` per update.
- D7 (`T | null` everywhere) and D7b (callbacks `fn?`, always wired via `NO_SLIDE_HANDLER`) are
  followed. No inline callbacks in the wrapper. `RecyclableView` has a full reset, and `onDropView`
  cancels the drag.
- The Reassure gate passes (Slider 6, no redundant updates).

Not met: R6, after the merge.

Note: `nuiTestDrag` is a test-only method that ships in the production binary and is described as
"TEMPORARY". That is acceptable for 0.1 since it is `@internal`. Track deleting it when the harness
can drag.

## 4. Do the tests fail when they should?

- **Spot-check (mutation, performed on a copy in `/tmp`):** Swift quantise ties-to-even passed all
  vectors. The tie path is untested; see R2.
- **Reasoned:**
  - `coalesces a drag…`, case 1 (8 moves in one turn → exactly 1 event) catches per-sample
    emission. Case 2 (spread moves → ≥ 2 events) catches a pump that never ticks. Together they
    are meaningful. The "≤ moves" upper bounds in case 2 and in the slow-JS test are not
    coalescing gates on their own, as the comments admit.
  - `reports start, change and complete` cannot pass with no events: it requires
    `change.length ≥ 1` and an exact `complete`.
  - The disabled test uses a proper barrier.
- **Weak spots:**
  - The "abandoned drag" test (`:944`) never asserts that the instance was actually **reused**
    (`nextHandle` vs `abandonedHandle`). If Fabric creates a fresh view, the old model's queued
    moves hit `nil` callbacks and the test passes vacuously. Log or assert identity, and skip with a
    message when the instance is not reused.
  - Nothing observes that the frame pump **stops**. A leaked `CADisplayLink` after `endDrag` is
    invisible, because `deliverPending` is a no-op with nothing pending. Consider a debug counter.
  - No controlled + slow-JS test, and no JS-write-mid-drag test (R1).
  - No a11y step test (R3).
  - No `min == max` render on a device.
- The sizing tests are good. `answers its own height even when the box has none` is proven red on
  iOS and is platform-discriminating. The report is candid that `ignores a box height that is
  wrong` is a tautology on iOS.

## 5. Bench honesty

**iOS (`efba374-dirty-ios-20261023T064108Z.md`):**

- **`presented` is broken for the `nitro-ui` mount cell.** The cell has `presentedBeforeMount=78/80`
  (`:108`), and `benchmarks.md` says "a column whose counters are not zero is a broken probe". The
  mechanism is consistent: the main thread is busy mounting for ~23 ms, so the display-link callback
  for a vsync that passed *during* the mount fires afterwards and stamps that earlier vsync. The
  16.06 ms is a frame that cannot contain the Sliders. Their mount finished at 23.23 ms, so the
  true presentation is at least one vsync later, roughly 33 ms against `expo-ui-shared-host`'s
  16.16 ms, which has 0 before-mount samples. **D15's headline "presented 0.99× meets" is
  therefore unsupported, and probably a miss by one frame.**
- **Is it right that `mounted` "favours the wrong arm"? Only partly.** It is true that the
  shared-host signal fires when its one Fabric node mounts, and that its SwiftUI build happens later
  in the same turn. But that build still lands before shared-host's (valid) `presented` stamp, and
  `nitro-ui`'s 23 ms is real synchronous main-thread work inside the mount transaction: 50
  `UIHostingController`s at ~0.44 ms each. `nitro-ui` is also **1.45× slower than
  `expo-ui-host-per-control`** on `mounted` (16.03 ms), which the narrative leaves out. This is a
  miss to record with a follow-up (profile host creation per instance), not a metric artifact.
- **The UI CPU/op "meets" (0.96×) cannot carry a verdict by the runner's own rule.** `nitro-ui`
  spread is 21.0% and shared-host 14.2%.
- **Memory 1.42× miss:** the explanation (one host, Nitro object, props buffer and Fabric node per
  control) is credible, and the cell is clean. Accept it for 0.1 with a recorded follow-up.
- **Update cells:** clean on `presented`/`mounted`. `nitro-ui` is the best arm on update UI CPU
  (0.72×). That is a real, reportable win.
- All iOS runs predate `2825825`, and the quoted run is from a dirty tree. Re-run on the clean tip.

**Android:** measured at ART `verify`, before T12's host changes and priming (main D18: "Android
numbers published before T12… were measured at `verify` — ratios and absolutes both differ"). The
report already says "reported, not adjudicated". It must also state the ART state, and that these
numbers must not be compared with post-T12 numbers. Re-run after the merge with `speed-profile`
priming before anyone quotes them. The counters are clean there; the spread is high, as stated.

## 6. Screenshots

- **iOS light and dark:** native iOS 26 Liquid Glass sliders (pill thumb, tint, disabled dimming),
  correct in both appearances. The thumb-without-track bug the report describes is gone, and the
  stepped and non-aligned rows look right.
- **Android light and dark:** genuine M3 (handle bar, track gap, end stop indicator, tick dots on
  stepped ranges, tint on the active track and thumb), correct in both appearances.
- **Problems:** the Android tab bar overlaps the status bar (R7), and the "72" label is wrong (R7).
  The disabled row is cut off at the bottom of the Android shots, which is acceptable.

## Merge with main (T12) — likely conflicts

- `git merge-tree HEAD main` is **textually clean**. I exported the merged tree to `/tmp`; there,
  `scripts/__tests__` (including main's `bench-gate.test.js`) passes 49/49, `test:native` passes
  (187 C++ checks plus the Slider vectors), and `tsc` is clean.
- **Semantic conflicts to handle:**
  - R6 (the colours rule).
  - Android immediate budget is 1 on main (was 2). Re-run both harness suites after the merge.
  - Main's `Sizing.harness.tsx` changed alongside G1's engine change.
  - `scripts/bench/{run,lib,render}.mjs` and `benchmarks.md` were both edited. G1 adds the
    component dimension and main adds the ART state. Check that the merged runner records `art` for
    `--component slider` runs.
  - `core.md`/`sizing.md` line references in G1's docs (e.g. `NitroSwiftUIHost.swift:356`,
    `NitroUiIntrinsic.hpp:208`) should be re-checked after the merge.
  - T13 is touching the Android Compose host now. Coordinate if Q5 is scheduled.

## Questions for orchestrator — recommendations

1. **iOS below 26 unmeasured.** Don't block G1 or G3+. For a `fillWidth` control a wrong fallback
   height costs only the first instance one frame. Record it, and add an iOS 18 runtime CI row
   during release readiness (Phase 4, alongside D2/D8). Until then, any copied fallback stays
   labelled "measured on 26.4/27 only".
2. **Android a11y in the harness.** Accept "View-level only" for the **label** in v0.1, and file the
   upstream Compose-semantics query (D11, `docs/upstream.md`). **Do not** accept it for
   increment/decrement. A component-side seam can reach `ViewRootForTest.semanticsOwner` and
   perform the real `SetProgress` action today (R3).
3. **Memory and `mounted` gaps.** Memory: accept and record for 0.1, and open a backlog item for a
   shared Nitro host for batches. That is a core redesign and not G1's job. `mounted`/`presented`:
   don't accept the "wrong arm" framing. Record an honest D15 miss on iOS mount presentation (about
   one frame at N=50). The follow-up is to profile per-instance host creation (the ~0.44 ms per
   host), which is cheaper than a shared host and may close most of the gap.
4. **`mountSignal: false` per cell.** Yes, as a T02 follow-up after this merges. It is small, but
   both branches touched `run.mjs`. Doing it on main avoids a third round of runner churn. If G1
   rebases on main for round 2 anyway, it may be done there.
5. **Register fallbacks before the first measure.** Worth doing, as a **separate small core task**,
   not G1 round 2.
   - **Size:** small. A pre-measure hook already exists: every wrapper calls
     `nitroUiCore.nextSizingId()` during render (`src/core/useSizingId.ts`), before any shadow node
     exists. The core's native init, or that first call, can run a per-platform table of
     `declareFallback()`s. Each component moves its existing static into that table, which is one
     line per component in the core.md §9 checklist.
   - **Estimate:** ~60–120 LOC across iOS and Android core, plus the Switch and Slider moves, docs
     (D17 wording, sizing.md §5) and a cold-first-instance test. That test is the hard part, because
     the harness process is warm. It needs either a dedicated first-running suite or an engine
     "measure before any view" assertion via stats.
   - **Keep the fallbacks native** (per-OS values, D14), not JS.
   - **Why separate:** it changes Switch's behaviour on both platforms, it touches the Android core
     while T13 is open, and G1 already carries four core changes. Schedule it after T13 and
     **before** the next `fillWidth` component (G3+).
   - Meanwhile, amend D17's text: the first `fillWidth` instance currently shows height 0 for one
     frame, not the declared fallback.
6. **Android numbers while T12 is in flight.** Agreed, and stronger: they are ART `verify`
   numbers (D18), so mark them non-comparable now and re-run after the merge with priming before
   anyone quotes them (part of R5).

## Positives worth keeping

- Four real core bugs found and fixed minimally, with mutation proofs and guide updates. The
  "screenshots caught what 51 tests didn't" section, and the warm-up-hides-a-process-local-bug
  lesson, are valuable.
- The value rule is in one pure file per platform with shared vectors, and the tidy-to-15-digits
  reasoning for the handshake is correct.
- The idempotent `beginDrag`, the range interpreted only in `afterUpdate`, the CADisplayLink in
  `.common` modes, and the weak proxy are all careful work.

---

## Fix round 1 verification

**Branch:** `task/G1-slider` @ `38f7335`. Reviewed `git diff 9b583d8..38f7335`, but only the
round's own commits (`4a419c8..38f7335`). Main's content from the merge was reviewed elsewhere.
**Method:** code, tests, logs, and the bench result files. No simulators or emulators were used.
- `bun run check` was re-run on the tip: **exit 0**. That covers 111 Jest tests, `test:native`
  (including the new handshake and slider-value vectors), nitrogen (no drift), api-extractor,
  publint and the manifest.
- `test:native:android` (JVM only) also passes: 36 tests, 0 failures.
- The working tree is clean apart from this section.
- The device harness counts (54/54 on each platform) are the implementer's. Their logs exist
  (`/tmp/g1-ios-harness-final3.log`, `/tmp/g1-android-full-{1,2}.log`), but I did not re-run them.

### Verdict: MERGE-AFTER-SMALL-FIXES

There are two small fixes and no re-review. D19 allows a doc-only round to merge on green gates;
fix 1 below is a single line of Kotlin.

1. **Android: a disabled Slider no longer tells TalkBack it is disabled. This regression came in
   with this round.**
   - The cause is `Modifier.clearAndSetSemantics { … }` at `HybridNitroUiSlider.kt:535-541`. It
     clears M3's own `sliderSemantics`, and that function is where `disabled()` lived.
   - I confirmed this in the M3 1.4.0 bytecode: `SliderKt.sliderSemantics$lambda` calls
     `SemanticsPropertiesKt.disabled` when `!enabled`.
   - The replacement block never restates it. TalkBack now reads a disabled Slider as an enabled,
     adjustable control. Its action is still refused (`accessibilityStepToward` returns false at
     `:218`), so the control looks live but does nothing.
   - iOS gets this right: the element adds `.notEnabled` (`HybridNitroUiSlider.swift:584`).
   - **Fix:** add `if (!enabled) disabled()` inside the block (`enabled` is already a parameter
     of `SliderTrack`).
2. **The report contains a red-proof that the committed test cannot produce.**
   - `G1-slider.report.md:706` cites `finishes a drag that a write from JS lands inside` →
     `expected 0.8 to be 0.5` (`/tmp/g1-ios-harness-1.log`). That log comes from an earlier draft
     of the test: the failing assertion is `expect(change[last]).toBe(landed)` at old line 839.
   - The committed test (`Slider.harness.tsx:789-874`) accepts either release value. Its own
     comment says "the JS stream cannot see the bug".
   - The real gates for fix 1 are `handshake.test.swift:117-151` and
     `NitroUiControlledValueTest.kt:116-147`. Both go red by construction without the
     `unreported` guard.
   - **Fix:** replace the row with those two tests. This is the same class of error the report
     itself calls out at `:722-726`.

### 1. The 8 required fixes

All 8 are done. The review's R1–R7, plus the bench-honesty list, map onto the report's 1–8.

| # | Done? | Where |
| - | ----- | ----- |
| R1 handshake race | Yes | `NitroUiModel.swift:54,78`, `NitroUiModel.kt:58,82`. Set at `HybridNitroUiSlider.swift:255` / `.kt:282`. Cleared at the tick (`.swift:351-352`, `.kt:338-339`), `cancelDrag` (`.swift:283`, `.kt:311`), and through `endDrag`. Host tests at `handshake.test.swift:117-151` and `NitroUiControlledValueTest.kt:116-147`. Harness case at `Slider.harness.tsx:789` (non-discriminating; see fix 2). |
| R2 ties | Yes | `NitroUiSliderValue.kt:103-104`, used in `division` `:82`, snapping `:146` and `tidy` `:178`. The Swift name is `NitroUiSliderValue.swift:81-83`. Mid-range and negative tie vectors are in both suites (`slider-value.test.swift:100-109`, `NitroUiSliderValueTest.kt:120-129`). |
| R3 a11y | Yes | Directional rule: `stepped` (`.swift:186-229`, `.kt:210-253`), with shared vectors that include negative and non-aligned ranges. iOS vends an element (`HybridNitroUiSlider.swift:552-596`, installed at `:668`) whose increment/decrement goes to `accessibilityStep` (`:314-322`: begin → drag → end in one turn). Android: `clearAndSetSemantics` + `setProgress` (`.kt:533-541`) → `accessibilityStepToward` (`:217-236`). Probes with no fallback are at `.swift:979-1000` and `.kt:965-1036`, and the harness asserts `performed` at `Slider.harness.tsx:100`. |
| R4 `endDrag` guard | Yes | `.swift:270`, `.kt:296`. |
| R5 bench | Yes | Both platforms re-run on the merged tree, Android primed (`ART: speed-profile` is recorded in the artifact). After 272e471 the only native change is a one-line no-op in Swift (`498f3fe`). See §5 below. |
| R6 colours | Yes | `SliderColorsCache` `.kt:388-455`, used at `:499`. |
| R7 example/docs | Yes | Tab bar inset at `App.tsx:38-39,102`. `defaultValue={70}` and the label `70` at `SliderScreen.tsx:170,179`. The pump wording is now accurate (`slider.md:141-145`; the kdoc at `.kt:73-82` says it re-posts per sample). The `pending` comment was rewritten (`.swift:157-162`). |
| Weak tests | Yes | Reuse is pinned per platform (`Slider.harness.tsx:1147-1153`). The pump-stops assertions use `nuiTestFramePumpArmed`. A flat-range render is at `:1370`. |

### 2. `unreported` and Switch

- **No change to Switch.** Switch never writes `unreported` (a grep of `ios/`, `android/src`
  finds only Slider and tests), so it stays `nil`/`null`. With `unreported` nil, `reconcile()` is
  byte-for-byte the old predicate on both platforms. Switch had no changes in the round's own
  diff.
- **Slider cannot get stuck refusing writes.**
  - Every write to `unreported` (`drag(to:)` / `dragTo`) also arms the pump. The pump's only
    `stop()` comes after `deliverUnreported()` (`endDrag`) or after clearing it (`cancelDrag`).
  - Recycle clears it on both platforms: iOS `prepareForRecycle` runs `cancelDrag()` and then
    replaces `state` (`.swift:857-858`); Android `reset()` runs `cancelDrag()` and sets
    `state.unreported = null` (`.kt:348,359`).
  - Drop clears it as well, via `cancelDrag()` in `onDropView` (`.swift:876`, `.kt:852`).
  - A refused write is not queued, but the next echo commit always carries the app's current
    value. A rejected-then-reverted value therefore still lands after release.

### 3. A11y safety

- **"No fallback" is test-only and safe.** Both probes are `nuiTest*` seams. When no node or
  element is found they only write a report string; the value and events are untouched. The
  harness then fails on `/performed /`.
- **The production TalkBack path does not depend on the probe.** It is the semantics action
  itself, and the probe's ambiguity check confirms the merged tree holds exactly one
  `SetProgress` node.
- **iOS: a VoiceOver write can no longer open a drag.**
  - The host's `accessibilityElements = [a11yElement]` means UIKit never descends to SwiftUI's
    Slider element. The SwiftUI side also hides children (`.accessibilityElement(children:
    .ignore)` + `.accessibilityAdjustableAction`).
  - No reader path writes the `Binding`. `accessibilityStep` opens and closes the drag in one
    turn, so the pump is stopped and `dragging` is false afterwards.

### 4. Rounding and negative values

- **Consistent for every tie, including negative ones.** Kotlin's `roundHalfAway` is
  `x < 0 ? -floor(-x + 0.5) : floor(x + 0.5)`. It is symmetric, and it matches Swift
  `.rounded()`: −2.5 → −3, −0.5 → −1, 2.5 → 3, checked by running both formulas.
- **Negative ranges are allowed and vectored on both platforms.** Examples:
  `quantize(-2.5, -5…5, 1) = -2` (counted from the minimum), and `stepped` on `-10…-1 step 3`.
- **Snapping never rounds a negative count.** The count is `(clamped - min) / step >= 0`. Only
  `tidy` sees negative values, and it is symmetric too.
- One divergence remains, and it is a single value; it is listed as a follow-up.

### 5. Bench verdicts

Both tables now carry only the verdicts the rules allow. I checked them against the artifacts.

- **iOS** (`f5c0450-ios-20261023T100532Z.md`): the three cells that carry verdicts are clean.
  These are update `presented`, update `mounted` (no spread flag, zero counters on the
  nitro-ui and shared-host cells) and memory.
  - Every mount row is "no verdict". This matches the spread flags at `:91,106` and
    `presentedBeforeMount=76` at `:108`.
  - Update UI CPU and update JS commit are "no verdict" (`:146,160`).
  - The withdrawn 0.99× and 0.96× claims are stated as withdrawn.
- **Android** (`7b6015e-android-…`): the only flag is UI CPU/unmount (`:77,105`), and that
  metric carries no verdict. Mount `presented` at 1.01× is not claimed as a meet.

### Follow-ups (one line each)

- Kotlin `floor(x + 0.5)` rounds `0.49999999999999994` to 1, where Swift `.rounded()` gives 0. That single value is the only divergence left.
- `drag(to:)` calls `refreshAccessibility()` on every touch sample (`HybridNitroUiSlider.swift:256`), which formats a String per sample on the drag path. The tick at `:353` already refreshes.
- Xcode warning from this round's seam: `element.perform(selector)` result unused (`HybridNitroUiSlider.swift:997`). Fix with `_ =`.
- An a11y step during an in-flight finger drag ends that finger's drag on both platforms, because `beginDrag` is a no-op and `endDrag` closes the drag.
- The comment at `HybridNitroUiSlider.kt:527-529` says M3 1.4 publishes no progress range. Its `sliderSemantics` does call `progressSemantics`. The comment is wrong; the code is unaffected.
- The Android harness asserts `nextHandle !== abandonedHandle` (`Slider.harness.tsx:1152`). That pins RN's recycler behaviour rather than ours.
- There is still no device render for `min > max` (review §1).
- `forceAccessibilityForTesting(true)` stays on for a probed instance after the probe. It is test-only, but undocumented in the spec comment.
