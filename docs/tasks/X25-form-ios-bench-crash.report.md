# X25 — iOS Form crashes the bench app in `readoptRowlessCells()`

**Branch:** `task/X25-form-ios-bench-crash` (from `main` at `537924c1`) · **Round:** 2 of up to
3 (D19) — round 1 ran no device gate; the cause above is corrected and everything device-side lives
in "Fix round 2" below. · **Round 1 lease:** none — see "Gates": the pool's two device leases stayed held by other tasks
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
| `check` | **PASS** | 2013 tests / 85 suites | `cf27f27206b3` | 3 m 28 s | start 11.5 / med 22.2 / max 29.5 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |

`need --for review`: `check` — green; `harness:ios`, `harness:android` — never run on this tree,
which is all `need` can ask for at review (`real-input:*` arrive at merge). No device lease came
free during this round. `acquire --task X25 --boot --wait-minutes 240` polled from 08:34 to
12:34, and again from 12:32, while G30 held pair-a and G31 then X24 held pair-b, each
re-acquiring the moment it released; the pool grants a freed pair to whichever waiter polls
first, so four waiting tasks share two pairs at random.

Everything a fix round needs is already built and stamped, so its only cost is the device time:
the fixed iOS and Android example apps (both from this tree), the **pre-fix** iOS app, and the
bench apps. The red proof's starting state is one command —
`git show e002d66b~1:ios/components/Form/HybridNitroUiForm.swift > ios/components/Form/HybridNitroUiForm.swift`
— which reproduces byte-for-byte the code tree that app was built from (`app.stamp` refuses any
other tree, which is also what proves the app under test is that one), then
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

## Fix round 2

**Cause, corrected.** Round 1 was half right, and the shipped fix is not the readopt filter. All
three aborts are one question asked three ways: `applySnapshot()` is coalesced to the next turn, so
a recycled or dropped Form clears `sections` a turn *before* its snapshot leaves the list, and the
next layout then asks the *next* mount's provider for content this Form has dropped. A `nil` band
asserts in `__UIDiffableDataSource`'s supplementary provider; a bare `UICollectionViewCell()`
aborts in `-_createPreparedCellForItemAtIndexPath:`; answering a reconfigure with a foreign cell
aborts in `-_reconfigureCell:forItemAtIndexPath:` — X24's bench stack.

**Fix.** `prepareForRecycle` takes the list's `dataSource` away with the models, so there is nothing
to ask until the next mount applies its own content (`applySnapshotNow` installs one). A registered
`NitroUiFormBlankCell` and `Self.emptyBand` replace the two answers UIKit cannot accept. Round 1's
readopt filter and reconfigure/reload split stay; debug instrumentation is out.

