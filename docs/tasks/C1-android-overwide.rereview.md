# C1 — Android over-wide content · re-review of fix round 1 (D19)

Branch `task/C1-android-overwide` @ `9332831`. Fix round `9b563b6..9332831`, full range `5282583..9332831`.

**Sources read:** the review, the round-1 report, `NitroComposeHost.kt` (the whole new mechanism), the new harness
tests, the three red logs, `android-after.png`, `core.md` §7, README, `segmented-control.md` and `button.md`.

**Compose UI bytecode** (1.11.4 and 1.12.1 from `~/.gradle/caches`):
- `AndroidComposeView.dispatchDraw`, `measureAndLayout`, `scheduleMeasureAndLayout` and `onRequestMeasure`;
- `MeasureAndLayoutDelegate`, `OwnerSnapshotObserver` and `GlobalSnapshotManager`.

**Bench:** the six result files in `bench/results/`, compared read-only with `scripts/bench/report.mjs --compare`.

**Not run:** no simulator, emulator, adb, Metro, harness or bench run. Harness and real-input results are the report's.

## Verdict: **MERGE-AFTER-SMALL-FIXES** (report and docs only, so no further re-review under D19)

The redesign is correct. The arming is made or released by the unbounded pass that measures the overrun, so it
can no longer outlive its trigger, and M1's failure mode is gone.

I found no loop, no per-frame invalidation, and no Compose-rule violation. The fitting-control fast path is now
truly zero extra recomposition and zero extra measure. The new tests are real and were red on `9b563b6`.

What remains is report honesty about the bench (one must-fix, docs only) plus a few one-liners.

## Gate

`bun run check` on `9332831` exited **0**:
- typecheck, bench typecheck, lint and prettier;
- jest 158/158;
- `test:native` (262 checks);
- `perf:renders` 5/5;
- nitrogen, autolinking, `bob build`, api-extractor, publint, manifest and README checks.

Afterwards the tree was clean (`git status` empty, HEAD `9332831`).

## Check 1: Compose correctness of writing state from inside the measure block

**No synchronous loop, and no "modified during measure" failure.** In both 1.11.4 and 1.12.1:
- `dispatchDraw` and `measureAndLayout` never call `Snapshot.sendApplyNotifications()`. `dispatchDraw` only calls
  `notifyObjectsInitialized`.
- Measure runs in the global snapshot, so the writes to `armed` and `remeasureToken` are global writes.
  `GlobalSnapshotManager`'s write observer sends their notification later, on `AndroidUiDispatcher.Main`.
- Only then does `OwnerSnapshotObserver` call `requestRemeasure`, which leads to `scheduleMeasureAndLayout` and
  then `invalidate()` or `requestLayout()`.
- The ask is therefore always deferred out of the current pass, and neither jar contains a guard string about
  writes during measure or layout.

**Termination.** `armed` uses `mutableStateOf`'s structural policy, so re-arming an already-armed host writes nothing.
The bounded pass skips the verdict block entirely and writes nothing. For a row that stays over-wide:

1. The unbounded pass stamps the width and revision `r`, writes the token, and possibly writes `armed`.
2. The next pass is bounded and then stops.

From cold, the `NO_REVISION` path adds one step:

1. The pass arms with `NO_REVISION`.
2. The `armed` write restarts `NitroUiMeasuredRoot`, which captures `r`.
3. One more unbounded pass stamps `r`.
4. The bounded pass follows.

Each step is a new frame. Nothing keeps writing once the row is bounded, so a row that stays over-wide is not
invalidated every frame. A disarm costs one extra restart and one extra measure, after which the row is quiet.

**Bounded oscillation in one edge case.** A pass that runs before the restart, for example a touch-driven
`measureAndLayout`, re-arms with `NO_REVISION` and bumps the token again. That is bounded by the number of frames
before the recomposition lands, so it is not a loop.

## Check 2: scenarios

Each scenario below is traced through the code.

