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
- **Cost is paid only by content that overruns** — which the first version of this fix did
  not actually deliver, and the second one does. A `intrinsic` control whose content fits
  measures exactly once per pass, as before, and `fillWidth` controls never read the new
  state at all. That holds because `NitroUiMeasuredRoot` reads the `contentRevision` that
  `markDirty()` bumps *only while the row is in its fitted state*: for a control that never
  overran, the bump has no reader, so a prop batch restarts no group, replaces no measure
  policy and asks for no measure. The first version read it for every `intrinsic` host, so
  every `update.*` bench arm paid four things per batch; see "Fix round 1" for the bench
  that now says so with numbers rather than with an argument about which arms overrun.
- **Gates**: Android harness 101/101, iOS harness 100 passed + 1 pre-existing skip,
  real-input 4/4 on both platforms, and `bun run check` green end to end.

> **Round 0 said "bench not run, deliberately"** — no bench arm lays out over-wide content
> (`segmentedOptions` alternates `['Day','Week','Month']` / `['Daily','Weekly','Monthly']`
> and `buttonTitle` is `Save`/`Saved`, at `width: '100%'`, per
> `bench/src/implementations/shared.ts:118-186`), so the placement pass never exists there.
> That reasoning was sound about the *placement pass* and wrong about the *cost*: the arms
> still call `markDirty()`, and the round-0 read of `contentRevision` did not care whether
> the control had ever overrun. The brief's condition was met. The bench was run in round 1.

## Files changed

- `android/src/main/java/com/margelo/nitro/nitroui/core/NitroComposeHost.kt` — the fix:
  `NitroUiOverWidePlacement` (`armed`, a snapshot boolean, plus the plain stamps
  `armedWidthPx` and `armedRevision`, which may be `NO_REVISION`), `contentRevision` bumped
  by `markDirty()` and read by `NitroUiMeasuredRoot`'s **composition** only while armed, the
  measure block's guard (`armed` + same box + same revision), `noteOverWideContent()` called
  from inside the measure pass (which also bumps `remeasureToken`), the child measured with
  `Constraints()` or the box's width depending on the guard, `onMeasured` skipped on the
  bounded pass, and resets from `onConfigurationChanged`, `prepareForRecycle`, `drop` and the
  F1 `sizingKeyChangePending` branch of `onLayout`.
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
  Round 1 adds `pressBothEnds()` and three more tests: `fits a row whose box comes from a
  narrow parent, not from a width` (the G4 F2 fixture — no `width`, cold key, the parent
  narrowing twice), `re-fits when the caller narrows the box under an over-wide row`
  (140 → 120) and `keeps an over-wide row fitted through a prop change` (`tintColor` on a
  row already fitted at 140). All three tap both edges of the box.
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
  Round 1 adds `red-1-narrow-parent.log`, `red-2-3-width-and-prop.log`, the review
  (`C1-android-overwide.review.md`), and a retaken `android-after.png`.

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
- **The arming is a fact about one content at one box, so every pass either remakes it or
  releases it.** `armedWidthPx` (in the px the measure block saw) covers Yoga moving the
  box, including the engine's provisional fallback before its own correction;
  `armedRevision` covers props changing the content under a box that did not move — a
  control measured at the box's width answers the box's width for *any* content, so without
  it every later correction would be lost silently. Any pass that matches neither asks the
  unbounded question, which is the only question that can report a new size, and an
  overrun found there arms again **from inside that pass**.
  *(Round 0 modelled the same two facts as a flag that went stale instead of one that gets
  **remade or released**: the guard expired, the flag never did, so an expired arming read
  back as "already placed at the box" and the next overrun was swallowed — M1 in the review,
  "Fix round 1" below.)*
- **An arming that cannot name its content is never placed.** The revision only travels
  with a composition that is armed, so the pass that runs inside the prop batch — before
  the recomposition it belongs to, which is where Fabric's measure always sits — stamps
  `NO_REVISION`. Such an arming is not honoured: placing it bounded would answer the box's
  width for content that is about to be replaced *and report nothing*, freezing the box
  wherever the engine last put it. It buys exactly one more unbounded pass, which is the
  pass that content needs anyway. Round 1 tried the cheaper rule (an un-stamped arming is
  honoured and adopts the first revision it meets) and `Sizing › sizes a control inside a
  Modal` was red on it, which is what proved the rule.
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
- **Two plain fields, one snapshot boolean.** The measure block writes `armedWidthPx` and
  `armedRevision` and reads all three on every pass; a measure block that observes what it
  writes dirties its own node, which here would be a permanent dirty → measure → honest →
  arm → dirty loop. So only `armed` is snapshot state, and the host writes it — from inside
  the pass that overran, which is exactly why the write is allowed to be observed there:
  Compose routes it as the request for the second measure (`remeasureToken` carries that
  ask), and the bounded pass that answers it writes nothing, so the pair terminates. All on
  the UI thread, all owned by the host, including every reset.
- **Routes taken and rejected**, in order:
  - *Arming the flag from `onLayout`* (v1) — `onLayout` does not fire on a props turn whose
    box did not move, which is the Modal case. Removed again; `noteSizingKeyChanged()` is
    back to plain.
  - *Bumping the revision at `commit()`, or only while armed* (v2/v3) — both miss the first
    overrun, which is armed later in the same turn.
    *(Round 1 corrects this: what fails is gating the **bump**. Gating the **read** — read
    `contentRevision` only while `armed`, and let the write of `armed` restart the group so
    the subscription starts at the moment of arming — works and is what shipped, because the
    arming no longer needs a revision it can see to be made, only to be honoured.)*
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

`nitroui_t01`, three rows (`docs/tasks/C1-android-overwide/`). Round 0's `android-after.png`
is replaced: it showed the middle row — `SegmentedControl`, **no** `width`, four month names,
the box clamped to the parent — still clipped at both ends, which is the G4 F2 case itself and
the exact thing M1 is about. Neither round-0 caption mentioned it.

- `android-before.png` — `width: 140` with four month names shows "ebruary | March" (the
  middle of the row); the 140 dp Button shows `too long for the box it w`, cut at both ends;
  the no-width row is clipped at both ends too.
- `android-after.png` — retaken after M1: all three rows are inside their boxes, with both
  end caps drawn and each label reduced to an ellipsis; the Button reads `A title far too…`
  inside its pill. See "Fix round 1" for what each row proves.

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
