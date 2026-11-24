# FIX29 — A hosted Android Picker's closed menu stays closed

**Branch:** `task/FIX29-picker-menu-count` (from `main` at `ec49b1d8`) · **Round:** 1 of up to 3 ·
**Lease:** `FIX29-qvefw` (`emulator-5574` / Metro `9295`)

## Summary

**What shipped.** The Picker's menu report now describes the control's open state rather than
the window Material keeps while it closes. The open count sits under the control's own
`expanded`, and a closed menu refuses reports from its fading window.

**Cause, from the source and one read.** The count was incremented inside the popup's own
content: `MenuWitness` was the first child of `ExposedDropdownMenu`'s content lambda. Material 3
gates that `Popup` on a `MutableTransitionState` (`if (expandedState.currentState ||
expandedState.targetState)`, material3 1.5.0-beta02), not on `expanded`, so the window and
everything composed in it survive the close for the length of the fade-out. `live`, `menu` and
`rows` measured a window whose lifetime is Material's; `expanded` measured the control. A read
can therefore carry `expanded=0` with `live=1` — the pair both CI cases reported.

Ranked causes, and what the existing reads said:

1. *(chosen)* The count is a window's lifetime, not a menu's. With a closed menu's
   late reports no longer refused, this emulator answered `rows=5` in a report that had already
   answered `expanded=0;live=0`: the window outlives the flag.
2. A press reopened the menu — contradicted: the failing read has `expanded=0`, and `expanded`
   goes true only from a gesture, a key click or the anchor's semantics `onClick`, none of which
   sits between the wait and the read.
3. Another control's menu in the process-wide count — contradicted: only the Picker's popup
   touches `PickerModel.liveMenus`, and that case's mount holds one Picker.

**Fix.** `MenuOpenWitness` counts under `if (expanded)` beside the anchor, and owns the fact that
a closed menu has no window: the view and the frame go with the count. `MenuWindowWitness` keeps the
window's frame, rows and drawn semantics and still clears `expanded` when the popup leaves the
composition, so a child re-entering a Host does not reopen it. `PickerModel` now ignores
`noteMenuFrame`, `noteMenuRows` and a non-null `noteMenuView` while the menu is closed — the
reports a fade-out would otherwise republish. No setter, handshake or composition-lifetime
change.

**Not reproduced.** The race never appeared here: the 25-case file passed on every run of this
branch. The cause is the Material source plus the late-write read above.

**Tests.** New case _keeps a closed menu closed through the batches that follow it_ — close by a
pick, then re-enable, move the Host, present the Host's other popup owner, then reopen, so the
count cannot pass by never counting. The re-enable case now asserts one read, not two.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2226 tests / 102 suites | `40db86c7d1bc` | 54.7 s | start 2.1 / med 4.7 / max 5.2 |
| `harness:ios` | **PASS** | 621 tests / 30 suites + isolated 6 tests / 3 suites | `0ce5f9f77787` (harness:ios digest) | 14 m 37 s | start 3.1 / med 5.3 / max 13.7 |
| `harness:android` | **PASS** | 680 tests / 31 suites + isolated 6 tests / 3 suites | `40db86c7d1bc` (harness:android digest) | 18 m 28 s | start 4.6 / med 3.0 / max 5.0 |
| `real-input:ios` | **PASS** (from `merge/X62-X63`) | — | `3c9fa9b83cf7` (real-input:ios digest) | 44 m 53 s | start 4.8 / med 4.8 / max 15.0 |
| `real-input:android` | missing | — | — | — | — |
| `harness:android:HostPopups` | stale | 1 failed of 25 tests / 1 suites | 224fcec2be16 (not this tree) | 45.1 s | start 1.6 / med 1.8 / max 2.1 |

`need --for review`: `need: review is satisfied on this code tree.`

## Red proofs

- `HostPopups › keeps a closed menu closed through the batches that follow it` ->
  `MenuOpenWitness(model)` composed unconditionally, so the count stops following `expanded` ->
  `Menu report never matched within 12000ms; last read "expanded=1;live=2;…;rows=3;…"` (nine cases
  in the file red, this one among them).
- `HostPopups › relays the rows when the options change while it is open` -> `PickerModel.noteMenuRows`
  writes whether or not a menu is open -> `expected 5 to be +0` at
  `example/__tests__/HostPopups.harness.tsx:831`.
- `HostPopups › relays the rows when the options change while it is open` -> `MenuOpenWitness` drops
  its `noteMenuView(null)` / `clearMenuFrame()` -> the same line red, `expected 5 to be +0`. The
  first `harness:android` run went red there on its own, which is how the late `rows` write was
  found and why the refusal now lives in the model.

## Files changed

- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiPicker.kt`: the open count and the
  window witness split; `PickerModel` refuses a closed menu's window reports.
- `example/__tests__/HostPopups.harness.tsx`: `expectNoOpenMenu` (one read, one line), the new
  case, and the re-enable case read once instead of twice.

## Follow-ups

- `MenuRows.kt`'s `MenuWitness` (`Menu`, `ContextMenu`) counts the popup composition the same way,
  so those controls' `live` reads carry the same window-lifetime lag.
- Flaky: `TextField › focuses from its parent's mount effect` and
  `TextField › applies a JS write that arrives with no composition open`, 2026-11-24,
  `harness:android` started 13:59 — green in the 14:21 run of this branch.
