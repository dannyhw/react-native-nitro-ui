# G20 — ButtonGroup

**Worktree / branch:** named in your delegation message (`task/G20-button-group`). **Round cap:** 1 round, plus at
most 2 fix rounds (D19). **Devices:** your lease (`node scripts/lease.mjs acquire --task G20 --boot`), plus the older
and newer iOS runtimes through `--ios-runtime` (X20) for check 1. Export the lease's environment before any device
gate.

## Read first

- AGENTS.md: the perf contract, the event-count handshake, red proofs, **never `pkill`/`killall`**, the README rule
  (D4) and CONTRIBUTING's "README screenshots" (804/720 px, Storybook, light). The README is for app developers only.
- `docs/DECISIONS.md` D17, D38 item 1, D39, D40, **D42** (items 1 and 2: the iOS versions and toggles in a connected
  iOS group) and D43 (icons).
- `docs/tasks/Q9-buttongroup-iconbutton-design.report.md`: **Appendix B** (the design), Appendix A (the iOS
  `ControlGroup` check) and Appendix D (G-B's four early checks).
- Button, IconButton (G23), SegmentedControl's `ConnectedRow` (E1) and Menu's popup rows (E2), as they are on `main`.
  Items take `androidIcon` through G19's icon path; don't build a second one.

## Do

1. **The four early checks first** (Q9 Appendix D), each with its evidence in the report. Any one of them can change
   the build, so stop and ask if one fails in a way the design doesn't cover:
   1. the `ControlGroup` probe on iOS 26.5 and 27.1 (Appendix A, screenshots under `docs/tasks/G20/`);
   2. whether `.labelStyle(.titleAndIcon)` keeps titles inside `ControlGroup`;
   3. Material's overflow `DropdownMenu` in a plain host and inside an Android `<Host>`, under
      `MaterialExpressiveTheme` (photograph it);
   4. `ButtonGroup` under `NitroUiMeasuredRoot`: a `fillWidth` measure gives a stable height and overflow count with
      no second `measure()` per pass, and a press's `animateWidth` doesn't move the box.
2. **ButtonGroup per Appendix B:** items as data (`id`, `title`, `systemImage`, `androidIcon`, enabled, toggleable with
   `checked`), `appearance: 'standard' | 'connected'`, size and variant from the shared ladder, `onPress(id)` and the
   toggle form on the event-count handshake. Android's overflow opens E2's popup; iOS per Appendix B3. Toggle items in
   a connected iOS group fall back to a row of bordered toggles (D42 item 2), documented.
3. **Sizing (D17), accessibility (each kind of item on both platforms), recycling with a full reset, the registry
   entry, conformance rules, stories, `docs/components/button-group.md` (including B8's "ButtonGroup or
   SegmentedControl?" paragraph and which iOS versions were checked), the README row, import, Usage section and both
   screenshots (`docs/images/components/button-group-{ios,android}.png`), and a minor changeset.**

adb `-s <serial>` on your own leased emulator is approved for screenshots. Undo `adb reverse` and the debug-host
preference afterwards, and restore any setting you change (read it first; never `cmd uimode`, not even to read).

## Tests, each shown red first

Appendix B7's test plan, plus real input on both platforms: a tap on each item fires `onPress(id)` once, a toggle item
flips once per tap, and an overflowed item is reachable through the overflow menu.

**Bench:** `mount.button-group` by merge mint (X14) on this machine, against a row of RN `Pressable`s and @expo/ui's
equivalent if it has one.

## Not in scope

`androidIcon` on Menu rows, SplitButton and Chip (G21), and anything else, which goes as one FOLLOWUPS line.

## Gates

`check`, both `harness:*` and both `real-input:*`, then `need --for review`. Report at
`docs/tasks/G20-button-group.report.md`, with the API and the early checks at the top. Export the ledger with
`gate.mjs export --task G20`.
