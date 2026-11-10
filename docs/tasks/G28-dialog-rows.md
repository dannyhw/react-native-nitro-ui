# G28 — ConfirmationDialog rows: Material 3 Expressive on Android

**Worktree / branch:** named in your delegation message (`task/G28-dialog-rows`). **Round cap:** 1 round, plus at
most 2 fix rounds (D19). **Devices:** your lease (`node scripts/lease.mjs acquire --task G28 --boot`). Export the
lease's environment before any device gate.

## Read first

- AGENTS.md: the perf contract, red proofs, **never `pkill`/`killall`**, the README rule (D4) and CONTRIBUTING's
  "README screenshots".
- `docs/DECISIONS.md` D39 and **D40** (the Expressive passes), and `docs/tasks/Q8-expressive-and-holdbacks.report.md`
  row 16 and Appendix E pass 3 B.
- Dialog as it is on `main`: `docs/components/dialog.md`, `HybridNitroUiDialog.kt` (the confirmation sheet's rows,
  around line 515, still hand-colour a disabled row because material3 1.4's `ListItem` had no `enabled`).

## Do

1. **Android confirmation rows** move to material3 1.5's interactive list item: the Expressive `SegmentedListItem`
   with `ListItemDefaults.segmentedShapes(index, count)` if it reads right in a bottom sheet, otherwise the interactive
   `ListItem(onClick, enabled, …)`. Decide on the device, show both in the report (screenshots), and say why.
   Disabled rows use the component's real `enabled = false`, not a hand-picked alpha; destructive keeps `error`;
   `tintColor` keeps colouring the action text.
2. Keep everything else: the order of actions, cancel handling, `dismissible`, the "an action always closes" rule,
   `titleVisibility`, hosting, recycling, and the dialog's report and accessibility (one node per row, disabled rows
   `enabled="false"`).
3. **AlertDialog** is unchanged.
4. **Docs:** `dialog.md` (the Android column and anything about disabled rows), the changeset (patch or minor as the
   visible change warrants), and retake `confirmation-dialog-android.png` (720 px, light, from Storybook) if the rows
   visibly change.

adb `-s <serial>` on your own leased emulator is approved for screenshots. Undo `adb reverse` and the debug-host
preference afterwards, and restore any setting you change (read it first; never `cmd uimode`, not even to read).

## Tests, each shown red first

- Harness, Android: a disabled row is drawn and reported disabled through the component's own state (red when the row
  ignores `enabled`); a tap on a disabled row sends nothing; row shapes or containers are what the chosen component
  draws (one probe), and the existing Dialog suite stays green.
- Real input, Android: a tap on an enabled row fires that action once and closes; a tap on a disabled row does nothing.
- iOS: unchanged; both iOS gates stay green.

## Not in scope

AlertDialog, iOS, and anything else, which goes as one FOLLOWUPS line.

## Gates

`check`, both `harness:*` and both `real-input:*`, then `need --for review`. Report at
`docs/tasks/G28-dialog-rows.report.md`. Export the ledger with `gate.mjs export --task G28`.
