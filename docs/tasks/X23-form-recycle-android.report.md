# X23 — Android: a recycled Form doesn't always start at the top

**Branch:** `task/X23-form-recycle-android` (from `main` at `e8ebf077`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `X23-8wjce` (`emulator-5570` + `3AE7EE8D-543D-445D-BC4A-C7A6CDFF5646` / Metro `8293`)

## Summary

**Cause — a test-seam cache that survived the recycle, not a scroll bug.** Android's Form
report is a cache: `nuiTestFormReport()` runs on the JS thread, posts a rebuild to the UI
thread and returns the string *as it last stood*. `prepareForRecycle()` reset the reported
deltas (`width`, `ime`) but not that string. React Native pools recycled views per
`surfaceId` (`ViewManager.mRecyclableViews`) and hands a stopped surface's id to the next
surface, so a later Form can pop an earlier Form's box — and with it the previous mount's
last build. The harness's recycle case then polled `rows === 9`; the stale string said
exactly that (same fixture, 9 rows), so the case asserted on the *previous* Form's
`scroll=200.0`. The failure carries the fingerprint: `FORM TRACE the recycled Form` was
byte-identical to `FORM TRACE scrolled before the recycle`, `inCells=7` included — a rebuilt
report cannot match, because the new box has no rows when it is first read.

**The view was never wrong.** A pooled box is detached on the way in
(`ReactViewGroup.recycleView()` removes it from its parent), and RN 0.88 does not pool
`ReactScrollView` at all (`enableViewRecyclingForScrollView=false`; the example app forces
only the master `enableViewRecycling`), so a recycled Form's scroller is a fresh
`ReactScrollView` at 0. What shipped wrong is an incomplete `RecyclableView` reset — the
report is the seam tests and host diagnostics read, and after a recycle it answered for its
previous owner. `HybridNitroUiContextMenu.prepareForRecycle` already drops its cache; Form
did not.

**Fix** — `report = "pending"` in `prepareForRecycle()`
(`android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiForm.kt:131`). The first read
after an adoption now answers `pending`, the poll waits, and the value the case asserts on is
built from the box as its own mount has it. `Form.harness.tsx` is unchanged: the offset
assertion is still `|offset + top| <= 1`.

**Why it looked order-dependent:** red or green turns on whether the new surface reuses a
`surfaceId` whose Form stack holds a box, which is exactly what earlier suites leave behind.
Running Form's suite after Switch's reproduces it on demand (3/3 red without the reset).

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1993 tests / 84 suites | `3eb8cfab1e9f` | 2 m 49 s | start 8.6 / med 8.6 / max 11.6 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | **PASS** | 620 tests / 30 suites + isolated 6 tests / 3 suites | `3eb8cfab1e9f` (android tree) | 17 m 39 s | start 17.3 / med 5.6 / max 23.8 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | **PASS** | — | `3eb8cfab1e9f` (android tree) | 57 m 42 s | start 5.3 / med 3.8 / max 13.6 |
| `harness:android:(Switch%7CForm).harness` | **PASS** | 29 tests / 2 suites | `3eb8cfab1e9f` (android tree) | 22.0 s | start 8.5 / med 9.1 / max 10.3 |
| `harness:android:(Switch%7CForm).harness:--background` | stale | — | f0181b2daf18 (not this tree) | 1.0 s | start 3.6 / med 3.6 / max 3.6 |
| `harness:android:(Switch%7CTextField%7CSearchField%7CForm).harness` | stale | 60 tests / 4 suites | 9de9c635dc49 (not this tree) | 49.3 s | start 4.9 / med 4.3 / max 4.9 |
| `harness:android:Form.harness` | stale | 14 tests / 1 suites | 7c4ff073e8a1 (not this tree) | 16.8 s | start 7.5 / med 7.4 / max 7.5 |

`need --for review`: `need: review is satisfied on this code tree.` — its header reads
`code diff base e8ebf07 touches android`, which is why `harness:ios` is deliberately not run:
the change is inside `android/`, the iOS half of the tree (`da3f77439b39`) is byte-identical
to main's, and `need --for merge` asks for `harness:ios` / `real-input:ios` at merge, where
the whole device set runs anyway. `harness:android` ran twice on this tree and both runs
passed (1070.9 s at `06:00:06Z`, 1058.5 s at `06:18:02Z`); both lines ship in
`docs/tasks/X23/gates.jsonl` beside this report, and the table prints the newest of them.

## Red proofs

- `Form.harness "starts a recycled Form at the top of its own content"` -> comment out
  `report = "pending"` in `prepareForRecycle()` (app rebuilt, `(Switch|Form).harness`) ->
  3/3 red: `expected 200 to be less than or equal to 1` at
  `example/__tests__/Form.harness.tsx:1266`
- same test -> same mutation removed, fix restored, same command -> 4/4 green,
  `Tests: 29 passed, 29 total`
- same test on the pristine tree (no local change at all), same command -> red, twice at
  05:28/05:29 and again at 05:53, with `FORM TRACE the recycled Form` identical to
  `FORM TRACE scrolled before the recycle`

## Files changed

- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiForm.kt` — drop the cached
  report in `prepareForRecycle()`; one line of code, the rest the reason.
- `docs/tasks/X23-form-recycle-android.report.md`, `docs/tasks/X23/` —
  this report and the exported ledger.

## Follow-ups

- Form's Row/Section: `HybridNitroUiFormRow.kt` and `HybridNitroUiFormSection.kt` cache their
  reports the same way and neither resets it in `prepareForRecycle()` — same defect class,
  not fixed here (D19).
- Recycling: if a host ever enables `enableViewRecyclingForScrollView`,
  `ReactScrollView.recycleView()` does not reset `scrollY`, so a recycled Form *would* come
  back scrolled; nothing in this repo gates that flag combination.
- Form.harness: the recycle case's `rows === 9` predicate cannot tell two mounts of the same
  fixture apart; keying the handle per mount (instead of one `forms.form` slot) would make
  the case blind to a late `hybridRef` from a dying Form as well.
