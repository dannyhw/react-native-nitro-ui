# FIX29 — A hosted Android Picker's closed menu stays closed

**Branch:** `task/FIX29-picker-menu-count` (from `main` at `ec49b1d8`) · **Round:** 1, plus fix rounds 1 and 2, of up to 3 ·
**Lease:** `FIX29-uun9q` (`emulator-5570` / Metro `9293`); round 1 ran on `FIX29-qvefw` (`emulator-5574` / Metro `9295`)

## Summary

**What shipped.** The Picker's menu report describes the control's open state, not the window
Material keeps while it closes. The open count sits beside the anchor under the control's own
`expanded`; the popup's window owns its view, frame and rows and is counted on its own (`windows`)
beside an `opens` count that only goes up. `readMenuReport` answers those window fields as closed
while the menu is closed.

**Cause, from the source.** `MenuWitness` was the first child of `ExposedDropdownMenu`'s content
lambda, so it counted the popup's composition. Material 3 gates that `Popup` on a
`MutableTransitionState` (`if (currentState || targetState)`, material3 1.5.0-beta02), not on
`expanded`, so the window survives the close by the length of the fade-out. `live`, `menu` and
`rows` measured a window whose lifetime is Material's; `expanded` measured the control, so a read
carries `expanded=0` with a `live=1` that lags a `0`. It is the shape of the bug, not what CI
read. Both CI cases had read `!expanded && live === 0` before the read that answered `live=1` (843
after the re-enable, 910 after the date dialog). A fade explains a `1` that lags a `0`, never one
that follows it, and a final `expanded=0` does not exclude a reopen that closed before the read:
those two reads need a popup that composed again, which `windows` and `opens` now tell apart.
Menu's disable case shares the shape — it waits for `live=0`, re-enables, reads `1` — so no fade
explains it either; the suspect both share is a close written from a props batch while the window
fades. A shared count is contradicted: only the Picker's popup touches `PickerModel.liveMenus`.
Why the popup composed again on CI is still unknown.

**Fix.** `MenuOpenWitness` counts under `if (expanded)` beside the anchor. `MenuWindowWitness` is
the only writer of a window's view, frame and rows, so a window that outlives a close and a reopen
keeps serving it; it still clears `expanded` when the popup leaves, so a child re-entering a Host
does not reopen. No setter, handshake or composition-lifetime change, and no changeset: outwardly
nothing moved.

**Tests.** _Keeps a closed menu closed through the batches that follow it_: after a close, the
re-enable, the Host move and the Host's other popup must leave `windows` at 0 and `opens`
unchanged, each step waited for where it lands — `disabled` read back, the anchor moved in the
report. The re-enable case reads once.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2226 tests / 102 suites | `ded6ed099a41` | 57.3 s | start 5.8 / med 12.6 / max 13.7 |
| `harness:ios` | **PASS** | 621 tests / 30 suites + isolated 6 tests / 3 suites | `ded6ed099a41` (harness:ios digest) | 14 m 31 s | start 5.1 / med 4.5 / max 13.5 |
| `harness:android` | **PASS** | 680 tests / 31 suites + isolated 6 tests / 3 suites | `ded6ed099a41` (harness:android digest) | 18 m 18 s | start 5.1 / med 4.4 / max 13.5 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `harness:android:HostPopups` | **PASS** | 25 tests / 1 suites | `ded6ed099a41` (harness:android digest) | 45.9 s | start 3.4 / med 3.5 / max 3.9 |

`need --for review`: `need: review is satisfied on this code tree.`

## Red proofs

- `HostPopups › keeps a closed menu closed through the batches that follow it` -> the count stops
  following `expanded` (`MenuOpenWitness` composed unconditionally) -> `Menu report never matched
  within 12000ms; last read "expanded=1;live=2;…;rows=3;…"` (nine cases in the file red, this one
  among them). That mutation does not undo this case's own guard — the case's own red is in Fix
  round 1.
- Superseded by fix round 1, which moved both gates out of the model, so neither write is a bug
  here any more: `HostPopups › relays the rows when the options change while it is open` ->
  `PickerModel.noteMenuRows` writes whether or not a menu is open -> `expected 5 to be +0` at
  `example/__tests__/HostPopups.harness.tsx:831`.
