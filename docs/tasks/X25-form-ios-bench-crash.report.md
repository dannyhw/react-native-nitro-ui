# X25 — iOS Form crashes the bench app in `readoptRowlessCells()`

**Branch:** `task/X25-form-ios-bench-crash` (from `main` at `537924c1`) · **Round:** 1 of up to
3 (D19) · **Lease:** none — see "Gates": the pool's two device leases stayed held by other tasks
for the whole four-hour wait, so no device gate ran in this round.

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

`need --for review`: `check` is green on this tree (99 s); `harness:ios`, `harness:android`,
`real-input:ios` and `real-input:android` are **missing** — no device lease came free during this
round. `acquire --task X25 --boot --wait-minutes 240` polled from 08:34 to 12:34 while G30 held
pair-a and G31 then X24 held pair-b, each re-acquiring the moment it released; the pool grants to
whichever waiter polls first, so four waiting tasks share two pairs at random.

Everything a fix round needs is already built and stamped, so its only cost is the device time:
the fixed iOS and Android example apps (both from this tree), the **pre-fix** iOS app, and the
bench apps. The red proof's starting state is one command: put the pre-fix Form file back with
`git show e002d66b~1:ios/components/Form/HybridNitroUiForm.swift > <same path>`, which
reproduces byte-for-byte the code tree that app was built from (`app.stamp` refuses any other
tree, which is also what proves the app under test is that one), then
`gate.mjs harness:ios -- Form`. The worktree is left clean at HEAD rather than sitting in that
state, because a round that ends without a device should leave a tree that says what it is.

## Bench

Not run: the bench measures on the leased simulator and emulator, and there was no lease. The
iOS `mount.form` numbers this section is supposed to carry are the gap X24 left open; the fix is
in this branch, the measurement is not.

## Red proofs

- `Form (G24) · survives a Form scrolled, reduced and torn down in a loop (X25)` -> restore
  `HybridNitroUiForm.swift` from `e002d66b~1` alone (harness case and everything else unchanged,
  and the pre-fix app is already built from exactly that tree) -> **not yet run**: it needs
  `gate.mjs harness:ios -- Form` on a device, which this round never got. The crash itself is not
  in doubt — 27 reports, one stack, quoted in the appendix — but the red half of this test is
  unproven, so the test is a guard and not yet a proof.

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
- pool: `acquire` grants a freed pair to whichever waiter polls first, so a task that has waited
  four hours loses it to one that waited four minutes; a FIFO queue would have given X25 a pair
  at least twice during this round.

## Questions for orchestrator

1. **Device time, not code, is what this task still needs.** Both pairs were held for all four
   hours of the wait, each release immediately retaken by the task that released it. Options:
   (a) give X25 a round when the pool is quiet and it can hold a pair for ~90 minutes — that is
   the red-proof run, four gates, and the bench; (b) let this round finish without device time,
   accepting an unproven red; (c) raise `maxDeviceLeases` for a short window. Recommend (a) with
   a scheduled retry at a quiet hour — everything it needs is already built and stamped.
2. **Is a grant order worth fixing in `lease.mjs`?** A `requestedAt` sort in the grant path is a
   few lines and would stop starvation; it is out of X25's scope, so it is only a line in
   Follow-ups here.

## Appendix — the crash evidence

27 `nitrouibench-*.ips` reports from X24's bench runs are all the same abort, and all of them
are still on the machine's DiagnosticReports folder. From the newest:

- `exception`: `EXC_CRASH / SIGABRT`, `termination`: `Abort trap: 6`, raised by the app itself.
- `lastExceptionBacktrace`, top down: `__exceptionPreprocess` → `objc_exception_throw` →
  Foundation `_userInfoForFileAndLine` (the frame that attaches the message to an
  `NSInternalInconsistencyException`) → `-[UICollectionView _reconfigureCell:forItemAtIndexPath:]`
  → `-[UICollectionView _reconfigureItemAtIndexPath:]` →
  `__49-[UICollectionView reconfigureItemsAtIndexPaths:]_block_invoke` →
  `-[UICollectionView reconfigureItemsAtIndexPaths:]` →
  `[_UIDiffableDataSourceViewUpdater _performViewUpdates:]` → the diffable apply — and below
  that, the frames X24 recorded, `closure #1 in HybridNitroUiForm.readoptRowlessCells()`.

`_reconfigureCell:forItemAtIndexPath:` is the only frame in that path that can raise, and it
raises for one reason: the data source answered a reconfiguration with a cell other than the one
on screen.
