# G4 — SegmentedControl + Picker

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/G4` (branch `task/G4-segmented-picker`, from `main`)
**Devices / env:** assigned in the delegation message (D13).
**Depends on:** T10, T02, T11 merged; G2 Button merged (reuse its size-affecting-prop sizing
pattern and R3 test helpers). Follow `docs/architecture/core.md` and `docs/architecture/sizing.md`.
Read `docs/DECISIONS.md`.

Two components in one task because they share the data model (a list of options + a selected
index, controlled via the core handshake). **v0.1 scope (D19): SegmentedControl only.** Picker is 0.2 — do not start it in this task.

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

## Lessons from G1/G2/T14 (read before starting)

- **D19:** one implementation round + at most two fix rounds; stay inside this brief, follow-ups
  go in one line each.
- Register your declared fallback in `NitroUiDeclaredFallbacks` (T14) — never only from the first view.
- Cache `*Defaults.colors()` / colour schemes process-wide per core.md "Shared objects" (G1/G2/T12).
- Size-affecting prop setters call `noteContentSizeMayHaveChanged()` (iOS); a `nuiSizingKey` change
  must reset the host's last-reported size (G2 F1 hook) so a same-size new key still reports.
- Bench: use main's `--component <name>` mechanism (`*.<name>` cells, arms switch on `component`);
  ART-primed Android (D18); verdicts only where the runner allows (no `presentedBeforeMount`, ≤10%
  spread).
- Harness: no suite-local `beforeAll` warm-ups, no two live `render()` trees, run edited harness
  files on both platforms. Add your control to the T15 real-input runner (one entry).
- Never `pkill`/`killall` by name; shut down your own devices at the end.
