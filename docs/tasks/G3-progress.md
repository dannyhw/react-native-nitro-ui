# G3 — Progress (linear + circular, determinate + indeterminate)

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/G3` (branch `task/G3-progress`, from `main`)
**Devices / env:** assigned in the delegation message (D13).
**Depends on:** T10 (core + Switch) and T02 (bench) merged. Follow `docs/architecture/core.md`
and copy Switch's structure (this one is non-interactive: no events, no handshake). Read
`docs/DECISIONS.md`.

## Goal

Native progress indicators: SwiftUI `ProgressView` (`.linear` / `.circular` styles) on iOS;
Material 3 `LinearProgressIndicator` / `CircularProgressIndicator` on Android.

## Public API (JS)

```ts
<Progress
  variant?: 'linear' | 'circular'   // default 'linear'
  value?: number | null             // 0..1; null/undefined = indeterminate
  tintColor?: ColorValue            // indicator color
  trackColor?: ColorValue           // Android track / iOS where supported (document limits)
  style, testID, accessibilityLabel
/>
```
Also export `ActivityIndicator`-style convenience? No — keep one component; document how to get
the RN `ActivityIndicator` look (`variant="circular"`, indeterminate).

## Requirements

- Updating `value` at 60 Hz from JS must stay cheap: one batched commit per update, no hosting
  recreation, animations between values follow platform defaults (document; allow
  `animated?: boolean` if trivial).
- Sizing: linear = `fillWidth` (height = platform default); circular = intrinsic (platform default
  size; measure real values per OS — D14). T11 later replaces defaults.
- Accessibility: progressbar role with value (determinate) / busy (indeterminate).
- Indeterminate animation must stop when the view is off-window / recycled and resume on re-attach
  (check CPU when a hidden indicator exists — no runaway animations).

## Deliverables

- Spec, wrapper, iOS + Android implementations, docs page `docs/components/progress.md`.
- Example screen (all variants, value driven by a timer at 60 Hz, tinted, 200 in a list).
- Harness tests: render each variant, value updates apply (read back via test hook / a11y value),
  indeterminate ↔ determinate switching, recycling-safe.
- Reassure re-render scenario test per D9.
- Bench: `nitro-ui` arm + scenario (mount N=1/50/200; update K value changes) vs `@expo/ui`
  equivalents (both host configs) and RN `ActivityIndicator` (circular indeterminate) as
  `rn-core` control. Paste quick-plan tables for both platforms in the report.
- Add to `scripts/smoke/App.tsx` (one line) and the api-extractor report.

## Acceptance

`bun run check` green; harness green on both platforms; bench tables in report; screenshots
(iOS + Android, light + dark) in `docs/tasks/G3-progress/`.
