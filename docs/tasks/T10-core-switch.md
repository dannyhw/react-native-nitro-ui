# T10 — Core hosting runtime + Switch (tracer bullet)

**Worktree:** `~/Developer/oss/nitro-ui-worktrees/T10` (branch `task/T10-core-switch`, from `main`)
**Devices:** iOS sim `iPhone 17` `F08675D3-A32B-4F88-BC81-02D7E0CB797E`; Android AVD `nitroui_t01`
on port 5570 (create it if missing, see T01 brief). Metro port 8293 (`METRO_PORT=8293`).
**Depends on:** T01 (merged). Read `CONTRIBUTING.md` for scripts/gates.

## Goal

Build the shared core that every component reuses, and prove it end to end with one component:
**Switch** (SwiftUI `Toggle` with `.toggleStyle(.switch)` on iOS, Material 3 `Switch` on Android).
This defines the pattern all later components copy, so keep it clean, small and documented.

Design source: `docs/research/core-architecture.md` §2 (SwiftUI hosting), §3 (Compose hosting),
§4 (events/controlled values), §5 (core module + Switch sketch). Constraints:
`docs/research/nitro-patterns.md`. Decisions that override the architecture doc:

- **Single package.** Core lives inside `react-native-nitro-ui` (no separate `@nitro-ui/core`).
  Layout suggestion: `src/core/`, `ios/core/`, `android/.../core/`, `cpp/core/`; components in
  `src/components/<Name>/`, `ios/components/<Name>/`, `android/.../components/<name>/`.
- **No optional Hybrid View props** (nitro#1184 crash): native specs use `T | null` (or
  sentinel values) and the JS wrapper always passes every prop. The public JS API can still use
  optional props. Lint enforces this.
- **Sizing is NOT in scope** (T11 adds the intrinsic shadow node). For now the JS wrapper applies
  a per-platform default size via style (e.g. iOS Toggle 51×31, Android M3 Switch 52×32 plus
  the 48dp touch target — measure the real values and document them), overridable by user style.
  Design the native host so T11 can later plug in "measure and push size" without rewriting
  components (e.g. a `measure()` hook on the host that returns the content's fitting size, unused
  for now except in a harness test that logs it).

## Scope

1. **JS core**: `useStableCallback`, `useControlled(value, defaultValue, onChange)` returning
   `{ value, mostRecentEventCount, onNativeChange }` (event-count handshake), `processColor`
   memo helper. Unit tests (Jest) for both hooks, including rejected-change and stale-event cases.
2. **iOS core**: `NitroUIModel` (manual `objectWillChange`, one send per `afterUpdate` when dirty),
   `ControlledValue<T>`, `NitroSwiftUIHost<Content>` (UIHostingController per instance, concrete
   generic root — no `AnyView`, `safeAreaRegions = []` / fallback, clear background, frame in
   `layoutSubviews`, optional VC containment flag (off for Switch), recycle reset that keeps the
   controller and suppresses animation on the first commit after recycle, `onDropView` cleanup,
   main-thread assertions, no redundant hops).
3. **Android core**: `NitroComposeModel` (mutableStateOf fields), `ControlledValue<T>`,
   `NitroComposeHost<M>: AbstractComposeView` (fixed `Content()`, owners only if missing,
   `DisposeOnLifecycleDestroyed` + explicit `disposeComposition()` in `onDropView`, recycle reset).
   Theme: use `MaterialTheme` with dynamic color on Android 12+ (`dynamicLight/DarkColorScheme`)
   following system dark mode; fall back to default M3 schemes.
4. **Switch**: spec `src/components/Switch/Switch.nitro.ts`, wrapper `Switch.tsx` with public props
   `value?`, `defaultValue?`, `onValueChange?(value)`, `disabled?`, `tintColor?` (iOS tint / Android
   checked track color), `style?`, `testID?`, accessibility label passthrough. Native iOS + Android
   implementations ~60–150 lines each using the core. Implement `RecyclableView`.
5. **Perf marks (minimal)**: `NitroUiCore` gains `setPerfEnabled(bool)`, `drainPerf()`, and the
   host records `propsApplied` and `firstFrame` timestamps per instance when enabled (one cheap
   flag check when disabled). An optional `nuiPerfId: number | null` prop on views. Keep it simple;
   T02's BenchProbe does the black-box measurements.
6. **Example app**: a Switch screen (controlled, uncontrolled, disabled, tinted, rejected-change
   demo, 200-switch ScrollView). **Harness tests**: renders; toggling via native tap fires
   `onValueChange` with the right value; controlled rejection reverts; prop update from JS applies;
   recycling-safe (mount/unmount many). Use whatever interaction APIs harness 1.6 provides; if it
   can't tap natively, call into the hybridRef or simulate via native test hooks and say so.
7. **Docs**: `docs/components/switch.md` (API, platform mapping, notes) and
   `docs/architecture/core.md` — a short "how to build a component" guide others will follow
   (files to create, base classes, checklist from AGENTS.md perf contract).

## Acceptance

- `bun run check` passes (incl. new unit tests, lint rules, nitrogen drift).
- Example builds and runs on both platforms; Switch screen works (attach screenshots to
  `docs/tasks/T10-core-switch/` — iOS + Android, light + dark).
- Harness tests pass on both platforms.
- No per-update hosting recreation (grep-able: `rootView =` / `setContent` only in init paths).
- Report includes measured default sizes, any deviations from the architecture doc and why.

## Notes from the T01 review (don't miss these)

- Register the generated view manager in `NitroUiPackage.createViewManagers` (empty today) and add
  the `nitro.json` autolinking entry for each view; run `bun run manifest:update` when the
  published file list changes; create `ios/` sources as needed.
- Harness/device selection is env-driven: `IOS_SIM_UDID`, `ANDROID_AVD`, `METRO_PORT`
  (see CONTRIBUTING.md). Always set all three to the values assigned above.
- Add the api-extractor report (`etc/react-native-nitro-ui.api.md`) now that the public API is real (D4).
- Follow `docs/DECISIONS.md`.
