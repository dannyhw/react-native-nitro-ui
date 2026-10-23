# G4 — SegmentedControl + Picker

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/G4` (branch `task/G4-segmented-picker`, from `main`)
**Devices / env:** assigned in the delegation message (D13).
**Depends on:** T10, T02, T11 merged; G2 Button merged (reuse its size-affecting-prop sizing
pattern and R3 test helpers). Follow `docs/architecture/core.md` and `docs/architecture/sizing.md`.
Read `docs/DECISIONS.md`.

Two components in one task because they share the data model (a list of options + a selected
index, controlled via the core handshake). Ship SegmentedControl first; if the task runs long,
report after it and Picker becomes G4b.

## Public API (JS)

```ts
<SegmentedControl
  options: string[]
  selectedIndex?: number            // controlled
  defaultSelectedIndex?: number     // uncontrolled
  onChange?: (event: { index: number; value: string }) => void
  disabled?: boolean
  tintColor?: ColorValue
  style, testID, accessibilityLabel
/>
// iOS: SwiftUI Picker with .pickerStyle(.segmented). Android: M3 SingleChoiceSegmentedButtonRow.

<Picker
  options: string[]
  selectedIndex?: number
  defaultSelectedIndex?: number
  onChange?: (event: { index: number; value: string }) => void
  variant?: 'menu' | 'wheel'        // default 'menu'
  label?: string                    // shown on the menu button where the platform does
  disabled?: boolean
  tintColor?: ColorValue
  style, testID, accessibilityLabel
/>
// iOS: SwiftUI Picker .menu / .wheel. Android: menu = M3 ExposedDropdownMenuBox;
// wheel has no M3 equivalent — document what we render (e.g. menu) rather than fake a wheel.
```
Options are strings only in v0.1 (no icons). Use a Nitro array prop; check nitrogen's array
handling and the D7 rule (no optional `?:` props — use `[]`/`-1` sentinels per core.md).

## Requirements

- Controlled selection via the event-count handshake; rejecting a change (parent doesn't update
  `selectedIndex`) snaps back natively without a flicker.
- Changing `options` at runtime (add/remove/rename) keeps the selection valid (clamp, document)
  and re-measures (SegmentedControl width depends on labels: intrinsic policy, `nuiSizingKey`
  includes the joined options). Picker `menu` = intrinsic; `wheel` = `fillWidth`.
- The open menu/popup must not leak when the view is recycled or dropped mid-open.
- Accessibility: segmented = tab list / radio-group semantics per platform; picker = button that
  opens a list; selected item announced.
- Recycling + `onDropView` per core.md; no per-update hosting recreation.

## Deliverables

- Specs, wrappers, iOS + Android implementations, sizing entries, docs pages
  `docs/components/segmented-control.md` and `docs/components/picker.md`.
- Example screens: controlled/uncontrolled, options changing on a timer, disabled, tinted, long
  labels, 200 in a list.
- Harness tests: render, tap/select changes selection + event, controlled rejection, options
  change clamps selection, R3-style resize on options change, recycling-safe (incl. open menu).
- Reassure scenarios per D9. Bench arms + scenarios (mount N=1/50/200; update K selection changes)
  vs `@expo/ui` equivalents (both host configs) and an `rn-core` control
  (`View` row of `Pressable`s for segmented). Quick-plan tables for both platforms.
- Smoke `App.tsx` lines and api-extractor report.

## Acceptance

`bun run check` green; harness green on both platforms; bench tables; screenshots (iOS + Android,
light + dark, menu open) in `docs/tasks/G4-segmented-picker/`.
