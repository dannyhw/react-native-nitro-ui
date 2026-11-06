# E3 — Material 3 Expressive, pass 2: SplitButton (Menu's `primaryAction` on Android)

**Worktree / branch:** named in your delegation message (`task/E3-split-button`). **Round cap:** 1 round, plus at
most 2 fix rounds (D19). **Devices:** your lease (`node scripts/lease.mjs acquire --task E3 --boot`).

## Read first

- AGENTS.md: the perf contract, red proofs, **never `pkill`/`killall`**, the README rule (D4) and CONTRIBUTING's "README
  screenshots" (804/720 px, Storybook, light). The README is for app developers only.
- `docs/DECISIONS.md` D29 (`primaryAction` shipped iOS-only), D39 and D40.
- `docs/tasks/Q8-expressive-and-holdbacks.report.md`: Appendix C row 2 (SplitButton) and Appendix E "Pass 2".
- `docs/components/menu.md` and the Menu source on both platforms. The two Expressive tasks before this one changed
  Menu, and both have merged:
  - E1 built the trigger on `NitroUiM3Button` with the size and shape tokens;
  - E2 moved the popup to `DropdownMenuPopup` with groups and `subtitle`/`checked` rows.

  Their reports (`docs/tasks/E1-expressive-buttons.report.md`, `docs/tasks/E2-expressive-menus.report.md`) say how.

## Do

Lift "`primaryAction` is iOS-only". On Android, a Menu with `primaryAction` set draws Material 3 Expressive's split
button: `SplitButtonLayout(leadingButton, trailingButton)`.

1. **Leading button.** It shows the trigger's `title` (and icon, if Menu has one today), and a tap runs
   `primaryAction`.
   - **Trailing button.** It opens the menu: E2's popup, anchored to the trailing button. Its `checked` state is
     the menu's open state, and its chevron turns as Material's sample does.
   - Build the chevron the way Chip builds its check. The library bundles no icon set (D40 item 2), so use an icon
     material3 or compose-foundation already ships, or draw the vector inline, and say which in the report.
2. **Variants.** Map them to `SplitButtonDefaults.{LeadingButton,TrailingButton}` (filled) and the `Tonal`,
   `Outlined` and `Elevated` sets. `variant="text"` has no split button, so it maps to outlined; document that.
3. **Sizes.** Use E1's size ladder (`size`) and the `shape` prop where the split button's API takes them. If
   `SplitButtonDefaults` has its own size tokens, prefer those, and write the mapping in the doc.
4. **Events.**
   - Unchanged on iOS.
   - On Android, a leading tap fires `primaryAction` and never opens the menu. A trailing tap opens it, firing
     `onOpen`/`onClose` exactly once each.
   - `disabled` disables both halves. `disabled` while the menu is open closes it, per D29.
5. **Accessibility.** The leading half is a button labelled with the title. The trailing half is a button with an
   expanded/collapsed state and a label saying it shows more options. Say what TalkBack reads for each.
6. **Sizing.** The split button changes Menu's Android size when `primaryAction` is set. Keep D17's measured sizing:
   - a conformance rule for the split configuration;
   - its fallback size;
   - the sizes table in `menu.md`.
7. **Docs and README.**
   - `menu.md`: `primaryAction` now works on both platforms. Describe each platform's idiom: on iOS a tap runs it and
     a long press opens the menu; on Android a split button.
   - README usage: if Menu has a usage block, add `primaryAction` to it.
   - Changeset: a minor.
   - Add a Storybook story for the split configuration, and retake `menu-android.png` only if the README's Menu shot
     should show it. Say what you chose and why. adb `-s <serial>` on your own leased emulator is approved for
     screenshots. Undo the reverse and the debug-host preference afterwards, and restore any setting you change.

## Tests, each shown red first

- **Harness, Android:** with `primaryAction` set,
  - the trigger is a split button (two hit targets);
  - a leading press fires `primaryAction` and no `onOpen`;
  - a trailing press opens the menu, with one `onOpen` and one `onClose` on dismiss;
  - the recycle reset clears `hasPrimaryAction`'s layout.
- **Harness, iOS:** the iOS behaviour is unchanged (the existing tests stay green).
- **Real-input, Android:** real taps on each half, with the event echo in order. Real-input on iOS still passes.
- **Conformance:** the split configuration's size against its fallback (not coinciding with it).
- **Bench:** none needed. Add one FOLLOWUPS line if you think one is owed.

## Not in scope

ButtonGroup, IconButton and the `androidIcon` prop (D40 item 2). Menu rows and the popup's look (E2's). Progress and
Slider (later pass-2 tasks). Anything else goes as one FOLLOWUPS line.

## Gates

`check`, both `harness:*` and both `real-input:*`, then `need --for review`. Report at
`docs/tasks/E3-split-button.report.md`, with the API and the Android mapping at the top. Export the ledger with
`gate.mjs export --task E3`.
