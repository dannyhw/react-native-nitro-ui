# X29 — Form's E4 case is red on one simulator only

**Branch:** `task/X29-form-e4-pair-a` (from `main` at `7e8bbf1b`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `X29-xf97x`, `X29-34ykm`, `X29-3a02x` (pair-a — simulator "nitro-ui A" / iOS 27.0,
`emulator-5574`, Metro 8295).

## Summary

**Cause: one content width for rows that do not share a box — plus a chase that could not see a
stolen row. Neither is a simulator setting.**

`Form` publishes **one** content width for the list (→ every `Form.Row`'s `style.width`). The box is
per row: `NitroUiFormRowCell` pins its container to the cell's `layoutMarginsGuide`, and a cell
drawing a trailing accessory shrinks that guide for its row — `boxSpan=22.00`: 338 pt beside 316 at
`listW=402.00`, 340 beside 318 at 420. Before any cell reports, the number is `attributesWidth()` —
the *cell*'s width: `w=370.00` at 402, `380.00` at 420.

Too wide is not cosmetic. Content laid out past a row's bounds is drawn there, but UIKit's
`hitTest:` stops at those bounds: the touch's view is the cell, React Native walks *up* from there
and never reaches the `Pressable`, which counts nothing. E4's `Pressable` is 75.7 pt wide, so it
survives an overhang under half that — 37.85 pt. A 370 pt guess over a 338 pt box overhangs **32
pt**; 380 over 340, **40 pt** — opposite sides of 37.85, the whole difference between the
simulators: one counted ten presses so the old `toBe(0)` went red, the other counted
none and passed. Which number ruled at the presses races the cells' first layout, so pair-b is not
exempt: X25-merge's `harness:ios` on "nitro-ui B" today also fails E4.

**Second bug, which E4 could dodge.** Adoption is `addSubview`, which *moves* a row, and a move is
silent toward the cell losing it, so that cell kept naming a row it was not drawing; the chase asked
"which cells hold no row", so it skipped the one repair that could help and the item's own row sat in
its section's hidden holding view — no pixels, and a press at its measured centre lands on the
neighbour. Measured `rowsInCells=8` against `rows=9`: red in 3 of 4 runs, green 4 of
4 after.

**Fix.** A cell reports its box *to the row it draws* (`Form.Row`'s `onContentBox`; Android has no cells
and answers nothing), so each row is laid
out at its own box. The list-wide number stays as the pre-layout estimate, clamped to the last real
box: too narrow only moves content inward, where a finger reaches it. E4 waits on the new witnesses
(`boxMismatch`, `boxSpan`, `wrongCells`…), asserts `boxSpan > 0` so the wait cannot go
vacuous, and expects ten presses on iOS as on Android.

## Gates

The one table `gate.mjs table` prints for the tree this branch now carries — `00664591cf2a`, which is
fix round 2. The full `harness:ios` and the four red proofs ran under lease `X29-cq1q0` on **pair-b**
(simulator "nitro-ui B", iOS 27.0) — the device that died; `harness:ios:Form.harness` and
`harness:android` ran under lease `X29-go41j` on **pair-a** ("nitro-ui A" / `emulator-5574`). Every
`stale` row is a mutation run from some round, not a gap: rows 11-14 below-the-line are this round's.
Round 1's runs (tree `effa2d29e8e2`) and the earlier reds are in the exported ledger,
`docs/tasks/X29/gates.jsonl`.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2093 tests / 88 suites | `00664591cf2a` | 2 m 43 s | start 8.3 / med 8.4 / max 11.3 |
| `harness:ios` | **PASS** | 616 tests / 32 suites + isolated 6 tests / 3 suites | `00664591cf2a` (ios tree) | 14 m 58 s | start 5.5 / med 5.6 / max 22.1 |
| `harness:android` | **PASS** | 672 tests / 32 suites + isolated 6 tests / 3 suites | `00664591cf2a` (android tree) | 18 m 45 s | start 9.8 / med 5.6 / max 14.3 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:ios:Form` | stale | 1 failed of 130 tests / 3 suites | f5792bd32323 (not this tree) | 3 m 46 s | start 15.3 / med 7.3 / max 15.3 |
| `harness:ios:Form.harness` | **PASS** | 18 tests / 1 suites | `00664591cf2a` (ios tree) | 25.6 s | start 10.3 / med 10.7 / max 10.9 |
| `harness:ios:Form.harness:--verbose` | stale | 0 tests / 1 suites | 1b1fa80a815f (not this tree) | 20.1 s | start 19.5 / med 19.5 / max 19.8 |
| `harness:ios:Form.harness:-t:Form.G24.%7CForm.measure` | stale | 18 tests / 1 suites | 1b1fa80a815f (not this tree) | 11.2 s | start 21.8 / med 21.6 / max 21.8 |
| `harness:ios:Form.harness:-t:Form.measure` | stale | 18 tests / 1 suites | 1b1fa80a815f (not this tree) | 11.0 s | start 13.6 / med 13.6 / max 13.6 |
| `harness:ios:Form.harness:-t:Form.measure%7CForm.row.content` | stale | 18 tests / 1 suites | 1b1fa80a815f (not this tree) | 10.9 s | start 9.9 / med 11.2 / max 12.5 |
| `harness:ios:Form.harness:-t:Form.measure%7CForm.row.content%7CForm.row.boxes` | stale | 0 tests / 1 suites | 1b1fa80a815f (not this tree) | 11.1 s | start 15.8 / med 15.0 / max 15.8 |
| `harness:ios:Form.harness:-t:Form.row.boxes` | **PASS** | 18 tests / 1 suites | `00664591cf2a` (ios tree) | 11.2 s | start 6.3 / med 6.5 / max 6.7 |
| `harness:ios:Form.harness:-t:Form.row.content` | stale | 18 tests / 1 suites | 1b1fa80a815f (not this tree) | 9.9 s | start 13.5 / med 13.3 / max 13.5 |
| `harness:ios:Form.harness:-t:Form.row.content%7CForm.row.boxes` | stale | 0 tests / 1 suites | 1b1fa80a815f (not this tree) | 10.1 s | start 12.5 / med 11.8 / max 12.5 |
| `harness:ios:Form.harness:-t:Form%20.G24.` | stale | 18 tests / 1 suites | 1b1fa80a815f (not this tree) | 19.1 s | start 29.6 / med 26.2 / max 29.6 |
| `harness:ios:Form.harness:-t:gains.an.accessory` | stale | 18 tests / 1 suites | 1b1fa80a815f (not this tree) | 10.5 s | start 37.8 / med 36.6 / max 37.8 |
| `harness:ios:Form.harness:-t:item%202` | stale | 1 failed of 18 tests / 1 suites | d5fbcfcfe15f (not this tree) | 11.8 s | start 5.9 / med 6.6 / max 7.3 |
| `harness:ios:Form.harness:-t:no.row.back.as.a.loss` | stale | 1 failed of 18 tests / 1 suites | 4591ebc3dcec (not this tree) | 11.2 s | start 7.7 / med 8.0 / max 8.3 |
| `harness:ios:Form.harness:-t:no.row.back%7CForm%20.G24.` | stale | — | 659d1a63edaf (not this tree) | 1.1 s | start 6.1 / med 6.1 / max 6.1 |
| `harness:ios:Form.harness:-t:no.row.back%7Cgains` | stale | 0 tests / 1 suites | 1b1fa80a815f (not this tree) | 10.1 s | start 10.9 / med 10.3 / max 10.9 |
| `harness:ios:Form.harness:-t:no.row.back%7Cre-lays` | stale | 0 tests / 1 suites | 1b1fa80a815f (not this tree) | 10.2 s | start 10.2 / med 10.2 / max 10.2 |
| `harness:ios:Form.harness:-t:re-lays.a.row` | stale | 1 failed of 18 tests / 1 suites | 30b89b4dfc02 (not this tree) | 19.3 s | start 9.2 / med 9.8 / max 9.8 |
| `harness:ios:Form.harness:-t:re-lays%20a%20row` | stale | 18 tests / 1 suites | 1b1fa80a815f (not this tree) | 11.4 s | start 13.3 / med 25.0 / max 36.8 |
| `harness:ios:Form.harness:-t:re-lays%7Cgains` | stale | 18 tests / 1 suites | 1b1fa80a815f (not this tree) | 10.8 s | start 10.2 / med 10.6 / max 10.9 |
| `harness:ios:Form.harness:-t:X29%20r2` | stale | 2 failed of 18 tests / 1 suites | cd5b419f2107 (not this tree) | 11.4 s | start 10.4 / med 10.4 / max 10.5 |
| `harness:ios:Form.harness:-t:X29%20r2:--background` | stale | — | 168b2bdae41d (not this tree) | 2.0 s | start 15.3 / med 15.3 / max 15.3 |
| `harness:ios:Form%20row%20boxes` | stale | — | d44e2c1ef83e (not this tree) | 1.8 s | start 5.3 / med 5.3 / max 5.3 |

Every device row above is pair-a (simulator `49D5024D…`, `emulator-5574`, Metro 8295) under lease
`X29-48jce`; the pair-b row X29 was also asked for is the one it could not run — see Follow-ups.

`need --for review`: `need: review is satisfied on this code tree.` (`check`, `harness:ios` on the
ios tree, `harness:android` on the android tree; `Form.harness.tsx` counts as both platforms, which
is why this round owes both device runs and got them.)

## Red proofs

- `Form.harness` E4 -> `expect(probe.log.pressable).toBe(0)` on `main`'s own files, pair-a -> the
  tap loop counted `tap9 pressable=10` (`02:24:22Z`): the red the task was filed on.
- E4's geometry wait -> `contentBoxReported(bounds.width + 22)` in `NitroUiFormRowContainer.layoutRow`
  (tree `0fe6ca55`) -> report `boxMismatch=22.00`, `Form report never satisfied "every row drawn by
  exactly one cell, at its own box"` (`04:45:10Z`).
- E4's geometry wait -> the chase without the `onRowLost` hand-back (tree `a8cb220a`) ->
  `expected 8 to be 9` for `rowsInCells` against `rows`, report `rowsInCells=8 claims=1 wrongCells=1`
  — red in 3 of 4 runs (`03:52:12Z`, `03:52:41Z`, `03:53:11Z`), and 4 of 4 green once the cell drops
  the pointer (`03:55:30Z`–`03:56:34Z`).
- `expect(probe.log.pressable).toBe(10)` -> before the per-row box reached the row (trees
  `b5501fd8`, `ad8716d0`) -> `expected +0 to be 10` (`03:31:16Z`, `03:37:23Z`).

Reds as data: `docs/tasks/X29/mutations.json`.

## Files changed

- `ios/components/Form/NitroUiFormViews.swift`: the container reports its box to the row it draws,
  fires `onRowLost` on a foreign take, and answers `isDrawingRow` / `claimsRowItDoesNotHold`.
- `ios/components/Form/HybridNitroUiFormRow.swift`: the `onContentBox` prop, `contentBoxReported`,
  `contentLaidWidth`, `laid=` in the row report, and both reset paths.
- `ios/components/Form/HybridNitroUiForm.swift`: the clamped estimate, the identity chase,
  `boxWitness` (`boxSpan` / `boxMismatch`) and the `rowsInCells` / `distinctDrawn` / `claims` /
  `wrongCells` / `losses` counts.
- `src/components/Form/Form.nitro.ts`, `Form.tsx`, `NativeFormViews.ts`, `NitroUiFormRowConfig.ts`
  and `nitrogen/generated/**`: the per-row `onContentBox` and each row's own width.
- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiFormRow.kt`: receives it, answers
  nothing, says why.
- `example/__tests__/Form.harness.tsx`: E4's waits, its assertions, and ten presses on iOS.

## Follow-ups

- pair-b: X29 never got it — `X25M-29avv` held pair-b for the whole round, with 210 minutes
  of TTL left when X29 last looked, so E4 has no pair-b run here; every X29 lease handed
  pair-a (`X29-wu80c`, `X29-x8k71`, `X29-xf97x`, `X29-34ykm`, `X29-35txq`, `X29-3a02x`).
- check + the lease env: a `check` started from a leased shell failed
  `scripts/__tests__/bench-baseline-merge.test.js:1694` (`04:28Z`) because the fixture's bench run
  inherited the task's `ANDROID_SERIAL`/`EMULATOR_PORT`; the same `check` with those unset passed.
  Worth clearing them inside `check`'s bench step.
- X25-merge's `harness:ios` on pair-b failed E4 with `No view found at point (0.00, 0.00)` on that
  branch's tree — the same family (a row whose pixels are elsewhere), not this tree.
- Hygiene incident: the `harness:ios` that this round's own detached script started at `05:13Z`
  outlived its lease (`X29-3a02x` released at `05:16Z` for a pair-b attempt that never came). It ran
  to completion on pair-a, protected by the pool's in-use check, and its ledger line names that
  lease; nothing else was touched.

## Questions for orchestrator

- **E4 on pair-b.** Options: (a) let the merge run settle it — `need --for merge` runs the full
  harness, and E4 now fails loudly (`boxMismatch`, `wrongCells`, or the 10/10 count) on any device
  whose geometry is wrong, so a pair-b pass there is real evidence; (b) hand X29 a fix round when
  pair-b frees. Recommend (a): the guards are device-independent, and the 22 pt `boxSpan` that makes
  the wait non-vacuous was measured on pair-b in stored runs (`340` against `318`).

## Fix round 1

**Cause of the second symptom: the same parked row — and its zero is not a point.** A press names a
*view*: `userEvent.press` sends (0, 0) beside the `nativeId` (`userEvent.ts:80`), native substitutes
the centre of the view held under that id (`HarnessUI.mm:248`) and hit-tests *that*; the rejection
then formats the *arguments* (`HarnessUI.mm:277`), so a rejected press always reads
`(0.00, 0.00)`. So it is not a hit test before layout (an unregistered id, point truly (0, 0),
presses fine: N1) and not a released id (N2): it is a named view whose centre has left the window.
Force that ordering on pair-a (aim, scroll 400 pt, press) and the state writes the *other* text,
`expected +0 to be 10` (row 9) — which text it is depends only on where the parked row's frame
lands. Pair-b wrote both, 35 minutes apart. A fresh query cannot name a row parked that far out
(N4): the hazard is a handle, not a query.

**Fix.** Aim after the certification, so a press names the row the Form has just reported as drawn
once, by its own cell, at its own box; the control waits for one live copy of itself. Rows 5-10 of
`docs/tasks/X29/mutations.json`.

### Gates (fix round 1)

The table in `## Gates` is this round's: `check`, `harness:ios` and `harness:android` all green on
`effa2d29e8e2`, and `need --for review` satisfied on it. The gate that matters for the finding is the
stale `harness:ios:Form.harness` row — that is row 9's red, on the mutated tree, listed below.

### Red proofs (fix round 1)

- Aim ordering (row 9) -> take E4's handle for `label-wifi`, move the list 400 pt, press the handle
  the case took before it moved -> `expected +0 to be 10` — pair-b's second text, made to happen on
  pair-a on order (`07:10:49Z`, tree `433f64dd`).
- `oneLiveViewPer` (row 5) -> a second live `loose-press` in the positive control's own tree -> `a
  testID does not have exactly one live view: loose-press=2 loose-switch=1` (`05:48:34Z`, tree
  `080fd244`).
- N1, green on purpose -> press `{ nativeId: 'x29-no-such-view' }`, so the point truly is (0, 0) ->
  **green**: the origin is hittable in this app, which is what rules the zero-point reading out
  (`06:34:11Z`, tree `3793e746`).
- N2, green on purpose -> press the pre-wait handle after its tree was replaced -> **green**: a
  stale handle is silent, so re-aiming is a guard and not the writer of that text (`06:32:31Z`, tree
  `e2258ea0`).
- N3, green on purpose -> scroll 400 pt, then press a *fresh* aim at a reclaimed row -> **green**:
  pair-a parks reclaimed rows inside the window (`06:36:53Z`, tree `11a95a44`).
- N4 (row 10) -> press `boxOf('f49')`, a row parked 50 deep -> `Unable to find element with testID:
  f49`: the query refuses a row parked out of reach, so only a handle can aim there. That line was
  caught by a Metro reload mid-run, so its tree and `treeAfter` differ and it is recorded as void.
- Not claimed: pair-a never wrote the `(0.00, 0.00)` text itself, and X29 never held pair-b to try.
  What is measured is what that text can and cannot mean, and that the ordering reaches its family.

### Follow-ups (fix round 1)

- The harness's `NO_VIEW` text formats `x, y` rather than the resolved centre
  (`@react-native-harness/ui`'s `HarnessUI.mm:277`), so it reads as a coordinate; that is what sent
  this task looking for a zero point. Worth an upstream issue.
- `Conformance.harness`'s `no-leak-on-drop` ledger is load-sensitive: this tree went red on
  `IconButton` at `1 ledger entry(ies) survived 50 drops` — 1 of 613 tests, E4 itself green in the
  same run, load1 8.88 at the start, 33.69 max (`06:38:53Z`). Round 1 was red on the same check with
  `SegmentedControl` at `-1` (`02:49:20Z`); `task/G30-list-item` and `task/G24-form` carry it too.
  Not a Form failure and not mine to fix.
- `scripts/__tests__/ci-workflows.test.js:902` (the preflight's 2 s `-accel-check` budget) went red
  twice under load with `asked: false` (`07:12Z`, `elapsedMs` 2266; `07:15Z`, 562) and green 3 m
  later at load 7.5 — that budget wants widening or a fake clock.
- The lease env still leaks into `check`'s bench step (`05:50Z`,
  `scripts/__tests__/bench-baseline-merge.test.js:1694`); with it unset the step is green, so
  `check` should clear it itself.
- pair-b was again never leased to X29 — `X25M-29avv`, `X25-47fmy` and `X25-484f3` held it through
  the task, which is why both symptoms are argued from stored runs here.
- `task/X25-fix2` is editing `ios/components/Form/HybridNitroUiForm.swift` over the same E4 (its
  `recycledTitle` cell that measures 353 and asks 236), and `main` has moved to `8df23709`: the two
  Form fixes will conflict at merge, which is a call for whoever merges.

## Fix round 2

**Cause: the list answered UIKit with a view nobody had dequeued.** A Section leaves `sections` on
unmount, but the snapshot trails that array by one apply, and the same mount resizes the holding view
so `listNeedsFrame` lays the list out *inside* it. Asked for a section it no longer has, the provider
gave up: a bare `UICollectionViewCell()` for a row, `nil` for a band. iOS 27 raises for both, Swift
catches no ObjC exception, the app dies, and every Form case reads as a bridge disconnect. Pair-b's
E4 (`No view found at point (0.00, 0.00)`) is the same give-up without the death: no row, nothing to
press.

**Fix.** Both providers read the section from the snapshot UIKit is laying out, so nothing is left to
give up (`giveUps`). Item 1: `giveBack()` labels its hand-over, so `losses` counts foreign takes only
and the chase still runs. Item 2: a row's box is stamped with the width it was reported under, and the
Form re-tells parked rows at a new width. Item 3: the published number is the plain box, once per list
width, plus the measured `accessoryInset`; items 4 and 5 are its docs row and the toggle test.

### Gates (fix round 2)

The table in `## Gates` is this round's: `check`, `harness:ios` and `harness:android` green on
`00664591cf2a`, `need --for review` satisfied on it, and `harness:ios:Form.harness` green as a filtered
run on pair-a. The rows that carry the finding are the stale ones beside it — each is a red proof on a
mutated tree, and none of them satisfies anything but its own name.

**Leases:** `X29-cq1q0` (pair-b) and `X29-go41j` (pair-a).

### Red proofs (fix round 2)

Rows 11-14 of `docs/tasks/X29/mutations.json`; every run is `harness:ios` filtered to `Form.harness`
under lease `X29-cq1q0` on pair-b, each mutation reverted before the next.

- `Form.harness`, whole suite -> the two provider answers this round replaces (`UICollectionViewCell()`
  for a row, `nil` for a band, the section read back out of `sections`) -> `● Test suite failed to run:
  The app bridge disconnected during test execution`, 0 tests run, with
  `*** Assertion failure in -[UICollectionView _createPreparedCellForItemAtIndexPath:…]` in the device
  log. Same tree, providers as shipped: 3 passed.
- `hands no row back as a loss across 400 pt scrolls` -> `giveBack()` stops labelling its hand-over
  (`handingOverRow = false`) -> `expected 32 to be +0` at
  `expect(num(after, 'losses') - lossesAtRest).toBe(0)` — four scrolls, 32 give-backs counted as lost
  rows.
- `moves no row of the list when one row gains an accessory` -> `rowBoxWidthReported` takes every cell
  report as a plain-row one (`let accessory = false`), the pre-fix "publish whichever cell laid out
  last" -> `expected 0 to be greater than 4` for `accessoryInset`, in that case and in the resize one.
- `re-lays a row that is off screen at the Form's new width` -> both halves of item 2 out: parked rows
  are never re-told, and a row trusts its remembered box forever -> `never saw "the parked plain row to
  be laid out at the new 256 pt box" - last was where=holding;frame=0.0,0.0,336.0,44.0`. Either half
  alone leaves it green — the JS clamp and the native push each cover for the other, which is why both
  ship.

### Follow-ups (fix round 2)

- `giveUps` is in the Form report and read 0 in every green run here; if it rises, a snapshot and the
  models disagree in a way neither the chase nor this round covers.
- Two full `harness:ios` runs on the pre-fix tree died *mid-suite* with the bridge gone (09:34, 09:50)
  — the same give-up, seen far from the mount that caused it. Both are green on this tree.
- `check` has to run with `EMULATOR_PORT` unset: a lease env exports it, and the bench step then asks
  that leased device to boot.
- The pool hands out pair-a whenever it is free, so pair-b was only reachable through a narrowed
  `--config`; a `lease.mjs --pair <name>` flag would retire the trick.
- `task-ready` names the report after the branch, so on this branch it looks in `docs/tasks` for a
  file called after `X29-fix2` rather than after the brief; with `--task X29-form-e4-pair-a` it is
  ready. Worth teaching it the brief's name too.
