# G7a context pack: real paths (checked at `main` when the brief was written)

| Item | Files |
|---|---|
| Design | `docs/tasks/Q1-menu-design.md` (§1 API, §2 iOS, §3 Android, §4 `@expo/ui` 58 copy/avoid, §5 sizing/recycling/leaks/tests), `docs/DECISIONS.md` D29 |
| The sibling to copy | `src/components/Button/` (`Button.nitro.ts`, `Button.tsx`, `component.json`), `ios/components/Button/HybridNitroUiButton.swift`, `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiButton.kt` |
| Popups on Android (H2b) | `android/src/main/java/com/margelo/nitro/nitroui/core/NitroComposeHost.kt`, `HybridNitroUiPicker.kt`, `HybridNitroUiDatePicker.kt`; tests `example/__tests__/HostPopups.harness.tsx`, `Picker.harness.tsx` |
| iOS host | `ios/core/NitroSwiftUIHost.swift` (`needsContainment`), `ios/components/Picker/HybridNitroUiPicker.swift` |
| Registry (X3) | `scripts/registry-core.mjs`, `scripts/gen-registry.mjs`, `bun run regen`, CONTRIBUTING "Adding a component" and "Merging two components" |
| Lint rules | `eslint-rules/index.js` (`no-optional-view-props`, `no-anymap-in-spec`, `no-json-string-prop`) |
| Test patterns | `docs/tasks/Q3-flaky-tests.md` (waits that refuse wrong answers, delta assertions), `example/__tests__/MountChurn.harness.tsx` (drop/leak) |
