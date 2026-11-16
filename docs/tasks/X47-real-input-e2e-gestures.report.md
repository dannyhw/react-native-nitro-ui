# X47 — Android real-input: gesture, sheet and dialog controls move into e2e

**Branch:** `task/X47-real-input-e2e-gestures` (stacked, from `9167652e`) · **Round:** 1 of up
to 3 · **Lease:** `X47-bhhmi` (`emulator-5574` / Metro `8295`)

## Summary

All eleven controls are done. Ten no longer have a tree check. `context-menu` keeps six reads
that the driver cannot make.

- **`ownerNode`** now picks the tightest `hittable` box that contains the labelled node,
  including the node itself. A tree read that asks for `enabled` now reads the unmerged tree.
  On the device, both disabled chips and the disabled list item read `false` and the enabled
  assist chip reads `true`. With the old rule, the same reads say `true`: it picks a wrapper
  of the same size.
- **Rows the context file marks "needs a driver change" or "better as a harness test" that
  moved anyway.** Q1 says that "`hittable` or `checked`" on the unmerged tree is the dump's
  actable node, node for node. That answer moves four rows:
  - C1 and C3: the calendar header is the seven named boxes that are not `hittable`;
  - G2a and G2b: `enabled` on the tightest `hittable` box around the action's label.

  Eight harness rows (M6, M12a, M12b, X2, X3, G3b, L3, T15) were cheaper to assert on the
  device than to argue about. M6 in e2e keeps phase 2's 1 dp, three-of-three bar, which the
  harness test does not. No row was deleted on the strength of a harness test.
- **The unmerged tree keeps off-screen nodes at their laid-out boxes.** Both calendars, the
  three wheels, the Host's node order and the mixed Host's widths are read without
  scrolling. To roll a drum, it is parked by slow drags along the right-hand edge of the
  window, aimed from the same tree.
- **Deleted with no test (four rows).**
  - T4 is `check(…, true)` and can never fail.
  - T8, T10 and T13 compare the row under the drum's centre line. Q10 found no drum rows in
    the dump or in the driver's tree, so phase 2 always skipped them.
- **Two additions from review.**
  - Three of `context-menu`'s assertions were deleted earlier as "already in phase 1":
    the hold never pressed the child, the pick was reported, and select came before close.
    The old check made them on each of three open-and-pick cycles. The hold test now makes
    all three on each of its three cycles.
  - The time wheel's `check(…, true)` (T4) went with its block. Its sentence, "the drum rows
    are in the tree", is false on this device (Q10), so there is nothing true to assert in
    its place.
- **Left in phase 2:** M8a, M8b and M3c (hold-then-drag, D-D), M15a and M15b (long-clickable,
  D-C), M16a and M16b (`focusable` on its own, D-A). The helpers they use stay: `contextReset`
  with H1, and `contextReveal` with H2a and H2b.
- **Orphaned helpers removed:** twelve `makeContext` methods and the date and dialog-grid
  helpers. `android-tree.mjs`'s `nativeEnabled` and its unit tests went too.

Per control: rows moved / deleted as already in phase 1 / deleted with no test / left.

| Control | Moved | Phase 1 | No test | Left |
| --- | --- | --- | --- | --- |
| context-menu | 22 | 0 | 0 | 7 rows + H1, H2a, H2b (driver change) |
| bottom-sheet | 18 | 2 (B3, B7) | 0 | 0 |
| date-picker | 16 | 0 | 4 (T4, T8, T10, T13) | 0 |
| hosted-date-picker | 5 | 2 (D1, D3) | 0 | 0 |
| dialog | 7 | 1 (G1) | 0 | 0 |
| popover | 3 | 2 (PO3a, PO3b) | 0 | 0 |
| chip | 8 | 1 (CH4) | 0 | 0 |
| checkbox | 8 | 1 (CB5) | 0 | 0 |
| list-item | 5 | 0 | 0 | 0 |
| hosted-switch | 2 | 0 | 0 | 0 |
| hosted-mixed | 4 | 0 | 0 | 0 |

