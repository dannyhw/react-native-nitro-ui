# FIX38 review: round 1

**Verdict: merge.** No blocking findings. Findings 1 to 4 are cheap. Fold them in if a fix round
happens for another reason; otherwise file them as follow-ups.

Diff reviewed: `c3a8b3a9..HEAD` (`f34f6269`).

## Checked, no finding

- **Can the hold stay open forever?** Every path that sets a hold also sets `pickStamp`
  (`choose` → `applyUserSelection` true → `holdSizingReports`). Every path that clears one
  clears both: `afterUpdate` on a caught-up batch, `prepareForRecycle` (`model.reset()` zeroes
  both counts and the stamp; the host clears `sizingReportsHeld`), and `drop`.
  - A pick that JS never answers cannot happen. The echo is Picker-local state, so the Picker
    re-renders itself even when the parent never does. It is set before the app's `onChange`
    runs: `useControlled` echoes first, and the uncontrolled branch calls `setLastChoice` before
    `forwardNativeChange` (`Picker.tsx:281-287`). A handler that throws cannot strand it.
  - A controlled parent that rejects the pick: the echo batch carries the old index and is
    caught up, so `reconcile` reverts and the hold is released unfiled. Same as main.
  - A disabled pick, or a pick of the row already shown, returns false and holds nothing.
  - A variant change remounts the view (`key={variantKey}`, new sizing id).
  - The only way to strand the hold is a pick with `model.onChange == null`. That happens only
    after `onDropView`, and recycle resets it.
- **Uncontrolled echo.** It changes nothing but release timing. `reconcile()` returns at
  `js ?: return false` on Android (and at `guard let js` on iOS), so `jsEvents` only gates the
  release. `defaultSelectedIndex` stays behind `didApplyDefault`. The Picker gets no extra
  render, because `setLastChoice` already rendered once per pick on main. The code matches
  Chip's uncontrolled path line for line (`Chip.tsx:223-241`). Picker skips Chip's
  `SELECTION_RESIZES` gate, but on iOS the echo has no effect.
- **Wheel.** The release block does not read `noteWheelBatch` or `syncWheelRow`. A stale
  controlled batch is refused by `reconcile`, so `displayed` does not move and the drum is not
  re-seated. A pick from a wheel coming to rest goes through the same `choose` → hold → echo
  path.
- **A single ordinary pick.** The batch after it is the echo batch, so it releases on the same
  batch as before. The existing cases 974, 1109 and 1194 keep `corrections` at 1. They wait for
  the box to reach the long title under a poisoned key, so they would also time out on a stuck
  single-pick hold.

## Findings

1. **Non-blocking: the new cases cannot see a stuck hold on the path they add.**
   `example/__tests__/Picker.harness.tsx:1247-1371`. Both picks end on `One`, the title the
   control started on, and key 0 already holds the short width. If the hold carried over the
   stale batch and never released, `twice` would still lay out at `shortSize` from the cache,
   and the case would stay green. Failure scenario: a later edit releases only on
   `jsEvents == nativeEvents`, or drops the stamp on the stale batch but keeps the hold. The
   control then never re-sizes after a quick double pick, and nothing goes red. Fix: after the
   two picks, re-poison `sizingKey(OPTIONS, 2, …)`, pick 2 once more, and `waitForBox` the long
   size. The report also has no red proof that the JS echo is needed. Removing it should leave
   case 1109 timing out at `waitForBox('unc', longSize, …)`. One line in the report would close
   that.
2. **Non-blocking: a doc comment is now false.**
   `HybridNitroUiPicker.kt:120-123` says `pickStamp` is "read once by the next `afterUpdate`,
   which clears it". It now survives every batch until one catches up. `choose`'s KDoc
   (`:615-616`, "only arrives with the next props batch") has the same problem.
3. **Non-blocking: the `afterUpdate` comment.** `HybridNitroUiPicker.kt:1325-1329` is five lines
   (AGENTS.md asks for one to three). Its first sentence, "The batch a held size report was
   waiting for has landed", is no longer true when this block runs. Chip's three-line comment
   (`HybridNitroUiChip.kt:545-547`) says the same thing correctly.
4. **Non-blocking: DESIGN.md.** 3.5 (`docs/DESIGN.md:153`) says an uncontrolled interaction
   "costs no React render". That is false for an uncontrolled Picker and Chip, though it was
   already false before this branch. Neither 3.5 nor 3.6 describes the rule these two
   components now share. Chip's uncontrolled echo is not described anywhere either. The rule:
   when a native interaction changes a control's size, the host holds its size reports until a
   batch has `jsEvents >= nativeEvents`, and the uncontrolled wrapper renders and echoes each
   interaction so that batch always comes. Two sentences in 3.6, plus a qualifier on the 3.5
   sentence, would cover it. The report lists this as a follow-up. A fix round should take it.
5. **Non-blocking: the iOS skip hides a reproduced iOS misfile.**
   `Picker.harness.tsx:1374-1377` justifies `it.skip` on iOS with "a path this case cannot speak
   for". The report says the same two-pick sequence costs one correction on iOS too. The brief
   allows the skip, but the follow-up should be filed as an iOS Picker sizing bug, not as a
   "reading". The comment would be better saying plainly that iOS misfiles here too, so the case
   is Android-only for now.

## Comments (AGENTS.md)

`Picker.tsx` and the test comments pass: no history, no task IDs, and they stand alone. The
Kotlin comments are covered in findings 2 and 3.
