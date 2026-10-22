# G1 — Slider

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/G1` (branch `task/G1-slider`, from `main`)
**Devices / env:** assigned in the delegation message (D13).
**Depends on:** T10 (core + Switch) and T02 (bench) merged. Follow `docs/architecture/core.md`
(the component guide) and copy Switch's structure. Read `docs/DECISIONS.md`.

## Goal

A native Slider: SwiftUI `Slider` on iOS, Material 3 `Slider` on Android, built on the shared core,
idiomatic, and faster than `@expo/ui`'s Slider in the bench.

## Public API (JS)

```ts
<Slider
  value?: number                 // controlled
  defaultValue?: number          // uncontrolled
  minimumValue?: number          // default 0
  maximumValue?: number          // default 1
  step?: number                  // 0 = continuous (default)
  disabled?: boolean
  tintColor?: ColorValue         // iOS tint / Android active track + thumb
  onValueChange?: (value: number) => void       // during drag (throttled to one event per frame)
  onSlidingStart?: (value: number) => void
  onSlidingComplete?: (value: number) => void
  style, testID, accessibilityLabel
/>
```
Mirror `@react-native-community/slider` naming where it doesn't conflict with platform idiom.

## Requirements

- Controlled value via the core event-count handshake; dragging must never stutter even when JS
  is slow (native owns the displayed value during a drag; JS writes during a drag are reconciled
  per core rules — document the behaviour).
- Continuous events: coalesce to at most one `onValueChange` per frame natively; always deliver
  the final value in `onSlidingComplete`.
- Sizing: `fillWidth` policy — width from layout (default `alignSelf: 'stretch'` behaviour),
  height = platform default (measure real values per OS; see D14). T11 will later replace defaults.
- Accessibility: adjustable role, value announced, a11y increment/decrement works on both platforms.
- Recycling + `onDropView` per core.md; no per-update hosting recreation.

## Deliverables

- Spec, wrapper, iOS + Android implementations, docs page `docs/components/slider.md`.
- Example screen (controlled, uncontrolled, stepped, disabled, tinted, JS-slow simulation, 200 in a list).
- Harness tests: render, drag/tap changes value + events (start/change/complete), controlled
  rejection, stepped values, JS-side update applies, recycling-safe.
- Reassure re-render scenario test (`*.perf-test.tsx`) per D9.
- Bench: add the `nitro-ui` Slider arm + scenario (mount N=1/50/200, update K flips) vs `@expo/ui`
  Slider (both host configs) and an RN `View` floor as `rn-core` control. Paste quick-plan tables
  for both platforms in the report.
- Add the component to `scripts/smoke/App.tsx` (one line) and the api-extractor report.

## Acceptance

`bun run check` green; harness green on both platforms; bench tables in report; screenshots
(iOS + Android, light + dark) in `docs/tasks/G1-slider/`.