| Scenario | Result |
| --- | --- |
| Narrow parent, no width, cold key (fallback, then clamp) | **OK.** Each new box misses `armedWidthPx`, the pass is unbounded and re-arms itself. `android-after.png`'s middle row now has both end caps (verified visually). |
| Width change while over-wide (140 → 120) | **OK.** The host's `onMeasure` runs for the new spec, the unbounded pass overruns, re-stamps and bumps the token, and the next frame is bounded. |
| `markDirty()` prop on a fitted row (tint, `disabled`, `options`) | **OK.** The armed group reads `contentRevision`, so `markDirty` restarts it. The new lambda causes a re-measure, the revision mismatch makes the pass unbounded, it re-arms, and the next pass is bounded. There is one clipped frame, which is documented. |
| Configuration change | **OK.** `reset()` restarts an armed group (the `armed` write) and the token forces a pass. See the non-blocking note on the token bump. |
| Box grows so the content fits | **OK.** The width mismatch makes the pass unbounded, the content fits, and the host disarms. The fitting pass is what gets drawn, so no stale bounded placement is drawn. |
| Content shrinks under an armed row | **OK.** The revision mismatch makes the pass unbounded, the content fits, the host disarms, and the new size is reported. |
| Row toggling between fits and doesn't fit | **OK.** Each transition arms or disarms once, and the stamps are rewritten on every unbounded pass. |
| RTL | **OK.** The offset `(W - m) / 2` with `placeRelative` is symmetric under mirroring, and the bounded pass gives `m ≤ W`. |
| Recycle or drop mid-armed (B1) | **OK.** `reset()` runs after `disposeComposition()` and writes a state that now has no readers. `noteOverWide` is a host-owned bound reference held only by the composition. Nothing new is registered. |
| Modal | **OK.** The ask reaches the dialog window through `invalidate()` on its own `AndroidComposeView`. The strict `NO_REVISION` rule is what keeps `Sizing › sizes a control inside a Modal` green (reported green). |
| Native tap on a fitted row | **OK.** The segment `icon = {}`, so selection changes no width. Content that changes size without `markDirty` is an acknowledged follow-up. |

## Check 3: M2

**Code:** verified. For a host that never armed:
- the composition reads only `armed`, never `contentRevision`, so a `markDirty()` batch:
  - restarts no group;
  - gives `Layout` the same lambda;
  - causes no measure;
  - calls `onMeasured` no extra time;
  - triggers no `requestLayout` bubble;
- in a pass that happens anyway, the verdict block only writes the plain fields;
- the `armed.value = …` write is skipped (`overruns || armed` is false);
- the remaining per-batch cost is one global snapshot write of `contentRevision`, which reuses its records in
  steady state, as the report states.

**Bench: the numbers in the table are real, but the selection is not complete.** `report.mjs` reproduces the
table's ratios exactly. However, `bench/results/` holds **five** C1 runs, not the three the report describes:

| Run | Native code | `memory.segmented-control` | Other gated cells |
| --- | --- | --- | --- |
| `1fd68c6` (09:37, `busy`, load 42.8) | Identical to the shipped `b01343d` (the diff between them is test-only) | **0.99x** | `update.button` UI CPU/op **1.51x**, "noisy, over threshold, not conclusive" |
| `b01343d` (the one tabled as "shipped") | Shipped | 1.06x | `update.button` 1.16x |
| Two dirty `9b563b6` runs (08:21, 08:44, during round 1) | Unknown working tree | 1.30x `FAIL` | The 08:21 run also fails `update.segmented-control` UI CPU/op 1.38x (CI 1.16–1.44) and JS CPU/op 2.30x |

What this means for the report's claims:
- The 0.99x and 1.06x come from identical native code, so the 1.06x is run-to-run noise. The report says
  "round 1 about 22 KiB, which is what the feature legitimately carries (a placement object, an `IntState`, one
  stable callback, one extra measure)". That is mislabelled: the objects are about 100 bytes, and a fitting
  control does no extra measure.
- The round-0 1.29x `FAIL` is solid, because three round-0-era runs agree.
- The report's hypothesis for its cause cannot apply to the bench: round 0's token bump in `onMeasure` needed
  `contentWantsMoreThanBox`, which fitting bench content never sets.

## Check 4: tests

The three new `SegmentedControl · G4` cases are real tests:
- The oracle is a `pressAt` at both box edges, which is independent of the fixture.
- Test 1 also asserts box ≈ parent and intrinsic > box + 20.
- `COLD_SIX` appears nowhere else in `example/`, so the key really is cold.
- `red-m1-tests-on-9b563b6.log` shows 3 failed and 15 passed, with the predicted neighbour segments (`clamped:4`,
  `narrowing:2`, `tinted:2,tinted:1`). Test 1 passing its first 300 dp step on the old code matches the M1
  mechanism.

