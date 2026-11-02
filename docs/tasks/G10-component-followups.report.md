# G10 — Component follow-up sweep: Slider, Button, Progress and SegmentedControl

**Branch:** `task/G10-component-followups` (from `main` at `cc51a7e`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `G10-y963t` (`pair-a`: iPhone 17 / iOS 27 sim `49D5024D…` + `nitroui_a` / `emulator-5574`, adb 5043) / Metro `8295`

## Summary

Triage of everything G1, G2, G3 and G4 left behind, against `main`. The table below has 37
rows; **five were live** — three correctness bugs and two test gaps — and each is fixed with a
test shown red first. Fifteen were fixed already by later tasks, sixteen are nits (now one
FOLLOWUPS line each), and one is a decision.

Fixed:

1. **Android's Slider thumb landed one step above iOS's** (`605b7e7`). `roundHalfAway` —
   the function written *because* the two OSes must agree on a step — was spelled
   `floor(x + 0.5)`, which perturbs the value before rounding it, and the addition rounds:
   `(0.21 - 0.1) / 0.22` is `0.49999999999999994` (nearer 0), and adding a half to it is
   exactly `1.0` because the sum has no room for the difference. It now decides magnitude
   with `Math.rint` on the exact value and pushes a real tie away from zero separately.
2. **A screen-reader step during a finger drag reported `onSlidingComplete` for a thumb the
   user was still holding** (`23fefd2`). The a11y path opens and closes its own
   start/change/complete triple, and `endDrag` is the only thing that emits a completion — so
   the app got a release it did not have, the frame pump that drag armed stopped with it, and
   the finger's next sample opened a second gesture. A step inside a drag is now one more
   sample of it. A step while nothing is dragged still reports all three callbacks.
3. **A `Button` could be laid out at another `Button`'s width forever** (`12d3d8c`). Its
   sizing key joined four fields with `|` and both free-form fields (icon, title) were
   unescaped, so icon `x|a` + title `b` and icon `x` + title `a|b` shared one cache entry.
   G2's review filed this as a nit; Menu, Picker and SegmentedControl already escaped, and
   the collision it described is between the two free-form fields, which "free-form values
   come last" never protected.
4. Two test gaps closed: no device render for `min > max` (`aa548d9`), and no test for the
   native-only clamp of an **uncontrolled** selection under shrinking options (`e3caeba`).

Three of my four red proofs were run on both platforms' devices; the `min > max` iOS proof
crashed the app in `SliderModel.trackBounds` rather than merely failing, which is the failure
mode the guard exists for.

iOS segmented `tintColor` is the one "needs a decision" item — not implemented; see below.

## Triage

| Item (task: where it was recorded) | Status | Where / why |
| --- | --- | --- |
| G1: Kotlin `floor(x + 0.5)` diverges from Swift `.rounded()` | **live correctness bug → fixed** | `NitroUiSliderValue.kt` + JVM/Swift vector twins (`605b7e7`) |
| G1: an a11y step mid-drag ends the finger's drag | **live correctness bug → fixed** | `accessibilityStepToward` / `accessibilityStep` (`23fefd2`) |
| G1: no device render for `min > max` | **live test gap → fixed** | `Slider.harness.tsx` "renders a range whose two ends are the wrong way round" |
| G4: no test for the native-only clamp (uncontrolled + shrinking `options`) | **live test gap → fixed** | `SegmentedControl.harness.tsx`, via `nuiTestDisplayedIndex` |
| G2: sizing key joins free-form fields with `\|`, two splits collide | **live correctness bug → fixed** | `Button.tsx` escapes both fields + `src/__tests__/buttonSizingKey.test.tsx` |
| G1: M3-1.4 "publishes no progress range" comment | fixed already | rewritten (`HybridNitroUiSlider.kt:551-556`) |
| G1: recycler assertion pins RN's behaviour | fixed already | platform-split with its reason (`Slider.harness.tsx:1422-1426`) |
| G1: `forceAccessibilityForTesting` undocumented | fixed already | documented at the call (`HybridNitroUiSlider.kt:1019-1023`) |
| G2: iOS press asserted at the callback, not on screen | fixed already | T15b real-input: `button` + `hosted-button` checks (both PASS this round) |
| G2: harness accepts an `HARNESS_APP_PATH` older than the sources | fixed already | `harness.mjs` refuses: "refusing to run against a stale app… stamp X, now Y" (seen first-hand this round) |
| G2: `Sizing.harness.tsx` reads `measureContent()` synchronously | fixed already | `measuredContent()` polls (`:234`); the one direct read left is deliberate and commented (`:1091`) |
| G3: `useSizingId` writes a ref during render (abandoned-render leak) | fixed already | it is state now (`src/core/useSizingId.ts`), A2 `b2ea328` |
| G3: `Progress.tsx:168` passes the raw `variant` as the key | fixed already | one normalised `variantKey`, used for both `useSizingId` and `key` (`:182`, `:195`) |
| G3: no jest test for `useSizingId(configuration)` | fixed already | `src/__tests__/useSizingId.test.tsx` (green in `check`) |
| G3: `progress.md` "(next bullet)" pointers + the "stripes" guess | fixed already | neither string is in the file now |
| G3: `value` JSDoc covers only the iOS circular limit | fixed already | both iOS limits are in `Progress.tsx:42-54` and `Progress.nitro.ts:42-47` |
| G3: Progress has no real-input coverage | fixed already (differently) | `hosted-progress` is in `A11Y_CONTROLS`, asserted on both platforms every run; the standalone screen is the `uiautomator`-never-idles item |
| G4: Android over-wide `intrinsic` content draws centred and clipped | fixed already | F3's fitting + `fits an over-wide row…` / `re-fits when the caller narrows…` tests |
| G4: `accessibilityLabel` unverified with VoiceOver, nothing reads the a11y tree | fixed already | X4's pass: `✓ NitroUiSegmentedControl is named on one element… as the segmented control it claims to be` |
| G4: `no-shadow`, mislabelled "Uncontrolled" comment | fixed already | G4 fix round 1 |
| G1: `refreshAccessibility()` per drag sample | perf nit | `drag(to:)` formats the a11y value at touch-sample rate; the frame tick refreshes too |
| G1: `element.perform(selector)` result unused | cosmetic | still warns: `HybridNitroUiSlider.swift:1037:13: result of call to function returning 'Unmanaged<AnyObject>?' is unused` |
| G1: `OptionalTint` / `OptionalAccessibility` copied per component | nit | now four copies (Switch, Slider, Button, Progress) — promote to `ios/core/` |
| G2: two `sizeThatFits` per size-affecting change on iOS | perf nit | `NitroSwiftUIHost` commit + `layoutSubviews` |
| G2: `PaddingValues` / `Modifier.semantics` / `heightIn` allocated per recomposition | perf nit | `contentPaddingFor`, `labelModifier`, `heightIn` in `HybridNitroUiButton.kt` |
| G2: `onClick` captures `model.onPress` at composition | nit, not a bug | `useStableCallback` gives one identity per mount, so the prop never changes identity; read at click time anyway for parity |
| G2: `outlined`'s `strokeBorder` overlay "takes hits on its 1 pt ring" | unconfirmed nit | the overlay is applied *to the styled Button itself*, so a ring hit resolves to the button's own gesture; Menu's trigger uses the same pattern and its real-input taps land |
| G2: "keeps a caller width… and truncates the label" never asserts truncation | cosmetic | the test says what it can and cannot read (`Button.harness.tsx:896-909`); only the *name* over-claims |
| G2: F1's reset dedupe, per-`(variant,size)` fallbacks | nits | engine behaviour / cache granularity, each a behaviour change |
| G3: memory MISS +43–45 KiB/instance, Android update cells, `mounted` sizingStats deltas, canonical baselines, `mount` noise, HID-tap injector, `mounts many instances` never red, real-input `screen` union, `trackColor` no-op | perf / bench / cosmetic nits | bench axes are F5's (out of scope here); each is a FOLLOWUPS line |
| G4: iOS `mounted` sizingStats, `presentedBeforeMount` on every segmented arm, `update.segmented-control` bench cell, expo arms keyed by index, canonical iOS baseline | perf / bench nits | F5's axes; FOLLOWUPS lines |
| G4: iOS fallback not OS-versioned, pre-26 heights unverified | open, not mine | the iOS-18-CI-row item already in FOLLOWUPS |
| G4: controlled→uncontrolled applies `defaultSelectedIndex` late | nit | unsupported mode switch; fixing it is a behaviour change |
| G4: empty `options` + selection 0 logs SwiftUI's "selection is invalid" per body evaluation | cosmetic | no `options.isEmpty` guard in the iOS file; log noise only, nothing on screen moves |
| G4: harness `settle(N)` + assert where `pollUntil` belongs | load-tolerance nit | 19 `settle(` sites left in `SegmentedControl.harness.tsx` |
| G4: LogBox warning on the Android Segments tab, four stale screenshots | cosmetic | release-readiness chores |
| G4: iOS per-instance `tintColor` | **needs a decision** | not implemented; options and recommendation below |

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1644 tests / 63 suites | `5bb6dfc5226e` | 2 m 35 s | start 1.6 / med 3.6 / max 4.8 |
| `harness:ios` | **PASS** | 236 tests / 16 suites | `5bb6dfc5226e` (ios tree) | 3 m 55 s | start 1.5 / med 2.2 / max 4.7 |
| `harness:android` | **PASS** | 287 tests / 16 suites | `5bb6dfc5226e` (android tree) | 8 m 33 s | start 112.4 / med 4.4 / max 112.4 |
| `real-input:ios` | **PASS** | — | `5bb6dfc5226e` (ios tree) | 16 m 34 s | start 1.9 / med 4.3 / max 19.4 |
| `real-input:android` | **PASS** | — | `5bb6dfc5226e` (android tree) | 21 m 33 s | start 2.5 / med 2.2 / max 5.0 |

`need --for review is satisfied on this code tree.` — check, both `harness:*` (on their own
platform half) and both `real-input:*` are green on `5bb6dfc5226e`. `harness:android` opened
at load1 112.4 because the iOS `real-input` build was still finishing; the run's own median
was 4.4. The red-proof runs are in the ledger under their own filtered names
(`harness:ios:Slider`, `harness:android:SegmentedControl`, …) and satisfy nothing; `gate.mjs
export --task G10-component-followups` wrote the ledger to `docs/tasks/G10-component-followups/gates.jsonl`
and a scrubbed excerpt of each failed run to `…/failures/`.

## Red proofs

- `NitroUiSliderValueTest.roundHalfAwayIsTheDefinitionOnLaddersThroughATie` -> `roundHalfAway` spelled `floor(x + 0.5)` -> red on the tie ladder's near-side neighbour, JVM (`aHairUnderATieIsNotATie` too); the Swift twin in `scripts/native-tests/slider-value.test.swift` goes red on 7 vectors with `NitroUiSliderValue.swift` given the same spelling.
- `SliderModelTest.anAccessibilityStepInsideAFingerDragIsASampleNotAGesture` -> drop the `if (dragging)` branch -> `expected:<[]> but was:<[3.0]>` (`SliderModelTest.kt:276`).
- `Slider › folds a screen reader step into a drag the finger has not released` -> same deletion, both platforms -> `expected [ +0, 3 ] to deeply equal [ +0 ]` (the second start is the finger's first sample after the step ended its drag).
- `Slider › renders a range whose two ends are the wrong way round` -> delete the `trackBounds` widening (iOS) -> the suite dies: "The app bridge disconnected", `.ips` frames `_assertionFailure` ← `SliderModel.trackBounds.getter` ← `SliderContent.body.getter`. Same test, `quantize` answering the smaller end for an inverted range -> `expected [ 1 ] to deeply equal [ 5 ]` on **Android and iOS**; the Android `trackRange` sort alone is not observable there, so the value rule is what is asserted.
- `SegmentedControl › moves an uncontrolled selection into the list when the options shrink` -> drop the `displayed` clamp in `afterUpdate` (both platforms) -> `never reported displayed=1. Last report: "displayed=2"` — while the *existing* controlled shrink test stays green, which is the gap.
- `Button · sizing key › separates a pipe in the icon from a pipe in the title` -> the old `${variant}|${size}|…` join -> `expected "filled|medium|x\|a|b", received "filled|medium|x|a|b"`; `escapes a backslash too…` -> `expected "filled|medium|a\\|b\|c", received "filled|medium|a\|b|c"`.

## Files changed

- `android/…/NitroUiSliderValue.kt`, `android/…/NitroUiSliderValueTest.kt`, `scripts/native-tests/slider-value.test.swift` — the rounding rule and both vector sets.
- `android/…/HybridNitroUiSlider.kt`, `ios/components/Slider/HybridNitroUiSlider.swift`, `android/…/SliderModelTest.kt` — a step inside a drag.
- `src/components/Button/Button.tsx`, `src/__tests__/buttonSizingKey.test.tsx` — the escaped key, and the wrapper test that was never there for Button.
- `example/__tests__/Slider.harness.tsx` — the inverted-range render, plus the drag/step device test and a `dragCompleted` helper.
- `example/__tests__/SegmentedControl.harness.tsx` — the uncontrolled clamp, plus a `waitForDisplayed` helper over `nuiTestDisplayedIndex`.
- `.changeset/g10-slider-step-rounding.md`, `.changeset/g10-slider-a11y-step-in-drag.md`, `.changeset/g10-button-sizing-key-escape.md`.
- `docs/tasks/FOLLOWUPS.md`, this report.

## Follow-ups

- slider-ios: `drag(to:)` refreshes the reader's value at touch-sample rate; the frame tick already does it.
- slider-ios: `element.perform(selector)` still warns at `HybridNitroUiSlider.swift:1037` (`_ =`).
- ios-core: `OptionalTint` / `OptionalAccessibility` are now four copies (Switch, Slider, Button, Progress) — promote them.
- button-android: `onClick` captures `model.onPress` at composition; read it at click time for iOS parity (harmless today because `useStableCallback` keeps one identity per mount).
- button-ios: two `sizeThatFits` per size-affecting change (`NitroSwiftUIHost.swift`), the second unneeded for `intrinsic`.
- button-android: `PaddingValues`, `Modifier.semantics` and `heightIn` are allocated per recomposition.
- button-ios: `outlined`'s `Capsule().strokeBorder` overlay is a hit candidate on its 1 pt ring — unmeasured; the overlay is inside the styled Button so the press still resolves, but a tap aimed exactly at the ring is the probe that would say so.
- button-harness: rename "keeps a caller width in charge and truncates the label" — it asserts the box, the measured size and the tap, not the truncation.
- button-engine: F1's reset is armed at the key change and fires at the next layout, so a key change measuring the current box leaves the old size in the dedupe.
- button: per-`(variant, size)` declared fallbacks rather than one for all five variants, now that T14 registers them at startup.
- progress-bench: the +43–45 KiB/instance memory gap vs `expo-ui-shared-host` is unexplained; Android update cells are not comparable until the expo arm writes its value inside the same bracket.
- progress: `mounts many instances at once` has never been driven red — the mutation that fails it is core-side (a cold batch that drops part of a flush).
- real-input: `screen` should reject a non-interactive control loudly instead of type-erroring at the entry.
- segmented-control-ios: empty `options` with selection 0 logs SwiftUI's "selection is invalid" on every body evaluation; guard the `ForEach`/selection on `options.isEmpty`.
- segmented-control: switching controlled→uncontrolled re-applies `defaultSelectedIndex` late (`didApplyDefault` is still false) — unsupported, but the jump is surprising.
- segmented-control-harness: `settle(N)` + assert in `re-reports a key change` and `corrects a planted size` should be `pollUntil` (load tolerance).
- segmented-control: re-take the four `docs/tasks/G4-segmented-control/*.png` and identify the LogBox warning on the Android Segments tab.

## Questions for orchestrator

1. **iOS segmented `tintColor`: keep it Android-only, or buy a tint that vanishes?** No code was written for this. Status quo: the prop is documented Android-only (`docs/components/segmented-control.md`, Limits), the difference is *asserted* on both platforms by the drawn-pixel probe, and iOS apps get the accent-coloured row every iOS user expects. The alternative F3 measured is writing `selectedSegmentTintColor` on the `UISegmentedControl` inside the hosted `Picker`: it does paint (9253 px of the requested colour in a 102×31 pt control), and it is gone on the first selection change with no re-write that survives — so an app would see its brand colour on the first frame and the default one after the first tap, on an undocumented private view hierarchy. **Recommendation: keep the status quo**, and let the existing probe go red if a future OS makes a per-instance tint real. If the answer is "we want a tint on iOS", that is a custom segmented control (a `UISegmentedControl` host, or hand-drawn segments), which is a component task, not a follow-up.
