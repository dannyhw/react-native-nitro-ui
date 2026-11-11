# X25 — iOS Form crashes the bench app in `readoptRowlessCells()`

**Branch:** `task/X25-form-ios-bench-crash` (from `main` at `537924c1`) · **Round:** 1 of up to
3 (D19) · **Lease:** `LEASE_PLACEHOLDER` (`DEVICE_PLACEHOLDER` / Metro `PORT_PLACEHOLDER`)

## Summary

**Cause.** `readoptRowlessCells()` asks UIKit to rebuild the cell of every visible item whose
cell holds no row, one turn after a settle. It took those items from
`dataSource.snapshot()` — the *data source's* snapshot, which is one turn behind this class —
and asked for a `reconfigureItems` apply of them all. Two facts meet there. Reconfiguration
must be answered with the cell already on screen: UIKit raises
`NSInternalInconsistencyException` from
`-[UICollectionView _reconfigureCell:forItemAtIndexPath:]` if the provider returns any other
cell. And the Form's provider *does* return another cell whenever it has nothing to draw:
its guard ends in `return UICollectionViewCell()` when `indexPath.section` is past
`sections.count`. So any turn in which React removes a Section — or the whole Form — between
a settle and that apply hands UIKit a reconfigure for an index path whose model is gone, the
provider gives up, and the app aborts. X24's 27 `nitrouibench` crash reports in
`~/Library/Logs/DiagnosticReports` are all one stack, all from
`closure #1 in HybridNitroUiForm.readoptRowlessCells()`, and UIKitCore's own assertion text
for that frame is "dataSource returned a different cell … than the cell being reconfigured,
which is not allowed". The harness never saw it because no case drops a mounted Form in the
turn after its settle; the bench's `mount` arm does that 20+ times per launch.

**Fix**, all in `ios/components/Form/HybridNitroUiForm.swift`:

- The readopt now asks the models, again, in the turn it writes the apply: an item is only
  chased when `path(for: row)` still puts that row at that index path. Behind-the-models
  items are exactly what `applySnapshot` is already queued to fix, one turn later.
- The give-up branch answers a reconfigure with the cell already on screen
  (`giveUpCell(in:at:)`) instead of a new one, so this class of abort cannot come back from
  any other path — including the models moving *during* the apply, which `onRowRemoved` can
  do.
- Items whose cell is not a `NitroUiFormRowCell` are no longer reconfigured — that was never
  legal, since the provider cannot obtain a foreign cell through `nitroui-form-row` — they are
  reloaded, which is allowed to build a new cell. This is the first version of that fix that
  cannot itself abort.
- Android has no equivalent path: its Form keeps rows in their Yoga boxes, so `inCells` is a
  visibility count and there is no cell to come up empty. Checked, nothing to change.

**Also fixed:** the bench app could not bundle at all. `bench/src/implementations/shared.ts`
required `../assets/circle.png`, which is `bench/src/assets/` — a folder that has never
existed. The two vectors gained a `-vector` suffix in the same commit because Android names a
drawable after the require path plus the file name without its extension, so making the
requires resolve made `assets/circle.png` and `assets/circle.xml` one resource name.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |

`need --for review`: NEED_PLACEHOLDER

## Bench

BENCH_PLACEHOLDER

## Red proofs

- `Form (G24) · survives a Form scrolled, reduced and torn down in a loop (X25)` ->
  `git revert` of the Swift fix alone (harness case and everything else unchanged) ->
  RED_PROOF_PLACEHOLDER

## Files changed

- `ios/components/Form/HybridNitroUiForm.swift`: the readopt's stale-identifier filter, the
  reconfigure/reload split, and `giveUpCell(in:at:)`.
- `example/__tests__/Form.harness.tsx`: `ChurnForm`/`Churn` and the churn case.
- `bench/src/implementations/shared.ts`, `bench/assets/*`: the glyph fixture paths, so the
  bench app bundles.

## Follow-ups

- bench/Android: `:app:createBundleReleaseJsAndAssets` still reports UP-TO-DATE over library
  source changes (X24's finding, unfixed here); this round forced the bundle instead.
- form/iOS: the provider's give-up branch still draws a blank cell for an item the models have
  moved under, one settle at a time; the fix keeps it from aborting, not from being blank.
