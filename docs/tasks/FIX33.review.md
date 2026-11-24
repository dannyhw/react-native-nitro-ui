# FIX33 review: Form section layer and the clear count (`0124dd86` vs `origin/main`)

## Verdict

**Fix round needed.** The SearchField part is right. The Form part names a cause the code rules
out. The CI log shows a stale layer, and the change hides that from the case instead of
explaining it.

## Blocking findings

1. **The clamp cannot happen. The report and comments state it as the cause.**
   `NitroUiMeasuredRoot` measures the content with `maxHeight = Constraints.Infinity`
   (`android/.../core/NitroComposeHost.kt:868-876`). So `coerceAtMost(constraints.maxHeight)` in
   main's `withPixelSize` never changed a height. The host view itself is measured `EXACTLY` at the
   section's height (`HybridNitroUiFormSection.kt:451-453`). CI's own report agrees:
   `hostBox=...,296.4`, while `layerBox=...,288.4`. CI's numbers point to a lag instead. In the
   failing log (run 45483759347, also 45470393466), `drawnCards` tops are
   37.3/93.3/149.3/205.3 (56 dp apart) and `cardBoxes` tops are 38.3/96.2/154.1/212.0 (58 dp
   apart). The layer was laid out from an earlier `rects` and an earlier `boxH` (288.4), so the
   whole composition was older than the section. A clamp would leave the row shapes where the
   rows are. Fix: rewrite the Summary's cause paragraph,
   `HybridNitroUiFormSection.kt:830-836` (the "measure spec ... padded one" sentence) and
   `:284-290` to describe the layer lagging the section. CI is a software-rendered emulator, so
   a frame is slow and the one-shot read lands inside it.
2. **The change makes the case pass without the layer being current.** `layerH` now tracks
   `boxH` through a measure-time read. But `rects`, `headerText` and the other inputs are still
   read in composition (`:671-673`). On CI the case would go green while the row shapes are still
   drawn up to 6.7 dp from their rows. That is the user-visible half of the same lag. The brief's
   Behaviour 1 covers this: the case should wait for the settled pair. Change
   `example/__tests__/Form.harness.tsx:2337-2350` to wait (the existing 12 s `sectionReport`
   deadline, no new timeout) until `layerH` is within 1 dp of `boxH` and every `drawnCards` box
   matches its `cardBoxes` box. Then assert as today. If the layer is stuck rather than slow, the
   timeout fails with the report. Keeping `intoSectionBox` is fine; see the note below.
3. **The red proof does not test what changed.** The `boxH - 21f` mutation of the new code shows
   the assertion catches a short layer. CI already showed that. Main's code cannot produce the
   failure through the clamp, so this is not "red on main, green after". Replace it with a proof
   for the new wait. For example, freeze the layer after its first non-zero composition (stop
   reading `rects`/`boxH` updates): the case must time out naming the stale pair. Unmutated, it
   must pass on Android.

## Non-blocking

- Reading `boxW`/`boxH` inside `layout {}` is sound. Compose observes state read in a layout
  modifier's measure and re-measures that node without recomposing. A box change no longer
  recomposes the layer: one fewer recomposition per resize, and no per-frame work. One caveat:
  after the write in `layoutHost`, the node may not be marked dirty before the synchronous
  `host.measure`. Apply notifications for global writes are posted, and the layer's constraints
  do not change when only the height changes (max height is infinite). So it can still trail by
  a frame. Do not claim a synchronous catch-up without showing it.
- Width lost its clamp. A stale, wider `boxW` makes Compose clamp the reported size and centre
  the placeable, which shifts the layer left by half the overflow for that pass. The host's bounds
  clip it, so nothing overlaps. Keeping `.coerceAtMost(constraints.maxWidth)` on width is free.
- `SearchField.harness.tsx:565-573`: the wait asks for a real signal (empty text and a native
  count past the typing, with JS caught up, through `reportedWhen`). It has no sleep, its
  assertions are unchanged, and a clear that is never counted still fails by name. One gap
  remains: `typed` comes from `stateWhen`, not `reportedWhen` (`:552`). If the native report can
  write the text before the count while typing too, `typed.nativeEvents` can be one low. A late
  typing count would then meet `>` and the case would pass without the clear's count. Reading
  `typed` with `reportedWhen` closes that.
- Q5: no. The diff touches only the root modifier of `FormSegmentedLayer` and one wait in the
  clear case, which ends focused and is unmounted by `cleanup`. No IME, focus or submit code
  changed. `harness:android` is still red, so a fresh-device green run is owed before merge.
- CodeRabbit (PR #131): review still "in progress", no inline comments to check yet.

## Follow-ups

- A host option that gives the content the box as bounded constraints would remove the
  `boxW`/`boxH` state. It changes the shared `NitroComposeHost`, so it is its own task.
- Android submit-then-blur reds (`mInputShown=false`): re-run on a fresh device, as proposed.
