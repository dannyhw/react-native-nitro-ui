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
- **Gates**: round 1's tree is Android harness 104/104 (the three new cases in) and iOS
  harness 103 passed + 1 pre-existing skip, real-input 4/4 on both platforms, and
  `bun run check` green end to end. Round 0's counts (101/101 and 100+1) stay in the table below.

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
  row already fitted at 140). All three tap both edges of the box. `pressBothEnds()` also
  compares the whole tap log as one joined string: the harness abbreviated a four-element
  diff to `[…(2)]`, which hides the only fact under test - which segment answered.
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
  (`C1-android-overwide.review.md`), a retaken `android-after.png`, and
  `red-m1-tests-on-9b563b6.log` - one whole-suite run of the round-1 test file on the round-0
  commit, which is the red proof for all three new cases at once.

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

> Round 1 re-ran every gate on a tree with three more tests and a second harness edit; those
> counts are in "Gates (round 1)" below and supersede the two harness rows above.

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


## Fix round 1

The review's verdict was NEEDS-WORK: **M1** the fit did not survive its own expiry, **M2** the cost
claim was both unbenchmarked and false for every `markDirty()` batch, **M3** a list of claims that
were not true. All three are addressed, and the round-0 text above is corrected in place rather than
contradicted — where round 0 was wrong, the sentence now says so.

### M1 — the arming is made by the pass that finds the overrun

Round 0 armed from the host's `onMeasure` and gated the ask on `placeAtBoxWidth`, whose comment
asserted that a measure reaching that point "was the bounded one, so it could not have overrun".
Both halves failed in the same direction:

- **`onMeasure` is not where overruns happen.** Fabric calls it when a view's spec changes; the
  passes that matter — the one after a prop batch, the one an armed sizing-key change asks for, the
  one `AndroidComposeView` runs from `dispatchDraw` because a child changed size — never come back
  through the host. An overrun noticed by one of those was left for an `onMeasure` that nothing was
  going to cause, because a view whose box did not move has no reason to be measured again.
- **The flag expired on a different schedule from the arming.** Once `maxWidth` or the revision
  stopped matching the stamps, the guard expired but the flag stayed `true`, so the next overrun read
  back as "already placed at the box" and the early return swallowed the ask.

That is the parent-clamp case exactly, which is why round 0's own `android-after.png` still showed
its middle row clipped: the row's own wide report was clamped to the parent, the box moved once from
the value Fabric first laid the view out at, the guard expired against it, and nothing ever asked
again. `nitroui_t01` now draws that row inside its box with both end caps.

`NitroUiMeasuredRoot` now takes an `onOverWide` callback beside `onMeasured`, and the measure block
calls it in the pass that has the facts — writing the box width and the content revision it just
measured as it goes. `noteOverWideContent` sets `armed` and bumps `remeasureToken` from inside that
pass, which Compose routes as a request to measure the node again at the end of the traversal. The
early return is gone, and `contentWantsMoreThanBox` and `askForBoundedPlacement` went with it.
`onConfigurationChanged` now bumps the token as well as resetting, so a rotation or a dark-mode
switch re-establishes the fit instead of waiting for an unrelated prop to bring the clip back.

Two invariants had to be found to make that hold, and neither is obvious from the code:

- **`armed` is snapshot state; the two stamps are plain fields.** The ask has to reach Compose, so
  `armed` is a `mutableStateOf` that the measure block reads live and the host writes. The stamps are
  plain because a measure block that *observes* what it writes marks its own node measure-dirty, and
  a block that both reads and writes its own arming width is a measure → arm → measure loop that never
  settles. The bounded pass writes nothing, so the arming/ask pair terminates.
- **An arming that cannot name its content is never honoured.** Fabric's measure runs *inside* the
  prop batch, before the recomposition that batch is for, and the revision is a composition read that
  only an armed group makes — so that pass has no revision to stamp. Round 1's first attempt honoured
  an un-stamped arming anyway (adopting the first revision it met) and `Sizing › sizes a control
  inside a Modal` went red: content placed at a box's width answers that width whatever the content is
  *and reports nothing*, so a stale arming froze the box at its 40×20 fallback and no correction ever
  arrived. Refusing it buys exactly one more unbounded pass — which is the pass new content needs in
  order to be reported at all. That test is the reason the rule is strict rather than opportunistic.

`onMeasured` is still skipped on the placement pass, so the cache and the D17 counters see exactly
what they saw before: every sizing gate (`Sizing`, `ColdSizing`, `Progress`, `Slider`, `Switch`) is
green on both platforms, and `MountChurn` is green with the extra `reset()` in `drop()`.

