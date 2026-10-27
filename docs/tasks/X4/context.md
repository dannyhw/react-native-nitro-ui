# X4 context pack: real paths (checked at `main` when the brief was written)

| Item | Files and facts |
|---|---|
| Manifests (X3) | `src/components/<Name>/component.json` (7 controls; keys `name`, `hybridView`, `implementation`, `id`, `sizing`, `hostable`, `exampleTab`, `bench`, `smoke`, `realInput`, …), read through `scripts/registry-core.mjs`; `bun run registry:check` |
| Leak on drop | `example/__tests__/MountChurn.harness.tsx` (the `onDropView` → `host.drop()` path, B1/H1/G6 M4; its header explains why each control needs its own case) |
| a11y, Android | `scripts/real-input/uiautomator.mjs` (`uiautomator dump` is the *accessibility* tree; it notes focusability and that Nitro views put `accessibilityLabel` into it), used by `scripts/real-input/android.mjs` |
| a11y, iOS | `example/ios/NitroUiExampleUITests/RealInputTests.swift` (XCUITest, which can read AX labels and traits); per-control harness files read `accessibilityLabel` props (e.g. `example/__tests__/Switch.harness.tsx`) |
| Fallbacks | `ios/core/NitroUiDeclaredFallbacks.swift`, `android/src/main/java/com/margelo/nitro/nitroui/core/NitroUiDeclaredFallbacks.kt` (generated regions now, X3); sizing counters `NitroUiSizingStats` in `src/NitroUiCore.nitro.ts` (`sizingStats()`); cold paths in `example/__tests__/ColdSizing.harness.tsx` |
| Recycling | `example/__tests__/Switch.harness.tsx` (~line 330, "the closest JS reaches to a recycled row"); the example app has `enableViewRecycling` off (B1 follow-up), so say how a recycle is forced |
| Gates | `scripts/gate.mjs` / `scripts/gate-core.mjs` (`need`, `table`), `scripts/harness.mjs`, `docs/tasks/REPORT-TEMPLATE.md`, `CONTRIBUTING.md` "Adding a component" (~line 159), `docs/tasks/ORCHESTRATOR.md` "The loop" |
