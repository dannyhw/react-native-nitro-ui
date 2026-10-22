# T11 — Intrinsic sizing (custom shadow node + size cache + native state push)

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/T11` (branch `task/T11-intrinsic-sizing`, from `main`)
**Devices:** iOS sim `iPhone 17` `F08675D3-A32B-4F88-BC81-02D7E0CB797E`; Android AVD `nitroui_t01`
port 5570. `METRO_PORT=8293`. Env: `IOS_SIM_UDID`, `ANDROID_AVD`, `METRO_PORT` (CONTRIBUTING.md).
**Depends on:** T10 (core runtime + Switch, merged) and T02 (bench, merged if available).

## Goal

Make SwiftUI/Compose controls report their real intrinsic size to Yoga, so users don't need explicit
width/height and nothing jumps. Design: `docs/research/core-architecture.md` §1 (read all of it,
especially §1.3 design, §1.4 the no-sync-native-call rule, §1.6 post-processing, §7 risks R1–R4,
R9–R12). This replaces T10's per-platform default-size style for Switch.

This is the riskiest piece of the architecture, so it is **prototype-gated**: do P0, then P1, and
stop early with a clear report if an exit criterion fails (then we switch to plan B, below).

## Phases

**P0 — plumbing (exit: builds and lays out on both platforms)**
- C++ core under `cpp/core/` (or the layout T10 established): `IntrinsicViewState<P>`,
  `IntrinsicShadowNode<Name, P>` (`LeafYogaNode` + `MeasurableYogaNode`, `measureContent` is a pure C++
  lookup: cache → state → fallback, never calls native), `IntrinsicComponentDescriptor<SN>` (keeps
  Nitro's prop parsing; Android `adopt` carries the measured size forward), `SizeCache`
  (environment epoch, per-component fallback), `LayoutLedger`, `pushMeasured`.
- Extend `scripts/patch-nitrogen.mjs` (keep it one script, hard-fail on missing anchors, idempotent)
  to apply the three alias swaps + `.mm` `updateState:oldState:` hook + Kotlin manager `onState` line
  for views listed in a config file (e.g. `nitro-ui.sizing.json`). Verify R10 (does nitrogen
  flatten `interface X extends IntrinsicProps`?) — if not, declare `nuiSizingKey` per spec.
- iOS: `NUISizeSink` (ObjC++) + host integration + run-loop flusher (below CA commit order,
  per-view budget of 2 immediate updates per turn, 0.5pt epsilon).
- Android: JNI `NitroUISizing.nativePush` (StateWrapperImpl unwrap like
  @lodev09/react-native-true-sheet), flush from `OnPreDrawListener`, return `false` when layout
  changed, dp with 0.9dp epsilon.
- Switch uses it (`nuiSizingKey` from the JS wrapper); remove the default-size style.

**P1 — correctness (exit: no wrong-size frames, bounded commits)**
- Cold-cache single Switch, 200 Switches, prop update that changes size (use a temporary test-only
  view or Switch with a size-affecting prop if Switch has none — e.g. a hidden test label; remove or
  keep test-only), accessibility text size change (environment epoch), RN `Modal`, mount/unmount
  stress with rapid prop changes (R9).
- Record frames (screen recording or per-frame layout logging) and assert no frame shows a wrong
  size; count commits (expected: 0 extra for pre-warmed, 1 sync for cold first instance).
- `NitroUI.prewarm([...])` API + per-component `prewarmKeys`.
- Harness tests covering layout size == native fitting size (± epsilon) on both platforms.
- Benchmark mount N=1/50/200 before/after (T02 tooling) and report.

## Plan B (only if P0 or P1 fails — report first, don't switch silently)

nitro-input-style two-phase sizing with a cache: native fills the `SizeCache` (pre-warm + after
first measure); JS reads a synchronous cache lookup (`NitroUiCore.cachedSize(component, key)`)
during render to seed style, and native `onSizeChange` corrects. No `main.sync` from JS.

## Acceptance

- `bun run check` passes; nitrogen drift + patch idempotency OK; patch hard-fails on shape change.
- Both platforms: Switch auto-sizes correctly with no explicit style; user width/height/flex still
  win (Yoga constraints respected); no wrong-size frame in P1 scenarios.
- Report: P0/P1 results with evidence (logs, frame captures, commit counts, bench numbers),
  risks R1–R4/R9–R12 status, upstream-proposal notes (core-architecture §1.5 "Upstream").
- `docs/architecture/sizing.md` explaining the mechanism and how a component opts in
  (sizing policy `intrinsic` / `fillWidth`, how to build `nuiSizingKey`).
