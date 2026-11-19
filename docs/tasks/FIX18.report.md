# FIX18 — A disabled iOS `ButtonGroup` keeps the items in its row

**Branch:** `task/FIX18-button-group-disabled-refit` (from `main` at `20e70ca`) ·
**Round:** 1 of up to 3 · **Lease:** `FIX18-lt366` (`iPhone Air` iOS 27 / Metro `8293`)

## Summary

An iOS `ButtonGroup` that an app disables refitted its own row. `candidate` left the overflow
`Menu` out of a disabled row, so every `ViewThatFits` candidate that could hold it measured
narrower while disabled, and one more item won a place: the items moved sideways for what should
have been a repaint, and moved back when enabled again.

A disabled group now keeps the control's room, and what is drawn in it matters. A `Menu` with
`.disabled(true)` would keep the geometry, but a `Menu` in the hierarchy keeps the popup it has
already opened, and `disabled` arriving while the menu is open has to close it; `Menu(isExpanded:)`
is iOS 18 and this library runs to iOS 15. So a disabled group draws the `Menu`'s own label in a
disabled `Button` with nothing to present — the same label, dimmed by the rule that dims the items,
read as a disabled control of the same name. `overflowLabel` is one function, so the two cannot
drift apart in width.

The probe report splits two facts one field carried. `overflow=1` says the row drew an overflow
control; `menu=` says whether it can present its menu, which is the question the existing "closes an
open menu" case asks, so that case keeps its meaning. Both come only from the placement witness, so
`menu=` answers once the row has laid out in the new state — that is what the new case waits on.

The case reads one group in a 220 pt well: enabled, disabled, enabled again. It asks for the same
count and ids in the same order, a control drawn in all three, presentable in only the enabled
ones, no event for any item while disabled, and drawing that ends within 2 pt of where it ended
enabled — a fix reporting a control it did not draw goes red on the drawing, not the count. It then
mounts a disabled group beside its enabled twin and asks the two rows to agree: the pair in the
screenshot.

Android is untouched: its overflow indicator is Material's own, drawn whatever the group's state,
and the case returns. The harness file is shared, so `harness:android` is owed and missing below:
this lease is iOS-only and the machine's only Android pair was held elsewhere all round. A real tap
on a disabled control, and what VoiceOver calls it, belong to `real-input:ios`, at merge.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2180 tests / 96 suites | `8c3880735bc3` | 59.6 s | start 69.6 / med 63.4 / max 69.6 |
| `harness:ios` | **PASS** | 616 tests / 30 suites + isolated 6 tests / 3 suites | `8c3880735bc3` (harness:ios digest) | 14 m 37 s | start 7.2 / med 10.0 / max 72.2 |
| `harness:android` | missing | — | — | — | — |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | **PASS** (completed: 1 of 52 units re-run, attempt 1; from `merge/FIX14-FIX15`) | 4 tests / 1 suites | `b1db28130516` (real-input:android digest) | 12 m 26 s + full run 39 m 59 s | start 4.1 / med 5.1 / max 11.8 |
| `harness:ios:ButtonGroup` | stale | 1 failed of 14 tests / 1 suites | 835f800141dc (not this tree) | 49.8 s | start 10.3 / med 16.5 / max 18.4 |

`need --for review`: 1 gate missing — `harness:android`; `check` and `harness:ios` are green on
code tree `8c3880735bc3`, the tree of the last commit below. The `real-input:android` row belongs
to another branch and is printed only because the ledger is per machine.

`harness:android` is owed, not skipped: the new case returns on Android and Material draws its own
overflow indicator, so nothing in the Android tree changed; the gate is required because
`example/__tests__/ButtonGroup.harness.tsx` is shared. See "Questions for orchestrator".

## Red proofs

- `keeps the same items in its row when it is disabled` -> restore
  `ios/components/ButtonGroup/HybridNitroUiButtonGroup.swift` from `HEAD~1`, so a disabled row
  leaves the overflow control out again, rebuild, filtered `harness:ios` run on `ButtonGroup` ->
  red at `example/__tests__/ButtonGroup.harness.tsx:770`:
  `expect(disabled.overflow, …).toBe('1')` received `'0'`, with the enabled row
  `visible=2 shown=day,week overflow=1` and the disabled row
  `visible=3 shown=day,week,month overflow=0`.
- That case also fails its `visible`, `shown` and ink assertions on the same build; the line above
  goes red first. The fixture does not coincide with the right answer — at that width a group of
  six items fits two enabled, and the bug's answer is three.

## Files changed

- `ios/components/ButtonGroup/HybridNitroUiButtonGroup.swift`: `candidate` keeps the overflow
  control in the row; `overflowControl` draws the `Menu` enabled and a control with nothing to
  present disabled, over one shared `overflowLabel`; `recordPlacement` also records whether the
  control can present, and `stateReport`'s `menu=` reads that.
- `example/__tests__/ButtonGroup.harness.tsx`: the new case, and the recycle case's comment on
  what `menu` answers.
- `docs/components/button-group.md`: Overflow says a disabled group keeps its row.
- `.changeset/button-group-disabled-row-keeps-its-items.md`: patch entry.

## Follow-ups

- `docs/tasks/FOLLOWUPS.md`: the G20 line "disabling a group on iOS refits more items into the
  row" is the one this branch fixes; it can go at the next prune.

## Questions for orchestrator

- `harness:android` is the one gate review asks for that this branch does not have. This task's
  lease was `--platform ios`, and a lease's env names only that half, so an Android gate here is
  refused before it starts. Re-leasing as `both` means releasing the pair this task holds, which
  queues behind the two Android tasks already waiting, so it could not be done inside the budget
  without leaving the iOS run unleased. Options: (a) let the merge branch settle it — its diff
  carries the same shared harness file, `need --for merge` asks for `harness:android`, and the
  merge run may run both harness gates under one lease for both; (b) lease a `both` pair for this
  branch and run the full `harness:android` (~18 min) before review. Recommendation: (a).
