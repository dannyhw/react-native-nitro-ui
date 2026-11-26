# FIX39 review — iOS Picker size hold

**Verdict: merge.** No blocking findings. The non-blocking items below can ride along or become
follow-ups.

Checked: `git diff 67a68647..HEAD` against Android's `NitroComposeHost.holdSizingReports` /
`releaseSizingReports` and `HybridNitroUiPicker.kt` (`choose`, `afterUpdate`), `useControlled.ts`
and `Picker.tsx` (the echo), DESIGN 3.5/3.6. `gate.mjs need --for review` is satisfied on this tree.

What holds up:

- Stuck hold. The hold is armed only in `applyUserSelection` after the disabled and same-row
  guards (`HybridNitroUiPicker.swift:74-82`), so a disabled picker and a re-tap arm nothing. Every
  armed pick emits, and both wrapper modes re-render with the new count: uncontrolled through
  `lastChoice`, controlled through `useControlled`'s own state, which also covers a refused pick
  (the parent does not have to re-render). A refused pick releases to the caught-up batch,
  `reconcile` reverts, the stamp no longer matches, and the revert's
  `noteContentSizeMayHaveChanged` re-measures unheld. A variant change remounts the view
  (`key={variantKey}`). Recycle and drop clear the hold in the host (`NitroSwiftUIHost.swift:296,
  329`), and recycle clears the stamp. A trait change while held overwrites `heldContentSize`, so
  the newest measure wins. On iOS `<Host>` composes no Picker content, so the Picker always owns
  its host. The release check runs in every `afterUpdate`, so a hold can outlive only a pick that
  JS never answers, which needs a dropped view, and a drop clears it.
- Ordering and threading. Menu, wheel and the test hook all apply through the one binding setter
  or `applyUserSelection`, on main. The hold is set before `objectWillChange.send()`, with no
  layout pass in between. No new `main.sync`/`main.async`. Release runs in `afterUpdate` before
  `commit()` and goes through `reportToSizingEngine` like any report, and earlier than the
  `layoutSubviews` path. A second pick's hold nils `heldContentSize`, so pick 1's measure cannot
  be filed for pick 2.
- Other controls. Default `sizingReportsHeld == false`, so the only per-measure cost is one bool
  branch in `refreshContentSize`. No extra commits or measures for controls that never hold.
- Tests. The third pick in `filesNothingUnderALeftKey` re-poisons the long key, with nothing else
  mounted under it, and expects exactly one correction. A stuck hold on iOS would swallow that
  report and time out at `waitForBox('twice', longSize, 'the third pick')`, so the case catches a
  stuck hold here too. The red proof (caught-up check forced to `true` gives
  `afterPicks.corrections 1`) shows the case fails for the misfile and not just because a hold
  exists. Picker and Sizing suites are green on both platforms.

## Findings

1. **non-blocking** `docs/DESIGN.md:204-206`: "a `Chip`'s toggle — either platform's host holds"
   reads as if iOS holds for a Chip. iOS Chip arms no hold, and its selection is not in its key
   (`docs/components/chip.md:154`). Suggest "a `Picker`'s pick on either platform, a `Chip`'s
   toggle on Android". The report already lists iOS Chip/Menu as a follow-up.
2. **non-blocking** `docs/architecture/core.md:223-236` (iOS list in section 7) does not mention
   the hold. The hold bullet at `:264-266` sits under Android and lists `Menu` and `Chip`, which
   are Android-only. Add an iOS bullet: a measure taken while held is kept, not reported, and
   `afterUpdate` files it.
3. **non-blocking** `NitroSwiftUIHost.swift:274-285`: when a held size is dropped
   (`heldSizeBelongsToBatch == false`), no new measure is queued. Scenario: pick B, then a batch
   that has not caught up changes `options`. Its commit measures and the hold keeps that size.
   The caught-up batch then drops it, because the stamp's options are stale, and flags nothing.
   The new key `(B, newOptions)` is cold and laid out at the 72x35 fallback. If that equals the
   current box, no `layoutSubviews` follows, and the control stays at the fallback until some
   other measure. Main has the same gap for this batch (it misfiled the earlier measure and
   reported nothing for the caught-up key), and Android is built the same way, so this is not a
   regression. A cheap fix: on a drop, mark the host dirty and `noteContentSizeMayHaveChanged()`,
   so that batch's `commit()` measures again unheld. Follow-up for both platforms.
4. **non-blocking** No iOS harness case covers a refused menu pick that changes the title,
   followed by a poisoned re-pick. That would show the refusal path releases the hold. Code
   inspection says it does (see above), and Android's radio case covers the logic there
   (`Picker.harness.tsx:1854` returns early on iOS). Follow-up candidate, not needed for merge.
5. **non-blocking** `NitroSwiftUIHost.swift:252-273`: the doc comments on `holdSizingReports`
   (7 lines) and `releaseSizingReports` (6 lines) are longer than AGENTS.md "Comments" asks for
   (one to three lines). The second paragraph of each can shrink to one sentence: "nothing
   measures here; the next measure applies the update first" and "files the measured size, not a
   new one: the batch's commit has not run". Content is accurate, and it cites no task, review or
   history.
6. **non-blocking** `HybridNitroUiPicker.swift:89-95` compares `options` arrays in every
   `afterUpdate` that holds a stamp, and only then. That is negligible and matches Android's
   `contentEquals`. No action.

DESIGN 3.6 and `docs/components/picker.md:234-239` are otherwise accurate for both platforms:
the hold is armed before the repaint on iOS and in `choose()` on Android, and both release only
to a caught-up batch while the stamp is still shown.
