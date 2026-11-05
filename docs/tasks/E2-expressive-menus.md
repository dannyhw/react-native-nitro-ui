# E2 — Material 3 Expressive, pass 1: menus

**Machine:** maintainer-mac-1, delegated through the T3 link. **Round cap:** 1 round, plus at most 2 fix rounds
(D19). **Devices:** your lease (`node scripts/lease.mjs acquire --task E2 --boot --wait-minutes 240`). No `--exclusive`.

## Workspace

- Your own worktree from `origin/main` on branch `task/E2-expressive-menus`; run `bun install` there.
- On maintainer-mac-1 the project checkout is the owner's working copy: don't edit it, switch its branch, stash, reset
  or clean it.
- Push only your own branch: never `main`, tags or force. No PR.

## Read first

- AGENTS.md: the perf contract, red proofs, **never `pkill`/`killall`**, the README rule (D4) and CONTRIBUTING "README
  screenshots" (804/720 px, Storybook, light). README content is for app developers only.
- `docs/DECISIONS.md` D32, D36, D37, D39 and D40.
- `docs/tasks/Q8-expressive-and-holdbacks.report.md`: Appendix A rows 5–7 (Menu, ContextMenu, Picker), Appendix E
  "Pass 1 — Machine B", and "Decisions already taken".
- `docs/components/{menu,context-menu,picker}.md`, and `MenuRows.kt`, the row code Menu and ContextMenu share since G16.

## Do

Move the three menu-shaped Android controls onto Expressive's menu. Build the popup, group and row composable once
and share it.

1. **Menu (A5).**
   - Use `DropdownMenuPopup` with `MenuDefaults.rememberDropdownMenuPopupPositionProvider`, anchored to the trigger.
   - Each `group` becomes a Material menu group, replacing the dividers between sections.
   - Add two optional props per action on **both** platforms:
     - `subtitle: string | null`: iOS `UIAction.subtitle` / SwiftUI, Android the row's supporting text;
     - `checked: boolean | null`: iOS `.on` state, Android a selected row with a check.
   - `onSelect`, `onOpen`/`onClose` (D32) and the menu witness must keep their exact semantics.
   - Keep Menu's trigger as it is: E1 owns it.
2. **ContextMenu (A6).** The same popup and groups, anchored at the press point. Keep D36/D37: the long-press
   arbitration, the accessibility action that opens it, and the `accessible` rule.
3. **Picker (A7).** Keep the exposed dropdown, because Expressive didn't replace it.
   - Move off any member API that 1.5 deprecates.
   - Draw the selected row as a real selected row instead of semantics only.
   - Restyle the container to the new menu.
   - `wheel` stays iOS-only; it belongs to pass 3.
4. Retake the **Android** README screenshots of Menu, ContextMenu and Picker, presented, by the CONTRIBUTING recipe.
   Retake the iOS ones only where `subtitle` or `checked` show up in the story you photograph.
   - **The owner has approved `adb -s <serial>` on your own leased emulator** for this. Undo the reverse and the
     preference afterwards.
5. Update the docs and the README usage for `subtitle` and `checked`, and add a minor changeset.

## Tests, each shown red first

- Harness, both platforms:
  - `subtitle` and `checked` reach the native menu: iOS reads the `UIMenu` tree, as G9's probe does; Android reads
    the row semantics;
  - the recycle reset of both props.
- Android:
  - groups render as groups, and the dividers are gone;
  - Picker's selected row is selected in the semantics;
  - D32's open and close events still fire exactly once per open;
  - ContextMenu's long-press arbitration cases from G16 still hold.
- Real-input on both platforms, for all three controls.

## Not in scope

Button, SegmentedControl, Chip and Menu's trigger (E1). SplitButton, `primaryAction` (pass 2), Picker `wheel` and
`radio` (pass 3), and Android icons. Anything else: one FOLLOWUPS line.

## Gates

`check`, both `harness:*` and both `real-input:*`, then `need --for review`. Report at
`docs/tasks/E2-expressive-menus.report.md` with the API you settled at the top. Export the ledger with
`gate.mjs export --task E2`.
Then commit and `git push origin task/E2-expressive-menus`.