- Superseded for the same reason: `HostPopups › relays the rows when the options change while it is
  open` -> `MenuOpenWitness` drops its `noteMenuView(null)` / `clearMenuFrame()` -> the same line
  red, `expected 5 to be +0`. The first `harness:android` run went red there on its own, which is
  how the late `rows` write was found.

## Files changed

- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiPicker.kt`: the open count and the
  window witness split; the window owns its view, frame and rows; `windows` and `opens` joined the
  report, whose window fields answer closed while the menu is.
- `example/__tests__/HostPopups.harness.tsx`: `awaitCloseOver`, `waitForDisabled` and
  `expectStillClosed` (five fields, one per assertion), and the new case, whose steps are each
  waited for where they land; the re-enable case reads once instead of twice.

## Follow-ups

- `MenuRows.kt`'s `MenuWitness` (`Menu`, `ContextMenu`) counts the popup composition the same way,
  so those controls' `live` reads carry the same window-lifetime lag. A third CI run on Android had
  `Menu › closes when it is disabled while the menu is open` read `live=1` where it expected `0`
  (2026-11-24): that case waits for `live=0` first, so the fade cannot explain it either, and both
  it and the Picker's reds sit after a re-enable. `MenuWitness` has no `windows`/`opens` to say
  which happened; giving it the same two fields is the next step, and Menu is untouched here.
- `harness:ios` once took `Tooltip.harness.tsx` down as a suite that failed to run: `SIGSEGV` /
  `EXC_BAD_ACCESS` in `worklets::cleanupRuntimeAware` during Hermes finalisation (2026-11-24,
  15:09). The completion run was green, and this diff touches no iOS behaviour but the report
  string.
- Flaky: `TextField › focuses from its parent's mount effect` and
  `TextField › applies a JS write that arrives with no composition open`, 2026-11-24,
  `harness:android` started 13:59 — green in the 14:21 run of this branch.

## Fix round 1

The three findings and the two comments, lease `FIX29-t7qtm`.

- Finding 2: `MenuWindowWitness` alone owns a window's view, frame and rows — the null write and
  the `expanded` gate left `noteMenuView`, and the closed-menu rule moved into `readMenuReport`. A
  menu reopened mid-fade keeps a window it can close.
- Finding 1: `windows` (per window, process-wide) and `opens` (only up) joined the report. Each
  close is waited out by `awaitCloseOver` (`windows === 0`), then `expectStillClosed` asserts the
  five fields one per assertion, so a red names it. Cause corrected above.

Red proofs, each a filtered `harness:android -- HostPopups` run (2 failed / 24 passed):

- `HostPopups › closes when the control is disabled while the menu is open` -> the `disabled`
  setter's re-enable branch opens a menu for 150 ms behind a closed report -> red at
  `expected 'windows=1 after re-enabling' to be 'windows=0 after re-enabling'`; the batches case
  read the same field under its own label, `after the disable and re-enable`.
- Finding 2 has no harness proof: `MenuOpenWitness.onDispose` writing `noteMenuView(null)` again
  left all 26 cases green — the window had faded before the second press here. It rests on the
  source.

## Fix round 2

The two blocking findings; no library code moved. Lease `FIX29-uun9q`.

- Deleted `owns its window when the menu reopens before the closing one fades`: re-adding the null
  write left it green, so it never reached its premise. Finding 2 rests on the source, where
  `noteMenuView`, `dropOpenMenu` and `refreshMenuFrame` are main's. The summary's mid-fade claim
  went with the case.
- `keeps a closed menu closed through the batches that follow it` now waits where each step lands:
  `waitForDisabled` reads `disabled` back before the re-enable and again after it, and the Host move
  is the report's `anchor` changing. Only the dwell before an absence read sleeps, as main's
  re-enable case's does.
- Report: round 1's bullets 2-3 marked superseded, its second quote fixed, and one plain sentence
  that the CI cause is still unknown.

Red proof, a filtered `harness:android -- HostPopups` (2 failed / 23 passed): the `disabled`
setter's re-enable branch opens a menu for 150 ms behind a closed report -> red at
`expected 'windows=1 after the disable and re-enable' to be 'windows=0 after the disable and
re-enable'`.
