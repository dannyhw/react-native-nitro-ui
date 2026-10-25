# C1 — Android over-wide content · review (D19: the one full review)

Branch `task/C1-android-overwide` @ `9b563b6`, from `5282583`. I reviewed `git diff 5282583..9b563b6`
against the brief, the G4 review's F2, `core.md`, `sizing.md`, the B1 report and re-review, `AGENTS.md`,
the report, and both screenshots. I used no simulator or emulator. Native findings come from reading the code paths,
plus the Compose UI 1.12.1 bytecode (`AndroidComposeView.scheduleMeasureAndLayout` /
`childSizeCanAffectParentSize`) where the scheduling behaviour matters.

## Verdict: **NEEDS-WORK**

The approach is sound: report the unbounded answer, then place a bounded one. The rule that the
placement pass never reports is right, and so is keeping the arming in plain fields rather than
snapshot state. The caller-`width` case works and is tested red-first.

But the arming does not survive its own expiry. Once a host has armed, the next overrun is
detected but never acted on. That happens when the box moves to another too-narrow width, or after any prop that calls
`markDirty()`. The host then goes back to the pre-C1 clipped drawing. The most common case is affected:
a row with no caller width whose box the engine clamps to the parent. That is the G4 F2 case itself. The
implementer's own `android-after.png` shows it still clipped at both ends, and the report doesn't
mention it.

The fix changes native code, so **D19 requires a re-review** after the fix round. This is fix round 1
of 2.

## Gate

`bun run check` on `9b563b6`: **exit 0**. That covers:

- typecheck, bench typecheck, lint and prettier;
- jest 158/158;
- `test:native` (262 checks);
- `perf:renders` 5/5;
- nitrogen, autolinking, `bob build`, api-extractor, publint, the manifest and the README checks.

The worktree was clean afterwards (`git status` empty, HEAD `9b563b6`). I did not run the harness or
real-input gates (no devices, per the rules). Their results below are the report's.

## Findings that must be fixed

### M1 — correctness (native): an expired arming is never re-armed, so over-wide content goes back to clipped

**Where:** `android/.../core/NitroComposeHost.kt`

- `:593-608`, `askForBoundedPlacement`, especially the early return at `:598-602`;
- `:557-566`, `onMeasure`, which is its only caller;
- `:1072-1124`, the measure block's guard and overrun branch.

**Mechanism.** `placeAtBoxWidth` is sticky. Only `reset()` clears it (recycle, drop, configuration
change, and the sizing-key `onLayout` branch). When the arming *expires* because `maxWidth` or
`revision` no longer matches the stamps, the measure block asks the unbounded question again. The
content still overruns, so the block re-stamps `armedWidthPx`/`armedRevision`, sets
`contentWantsMoreThanBox = true`, and places the content at its intrinsic width, centred. That is the
clipped drawing. Two things then stop the bounded pass from ever being requested:

1. **The early return swallows it.** `askForBoundedPlacement` sees `placeAtBoxWidth == true` and
   returns without bumping `remeasureToken`. Its comment says "This measure *was* the bounded one, so
   it could not have overrun". That is false: `contentWantsMoreThanBox` is only ever written by an
   unbounded pass, and an expired arming produces exactly an unbounded pass while
   `placeAtBoxWidth` is still `true`.
2. **Compose's own passes never reach it.** `askForBoundedPlacement` only runs from the host's
   `onMeasure`. The host's `onMeasure` only runs when Fabric measures the host with a changed spec
   (`View.measure` skips `onMeasure` for an identical `EXACTLY` spec without `FORCE_LAYOUT`). Several
   passes run inside `AndroidComposeView` instead (`measureAndLayout` from `dispatchDraw`) and never
   come back through the host:
   - the re-measure that `contentRevision` forces after a prop batch;
   - the re-measure that the `onLayout` sizing-key branch requests with `remeasureToken`;
   - a child-size change after recomposition;
   - the first measure after `onConfigurationChanged`'s `reset()`.

   Even with (1) removed, an overrun found in any of those passes stays unarmed until some unrelated
   Fabric layout happens to touch this view.

**Concrete failures:**

