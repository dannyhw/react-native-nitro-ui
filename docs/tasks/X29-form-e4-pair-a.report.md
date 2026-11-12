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

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2093 tests / 88 suites | `b3412f3174e7` | 2 m 48 s | start 5.1 / med 6.0 / max 8.8 |
| `harness:ios` | **PASS** | 613 tests / 32 suites + isolated 6 tests / 3 suites | `b3412f3174e7` (ios tree) | 20 m 17 s | start 5.3 / med 8.3 / max 23.6 |
| `harness:android` | **PASS** | 669 tests / 32 suites + isolated 6 tests / 3 suites | `b3412f3174e7` (android tree) | 18 m 48 s | start 21.3 / med 6.7 / max 21.3 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:ios:Form.harness` | **PASS** | 15 tests / 1 suites | `b3412f3174e7` (ios tree) | 20.4 s | start 5.1 / med 5.3 / max 5.4 |
| `harness:ios:Form.harness:--background` | stale | — | 8383afbb6aab (not this tree) | 1.2 s | start 9.9 / med 9.9 / max 9.9 |
| `harness:ios:Form.harness:-t:aims%20a%20row%20content` | stale | 1 failed of 15 tests / 1 suites | f1e7470b926d (not this tree) | 19.7 s | start 42.8 / med 34.8 / max 42.8 |
| `harness:ios:Form.harness:-t:aims%20a%20row%20content:--background` | stale | — | 07b85d8fdec9 (not this tree) | 1.4 s | start 4.3 / med 4.3 / max 4.3 |
| `harness:ios:Form.harness:-t:grows%20a%20row%7Caims%20a%20row` | stale | — | 49203cb0c2a5 (not this tree) | 1.3 s | start 6.3 / med 6.3 / max 6.3 |

Every device row above is pair-a (simulator `49D5024D…`, `emulator-5574`, Metro 8295); the
pair-b row X29 was also asked for is the one it could not run — see Follow-ups.

`need --for review`: `need: review is satisfied on this code tree.` (`check`, `harness:ios` on
the ios tree, `harness:android` on the android tree; `Form.harness.tsx` counts as both platforms.)

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
