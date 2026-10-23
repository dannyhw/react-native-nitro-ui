# G2 — Button

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/G2` (branch `task/G2-button`, from `main`)
**Devices / env:** assigned in the delegation message (D13).
**Depends on:** T10 (core + Switch), T02 (bench) and T11 (intrinsic sizing) merged. Follow
`docs/architecture/core.md` (component guide) and `docs/architecture/sizing.md` (opting in), copy
Switch's structure. Read `docs/DECISIONS.md` (especially D7, D7b, D14, D16).

## Goal

A native button: SwiftUI `Button` with `.buttonStyle(...)` on iOS; Material 3 `Button` /
`FilledTonalButton` / `OutlinedButton` / `TextButton` / `ElevatedButton` on Android. It is the first
component whose **size depends on its props** (title, variant, size), so it proves T11's sizing
for size-affecting props (D16, risk R3).

## Public API (JS)

```ts
<Button
  title: string
  onPress?: () => void
  variant?: 'filled' | 'tonal' | 'outlined' | 'text' | 'elevated'   // default 'filled'
  // iOS mapping: filled→.borderedProminent, tonal→.bordered, outlined→.bordered (+ border where
  // the OS has no native outline style; document), text→.borderless, elevated→.borderedProminent
  // (document). Pick the closest *idiomatic* style per platform, do not fake one in either.
  size?: 'small' | 'medium' | 'large'   // iOS .controlSize; Android content padding/typography
  disabled?: boolean
  tintColor?: ColorValue                 // container colour / iOS tint
  systemImage?: string                   // optional leading SF Symbol name; ignored on Android
                                         // in v0.1 (document)
  style, testID, accessibilityLabel
/>
```
No children in v0.1 (only Hybrid View leaf views are supported, see core.md). Text is `title`.

## Requirements

- Sizing: `intrinsic` policy. `nuiSizingKey` = `variant|size|systemImage|title` (sizing.md
  "Building `nuiSizingKey`"; never the component name, never environment inputs). Declare an
  OS-specific fallback size per variant/size with `setFallback`.
- **R3 test (D16, required):** harness test on both platforms that changes `title` (short → long →
  short) and `size` at runtime and asserts the laid-out frame equals the native fitting size
  (± epsilon) after each change, with no frame showing the old size beyond what sizing.md §4 allows
  (1 stale iOS frame only after an environment change; none for a prop change on Android). Also
  two Buttons with different titles in the same row must get different widths (cache-key
  correctness), and Dynamic Type / font-scale change re-measures (environment epoch).
- `onPress` fires once per tap; no event when disabled. Pressed/hover/focus states are native.
- Accessibility: button role, label = `accessibilityLabel ?? title`, disabled state announced.
- Recycling + `onDropView` per core.md; no per-update hosting recreation; one batched commit per
  JS update.

## Deliverables

- Spec, wrapper, iOS + Android implementations, `nitro-ui.sizing.json` entry, docs page
  `docs/components/button.md` (variant mapping table per platform with screenshots).
- Example screen: every variant × size, disabled, tinted, long titles, a title changing on a timer,
  a row of buttons, 200 in a list.
- Harness tests: render each variant, press fires `onPress`, disabled doesn't, the R3 sizing tests
  above, recycling-safe.
- Reassure re-render scenario test (`Button.perf-test.tsx`) per D9.
- Bench: `nitro-ui` Button arm + scenario (mount N=1/50/200; update K title changes, which
  exercises re-measure) vs `@expo/ui` Button (both host configs) and RN `Pressable`+`Text` as
  `rn-core`. Quick-plan tables for both platforms in the report (D15 targets).
- Add to `scripts/smoke/App.tsx` (one line) and the api-extractor report.

## Acceptance

`bun run check` green; harness green on both platforms (including the R3 tests); bench tables in
report; screenshots (iOS + Android, light + dark) in `docs/tasks/G2-button/`.