**What remains, and is now documented:** one traversal's worth of clipped drawing after
`markDirty()` on an already-fitted row. The report question can only be answered unbounded, and a
`Measurable` may be measured exactly once per pass (`MeasurePassDelegate` throws otherwise), so the
pass that discovers the overrun is also the pass that gets drawn. It is the same shape as the
one-frame fallback correction D17 already accepts, it is invisible unless the control is over-wide in
the first place, and `docs/architecture/core.md` §7 says so next to the one-traversal note.

### M2 — the read was the cost, and the bench caught round 0 paying for it

Round 0's reason for skipping the bench was that no bench arm lays out over-wide content
(`segmentedOptions` alternates `['Day','Week','Month']` / `['Daily','Weekly','Monthly']` and
`buttonTitle` flips `Save`/`Saved`, both self-sized), so the placement pass never exists there. That was
true of the pass and false of the cost: every one of those arms calls `markDirty()`, and round 0 read
`contentRevision` for **every** `intrinsic` host, armed or not, so a batch restarted the measured-root
group, handed `Layout` a new measure-policy lambda (the captured revision is what changed), re-measured
the node and ran `onMeasured`. The brief's condition was met, so three labelled runs happened on
`nitroui_t01` — `bun bench --platform android --plan quick --only
nitro-ui,expo-ui-shared-host,rn-core` at the pre-C1 commit, at round 0, and at the shipped commit, ~19
minutes each. `update` is the Switch cell (`scripts/bench/lib.mjs:173`); `update.progress` is circular.

| `nitro-ui` cell                 | metric      | `5282583` pre-C1 | `9b563b6` round 0 | `b01343d` shipped |
| ------------------------------- | ----------- | ---------------- | ----------------- | ----------------- |
| `update` (Switch)               | UI CPU/op   | 3.29x            | 3.18x (0.97x)     | 3.11x (0.94x)     |
| `update.button`                 | UI CPU/op   | 1.58x            | 1.57x (0.99x)     | 1.83x (1.16x)     |
| `update.segmented-control`      | UI CPU/op   | 1.25x            | 1.19x (0.95x)     | 1.36x (1.09x)     |
| `update.progress`               | UI CPU/op   | 536x             | 378x (0.71x)      | 445x (0.83x)      |
| `memory` (Switch)               | bytes/inst  | 2.66x            | 2.64x (0.99x)     | 2.68x (1.01x)     |
| `memory.button`                 | bytes/inst  | 2.46x            | 2.46x (1.00x)     | 2.47x (1.00x)     |
| `memory.progress`               | bytes/inst  | 2.60x            | 2.56x (0.99x)     | 2.49x (0.96x)     |
| `memory.slider`                 | bytes/inst  | 9.99x            | 10.50x (1.05x)    | 10.76x (1.08x)    |
| `memory.segmented-control`      | bytes/inst  | 1.25x            | **1.60x (1.29x, FAIL)** | 1.32x (1.06x) |

Parentheses are `head(x/rn-core) / base(x/rn-core)` from `scripts/bench/report.mjs`, which is the gated
unit. Three things come out of this, and the second is not the one I expected.

- **The shipped build costs nothing measurable on CPU.** The four `markDirty()` arms land at 0.94x,
  1.16x, 0.83x and 1.09x UI CPU/op, and the runner marks three of the four `noisy` by its own
  within-run spread test, so none of them carries a verdict. That is "no measurable cost", not "zero
  cost": this plan resolves a few per cent on a UI thread doing ~10 ms per operation, and the change it
  is pricing is one snapshot write per batch on a fitting control. The `update.progress` ratio in
  absolute terms (536x/378x/445x) is an artefact — RN core's circular `ProgressView` spends about 2 µs
  of UI CPU per operation, so only `head/base` is readable there.
- **Round 0 did pay, and the gate caught it — in memory, not CPU.**
  `memory.segmented-control` is a mount-only cell (`runMemoryScenario` samples an empty list at
  `commit(0)` and again at `commit(200)` — `bench/src/runner.ts:383-387`), and round 0 measured
  **1.29x** more bytes per instance against pre-C1: a `FAIL`, the only one in either comparison, with a
  95% CI of 1.26x–1.31x from a hierarchical bootstrap over the eight launches. In absolute terms the
  gated metric is 311.8 KiB/inst pre-C1, 401.2 KiB under round 0, 333.6 KiB shipped — round 0 added
  about 89 KiB per `SegmentedControl` and round 1 about 22 KiB, which is what the feature legitimately
  carries (a placement object, an `IntState`, one stable callback, one extra measure). Both heaps moved
  together and both came back down: 128.3 + 175.8 KiB native + Java pre-C1, 165.0 + 228.8 under round 0,
  134.1 + 191.2 shipped. Nothing else moved: the other four `memory.*` cells are 0.99x, 1.00x, 0.99x and
  1.05x under round 0.
