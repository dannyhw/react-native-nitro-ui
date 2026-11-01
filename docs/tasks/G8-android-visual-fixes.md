# G8 — Android visual fixes from the README screenshots

**Worktree / branch:** named in your delegation message, from `main`. **Round cap:** 1 round, plus at most 2 fix
rounds (D19). **Devices:** your lease (`lease.mjs acquire --task G8 --boot --platform android`). This host's iOS
simulators can't launch apps until it restarts (FOLLOWUPS), so iOS device gates are out of reach for now. Keep the
fixes Android-only, and say so if one turns out to need iOS.

Read first: the three PR #11 lines at the end of `docs/tasks/FOLLOWUPS.md`, and the screenshots
`docs/images/components/date-picker-android.png` and `menu-android.png`.

## Do

1. **The Android inline `DatePicker` is clipped inside its box.** In the README's 320-wide example, the Saturday
   column is cut off and the "F S" headers run together.
   - Find out why: the declared or measured size, the Material3 `DatePicker`'s minimum width, or our host
     constraining it.
   - Fix it so the full calendar is visible at the widths the README and the example use. Then decide what
     happens below the calendar's real minimum: grow, scale, or document it.
   - Add a harness test that fails today on the clipping. For example, compare the measured content width with
     the box width, or assert the last weekday column is laid out inside the box.
   - Add a patch changeset.
2. **The Android `Menu` dropdown is too narrow and truncates "AirDrop".** Fix the dropdown's width so item labels
   aren't truncated at the example's sizes. Respect Material3's min and max widths, and add a test that fails
   today. Add a patch changeset.
3. The iOS item, Menu's File menu omitting the untitled destructive "Delete" group, is **not** in scope. It needs
   iOS. Leave its FOLLOWUPS line.

Remove the two FOLLOWUPS lines you close, and point them at this report. Re-take the two affected Android
screenshots in `docs/images/components/` the same way PR #11 did: light appearance, cropped to the story content.

## Gates

`check`, `harness:android`, `real-input:android`, then `need --for review`. `harness:ios` and `real-input:ios` will
be missing; I'll take them from CI or after the host restart. Report at `docs/tasks/G8-android-visual-fixes.report.md`,
with the ledger exported.
