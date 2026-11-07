# E4 — Progress `variant="loading"` and `appearance="wavy"` (Material 3 Expressive, pass 2)

**Branch:** `task/E4-progress-loading-wavy` (from `main` at `05ef08df`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `E4-h377u` (pair-b — iPhone Air / iOS 27 and `emulator-5570` (`nitroui_b`, API 35,
420 dpi) / Metro `8293`)

## Summary

**API.** `Progress` gains `appearance: 'flat' | 'wavy'` (default `'flat'`) and
`variant: 'loading'` with `contained: boolean` (default `false`). All three are
always sent and non-optional on the Hybrid View (nitro#1184), and the wrapper
resolves them first: `wavy` means nothing for `'loading'` and `contained` nothing
for a bar or a ring, so an undrawable combination gets neither a pixel nor a
sizing-cache entry.

**Platform mapping.** Android draws all four: `LinearWavyProgressIndicator` /
`CircularWavyProgressIndicator` — both **stable** in material3 1.5.0-beta02 (no
opt-in marker anywhere in `WavyProgressIndicatorKt`) — and `LoadingIndicator` /
`ContainedLoadingIndicator`, which **are** `@ExperimentalMaterial3ExpressiveApi`
and sit behind one `@OptIn` on one private composable — the library's only
`ExperimentalMaterial3ExpressiveApi` opt-in (Dialog, BottomSheet, DatePicker,
SearchField and Tooltip all opt into `ExperimentalMaterial3Api`). iOS has no wavy
indicator and no morphing shape: it draws the flat bar
or ring and a circular `ProgressView`, storing `appearance` / `contained`
unpainted — the `trackColor` treatment, documented rather than faked.

**Measured sizes** (D17; `measureContent()` and the Yoga box in one run): wavy
bar **9.90 dp** against flat **4.19** (Material's 10 dp is 26 whole px at 420
dpi, the same round-down), wavy ring **48 dp** against **40**, `loading`
**48 dp** with Material's 38 dp shape inside it, and `contained` the same
**48 dp** — the container is the box. iOS answers 4 pt and 20 pt everywhere,
because it draws the flat bar and the ring.

**Sizing.** The key is `''`, `'wavy'`, `'circular'`, `'circular|wavy'`,
`'loading'`, `'loading|contained'`. Only a *shape* change remounts the native
view; `appearance` and `contained` re-measure in place through `nuiSizingKey` →
`noteSizingKeyChanged()`. Widening the remount would pass the same tests for the
wrong reason. Said plainly: the per-configuration **declared** fallback that an
earlier draft of this round sketched was **not** built, because
`NitroUiSizing.setFallback` is keyed per component, not per configuration — six
keys, one fallback each. The new configurations are covered by poisoning the
engine's cache entry for that key instead, which is what the sizing rows measure.

**The row no size can settle.** A wavy ring and `loading` both measure 48 dp and
both publish one semantics node with the same `ProgressBarRangeInfo`, so the paint
test reads the window: `NitroUiProbe.paintedInk` copies the control's rectangle
out of the compositor and asserts ink extent, fill density, and the container
colour's presence on `contained` and its absence beside it.

**Two notes.** (1) The probe caught a bug in my own test: `processColor()`'s
output handed to `tintColor` is processed twice, so the bar drew the scheme's
colour and the probe found none of the red it was asked for; a plain `#00ff00`
`View` now rides in the probe's frame. (2) `loading` is the one *Expressive*
`@OptIn`: at
material3 1.5.0 **stable** an experimental member can vanish at a minor without a
deprecation cycle, and the break compiles red in that one file.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1819 tests / 71 suites | `5882b14889d3` | 2 m 43 s | start 4.5 / med 5.5 / max 7.1 |
| `harness:ios` | **PASS** | 448 tests / 25 suites + isolated 4 tests / 2 suites | `5882b14889d3` (ios tree) | 10 m 49 s | start 5.9 / med 5.5 / max 9.8 |
| `harness:android` | **PASS** | 499 tests / 25 suites + isolated 4 tests / 2 suites | `5882b14889d3` (android tree) | 15 m 05 s | start 6.4 / med 3.6 / max 13.4 |
| `real-input:ios` | stale | — | e18a547f0973 (not this tree) | 27 m 54 s | start 4.2 / med 5.3 / max 17.4 |
| `real-input:android` | stale | — | e18a547f0973 (not this tree) | 41 m 07 s | start 6.6 / med 3.0 / max 8.9 |
| `harness:android:Progress` | **PASS** | 19 tests / 1 suites | `5882b14889d3` (android tree) | 17.0 s | start 6.5 / med 6.8 / max 6.8 |
| `harness:android:Progress:--background` | stale | — | 2ac53e423459 (not this tree) | 1.2 s | start 9.4 / med 9.4 / max 9.4 |
| `harness:ios:Progress` | stale | 17 tests / 1 suites | 6070e0c8701b (not this tree) | 15.8 s | start 3.2 / med 5.1 / max 5.1 |
| `real-input:android:--control:hosted-slider` | stale | — | e18a547f0973 (not this tree) | 8 m 31 s | start 2.1 / med 3.0 / max 6.9 |

`need --for review`: need: review is satisfied on this code tree.

**One retry, outside this task's code.** The first `real-input:android` run came
back 21/22: `hosted-slider`'s real drag stopped at 0.43 where the check wants
0.7+, and the check right after it moved the same thumb 0.43 -> 0.11. A gesture
that landed short, on a tree whose diff against `main` names no Slider file. The
same APK with `--control hosted-slider` moved 0.4 -> 0.88 (recorded under its own
name, so it satisfies nothing), and the table above is the clean re-run. Four
other branches in the gate log store show one control short and green on the
re-run (`E1`, `G17`, `X18`, `E3`).

## Red proofs

- `progressSizingKey.test.tsx` (2 tests) -> `progressSizingKey` drops the `'wavy'`
  segment -> `keys each configuration…` and `changes the key…` fail (2 red of 1818).
- `Progress.harness.tsx: lays every configuration out at the size it measures` ->
  the same key mutation, on device -> `linear-flat's box never became
  300.19x4.19 (last=300.19x9.90, guess was 137x23)`: the flat bar inherited the
  wave's entry, which is the R3 bug class.
- `Progress.harness.tsx: re-measures an appearance change on the same view` ->
  Android `appearance` setter stores nothing -> `The wavy bar never measured 10
  tall (last=300.19x4.19, flat was 300.19x4.19)`; the paint test and the
  configurations test went red in the same run.
- `Progress.harness.tsx: gives a contained loading indicator its own cache entry`
  -> Android `nuiSizingKey` setter stores the key without
  `host.noteSizingKeyChanged()` -> `expected 13.333332061767578 to be less than 1`
  (the box still the 37 dp poison, because the host never asked).
- `Progress.harness.tsx: paints the wavy and loading shapes…` -> Android
  `contained` setter stores nothing -> `expected 0 to be greater than 500` for the
  container's ink; the same mutation also reddens the configurations and
  cache-entry rows.
- `Progress.harness.tsx` (iOS) -> `isIntrinsicShape` forgets `'loading'` ->
  `lays every configuration out…`: `loading width: expected 280 to be less than
  1` (a square answered at the box's width), plus the cache-entry row.
- `Progress.harness.tsx: animates every new configuration…` (iOS) -> the off-window
  rule removed (`drawnValue` always indeterminate, `animating` no longer gated on
  the window) -> `expected true to be false` at the "stops when it is gone" wait;
  the pre-existing `animates while it is on screen…` reddens beside it.
- `ProgressModelTest.aResetClearsTheConfigurationToo` -> `reset()` stops clearing
  `appearance`/`contained` -> `org.junit.ComparisonFailure at
  ProgressModelTest.kt:149`.
- `ProgressModelTest.onlyAShapeThatHasAWavyFormDrawsWavy` -> `drawsWavy` ignores
  the shape -> same test `FAILED` (91 tests, 1 failed).
- `ProgressModelTest.onlyTheLoadingShapeHasAContainer` -> `drawsContainer` ignores
  the shape -> same test `FAILED`.
- `ProgressModelTest.aRingAndALoadingIndicatorBothAskTheIntrinsicQuestion` ->
  `isIntrinsicShape` answers only for the ring (`variant == VARIANT_CIRCULAR`, the
  `|| VARIANT_LOADING` dropped) -> `java.lang.AssertionError at
  ProgressModelTest.kt:194`, `91 tests completed, 1 failed`.
- **Not reddened, said plainly:** the same off-window-rule mutation on **Android**
  stayed green, and removing only `refreshAnimationReport()` from iOS's `onDropView`
  stayed green. Both platforms have a second belt for that invariant: on Android
  it is `model.reset()` in `NitroComposeHost.prepareForRecycle` that clears
  `inWindow` — `drop()` never touches the model, so the disposed composition is
  not the belt — and on iOS the off-window `drawnValue` is already determinate.
  So the animation red proof above is the iOS one, from removing the rule itself
  rather than one half of it.

## Files changed

- `src/components/Progress/` — `Progress.tsx` (the three props, the resolution,
  the key, the shape-only remount), `Progress.nitro.ts`,
  `NativeNitroUiProgress.ts`, `NitroUiProgressConfig.ts`; regenerated `nitrogen/`.
- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiProgress.kt` —
  `appearance`/`contained` in the model,
  `drawsWavy`/`drawsContainer`/`isIntrinsicShape`, the four Expressive call sites
  in one `@OptIn` composable, the `nuiSizingKey` re-measure, the reset.
- `ios/components/Progress/HybridNitroUiProgress.swift` — the stored-and-not-painted
  props, `loading` as a circular `ProgressView`, the reset, the recycle path.
- `android/src/test/java/com/margelo/nitro/nitroui/ProgressModelTest.kt`,
  `src/__tests__/progressSizingKey.test.tsx`
  — the unit guards.
- `example/__tests__/Progress.harness.tsx` — five new on-device tests;
  `example/__tests__/Conformance.harness.tsx` — the recycle note now names both new
  props.
- `example/android/app/src/main/java/nitroui/example/NitroUiProbePackage.kt` —
  `paintedInk(testTag, colorArgb,
  tolerance)`: `PixelCopy` of the control's window rectangle, ink count, ink
  bounding box, and the palette it saw.
- `example/src/stories/Progress.stories.tsx` — `loading` and `wavy` columns in
  `States`, the new frames in `Sizing`, the two new args in `Playground`.
- `docs/components/progress.md`, `README.md` + `example/src/readme-examples.tsx`,
  `etc/react-native-nitro-ui.api.md`, `.changeset/e4-progress-loading-wavy.md`.
- `docs/images/components/progress-{ios,android}.png` — both retaken; see below.
  `check` was re-run after that, because the readme test reads the width out of each
  PNG's own IHDR chunk and the recorded green predated the new files.

## Follow-ups

- G19: the library-side pixel probe had not merged when this started (no such path
  at HEAD), so the shape witness is the example app's `PixelCopy` probe, not library
  API.
- iOS has no shape or pixel witness at all; its `wavy`/`loading` claims rest on
  documented fallbacks and measured sizes.
- Bench: none added (the brief needs none). The wavy indicators' animation cost
  against the flat ones is unmeasured, as is the CPU saving of the off-window rule
  that `docs/components/progress.md` already declines to claim.
- `docs/components/progress.md`'s determinate-ring and indeterminate-bar limits
  apply to `loading` on iOS as well (it *is* the ring); the page says so, but the
  underlying SwiftUI limits are untouched here.
- `scripts/real-input/android.mjs` reads a *settled* echo right after `swipe`, so a
  gesture still in flight can settle mid-drag — the 0.43 above. The press sequences
  have a retry; the two drag checks on a hosted Slider have none.

## Questions for orchestrator

None.

## Screenshots: the choice the brief left open, made

Item 7 asks whether `States`' first screen should show the new configurations, and
to say what was chosen. It should, and both halves are retaken — the committed pair
was a crop of a screen this branch changed, which makes it a picture of a story that
no longer exists.

Both are the same five columns on both platforms, ending at the wavy `CIRCULAR
INDETERMINATE` row: on Android that is the fold — the `clamped` column starts below
it — and iOS is cropped to the same row so the pair still compares the same rows.
Widths are the documented 720 / 804 px (`scripts/__tests__/readme-components.test.js`
reads the IHDR), taken at 2/3 of each window like the pair they replace.

The iOS half is honest about the fallback rather than pretending: `loading` draws a
circular `ProgressView` — the ring the old picture already showed — and `wavy` draws
flat, which the row labels in the picture say out loud. The alt text names both.
Taken on the lease (`E4-h377u`) by the CONTRIBUTING recipe: a scratch
`initialSelection` in `example/.rnstorybook/index.tsx` (reverted), Metro on 8293
(killed), `debug_http_host` written and `adb reverse tcp:8293` added (reverse
removed; the preference already read `localhost:8293` from the harness run and was
left as found), and `RCT_jsLocation` deleted afterwards because it was unset before.

## Fix round 1

**Sizing id.** `useSizingId(sizingKey)` minted a second id when `appearance` or
`contained` moved under a view keyed on `shape` alone, so the first id's engine
entry was never dropped. It is `useSizingId(shape)`; the re-measure still rides
`noteSizingKeyChanged()` alone. Red: a new row moves `appearance` then `contained`
and expects one mint -> `Expected: 1 / Received: 2` at
`src/__tests__/useSizingId.test.tsx:378`.

**Off-window wave.** material3 defaults a determinate wave's `waveSpeed` to the
wavelength and runs `infiniteRepeatable` while attached, so the off-window swap
animated a wave nobody could see. `ProgressModel.waveSpeed` now hands `0.dp` when
`!inWindow`, and `isAnimating` counts an in-window wavy indicator: Material's
determinate wave travels, and the harness comment says so. Red:
`ProgressModelTest.kt:111` (default getter) and `:128` (old rule), one failure of
93 each. The new detach/attach probe row is that suite's only red with the
`inWindow` gate removed (`expected true to be false`,
`example/__tests__/Progress.harness.tsx:1844`), 19/19 restored. `reset()` clears
`animating` itself, so an unmount cannot see the detach gate.

**Claims.** Only-`@OptIn` is now only-`ExperimentalMaterial3ExpressiveApi` (docs,
changeset); the belt is `model.reset()` in `prepareForRecycle`, not a disposed
composition. Stale comment, `sizingKey`/handle docs, the `circular ->` indent and
fallback wording fixed. Gates re-run green at `5882b14889d3`; the
`harness:android:Progress:--background` row is my mistyped argument, not a run.