**Red proof** (supersedes round 1's "not yet run"):
`Form (G24) · survives a Form scrolled, reduced and torn down in a loop (X25)` -> restore
`HybridNitroUiForm.swift` from `e002d66b~1`, nothing else changed ->
`The app bridge disconnected during test execution`, `Tests: 0 total`, **FAIL 11.9 s**
(`harness:ios:Form.harness:-t:X25`, tree `851146ee7384`); **PASS 12.1 s** on the fixed tree.

## Fix round 2 — gates

HEAD `b6c69bcf`, code tree `8ede3623ea3e`, lease X25-ovlyd (pair-a: iPhone 17 / iOS 27.0,
`emulator-5574`).

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2013 tests / 85 suites | `8ede3623ea3e` | 2 m 49 s | start 7.9 / med 7.7 / max 10.6 |
| `harness:ios` | **FAIL** | 1 failed of 594 tests / 31 suites + isolated 6 tests / 3 suites | `8ede3623ea3e` (ios tree) | 16 m 43 s | start 14.7 / med 7.9 / max 28.8 |
| `harness:android` | **PASS** | 650 tests / 31 suites + isolated 6 tests / 3 suites | `8ede3623ea3e` (android tree) | 18 m 23 s | start 11.2 / med 5.9 / max 19.5 |
| `real-input:ios` | **PASS** | — | `8ede3623ea3e` (ios tree) | 40 m 45 s | start 13.4 / med 8.1 / max 32.5 |
| `real-input:android` | **PASS** | — | `8ede3623ea3e` (android tree) | 62 m 57 s | start 5.7 / med 5.5 / max 44.1 |

`need --for review`: `check` ✓, `harness:android` ✓, `harness:ios` ✗ on one test — G24's E4, which
is red on `main` on this simulator (next section). `real-input:*` are the merge bar; both are green
here. Round 1's device gates ran on `d7097d724a7c`; `check` then went red on one prettier error in
the test file, so `b6c69bcf` (a 3-line wrap, no behaviour change) is the tree above and every device
gate was re-run on it.

Three runs went red first and green on a re-run, and the ledger's load column says why:

- `real-input:android` at `d7097d724a7c`: this task's own `mount.form` bench was on the same
  emulator, and the bench `am force-stop`s `nitroui.example` on its way in (logcat 20:32:22, in the
  store's copy of that log). Dead at 22 min with no app process; alone, 62 m 57 s green.
- `harness:android` first attempt: E1's 1000 ms render budget expired with load1 peaking at 82.0
  while another task booted pair-b. Alone (median 5.9), 647 of 650, 0 failed.
- `real-input:ios` first attempt: `testRealInputForm`'s hosted-Switch tap did not reach JS within
  8 s with load1 at 143.4. Alone (median 8.1), green.
- E4 in `harness:ios` is not load: it fails identically in isolation on both trees, and on `main`.

## Fix round 2 — E4 is red on `main`, on this simulator

`harness:ios` fails one test: `Form (G24) › aims a row content at its Yoga origin on iOS and presses
it on Android (E4)`, `expect(probe.log.pressable).toBe(0)` — expected 10 to be 0. With
`HybridNitroUiForm.swift`, `NitroUiFormViews.swift` **and** `Form.harness.tsx` all restored to the
branch base `537924c1` — main's Form code and main's harness file together, tree `9b1dd98b05b6` —
that one test still fails on pair-a, in isolation, in 16.1 s. So E4 is red on `main` on the pair-a
iPhone 17 / iOS 27.0 simulator, not here.

## Fix round 2 — bench

`node scripts/bench/run.mjs --platform <p> --plan quick --only nitro-ui --component form`, 4
launches, 80 samples, at HEAD `b6c69bcf` (`bench/results/b6c69bcf-{ios,android}-*.json`); the
`rn-core` arms were filtered out, so no ratio is quoted.

| Cell | presented | mounted | JS commit | JS CPU/op | UI CPU/op | bytes/inst |
| --- | --- | --- | --- | --- | --- | --- |
| `mount.form` N=20 · iOS | 16.10 ms | 9.82 ms | 1.48 ms | 2.58 ms | 18.77 ms | — |
| `mount.form` N=50 · iOS | 16.14 ms | 18.75 ms | 3.37 ms | 5.10 ms | 22.88 ms | — |
| `update.form` N=50 · iOS | 16.06 ms | 2.71 ms | 2.43 ms | 2.56 ms | 4.50 ms | — |
| `memory.form` N=200 · iOS | — | — | — | — | — | 163.2 KiB |
| `mount.form` N=20 · Android | 32.52 ms | 25.32 ms | 2.57 ms | 5.61 ms | 16.02 ms | — |
| `mount.form` N=50 · Android | 44.26 ms | 31.77 ms | 4.32 ms | 9.39 ms | 28.64 ms | — |
| `update.form` N=50 · Android | 30.17 ms | 15.73 ms | 2.62 ms | 2.81 ms | 4.87 ms | — |
| `memory.form` N=200 · Android | — | — | — | — | — | 192.4 KiB |

`mount.form` — the cell that aborted on 8 of X24's 8 launches — completed every launch on both
platforms with `problems: []`. Android's `memory.form` splits 131.6 KiB native + 40.1 KiB Java.

## Fix round 2 — what the crash looked like from inside

`NUI25` `NSLog` probes (since removed) caught the abort live on the pre-fix Form code:
`recycle models=0 snapSections=2` — the recycled list still holding the ended mount's two Sections —
then `giveUpRow at [1,0..6] models=1 snapItems=14` for the rows and
`bandNoModel …SectionHeader at [1,0] models=1` for the band, and the abort. One stale question,
three fatal answers.

## Fix round 2 — follow-ups

- bench: a bench run `am force-stop`s the example app on its lease's emulator, so it silently kills a
  `real-input` run in progress. It should refuse while a device gate holds the same lease.
- harness: E1's 1 s render budget and `real-input`'s 8 s tap budget read as component failures when
  another task boots a device pair mid-run (load1 82.0 / 143.4 here). A budget that scales with the
  run's own load, or a load1 refusal for `real-input` like the harness has, would say "environment".
- harness/iOS: G24's E4 is red on pair-a on `main`; it is the only thing between this branch and a
  green `harness:ios`.
- form/iOS: the give-up branch still draws a blank cell or band for content the models moved under,
  one settle at a time. Round 2 makes every such answer legal, not unnecessary.
- pool: round 1's starvation is fixed by X26's queue (in flight elsewhere); pair-a came free to this
  task the moment it was released, both times.

## Fix round 2 — questions for orchestrator

1. **E4 blocks a green `harness:ios` for anything on pair-a, including `main`.** Options: (a) treat
   pair-a's iPhone 17 / iOS 27.0 as the device at fault, re-run `harness:ios` on pair-b at merge and
   take that as the merge decision; (b) give G24 a look at the E4 probe on an iOS 27 simulator.
   Recommend (a) now and (b) as its own task — the probe is G24's, outside X25's scope, and this
   round did not touch it.
2. Nothing else is open. Round 1's question 1 (device time) answered itself: a pair came free twice,
   and its question 2 (FIFO grants) is X26.
