# G21 — `androidIcon` on Menu and ContextMenu rows, SplitButton and Chip

**Worktree / branch:** named in your delegation message (`task/G21-android-icon-rows`). **Round cap:** 1 round, plus
at most 2 fix rounds (D19). **Devices:** your lease (`node scripts/lease.mjs acquire --task G21 --boot`). Export the
lease's environment before any device gate.

## Read first

- AGENTS.md: the perf contract, red proofs, **never `pkill`/`killall`**, the README rule (D4).
- `docs/DECISIONS.md` D40 item 2 and **D43** (icons: official Material Symbols files; `androidIcon` takes a Metro
  `.xml` asset or a drawable name).
- `docs/tasks/Q9-buttongroup-iconbutton-design.report.md` Appendix C1–C3, especially **C2 item 3**.
- G19 as merged: `src/iconSource.ts`, `NitroUiIcon.kt`, `NitroUiIcons`, Button's `androidIcon` and its report. Reuse
  that path; don't build a second one.
- Menu, ContextMenu (`MenuRows.kt`, the `NitroUiMenuRow` struct), Menu's `primaryAction` split button (E3) and Chip
  (`HybridNitroUiChip.kt`), as they are on `main`.

## Do

1. **Menu and ContextMenu rows:** `androidIcon` beside `systemImage` on every row type that takes `systemImage` today,
   drawn as the row's leading icon in Material's slot and colour, through G19's resolver (JS resolves the asset; native
   gets a string).
2. **SplitButton:** `primaryAction`'s leading half takes `androidIcon` (the trailing chevron stays FIX4's official
   icon).
3. **Chip:** an assist chip's leading icon, and a filter chip's leading icon while unselected (the check takes the
   slot when selected), through the existing leading slot.
4. **Sizing:** any row or chip whose box changes with an icon has the icon in its sizing key, with conformance rules
   and a fallback that doesn't coincide with the real size.
5. **Docs:** each component's page says how to pass Android icons (point to `button.md`'s "Android icons"), the
   README usage blocks show one example each, and a minor changeset.

adb `-s <serial>` on your own leased emulator is approved for screenshots. Retake any README screenshot whose
component visibly changes. Undo `adb reverse` and the debug-host preference afterwards, and restore any setting you
change (read it first; never `cmd uimode`, not even to read).

## Tests, each shown red first

- **Harness, Android:** the icon draws in each new slot (G19's pixel probe), from a Metro asset in dev and a drawable
  name, at the slot's size; a missing icon leaves the row or chip exactly its no-icon self; recycling clears it; a
  filter chip swaps icon and check on selection without moving its box beyond the measured difference.
- **Harness, iOS:** unchanged behaviour, existing tests green.
- **Real input:** no new input; both real-input gates stay green.

## Not in scope

ButtonGroup (G20), and anything else, which goes as one FOLLOWUPS line.

## Gates

`check`, both `harness:*` and both `real-input:*`, then `need --for review`. Report at
`docs/tasks/G21-android-icon-rows.report.md`. Export the ledger with `gate.mjs export --task G21`.