- **No caller width, row clamped to the parent (the brief's "narrow parent", G4 F2's actual case).**
  1. A cold key mounts at the 256 dp fallback (`HybridNitroUiSegmentedControl.kt:400`).
  2. The unbounded measure overruns, so the host arms against 256 dp and the bounded pass runs.
  3. The report of about 415 dp is clamped by the engine to the parent (`cpp/NitroUiIntrinsic.hpp:212`).
     Fabric re-measures the host at about 379 dp.
  4. `maxWidth != armedWidthPx`, so the measure is unbounded and overruns.
  5. `placeAtBoxWidth` is still `true`, so the early return fires and nothing else asks.

  **The report's own `docs/tasks/C1-android-overwide/android-after.png` shows this.** Its middle row,
  "SegmentedControl — no width, four labels", is pixel-identical to `android-before.png`. The
  selected "January" segment has a square, cut-off left edge, about 226 px against the other
  segments' 272 px. "April" has no right end cap. The row is clipped at both ends.

  The `armedWidthPx` KDoc (`:1172-1183`) says this exact path is handled ("content that overran the
  engine's *first* guess at a box ... would otherwise be placed at that too-small width forever").
  Not re-placing it is the opposite failure, and the code has it.
- **Caller width changes while still too narrow.** Example: `width` goes from 140 to 120, or a flex
  parent narrows on rotation. The host `onMeasure` does run, and (1) swallows it. The row stays
  clipped at 120.
- **Any `markDirty()` prop on an armed control whose box does not move.** Examples:
  - `tintColor`, `disabled` or `accessibilityLabel`;
  - a programmatic or rejected `selectedIndex`, where `reconcile()` makes `afterUpdate` call
    `markDirty`;
  - a new `options` list that is still over-wide;
  - a Button `title` or `disabled` change.

  In each case the `revision` mismatch causes an unbounded pass in Compose's own `measureAndLayout`.
  Then (2) applies, and (1) applies if a host measure ever arrives. From then on an edge tap hits the
  wrong segment, which is the red log's `overwide:2`. The new test doesn't catch this because it is
  uncontrolled and makes no prop change after arming. A native tap writes `model.displayed` without
  `markDirty`.

**Fix (native):**

- Arm from the pass that detects the overrun, not from the host's `onMeasure`. For example, pass an
  `onOverrun` callback into `NitroUiMeasuredRoot`, the way `onMeasured` is passed. The host's
  implementation sets `placeAtBoxWidth = true` and bumps `remeasureToken`.
  - The bounded pass never takes the overrun branch, so this can't loop.
  - If writing the token inside the measure block is not wanted, `post` it. That costs one frame.
- Delete the `placeAtBoxWidth` early return. With the change above, `contentWantsMoreThanBox` and
  most of `askForBoundedPlacement` go away too.
- Fix the KDocs that describe the old flow (`:568-592`, `:1105-1116`, `:1151-1215`).

**Tests (harness, red on `9b563b6` first):**

1. A narrow parent with no caller width and a **cold** key, so the fallback-then-clamp path runs.
   Use unique labels, because the cache is process-wide. For example,
   `<View style={{ width: 300 }}><SegmentedControl options={[four unique long labels]} /></View>`.
   Assert the reported size is greater than the box width, then `pressAt` both edges and expect the
   last and the first segment.
2. Arm at `width: 140`, re-render at `width: 120`, then `pressAt` both edges.
3. Arm at `width: 140`, change only `tintColor` (or toggle `disabled` and back), wait for the commit,
   then `pressAt` both edges.

### M2 — gate (perf): every `intrinsic` control now pays on every `markDirty()` batch, so the brief's bench condition is met

**Where:**

- `NitroComposeHost.kt:325-331`: `markDirty` bumps `contentRevision`.
- `:1066`: a composition read for every `unbounded` host, armed or not.
- `:1067-1077`: the measure-policy lambda captures `revision`.

**Mechanism.** On a fitting Switch, Button, SegmentedControl or circular Progress, every batch that
calls `markDirty()` now does four things it did not do before:

- restarts `NitroUiMeasuredRoot`;
- hands `Layout` a new measure-policy lambda, because the captured `revision` changed, which calls
  `invalidateMeasurements()` on the root `Layout` node;
- re-measures that node and calls `onMeasured`. `recordMeasuredSize` allocates a `NitroUiDpSize`,
  does a volatile write and an epsilon compare, then dedupes;
- **may trigger a window layout request.** In Compose UI 1.12.1, a re-measure of a direct root child
  goes to `AndroidComposeView.requestLayout()` whenever `wasMeasuredWithMultipleConstraints` is set.
  That flag is true for any host Fabric has measured at two different boxes, which includes every
  mount corrected from a fallback. The request then bubbles up the RN view tree to `ViewRootImpl`.

Before C1 this node was only re-measured when the child's size actually changed. Examples of the new
cost: a JS-driven Switch `value` flip (`reconcile()` → `markDirty`) and a circular Progress `value`
update, which can be per-frame if JS animates it. D17 counters are not affected, because the dedupe
swallows the identical report. `fillWidth` controls are untouched, as claimed: they read `-1` and
never subscribe.

The report's reason for skipping the bench ("every arm fits its box, so the placement pass never
exists there") misses this. The `update.switch`, `update.button`, `update.segmented-control` and
circular `update.progress` arms all go through `markDirty`.

**Fix:**

- **Required:** run the brief's one quick Android bench run for the touched components, labelled,
  against `main`.
- **If it moves:** subscribe only while armed. Keep a snapshot `armed` boolean that the host writes
  when it arms or disarms (outside the measure block), and read
  `contentRevision.value` only `if (unbounded && armed.value)`. Writing `armed` restarts the group, so
  the subscription begins at the moment of arming. That is the gap the report's "v3, only while
  armed" variant fell into, because there the revision *bump* was gated instead of the *read*.

### M3 — report and docs claims to correct (riding on M1/M2)

- `C1-android-overwide.report.md:149-157` says "the same three rows before and after" and describes
  rows 1 and 3 as fixed. It doesn't mention that row 2, the no-width clamp case, is unchanged and
  still clipped. Say so, or replace it with a post-M1 shot.
- `report.md:23-26` claims "Cost is paid only by content that overruns … measures exactly once per
  pass, as before". `core.md:391` claims "only content that actually overran pays for it: a control
  that fits its box measures once, as before". Both are false per M2. Restate after the bench.
- `report.md:28-33`, the bench rationale: see M2.
- `README.md:300-306`, `segmented-control.md:165-176` and `:251-263`, and `button.md:168-171` say
  over-wide content "now fits what it is given" on Android. That is false for the parent-clamp case
  and after any prop change until M1 lands. Keep the wording, but only after the M1 tests are green.
- `report.md` Decisions: "Any other width falls back to the unbounded question … so a box that grows
  back releases the flag by itself" (and the same at `NitroComposeHost.kt:1106-1108`). The *guard*
  expires. The flag is never released, which is the root of M1. Reword.
- Brief item 3 asks for the over-wide case "in a narrow parent". The new SegmentedControl test uses a
  caller `width: 140`, which happens to keep the box width constant from mount and so never
  exercises expiry. M1 test 1 covers the brief's fixture.

## Non-blocking (one line each)

- **One-frame flash after M1.** Every `markDirty()` on an armed control re-asks unbounded first, and
  that pass is drawn. The report question can only be answered unbounded, so this is inherent to the
  design. Document it in `core.md` §7 next to the "one traversal" note.
- **Button test.** The planted red (bounded pass reports the box) legitimately guards the
  "placement never reports" invariant. It is not proof of the C1 fix. The Android centre tap passes
  clipped or not, so Button truncation is evidenced by the screenshot only. The report says this
  correctly; keep it that way.
- **`onConfigurationChanged`** resets the arming without requesting a measure. That is harmless once
  M1 arms from the block. Today it silently disarms on rotation or dark mode, until the next prop
  brings the clip back.
- **Unconsumed flag.** `contentWantsMoreThanBox` left `true` by a Compose-internal pass is consumed
  by whatever host measure comes next, possibly much later. It disappears with M1.
- **Switch `nuiTestWidth` → `markDirty()`.** Correct: it gives iOS parity and puts the write in this
  turn. Sizing suites are reported green with it.
- **Hit-testing, semantics and RTL.** The bounded pass places the child at offset 0, with the box's
  width, so pointer input and semantics bounds come from the placed child and sit inside the box.
  `placeRelative` with a zero offset is RTL-neutral. The SegmentedControl edge-tap test is a real
  hit-test proof for the caller-width case.
- **Loops.** The bounded pass writes nothing and the plain fields are not observed, so there is no
  measure→write→measure cycle. The `revision` composition read can't loop, because only `markDirty`
  (setters) writes it.
- **B1.** The only lifecycle edits are `overWidePlacement.reset()` beside the existing
  `contentSize = null` in `drop()` and `prepareForRecycle()`. There are no new registrations,
  listeners or strategy changes, and one small object per host. The `MountChurn` gate is reported
  green, and the code gives no reason to doubt it.
- **Over-wide in height.** A caller `height` smaller than the control still clips it vertically,
  centred, as documented. That's fine, since both labels are `maxLines = 1`.

## Report claims to correct

See M3. Otherwise:

- The red-first SegmentedControl proof is real: `overwide:2` on the clipped row.
- The routes-rejected list is honest.
- The follow-up about async content changing size is a fair note.

## Do the must-fixes change native code?

**Yes.**

- M1 changes `NitroComposeHost.kt`: arming moves into or behind the measure block, and the early
  return goes.
- M2 may change it too, if the bench shows the per-update cost and the read gets gated on an `armed`
  state.

Under D19 the fix round therefore needs an **Opus re-review**. Its acceptance check is that the three
M1 harness tests are red on `9b563b6` and green after, plus a new `android-after.png` whose no-width
row has both end caps.
