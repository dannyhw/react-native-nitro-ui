# C1 — Android: intrinsic content wider than its box fits instead of clipping

## Summary

A `SegmentedControl` whose labels want more width than Yoga gave it was drawn
**outside** its box: centred at its measured width, cut off at both ends by the host's
bounds, with the visible part of each outer segment belonging to its neighbour — so the
ends were neither visible nor tappable. iOS never did this, because SwiftUI is handed the
box and lays the `Picker` *into* it.

- **Fix, in the shared host (~60 lines plus KDoc, no per-component change).** The host
  keeps asking the unbounded question — that is the only question that can *report* a
  control's size (T11) — and when the answer is wider than the box it was measured under,
  it asks Compose **one more measure with the box's width and places that**. Material 3
  then does what Material 3 does at a finite width: shares the row out and ellipsizes
  labels. The `onMeasured` report is skipped on the placement pass, so `contentSize`, the
  cache key and every D17 counter still see the control's intrinsic size and nothing else.
- **Red → green, naturally.** `SegmentedControl › fits an over-wide row into the box the
  caller gave it` failed pre-fix with `expected [ 'overwide:2' ] to deeply equal
  [ 'overwide:3' ]` — a harness tap at the box's right edge selected the *third* segment,
  because the fourth was drawn past the edge. Both new/changed tests are green now, on both
  platforms.
- **Cost is paid only by content that overruns.** A `intrinsic` control whose content fits
  measures exactly once per pass, as before; `fillWidth` controls never read the new state
  at all. The `contentRevision` that expires an arming is bumped by `markDirty()`, which
  every setter that renders already calls, so a prop batch that changes nothing drawn does
  not re-ask anything.
- **Bench not run, deliberately** (the brief makes it conditional). No bench arm lays out
  over-wide content: `segmentedOptions` alternates `['Day','Week','Month']` /
  `['Daily','Weekly','Monthly']` and `buttonTitle` is `Save`/`Saved`, at `width: '100%'`
  (`bench/src/implementations/shared.ts:118-186`). Every arm fits its box, so the placement
  pass never exists there and a run would measure noise.
- **Gates**: Android harness 101/101, iOS harness 100 passed + 1 pre-existing skip,
  real-input 4/4 on both platforms, and `bun run check` green end to end.

## Files changed

- `android/src/main/java/com/margelo/nitro/nitroui/core/NitroComposeHost.kt` — the fix:
  `NitroUiOverWidePlacement` (plain fields: `placeAtBoxWidth`, `armedWidthPx`,
  `armedRevision`, `contentWantsMoreThanBox`), the `contentRevision` state read by
  `NitroUiMeasuredRoot`'s measure block, `NitroComposeHost.askForBoundedPlacement()` after
  `super.onMeasure`, the child measured with `Constraints()` / the box / the box-with-width
  depending on the arming, `onMeasured` skipped on the bounded pass, and resets from
  `onConfigurationChanged`, `prepareForRecycle`, `drop` and the F1 `sizingKeyChangePending`
  branch of `onLayout`.
- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiSwitch.kt` — the
  `nuiTestWidth` setter now calls `host.markDirty()`. Not cosmetic: the perf contract is
  that every setter which renders calls `markDirty()`, the iOS twin already does
  (`markDirty()` + `noteContentSizeMayHaveChanged()`), and `contentRevision` rides on that
  contract.
- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiSegmentedControl.kt` — the
  fallback-width KDoc no longer claims a too-wide row is "drawn centred and clipped".
