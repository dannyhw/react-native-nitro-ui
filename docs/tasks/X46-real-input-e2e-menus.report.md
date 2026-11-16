# X46 — Android real-input: pickers, menus and button controls move into e2e

**Branch:** `task/X46-real-input-e2e-menus` (stacked on the X45 branch at `bec7fc06`) ·
**Round:** 1 of up to 3 · **Leases:** `X46-bio9o` (`emulator-5570` / Metro `8293`), then `X46-gncza` (`emulator-5574` / Metro `8295`)

## Summary

All six controls are done. `icon-button`, `menu`, `hosted-picker` and `segmented-control` have no
tree check left, and their blocks and entries are gone. `button-group` and `picker` keep one
assertion each, because each needs the driver's `clickable` flag.

| Control | Rows | Moved to e2e | Deleted, harness covers | Already gone (phase 1) | Left |
| --- | --- | --- | --- | --- | --- |
| icon-button | 19 | 17 | 1 (IB4b) | 1 (IB2) | 0 |
| button-group | 18 | 14, BG6 made exact, BG11a and BG11b by coordinates | 0 | 3 (BG3a, BG3b, BG7) | 1 (BG2) |
| picker | 29 | 27, PK7 included | 1 (PK17b) | 0 | 1 (PK23) |
| menu | 13 | 12 | 0 | 1 (MN2) | 0 |
| hosted-picker | 5 | 4 | 0 | 1 (HP3) | 0 |
| segmented-control | 10 | 10, S3's press included | 0 | 0 | 0 |

**Decisions:**

- **`factsForItem` reads the unmerged tree** (`tree({ unmerged: true })`). Its only callers are the button-group and radio item reads. The icon toggle uses `android-tree.mjs` `nativeChecked` over the unmerged tree, which is phase 2's own rule. `screenReaderFacts` and `ownerNode` are untouched.
- **Where the device corrected the source:** the unmerged tree carries a segment's label `TextView` with its words in `contentDesc`, because `os-tree` maps the driver's `label` there when no `value` is printed. S7 reads text or description.
- **The e2e phase's 25-minute ceiling.** The first full run stopped at `--max-duration` with
  50 of 51 tests passed; the last tooltip test was interrupted. The sweep and every tree check
  passed. A reveal of a control low on the Picker or Host screen costs about 100 s of drags,
  so the lower Picker tests became one test reached by short drags, and the hosted menu's
  Back check became part of the test that already reveals it. `picker.e2e.ts` went from
  417 s to 113 s, and `hosted-picker.e2e.ts` from 222 s to 113 s. I did not raise the ceiling
  (see Questions). On the final run the e2e phase took 23 m 15 s.

## Appendix: rows deleted as covered, and rows left

**Rows deleted because a harness test covers them** (each line opened):

- IB4b: `IconButton.harness.tsx:938` covers the press form: `expect(events).toEqual(['press-once:press', 'press-once:press'])`, read after pressing the disabled button. `:1177` covers the toggle form: `expect(events).toEqual([])`. The test at `:1155` presses only the toggle form, although its title says "either form".
- PK17b: `Picker.harness.tsx:1769` and `:1772`, `expect(eventLog).toEqual([])`, read after `pickRow('radio-disabled', 1)` and `pickRow('radio-disabled', 2)`.
- BG11a and BG11b were not deleted as covered; they moved to e2e. `ButtonGroup.harness.tsx:619` and `:636` press through the host's `press(id)`, which has its own guard, so they do not cover a real tap. `button-group.e2e.ts` taps `Cut` and the disabled group's `Copy` by coordinates and reads the disabled counter at `:95`.
- PK7 was not deleted as covered; it moved to e2e. The context cites `:1738`/`:1769`, which test the radio variant, not the menu. The menu-variant line, `:1312`, reads the log straight after the pick, with no quiet wait. In e2e it costs one echo read (`picker.e2e.ts:136`).

**Rows left, and what they wait for:**

- BG2: a clickable node contains each item's title. The audit marks it "Needs a driver change", so it stays (brief item 4). It waits on D-A, or on `hittable` mapped in `os-tree.ts`: Q1 shows that `hittable` over `--raw` matches the dump.
- PK23: the enabled Picker's named node is clickable. Needs D-A, since `hittable` also counts `focusable`.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1987 tests / 88 suites | `2a41cfe1f33c` | 2 m 00 s | start 6.8 / med 12.6 / max 38.5 |
| `harness:ios` | missing | — | — | — | — |
| `harness:android` | **PASS** | 659 tests / 31 suites + isolated 6 tests / 3 suites | `2a41cfe1f33c` (android tree) | 18 m 21 s | start 7.2 / med 9.6 / max 27.2 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | **PASS** | — | `2a41cfe1f33c` (android tree) | 51 m 52 s | start 4.6 / med 8.7 / max 81.0 |
| `real-input:android:--control:icon-button` | stale | — | e90a72db3856 (not this tree) | 0.8 s | start 4.8 / med 4.8 / max 4.8 |
| `real-input:android:--control:icon-button:--control:button-group` | stale | — | 802490351dd8 (not this tree) | 12 m 09 s | start 4.5 / med 5.4 / max 17.4 |
| `real-input:android:--control:picker` | stale | — | ddb25a36844d (not this tree) | 13 m 58 s | start 5.6 / med 6.7 / max 20.1 |