- **The shipped build is inside every gate.** `report.mjs` exits 0 against pre-C1. Five `nitro-ui`
  head/base ratios exceed 1.20x and the runner declines a verdict on all five: `update.progress` JS
  commit 1.50x and JS CPU/op 1.43x (both `noisy`, both CIs cover 1.0), `update.segmented-control`
  presented 1.28x (CI 0.81x–1.49x, and that cell's gated `UI CPU/op` is 1.09x), and `mount.slider` /
  `mount.segmented-control` `UI CPU/unmount` at 1.26x and 1.38x, with CIs from 0.05x and 0.50x up to
  3.40x and 2.94x. No `markDirty()` arm's `UI CPU/op` is near the threshold. For scale, the `rn-core`
  control moved more than 10% between its own two runs on 13 metrics — the honest noise floor of this
  machine even on a quiet night.

The mechanism for the memory delta is a hypothesis, not a finding, and this report labels it as one:
the two builds differ in the mount path only in *where* the placement measure is asked for — round 0
bumped its token from inside `View.onMeasure`, so `requestLayout()` bubbled through the RN tree once per
instance across a 200-instance mount, where round 1 writes `remeasureToken` from inside the measure
block and Compose re-measures that node at the end of the traversal — and a window-layout storm per
instance is the shape that would inflate both heaps together. I did not prove it and C1's gate is the
shipped tree, which passes; the follow-up line is there if the next bench/memory task wants it. The
round-0 run also carries a `(busy)` load flag (load1 12.7), which is a caveat on any absolute number
from it — but bytes/inst is a footprint sample, its four launches agree tightly, and the same base file
is used for both comparisons.

Round 0's "cost is paid only by content that overruns" is therefore corrected twice over: it was false
as written, it was measurable, and the gate that makes it true is now in the code rather than in the
prose.

### M3 — claims corrected

- `android-after.png` is retaken. Its middle row — no `width`, four month labels, box clamped to the
  parent — was pixel-identical to the before shot and is now inside its box; round 0's caption
  described rows 1 and 3 and said nothing about row 2. Both captions above now describe what each row
  shows, including the row that was still broken.
- Round 0's "cost is paid only by content that overruns" and `core.md`'s "a control that fits its box
  measures once, as before" were false for the reason in M2. `core.md` §7 now states the real rule —
  only an *armed* control reads anything, every host pays one snapshot write — and the summary bullet
  says which bench arms were being mispriced.
- README, `segmented-control.md` and `button.md` keep their "now fits" wording because it is now true
  (the parent-clamp case and the post-`markDirty()` case are both covered by green tests). The
  `armedWidthPx` KDoc that described the parent-clamp path as handled while the code did the opposite
  is rewritten, as are the KDocs on the old `askForBoundedPlacement` flow, and the Decisions bullet
  that said a box which grows back "releases the flag by itself" now says the truth: an unbounded pass
  either remakes the arming or releases it, which is a different statement from the one round 0 made.
- Brief item 3's "in a narrow parent" fixture is now actually in the suite:
  `fits a row whose box comes from a narrow parent, not from a width`. The round-0 caller-`width` test
  keeps its name and its assertions — the box is the caller's — but it never exercised arming expiry,
  so it was never a stand-in for the brief's case.

### Tests added, red first

All three are `SegmentedControl · G4` cases that tap **both edges of the box** and require the first
and last segment, which is the only oracle that can see where a Compose row's segments really are: the
segments are virtual nodes that no geometry query can read, while `userEvent.pressAt` dispatches a
real MotionEvent that Compose hit-tests the way it hit-tests a finger. Both ends matter because
over-wide content is centred, so each end of the box shows a *different* neighbour's segment.

`docs/tasks/C1-android-overwide/red-m1-tests-on-9b563b6.log` is one whole-suite run of this branch's
test file on `9b563b6` with no fix: `3 failed, 15 passed`. The failure text is the assertion, so it
names the segment that answered.

| New test                                                           | Red on `9b563b6` — received vs expected                                                            |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `fits a row whose box comes from a narrow parent, not from a width` | `clamped:5,clamped:0,clamped:4,…` ≠ `clamped:5,clamped:0,clamped:5,…` — 300 dp fits, then the right edge of the 260 dp box answers segment **4** |
| `re-fits when the caller narrows the box under an over-wide row`    | `narrowing:3,narrowing:0,narrowing:2,…` ≠ `narrowing:3,narrowing:0,narrowing:3,…` — 140 dp fits, then the 120 dp box answers **2** and **1** |
| `keeps an over-wide row fitted through a prop change`               | `tinted:3,tinted:0,tinted:2,tinted:1` ≠ `tinted:3,tinted:0,tinted:3,tinted:0` — after `tintColor`, **both** edges answer the neighbour |

Those are the three failures the review predicted, in its order, and the third one is the clipped
drawing reappearing on a box that never moved. The two earlier logs (`red-1-narrow-parent.log`,
`red-2-3-width-and-prop.log`) are kept: they are the first proofs, run before `pressBothEnds`
compared its log as a joined string — until then the harness abbreviated the diff to
`[…(2)]`, which hides the segment that answered, which is the fact under test.

The first test narrows the parent twice (300 → 260 → 224 dp) rather than once, deliberately: at the
first narrowing a pre-fix host either lands clipped or genuinely has an arming for the new box, so a
single move can pass by accident. Two moves retire an arming that exists, which is the expiry the fix
is about. Each step also asserts the box is the parent's width *and* that the report is still the row's
own (`intrinsic.width > box.width + 20`), because a test that only taps cannot tell a fitted row from
one that has started lying about its size — the pre-T11 failure would satisfy a tap-only test.

### Gates (round 1)

Every command ran with `ANDROID_ADB_SERVER_PORT=5041`, `ANDROID_AVD=nitroui_t01` /
`IOS_SIM_UDID=F08675D3-A32B-4F88-BC81-02D7E0CB797E`, `METRO_PORT=8293`, an absolute
`HARNESS_APP_PATH`, under `fnm exec --using 24 --`.

| Gate                                                | Result                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------- |
| `bun run check`                                     | **exit 0** on the round-1 tree                                                  |
| `bunx react-native-harness --harnessRunner android` | **104 passed / 104** (8 suites, includes `MountChurn` and the three new tests)   |
| `bunx react-native-harness --harnessRunner ios`     | **103 passed, 1 skipped** of 104 (the skip is `MountChurn › is Android-only`)    |
| `bun run test:real-input:android`                   | **4/4 controls**                                                                |
| `bun run test:real-input:ios`                       | **4/4 controls** on the re-run; the first run failed `switch` (see below)                              |

`test:real-input:ios` failed on its first run here, on `switch` alone:
`XCUITest ... XCTAssertEqual failed: ("off") is not equal to ("on")` — one HID tap did not land.
The identical command passed 4/4 immediately afterwards, and `switch` is the first control the
suite runs, so the app is still warming up under a Metro bundle while the other three are not.
The Android suite does not have this shape (it installs an APK and waits). Treated as an
environment flake, not as a C1 result: nothing in C1 touches iOS native code, the iOS harness's
own Switch cases (`flips the switch`, both platforms, 104 cases) were green on this tree, and the
failure is a tap that never arrived rather than a size, a placement or a report. It is recorded
here because a gate that passed on a retry is not the same as a gate that passed.

Nothing in the tree moved after these runs except this report and `docs/tasks/`: no native source, no
`example/src`, no `bench`. The APK the real-input run used was built at 10:23 from the shipped tree.

`example/__tests__/SegmentedControl.harness.tsx` changed twice in this round (three new cases, then
the joined-string assertion), and both times the suite ran on both platforms — the second time is the
104/104 and 103+1 above. The three new cases are plain `it`s, not Android-only ones, so iOS runs them
too and passes, which is the parity claim: a row that fits its box on iOS has always tapped like this.

### Environment notes for this round

- `example/ios/Podfile.lock` and `example/Gemfile.lock` appeared as side effects of a `pod install`
  and a `bundle install` during an iOS gate on this machine (CocoaPods resolved 1.15.2 there, not the
  1.17.0 in the lock). Both were reverted/removed rather than committed; no build or gate here depends
  on either.
- The Gradle daemon is shared with other tasks, so it was not `--stop`ed. It restarted itself once
  after running out of Metaspace during a build, which changed nothing measurable.
- `android-before.png` was re-taken this round from a checkout of `5282583` and reproduced the
  committed picture (same three clipped rows, same end-cap geometry), so the round-0 file stays as the
  before of the pair. The after file is new: it is this round's build.
- The emulator (`nitroui_t01`) and the iPhone 17 simulator were shut down at the end of the round, and
  the private adb server on port 5041 was stopped.

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
- The round-0 `memory.segmented-control` regression (+89 KiB/inst, `FAIL`) is explained but not
  proven - see the hypothesis in "Fix round 1". If the next bench/memory task wants it, a
  `requestLayout()`-per-mount counter on the Android mount path would settle it in one run.
- The harness caps a test at 30 s, which is tight for a case that renders, narrows a parent twice
  and taps six edges (`fits a row whose box comes from a narrow parent...` is the closest to it). A
  per-test timeout knob, or a cheaper way to wait for a box, belongs to the harness rather than to
  any task.
- Environment, not code: the Gradle daemon for this Gradle version is shared with other
  tasks, so it was left running rather than `--stop`ed; the emulator, `debug_http_host`
  pref and `adb reverse` entries this task added were restored/removed at the end.