- `example/__tests__/SegmentedControl.harness.tsx` — new test
  `fits an over-wide row into the box the caller gave it` (box, intrinsic report, and a
  `pressAt` at each edge of the box); `boxOf()` helper; the comment in
  `keeps a caller width in charge` that documented the clip as the platform difference.
  The name still describes what it asserts (the box is the caller's), so it stayed.
- `example/__tests__/Button.harness.tsx` — `keeps a caller width in charge and truncates
  the label` gained a barometer `Pressable`, an `intrinsic.width > box.width + 20`
  assertion, and (Android) a press of the truncated button. The press is gated to Android
  for the reason already written out in `fires onPress once per tap`: a synthesised
  `UITouch` with no HID event behind it is refused by SwiftUI's button gesture
  environment, so this suite cannot press a hosted Button on iOS from the harness.
- `README.md`, `docs/components/segmented-control.md`, `docs/components/button.md`,
  `docs/architecture/core.md` — the clip claims replaced with what the host does now, and
  `example/src/SegmentedControlScreen.tsx` — the `OPTION_SETS` rationale and the "iOS
  truncates, Android clips the ends" row title (its `REAL_INPUT_OPTIONS` untouched).
- `docs/tasks/C1-android-overwide/` — before/after screenshots and both red logs.

## Decisions

- **A second measure, on the host's next pass — not a second measure inside one pass.** A
  `Measurable` may be measured exactly once per pass (`MeasurePassDelegate` throws
  "measure() may not be called multiple times"), so the placement question has to be a
  separate traversal. That means one traversal's worth of the old drawing can reach the
  screen for a control that overruns; it cannot reach the *report*.
- **Placement is never reported.** The bounded answer is the box, and the box in the cache
  under that configuration is precisely the pre-T11 bug (`docs/architecture/sizing.md` §3):
  a row that wants 330 dp laid out at 140 forever, for every later instance with those
  labels. The new test asserts the report stays intrinsic in the same breath as the
  placement, because that is the regression worth a test.
- **The arming is a fact about one content at one box, and expires on either.**
  `armedWidthPx` (in the px the measure block saw) covers Yoga moving the box, including
  the engine's provisional fallback before its own correction; `armedRevision` covers props
  changing the content under a box that did not move — a control measured at the box's
  width answers the box's width for *any* content, so without it every later correction
  would be lost silently. Any other width falls back to the unbounded question, which is
  also the only thing that can report a new size, so a box that grows back releases the
  flag by itself.
- **Why `markDirty()` bumps the revision (this was the hard part).** A prop batch runs
  setters → `commit()` (snapshot apply) → Fabric's measure inside one message, with the
  recomposition dispatched *after* it — read off `adb` logs on `nitroui_t01`. So a measure
  in the prop turn still measures the old content, and once a control is placed at its
  box's width its size stops changing, which means Compose has no child-size change to
  propagate and never re-measures our node on its own: the box can then be stuck at the
  40×20 fallback with no report coming. `contentRevision` is a composition read captured
  into the `Layout` block, so bumping it restarts the group that owns the block — the one
  thing that asks again *after* the new content is in the composition. This is what
  `Sizing › sizes a control inside a Modal` (a Modal tree, where `onLayout` does not fire
  for a box that did not move) failed on for the first three attempts.
- **Plain fields, not snapshot state.** The measure block writes `contentWantsMoreThanBox`
  and reads `placeAtBoxWidth` on every pass; a measure block that observes what it writes
  dirties its own node, which here would be a permanent dirty → measure → honest → arm →
  dirty loop. The host owns the fields and every reset, all on the UI thread, in the one
  moment they can be trusted: after a measure.
- **Routes taken and rejected**, in order:
  - *Arming the flag from `onLayout`* (v1) — `onLayout` does not fire on a props turn whose
    box did not move, which is the Modal case. Removed again; `noteSizingKeyChanged()` is
    back to plain.
  - *Bumping the revision at `commit()`, or only while armed* (v2/v3) — both miss the first
    overrun, which is armed later in the same turn.
  - *`maxIntrinsicWidth`* — M3's layout policy implements no intrinsics, and the default
    intrinsic path runs the measure block anyway.
  - *Resetting the flag on every `onLayout(changed = true)`* — wipes it before the bounded
    pass that the flag exists to cause.
  - *A `SubcomposeLayout` probe to learn the intrinsic size* — doubles the composition of
    every `intrinsic` control to save one measure for a few.

## Tests run

Red first, on `nitroui_t01` (both logs are in `docs/tasks/C1-android-overwide/`):

| New / changed assertion                                       | Red proof                                                                                     |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `fits an over-wide row into the box the caller gave it`        | Pre-fix: `expected [ 'overwide:2' ] to deeply equal [ 'overwide:3' ]` — the natural C1 bug.   |
| `keeps a caller width in charge and truncates the label`       | Could not be made red by the C1 bug (the report was already intrinsic pre-fix, and a centred over-long label is still tappable in the middle). Shown red by planting exactly what it guards against — the bounded pass reporting the box: `expected 120 to be greater than 140`, then the plant reverted. |

Every command ran with `ANDROID_ADB_SERVER_PORT=5041`, `ANDROID_AVD=nitroui_t01` /
`IOS_SIM_UDID=F08675D3-A32B-4F88-BC81-02D7E0CB797E`, `METRO_PORT=8293`, an absolute
`HARNESS_APP_PATH`, under `fnm exec --using 24 --`.

| Gate                                                              | Result                                            |
| ----------------------------------------------------------------- | -------------------------------------------------- |
| `bunx react-native-harness --harnessRunner android` (8 suites)     | **101 passed / 101** (four runs; final source)     |
| `--harnessRunner android SegmentedControl` / `Button`             | 15/15 and 12/12                                    |
| `--harnessRunner ios` (8 suites, after the harness change)         | **100 passed, 1 skipped** (the skip is `MountChurn › is Android-only`) |
| `bun run test:real-input:android`                                  | **4/4 controls** (switch, slider, button, segmented-control) |
| `bun run test:real-input:ios`                                      | **4/4 controls**, XCUITest `TEST EXECUTE SUCCEEDED` |
| `bun run check`                                                    | **exit 0** — typecheck, bench typecheck, lint, `prettier --check .`, jest, native tests (JVM Kotlin), `perf:renders`, nitrogen/autolinking checks, `bob build`, api-extractor, publint, manifest and README checks |

The B1 work is not regressed: `MountChurn` is in the Android suite and green, and the
strategy-arming/`PreDrawWatch` paths were untouched apart from `drop()`'s extra
`overWidePlacement.reset()` next to the existing `contentSize = null`. D17 counters needed no
budget change — every sizing gate (`Sizing`, `ColdSizing`, `Progress`, `Slider`, `Switch`)
passes on both platforms, and the placement pass reports nothing.

## Screenshots

`nitroui_t01`, the same three rows before and after (`docs/tasks/C1-android-overwide/`):

- `android-before.png` — `width: 140` with four month names shows "ebruary | March" (the
  middle of the row); the 140 dp Button shows `too long for the box it w`, cut at both ends.
- `android-after.png` — the row is inside the 140 dp box with both end caps drawn and each
  label reduced to an ellipsis; the Button reads `A title far too…` inside its pill.

The after shot is honest about the trade: fitting is not legibility. Material 3 splits the
row's width equally, so four segments in 140 dp each get an ellipsis, where iOS's `Picker`
distributes widths and keeps more text. That difference is now the documented limit instead
of the clip.

## Follow-ups

- Android's equal-share segments make an over-wide row unreadable once it fits (above). A
  `SegmentedControl`-level fix (scrollable row, or proportional segment widths) is a design
  decision, not a host one — out of C1's scope and not claimed anywhere.
- The real-input suite has no over-wide case: `REAL_INPUT_OPTIONS` is `['1','2','3']` so its
  segment taps stay inside the box. Outer-segment tappability after fitting is therefore
  gated by the harness tap (`userEvent.pressAt` at both edges) on Android **and** iOS, plus
  the screenshot — not by `adb shell input`.
- `armedWidthPx`/`armedRevision` mean "same box, same content" as two cheap proxies. Content
  that changes size *after* the props settle (an async icon font, a lazily loaded image in a
  future control) would keep an arming that no longer matches; invalidating from a reported
  `contentSize` change is the robust version if such a control ever appears.
- Environment, not code: the Gradle daemon for this Gradle version is shared with other
  tasks, so it was left running rather than `--stop`ed; the emulator, `debug_http_host`
  pref and `adb reverse` entries this task added were restored/removed at the end.
