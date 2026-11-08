# G24 — Form and Section

**Worktree / branch:** named in your delegation message (`task/G24-form`). **Round cap:** 1 round, plus at most 2 fix
rounds (D19). **Devices:** your lease (`node scripts/lease.mjs acquire --task G24 --boot`). Export the lease's
environment before any device gate.

## Read first

- AGENTS.md: the perf contract, red proofs, **never `pkill`/`killall`**, the README rule (D4) and CONTRIBUTING's
  "README screenshots" (804/720 px, Storybook, light). The README is for app developers only.
- `docs/DECISIONS.md` D17, D23, D35, D37, D38, D39 and **D45** (this component's decisions).
- `docs/tasks/Q10-form-list-research.report.md` Appendix C1 (the design).
- `docs/tasks/S6-form-spike.report.md`, both rounds: what was measured, the prototype's mechanisms, the red proofs and
  everything it says G-Form must know. The prototype is on `task/S6b-form-spike` (`e47f30fc`). Reuse what holds up,
  but it was never reviewed, so bring it to the bar rather than copying it.
- BottomSheet and ContextMenu on `main`: `scripts/patch-nitrogen.mjs`'s `CONTENT_CHILDREN_VIEWS`, the `onContentBox`
  round trip, `NitroUiContextMenuViewManager.kt`.

## Do

1. **The real-input tooling fixes from S6b first, in their own commit:** `imeShown()` passing the adb result object to
   `RegExp.test`, the keyboard edge read from the IME service's `visibleTopInsets` while `mInputShown=true`, and
   `hideKeyboard()` being a no-op. Check how Popover's `scripts/real-input/ime-frame.mjs` (G22, if merged by then)
   reads the keyboard and share one reader. Re-run TextField's and SearchField's real-input checks with the fixed
   tooling and report the result.
2. **The Android keyboard (D45 item 1):** a focused field in a row near the bottom scrolls into view above the
   keyboard (IME insets, `WindowInsetsCompat.Type.ime()`). Gate: the real-input keyboard check on a full software
   keyboard, red today as S6b measured.
3. **The component:** `Form`, `Form.Section` (`title`, `footer`) and `Form.Row` (`onPress`, `accessory: 'none' |
   'disclosure' | 'checkmark'`, `selected`), per Q10 C1 and S6. Any React Native view is a row, with no wrapper.
   - **iOS:** the `.insetGrouped` `UICollectionView` with cells holding the rows; the 52 pt row box; `UICellAccessory`
     for accessories; the cell highlight for rows with `onPress`.
   - **Android:** rows in place with `SegmentedListItem` shapes (`segmentedShapes(index, count)`,
     `segmentedColors()`), the reserved header band (D45 item 2), M3's pressed state without stealing touches from
     controls in the row. The `disclosure` and `checkmark` accessories use Material Symbols files through
     `scripts/icons/fetch-material-symbols.mjs` (D43), never hand-drawn.
   - **`measure()`** right after scrolling settles, through the shadow-node fix (D45 items 3–4).
   - Keyboard avoidance on iOS kept as S6b measured it.
4. **Sizing, accessibility (rows with `onPress` are one button element; headers are headings), recycling with a full
   reset, the registry entries, the conformance tables, stories, `docs/components/form.md` (including D45 items 4–6:
   settle-time `measure`, off-screen rows, and FlashList/Legend List for long lists), the README row, import, Usage
   section and both screenshots (`docs/images/components/form-{ios,android}.png`), and a minor changeset.**

adb `-s <serial>` on your own leased emulator is approved for screenshots. Undo `adb reverse` and the debug-host
preference afterwards, and restore any setting you change (read it first; never `cmd uimode`, not even to read).

## Tests, each shown red first

- **Harness, both platforms:** the fidelity table against SwiftUI's `Form` (iOS) and the segmented shapes following
  `index`/`count` through inserts and removals (Android); rows in cells through insert, remove, reorder and 50 scroll
  cycles with no orphans; row heights right on the first frame and when content grows; `measure()` of rows at rest
  and after a scroll; recycling.
- **Real input, both platforms:** taps on a `Switch`, a `Pressable` and a row with `onPress`, 10/10 each, and a tap
  outside any row does nothing; a field near the bottom stays visible above the keyboard.
- **Bench:** S6's question 6 by merge mint (X14) on this machine, N = 20 and 50 mixed rows, against `@expo/ui`'s
  `Form` (iOS) and `FieldGroup` (Android). Say the load.

## Not in scope

A `ListItem` row-content control, a virtualized List, swipe actions, collapsible sections, header or footer views
(strings only in v1), and anything else, which goes as one FOLLOWUPS line.

## Gates

`check`, both `harness:*` and both `real-input:*`, then `need --for review`. Report at `docs/tasks/G24-form.report.md`,
with the API at the top. Export the ledger with `gate.mjs export --task G24`.