Phase 1 lines read for those deletions: `bottom-sheet.e2e.ts:21-26`,
`hosted-date-picker.e2e.ts:26-30`, `dialog.e2e.ts:20-23`, `popover.e2e.ts:54-57`,
`chip.e2e.ts:22-23` and `checkbox.e2e.ts:25-26`. Each of those controls' new tests also
repeats the press.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1984 tests / 88 suites | `4b6653cd493a` | 1 m 33 s | start 4.7 / med 8.1 / max 10.0 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | **PASS** | 659 tests / 31 suites + isolated 6 tests / 3 suites | `4b6653cd493a` (android tree) | 18 m 05 s | start 4.6 / med 7.6 / max 16.0 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | missing | — | — | — | — |
| `real-input:android:--control:chip:--control:checkbox:--control:list-item:--control:hosted-switch:--control:hosted-mixed` | **PASS** | — | `4b6653cd493a` (android tree) | 15 m 34 s | start 3.6 / med 11.9 / max 49.4 |
| `real-input:android:--control:context-menu` | stale | — | 238ca79d9735 (not this tree) | 0.9 s | start 16.8 / med 16.5 / max 16.8 |
| `real-input:android:--control:context-menu:--control:bottom-sheet` | stale | — | ee5c5cbc9cfc (not this tree) | 14 m 12 s | start 5.9 / med 5.6 / max 17.7 |
| `real-input:android:--control:context-menu:--control:bottom-sheet:--control:date-picker:--control:hosted-date-picker:--control:dialog:--control:popover` | stale | — | 05b21ef2fac6 (not this tree) | 21 m 41 s | start 6.9 / med 9.4 / max 38.7 |
| `real-input:android:--control:context-menu:--control:date-picker:--control:bottom-sheet:--control:hosted-date-picker:--control:dialog:--control:popover` | **PASS** | — | `4b6653cd493a` (android tree) | 20 m 54 s | start 7.6 / med 6.9 / max 21.2 |
| `real-input:android:--control:date-picker:--control:hosted-date-picker` | stale | — | a363c5a60636 (not this tree) | 14 m 24 s | start 6.2 / med 6.0 / max 18.8 |
| `real-input:android:--control:dialog:--control:popover:--control:chip:--control:checkbox:--control:list-item:--control:hosted-switch:--control:hosted-mixed` | stale | — | 37629df01860 (not this tree) | 16 m 25 s | start 9.7 / med 5.8 / max 17.1 |

The real-input proof is the two filtered runs that are green on this tree. Together they name
all eleven controls. A single run naming all eleven is refused by `gate.mjs` itself: its log
file name exceeds the file system's limit (`ENAMETOOLONG`). The full `real-input:android`
run is left for merge, as instructed. The stale rows are earlier runs of the same tests.

`need --for review`: `need: 1 gate(s) missing for review: harness:ios`, which runs at merge.
`bun run task-ready` passes every check except this one, and refuses on it alone.

## Red proofs

Native mutations were built with `--no-stamp`, installed, run with only the named tests,
and reverted. Line numbers are those of the committed files.

- `os-tree.ts` `ownerNode` (the chip and list-item tests below) -> the old rule: any covering
  box, the node itself excluded, `hittable` ignored -> `reader.ts:108`, reached from
  `chip.e2e.ts:52`: "Real-input disabled chip" is not `enabled="false"`, `expected "true"`.
  The same mutation also failed at `list-item.e2e.ts:73`.
- `context-menu` "quick taps belong to the child, and each of three still holds opens the
  menu at the finger…" -> `openAt(x + 40, y + 40)` -> `context-menu.e2e.ts:223`: the popup's
  top-start is at 390,796 with the finger at 350,756.
- `context-menu`, the same test, cycles 2 and 3 -> the ContextMenu reports only its first
  pick (`selects == 0` guard in `applyPick`) -> `context-menu.e2e.ts:234`:
  `hold 2's pick was not reported`, 1 to be 2. The single-pick test stayed green.
- `context-menu` "a drag that starts on the ContextMenu, or inside its horizontal list" ->
  a MOVE past the slop opens the menu instead of dropping the press ->
  `context-menu.e2e.ts:290` `the pan put a window up`, 1 to be 0.
- `context-menu` "a tap outside closes the menu" -> `onDismissRequest = { }` ->
  `context-menu.e2e.ts:313` `popupsReach(0)` timed out after 8 s.
- `context-menu` "an accessible menu is one named node, a hold opens only the innermost
  menu…" -> `canOpen` ignores `enabled` -> `context-menu.e2e.ts:348`
  `a disabled ContextMenu put a window up`, 1 to be 0.