On robustness under load, there is no false-green path:
- Old code stays clipped permanently.
- Test 3 polls the handle's `tintColor` and then settles for 400 ms.

Tests 1 and 2, however, tap straight after `waitForBox`. On fixed code the fit lands one or two frames after the
box, so a slow tap dispatch could catch the clipped frame (see N3).

## Check 5: docs and report vs code

These match the code:
- `core.md` §7 (:385-414);
- README :300-306;
- `segmented-control.md` :165-176 and :251-263;
- `button.md` :168-172.

The exceptions are listed below.

## Must-fix (docs only, not native)

**F1 — the report's M2 bench section is selective and mislabels the 1.06x.**
- **Where:** `docs/tasks/C1-android-overwide.report.md`, :280-336 and Follow-ups :453-455.
- **Problem:** see Check 3.
- **Fix:**
  - Add the `1fd68c6` column. It is the same native code as the shipped tree, `busy`, with
    `memory.segmented-control` 0.99x and `update.button` 1.51x noisy and not conclusive.
  - Mention the two dirty runs and their `FAIL`s, labelled as work-in-progress trees.
  - Replace "about 22 KiB, which is what the feature legitimately carries" with "1.06x and 0.99x on identical
    native code: noise; the feature's own footprint is about 100 B per instance".
  - Mark the round-0 mechanism as unexplained. The `onMeasure`/`requestLayout` hypothesis cannot apply, because
    fitting bench content never armed in round 0.
  - Change "three labelled runs" to the correct count.

## Non-blocking (one line each)

- **N1:** the screenshot caption at `report.md:200-201` says "each label reduced to an ellipsis", but the middle
  row in `android-after.png` shows full labels (January…April). Only the 140 dp rows ellipsize.
- **N2:** the comment at `NitroComposeHost.kt:1109-1112` says the arming and its width are "plain fields", but
  `armed` is snapshot state read in this block. Say the stamps are plain fields and that `armed` is safe to
  observe because its writes are idempotent and stop at the bounded pass.
- **N3:** in tests 1 and 2, add `await settle()` after each `waitForBox` before `pressBothEnds`, as test 3 does,
  so a loaded emulator cannot tap during the legitimate clipped frame.
- **N4:** "deferred to the end of the traversal" (`NitroComposeHost.kt:607`, `report.md:240` and `:331`) is
  imprecise. The ask goes through the global apply notification on `AndroidUiDispatcher`, then `invalidate`, then
  the next frame. Also, the cold or reset path draws two unbounded frames, not one (the `NO_REVISION` hop), so
  `core.md:409-414`'s "one clipped frame" applies to the `markDirty` case only.
- **N5:** the token bump in `onConfigurationChanged` (`:876`) is redundant for armed hosts, because the `armed`
  write already restarts the group and changes the lambda. For every other host it costs one re-measure, a JNI
  report and a flush listener on each rotation or dark-mode switch. Gate it on whether the host was armed, or
  drop it (FOLLOWUPS).
- **N6:** a cold mount whose fallback is narrower than its content (a Button over 91 dp, a row over 256 dp)
  now arms and then disarms, costing about two extra restarts and one or two extra measures. This applies to
  cold mounts only, the `ColdSizing` gates are reported green, and the bench is warm (FOLLOWUPS if cold batches
  matter).
- **N7:** the round-1 iOS real-input gate passed only on a retry (a `switch` HID tap). It is disclosed, and C1
  does not touch iOS code.

## M1 / M2 / M3 status

- **M1: verified resolved.** The arming now comes from the pass that detects the overrun, the early return is
  gone, `onConfigurationChanged` asks for a pass, and all four scenarios hold. The new screenshot shows the
  no-width row inside its box.
- **M2: verified in code.** For a fitting control there is no extra recomposition, measure, `onMeasured` or
  `requestLayout` per batch; one snapshot write remains. The bench claim needs the F1 relabelling.
- **M3: mostly resolved.** The README, component docs, `core.md` and KDocs are corrected. F1 and N1 remain.

## Do the must-fixes change native code?

**No.** F1 is report-only. N2 and N4 are comment-only, and N3 changes a test only. Under D19 this is a doc/test
fix that merges on green gates without another Opus re-review.
