# E1 — Material 3 Expressive, pass 1: buttons

**Worktree / branch:** named in your delegation message (`task/E1-expressive-buttons`). **Round cap:** 1 round, plus
at most 2 fix rounds (D19). **Devices:** your lease (`node scripts/lease.mjs acquire --task E1 --boot`).

## Read first

- AGENTS.md: the perf contract, red proofs, **never `pkill`/`killall`**, the README rule (D4) and CONTRIBUTING "README
  screenshots" (804/720 px, Storybook, light). README content is for app developers only.
- `docs/DECISIONS.md` D39 and D40.
- `docs/tasks/Q8-expressive-and-holdbacks.report.md`: Appendix A rows 2–4 (Button, SegmentedControl, Chip), Appendix E
  "Pass 1 — Machine A", and "Decisions already taken".
- X18's theme (`NitroUiTheme` in `NitroComposeHost.kt`, and `setMaterialTheme`): every control already sits under one
  `MaterialExpressiveTheme`, on material3 1.5.0-beta02.

## Do

Move the three button-shaped Android controls onto their Expressive APIs. They share the size tokens and the
`ToggleButton`/`ButtonGroupDefaults` code, so build that shared code once.

1. **Button (A2).**
   - Use the `shapes: ButtonShapes` overload, so the shape morphs on press.
   - Take padding, type and icon size from `ButtonDefaults.*For(buttonHeight)`, replacing the hand-rolled values per
     size.
   - Map `size` to M3's XS/S/M height tokens as Q8 proposes. Keep the 48 dp minimum touch target.
   - Add `shape: 'round' | 'square' | null` on **both** platforms. iOS maps it to the nearest SwiftUI border shape;
     write the mapping in the doc.
   - Menu's trigger goes through the same helpers. Change only the trigger, not the popup: E2 owns that.
2. **SegmentedControl (A3).** On Android, draw it as a connected button group: a `Row` spaced by
   `ButtonGroupDefaults.ConnectedSpaceBetween`, of `ToggleButton`s with the connected leading, middle and trailing
   shapes.
   - Keep the public API unchanged.
   - Keep radio semantics: one merged group, with each item `Role.RadioButton` and `selected`, so TalkBack still
     announces "1 of 3, selected".
   - Keep the event-count handshake and the refused-change revert.
3. **Chip (A4).** Use the `shapes: ChipShapes` overload, so a selected chip has its own corner.
   - If 1.5 no longer has the leading-slot width spring, drop the always-present leading slot workaround, and prove
     the width stays steady in the harness.
4. Sizing: every changed control keeps D17's measured sizing. Update the conformance rules and the fallback sizes when
   the measured size changes, and say by how much in the report.
5. Retake the **Android** README screenshots of Button, SegmentedControl and Chip by the CONTRIBUTING recipe. iOS
   shots change only if `shape` changes what the existing story shows.
   - **The owner has approved `adb -s <serial>` on your own leased emulator** for this. Undo the reverse and the
     preference afterwards.
6. Update `docs/components/{button,segmented-control,chip}.md`, the README usage for `shape`, and add a minor
   changeset.

## Tests, each shown red first

- Harness, both platforms: the new `shape` prop and its recycle reset.
- SegmentedControl on Android:
  - the role, selected state and position of each item;
  - the handshake, including a refused change reverting, still holding;
  - the connected group drawing as one row with no gaps wider than the connected spacing, measured from the item
    bounds.
- Chip: width steady across select and deselect.
- Real-input taps on both platforms still pass for all three controls.
- Bench: re-run the three controls' arms if that's cheap. Otherwise add one FOLLOWUPS line.

## Not in scope

Menu's popup and rows, ContextMenu and Picker (E2). ButtonGroup as a component, SplitButton, IconButton and Android
icons (pass 2). Anything else: one FOLLOWUPS line.

## Gates

`check`, both `harness:*` and both `real-input:*`, then `need --for review`. Report at
`docs/tasks/E1-expressive-buttons.report.md` with the API you settled at the top. Export the ledger with
`gate.mjs export --task E1`.