- `context-menu` "at the bottom edge the menu opens above the finger" -> a position provider
  that never flips (top-start at the anchor's bottom) -> `context-menu.e2e.ts:373`: 2361 is
  not ≤ 2351.
- `bottom-sheet` "a tap on the sheet's TextInput reaches JS whole…" -> the sheet root honours
  `requestDisallowInterceptTouchEvent` -> `bottom-sheet.e2e.ts:153`
  `Input touches: in 1 out 1`.
- `bottom-sheet` "Back, a tap outside and a drag down each close the fit sheet…" ->
  `shouldDismissOnClickOutside = false` -> `bottom-sheet.e2e.ts:212`, the log.
- `bottom-sheet` "a sticky sheet stays up…" -> `dismissible` ignored in `userDismissed`,
  `confirmValueChange` and the Back property -> `bottom-sheet.e2e.ts:131`
  `Back closed the sheet`, 0 to be 1.
- `bottom-sheet` "a drag up on the two-detent header expands the sheet…" -> the detent
  reporter drops two changes instead of one -> `bottom-sheet.e2e.ts:273`, the log.
- `date-picker` "each inline calendar lays a whole week out…" -> a narrow box keeps the
  48 dp floor -> `date-picker.e2e.ts:120`: `126 px ×6, 20 px`, two problems.
- `date-picker` "one fling of the hour drum reports one change…" -> the hour drum reports
  every row it crosses -> `date-picker.e2e.ts:240`, the `oneEvent` poll for `1` timed out.
- `date-picker` "a drum whose parent refuses…" -> the same mutation ->
  `date-picker.e2e.ts:240`, timed out.
- `hosted-date-picker` "Back and Cancel each close the hosted dialog…" -> the dialog's
  `onDismissRequest` reports the next day -> `hosted-date-picker.e2e.ts:86`
  `toHaveText('2026-05-17')`.
- `dialog` "the alert's disabled action is disabled where a finger lands…" -> alert actions
  `enabled = true` -> `dialog.e2e.ts:78`: `the disabled action`, "true" to be "false".
- `dialog` "Back and a tap outside each close the alert…" -> `userDismissed` reports
  `onAction("back")` -> `dialog.e2e.ts:124`, the log.
- `popover` "keystrokes reach the field inside the popover…" -> `Popup` with
  `focusable = false` -> `popover.e2e.ts:150`, the log.
- `chip` "a second tap deselects the Chip…" -> the `ownerNode` mutation above ->
  `chip.e2e.ts:52`.
- `checkbox` "a second tap unchecks the Checkbox…" -> `press()` always asks for `true` ->
  `checkbox.e2e.ts:54` `toHaveText('off')`.
- `list-item` "a disabled ListItem is disabled where a finger lands…" -> the `ownerNode`
  mutation above -> `list-item.e2e.ts:73`.
- `hosted-switch` "a screen reader meets the hosted Switches in mount order…" -> the Host
  composes its children last to first -> `hosted-switch.e2e.ts:69`: `[112,108,104]` is not
  in order.
- `hosted-mixed` "in a Host of mixed controls the linear ones fill it…" -> the hosted Switch
  gets `fillMaxWidth()` -> `hosted-mixed.e2e.ts:76` `the Switch does not keep its own
  width` (996 px).

- `date-picker` "one fling of the hour drum…", the drum names -> the minute drum named
  `Minutes` instead of Material's string -> `date-picker.e2e.ts:280`:
  `the minute drum is not named inside the wheel`.

Not shown red on its own: the vertical-drag half of the drag test. The mutation above
failed only the horizontal pan, because the page's ScrollView takes a vertical drag before
the ContextMenu sees it. The date wheel's height is asserted inside a test that is shown
red.

## Files changed

- `example/e2e/real-input/`: `os-tree.ts` and `reader.ts` (the enabled read), and the eleven
  controls' `.e2e.ts` files.
- `scripts/real-input/android-tree-checks.mjs`: ten blocks, their entries and the helpers
  they orphaned; `context-menu` cut to the rows that stay.
- `scripts/real-input/android-tree.mjs`, `android-tree.d.mts`,
  `scripts/__tests__/real-input-android-tree.test.js`: `nativeEnabled` removed.

## Follow-ups

- Remaining `context-menu` rows wait on driver capabilities: hold-then-move at points
  (M8a, M8b, M3c), `long-clickable` (M15a, M15b) and `focusable` on its own (M16a, M16b).
- `hosted-date-picker.e2e.ts`: each test spends about 110 s in `reveal` on the Host screen,
  which is most of the control's run time.
- `checkbox.e2e.ts` reads the disabled checkbox's counter only at rest, as phase 2 did; no
  test taps the disabled box.
- `android-tree-checks.mjs:1-6` and `example/e2e/README.md` still describe the checks this
  task removed.
- `os-tree.ts` `screenReaderFacts` still reads `checked` on the default tree unless `enabled`
  is asked for too; the unmerged tree is the dump's, node for node.
- Flaky: `Form.harness.tsx` "places a drawn accessory inside the row it belongs to, and keeps
  it there (E2)", 2026-11-16, `harness:android` started 15:27 (accessory 1.1 dp off its row);
  green on its one rerun.
