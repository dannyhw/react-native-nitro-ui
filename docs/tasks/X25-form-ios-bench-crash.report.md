# X25 — iOS Form crashes the bench app in `readoptRowlessCells()`

**Branch:** `task/X25-form-ios-bench-crash` (from `main` at `537924c1`) · **Round:** 1 of up to
3 (D19) · **Lease:** `LEASE_PLACEHOLDER` (`DEVICE_PLACEHOLDER` / Metro `PORT_PLACEHOLDER`)

## Summary

**Cause.** `readoptRowlessCells()` asks UIKit to rebuild the cell of every visible item whose
cell holds no row, one turn after a settle. It built that list from `dataSource.snapshot()` —
the *data source's* list, one turn behind this class — and asked for a `reconfigureItems` apply
of it. Two facts meet there. A reconfiguration must be answered with the cell already on screen:
UIKit raises `NSInternalInconsistencyException` from
`-[UICollectionView _reconfigureCell:forItemAtIndexPath:]` when the provider returns any other
cell. And this Form's provider *does* return another cell when it has nothing to draw — its
guard ends in `return UICollectionViewCell()` once `indexPath.section` is past `sections.count`.
So when React removes a Section, or the whole Form, in the turn between a settle and that apply,
UIKit gets a reconfigure for an index path whose model is gone, the provider gives up, and the
app aborts. X24's 27 `nitrouibench` crash reports are all that one stack, from
`closure #1 in HybridNitroUiForm.readoptRowlessCells()`. No harness case drops a mounted Form in
the turn after its settle; the bench's `mount` arm does it 20+ times per launch.

**Fix**, all in `ios/components/Form/HybridNitroUiForm.swift`:

- The readopt asks the models again in the turn it writes the apply: an item is chased only when
  `path(for: row)` still puts that row at that index path. Items behind the models are what the
  already-queued `applySnapshot` is fixing anyway.
- The give-up branch answers a reconfigure with the cell already on screen (`giveUpCell(in:at:)`)
  instead of a new one, so no other path can abort this way — including models moving *during*
  the apply. That window stays open until the run loop moves on: an apply does not promise to
  run the reconfigure before it returns.
- Items whose cell is not a `NitroUiFormRowCell` are reloaded, not reconfigured — the provider
  cannot obtain a foreign cell through the row registration, so reconfiguring one was never
  legal.
- Android has no equivalent path: its rows live in Yoga boxes, so `inCells` is a visibility
  count and no cell can come up empty.

**Also fixed:** the bench app could not bundle. `bench/src/implementations/shared.ts` required
`../assets/circle.png`, in a folder that has never existed; the two vectors gained a `-vector`
suffix so resolving them does not collide `circle.png` with `circle.xml`, which Android would
name as one drawable.

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
