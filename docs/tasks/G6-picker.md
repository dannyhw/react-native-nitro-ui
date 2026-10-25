# G6 — Picker (0.2)

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/G6` (branch `task/G6-picker`, from `main`).
**Devices / env:** assigned in the delegation message. **Round cap (D19):** 1 + 2 fix rounds.
Follow `docs/architecture/core.md`, `docs/architecture/sizing.md`, `docs/DECISIONS.md`. The data
model and sizing-key rules are SegmentedControl's (`src/components/SegmentedControl/`,
`docs/components/segmented-control.md`) — reuse them, don't fork them.

## Public API (JS)

```ts
<Picker
  options: string[]
  selectedIndex?: number            // controlled
  defaultSelectedIndex?: number     // uncontrolled
  onChange?: (event: { index: number; value: string }) => void
  variant?: 'menu' | 'wheel'        // default 'menu'
  label?: string                    // shown on the menu button where the platform does
  disabled?: boolean
  tintColor?: ColorValue
  style, testID, accessibilityLabel
/>
```

- iOS: SwiftUI `Picker` with `.pickerStyle(.menu)` / `.wheel`.
- Android: `menu` = Material 3 `ExposedDropdownMenuBox`; `wheel` has no M3 equivalent — render the
  menu and document it, don't fake a wheel.
- Strings only; Nitro array prop; no optional `?:` view props (D7) — sentinels per core.md.

## Requirements

- Controlled selection via the event-count handshake; a rejected change snaps back without flicker.
- Clamp rules identical to SegmentedControl's (past the end → last, junk → first, shrink clamps).
- Sizing: `menu` intrinsic (`nuiSizingKey` from the options + selected label, escaped as in
  SegmentedControl), `wheel` `fillWidth` with platform height. Declared fallbacks registered in
  `NitroUiDeclaredFallbacks`. Over-wide content fits its box (C1 behaviour) — test it.
- The open menu/popup closes and does not leak when the view is recycled, dropped or the screen
  unmounts while open (Android: back dismisses it). The B1 `MountChurn` gate pattern applies.
- Accessibility: a button that opens a list; selected item announced; disabled exposed on both.

## Deliverables

- Spec, wrapper, iOS + Android implementations, sizing entries, `docs/components/picker.md`.
- Example screen tab; **Storybook stories** (Playground with every prop + showcase) per S1's layout.
- Harness tests (render, select + event, controlled rejection, options change clamps, R3 resize on
  key change, open-menu-on-unmount, recycling-safe), every one shown red first; real-input case
  (open menu, pick an item) on both platforms; smoke `App.tsx` + per-control layout check (A2).
- Bench arm + scenarios (mount N=1/50/200; update K selection changes) vs `@expo/ui` (both host
  configs) and an `rn-core` control; quick-plan tables, both platforms, labelled with load.
- api-extractor report.

## Acceptance

`bun run check`; harness + real-input green on both platforms; bench tables; screenshots (iOS +
Android, light + dark, menu open) in `docs/tasks/G6-picker/`.

## Lessons (G1–G4, B1, C1)

- Size-affecting setters call `noteContentSizeMayHaveChanged()` (iOS) and `noteSizingKeyChanged()`.
- Process-wide cached `*Defaults.colors()` / colour schemes (core.md "Shared objects").
- Nothing per-mount may register on the Activity, window or a `ViewTreeObserver` without being
  removed on drop (B1). Popups are the obvious new risk.
- iOS `.tint` on some picker styles is ignored (G4 F1) — verify visually; document what works.