`need --for review`: `harness:ios`, which runs at merge. On the final tree, the e2e phase of
`real-input:android` ran 49 tests in 23 m 15 s against its 25-minute ceiling. The whole gate
took 51 m 52 s.

## Red proofs

- `icon-button.e2e.ts` "two real taps on the press button…" -> `onPress` invoked twice per press -> `icon-button.e2e.ts:85` `expect(presses).toHaveText('1')`.
- `icon-button.e2e.ts` "one real tap per direction checks and unchecks the toggle…" -> the tonal toggle composed with `checked = false` -> the poll called from `:110` read `off`, expected `on`.
- `button-group.e2e.ts` "one real tap per direction toggles one item once…" -> `onCheckedChange` invoked twice per tap -> `button-group.e2e.ts:103` `expect(events).toHaveText('1')`.
- `picker.e2e.ts` "the menu is a popup window…" -> a re-pick of the shown row is reported -> `picker.e2e.ts:136` `expect(events).toHaveText('0')`.
- `picker.e2e.ts` "a real tap picks one radio row…" -> radio rows `selectable(enabled = true)` -> `:165` `itemAnnounces(RADIO_LOCKED, row, { enabled: 'false' })` read `Gabbro` enabled=true.
- the same test -> the menu anchor and `onExpandedChange` ignore `enabled` -> `picker.e2e.ts:188` "a tap on the disabled Picker opened a window: expected 1 to be 0".
- `menu.e2e.ts` "the trigger is one Spinner node…" -> the primary action also opens the list -> `menu.e2e.ts:133` `expect(echo).toHaveText('action')`.
- `hosted-picker.e2e.ts` "a hosted Picker opens its menu as a window that Back takes down…" -> a dismissal picks row 0 -> `hosted-picker.e2e.ts:43` `expect(index).toHaveText('1')`.
- `segmented-control.e2e.ts` "one real tap is one change, and each segment…" -> `Role.RadioButton` dropped from the segment -> `segmented-control.e2e.ts:101` "one radio node per option: expected 0 to be 3".

The disabled-Picker and hosted reds were taken again after the merge, on the merged tests. The
`:136` and `:165` reds were taken before an import reflow moved those lines down by 7. The
assertions are the ones cited.

## Files changed

- `example/e2e/real-input/{icon-button,button-group,picker,menu,hosted-picker,segmented-control}.e2e.ts`: the moved rows.
- `example/e2e/real-input/os-tree.ts`: `factsForItem` reads the unmerged tree.
- `scripts/real-input/android-tree-checks.mjs`:
  - four blocks and their entries removed;
  - `buttonGroupChecks` and `pickerChecks` reduced to BG2 and PK23;
  - the uncalled `requireControlAt`, `optionIsSelected` and `popupWindowCount` context helpers removed.

## Follow-ups

- `os-tree.ts` `asTreeNode`: in the unmerged tree a `TextView`'s words land in `contentDesc`, so `findAllByText` misses them there.
- BG2 can move once `os-tree.ts` maps `hittable`, which the other task adds for `ownerNode`.
- The first gate run of the disabled-Picker test failed: the enabled twin was tapped at the band's lower edge (y≈2183 of 2424) and opened nothing. Fixed with `liftIntoBand`, from the trace.
- `reveal` on the Picker and Host screens takes 95–110 s to reach the lower controls, and every `reveal` starts again from the top of the page.
- Incident: I released the lease to renew it, and the queued X48 took the slot. The final device gates waited for a free slot.
- `IconButton.harness.tsx:1155`'s title says "either form", but it presses only the toggle form.

## Questions for orchestrator

- **The e2e deadline (`RUN_MAX_MS`, 25 min, `scripts/real-input/android.mjs`).** Phase 1 was
  17 m 42 s after X45. With this task it is about 21 minutes, and the other task's moves add
  more. Phase 2 shrinks by about as much, but only phase 1 has the ceiling. Options:
  - (a) raise the ceiling, as a budget for the suite's size and not a flake fix;
  - (b) split the e2e run into two processes;
  - (c) make `reveal` start from where the page is rather than from the top.

  I recommend (a) now, sized from the merged suite's measured length, with (c) as a
  follow-up task. I did not take any of them.
