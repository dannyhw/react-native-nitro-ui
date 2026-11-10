# G30 — ListItem

**Worktree / branch:** named in your delegation message (`task/G30-list-item`). **Round cap:** 1 round, plus at most
2 fix rounds (D19). **Devices:** your lease (`node scripts/lease.mjs acquire --task G30 --boot`). Export the lease's
environment before any device gate.

## Read first

- AGENTS.md: the perf contract, the event-count handshake, red proofs, **never `pkill`/`killall`**, the README rule
  (D4) and CONTRIBUTING's "README screenshots" (804/720 px, Storybook, light). The README is for app developers only.
- `docs/DECISIONS.md` D17, D39, D40, D43, D45 and **D46** (the decision and v1's scope).
- `docs/tasks/Q10-form-list-research.report.md`: question C, Appendix A (@expo/ui's `ListItem` on both platforms and
  the bugs it hit, e.g. a `ListItem` inside a `ListItem`) and Appendix C (Form's design).
- Form and Section (G24), Button's and Menu's icon path (G19, `src/iconSource.ts`, `NitroUiIcon.kt`), and the sizing
  engine, as they are on `main`.

## Do

1. **Early checks first**, each with evidence in the report; stop and ask if one fails in a way D46 doesn't cover:
   1. iOS: `UIListContentView` hosted in our view, configured with `.cell()`, `.subtitleCell()` and `.valueCell()`:
      does it self-size from `systemLayoutSizeFitting` for a given width, and do its margins match a
      `UICollectionView` list cell's in `.insetGrouped` (Form's) and standalone?
   2. Android: Material 3 `ListItem` content (headline, supporting, overline, leading, trailing) inside
      `NitroUiMeasuredRoot`: its one-, two- and three-line minimum heights, measured, and that it draws no container
      of its own when Form's segmented row owns the shape.
   3. Inside a `Form.Row` on both platforms: no doubled padding, shape or press highlight.
2. **API** (D46 item 1): `title`, `subtitle`, `value` (trailing text), `systemImage`/`androidIcon` (leading),
   `accessory: 'none' | 'disclosure'`, `disabled`, `onPress` (optional; when set, the row highlights as the platform's
   does and is a button to screen readers), `accessibilityLabel`. Every native prop always passed.
3. **Sizing (D17):** `fillWidth` with a measured height per configuration, keys and conformance rules, fallbacks that
   don't coincide with the real size, dynamic type / font scale respected.
4. **Accessibility:** one element per item, its title, subtitle and value read in the platform's order, the button
   role only with `onPress`, disabled state.
5. **Recycling with a full reset, the registry entry, stories (standalone, and inside `Form`), `docs/components/list-item.md`
   (with "inside a Form" and "in a FlashList row" sections), the README row, import, Usage section and both screenshots
   (`docs/images/components/list-item-{ios,android}.png`), and a minor changeset.**

adb `-s <serial>` on your own leased emulator is approved for screenshots. Undo `adb reverse` and the debug-host
preference afterwards, and restore any setting you change (read it first; never `cmd uimode`, not even to read).

## Tests, each shown red first

- Harness, both platforms: each configuration sizes from a poisoned fallback; a title/subtitle/value change resizes
  only when the box should change; the icon draws (G19's pixel probe on Android); `disabled` sends nothing; recycling
  resets; inside a `Form.Row` the item draws no shape or padding of its own.
- Accessibility: one node per item with the right text and role, on both platforms.
- Real input, both platforms: a tap on an item with `onPress` fires once and highlights; a tap on a disabled item does
  nothing; inside a `Form`, a tap reaches the item.

**Bench:** `mount.list-item` on this machine against an RN `View` + two `Text`s.

## Not in scope

Control accessories (a `Switch` inside the item), swipe actions, a virtualized list, and anything else, which goes as
one FOLLOWUPS line.

## Gates

`check`, both `harness:*` and both `real-input:*`, then `need --for review`. Report at
`docs/tasks/G30-list-item.report.md`, with the API and the early checks at the top. Export the ledger with
`gate.mjs export --task G30`.
