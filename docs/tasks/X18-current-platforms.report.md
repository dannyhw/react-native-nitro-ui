# X18 — Current platforms: RN 0.88 floor, Compose 1.12, material3 1.5, the Expressive theme

**Branch:** `task/X18-current-platforms` (from `main` at `69be3bc6`, `origin/main` `a0af9749` merged in for D40/Q8) ·
**Round:** 1 of up to 3 (D19) · **Leases:** `X18-st68s` (pair-a: `emulator-5574`, iOS `49D5024D…` / Metro `8295`), then `X18-ax5g2` (iOS `3AE7EE8D…` /
Metro `8293`) for `real-input:ios` after a network outage

## Summary

**Floor.** Peer `react-native >= 0.88.0`. README "Requirements" says RN 0.88 / Expo SDK 58 and compileSdk 37 with AGP
9.1+. The RN 0.86 limitation, the smoke matrix's `0.86.3` row and the old-floor reasoning in CONTRIBUTING, `rn-cli.sh`,
`upstream.md`, `ci-runner-images.md` and FOLLOWUPS are gone.

**Android dependencies.** Compose BOM `2026.09.00` (Compose 1.12.1) and `material3:1.5.0-beta02`, pinned on its own
because the BOM still carries 1.4.0. Library and bench-probe fallback `compileSdkVersion` is 37; the example was already on
37 / AGP 9.2.1 / Kotlin 2.2.0. Migrated:
- the `ExposedDropdownMenu` import (the member is now `HIDDEN`);
- two `@OptIn`s that are no longer needed;
- the deprecated value `Slider`, now the state overload, built the way the deprecated one built it internally;
- `rememberModalBottomSheetState` in BottomSheet and Dialog, now `rememberBottomSheetState`;
- `ListItem(headlineContent…)`, now the content-lambda overload.

One behaviour change: 1.5's sheet state keeps a `PartiallyExpanded` anchor *on top of* `Expanded` for a sheet no taller
than half the screen, so `[medium, {height: 200}]` would report `medium`. `detentIndexOf` maps it back to the expanded
detent; a new BottomSheet case guards it.

**Theme (D39 item 3).** `NitroUiTheme` uses `MaterialExpressiveTheme` (`MotionScheme.expressive()`) over the existing
colour schemes; in 1.5 that changes **motion only**. The opt-out is `setMaterialTheme('expressive' | 'baseline')`:
- a JS call at startup, so Expo CNG and bare apps need no native edit (a manifest or Gradle flag would need a config
  plugin in Expo);
- an Android-only Kotlin HybridObject writes process-wide snapshot state that every composition root reads: each
  control's and each `<Host>`'s. A later call moves controls already on screen (harness, both ways). No-op on iOS;
- read back through `nitroUiCore.materialThemeReport()`; documented in README "Android theme" and a minor changeset.

**Screenshots.** No Android README picture changed visibly, so none was retaken. All 15 source stories were captured
before and after the bump on the leased emulator:
- 14 are pixel-identical at 6 % fuzz (13 at zero fuzz);
- Progress differs only in its indeterminate animation frame;
- the confirmation sheet, after the `ListItem` move, differs by at most 6/255 per channel.

**Also lifted:** `NitroUiPropsCompat.hpp`'s RN 0.84–0.86 branch. The call is unconditional now, and a `static_assert`
refuses RN < 0.88. Also lifted: the dead `doctor.mjs` and bench-probe `SDK_INT >= N` branches, and stale 1.4 version
comments.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1724 tests / 69 suites | `7f0cf1e4aab6` | 2 m 48 s | start 14.2 / med 9.9 / max 16.1 |
| `harness:ios` | **PASS** | 360 tests / 22 suites + isolated 2 tests / 1 suites | `7f0cf1e4aab6` (ios tree) | 8 m 40 s | start 6.9 / med 3.8 / max 7.8 |
| `harness:android` | **PASS** | 409 tests / 22 suites + isolated 2 tests / 1 suites | `7f0cf1e4aab6` (android tree) | 12 m 31 s | start 6.3 / med 3.1 / max 6.8 |
| `real-input:ios` | **PASS** | — | `7f0cf1e4aab6` (ios tree) | 21 m 39 s | start 3.4 / med 19.3 / max 39.8 |
| `real-input:android` | **PASS** | — | `7f0cf1e4aab6` (android tree) | 31 m 13 s | start 2.2 / med 3.0 / max 16.2 |
| `harness:android:BottomSheet` | stale | 1 failed of 26 tests / 1 suites | 2f30c7c014e3 (not this tree) | 2 m 11 s | start 3.4 / med 2.7 / max 3.7 |
| `harness:android:MaterialTheme` | stale | 1 failed of 4 tests / 1 suites | 3e643ff49ed8 (not this tree) | 12.8 s | start 3.6 / med 3.6 / max 3.6 |
| `real-input:android:--control:picker` | **PASS** | — | `7f0cf1e4aab6` (android tree) | 8 m 51 s | start 6.0 / med 3.9 / max 7.3 |
| `real-input:android:picker` | **FAIL** | — | `7f0cf1e4aab6` (android tree) | 0.2 s | start 5.9 / med 5.9 / max 5.9 |

The stale filtered rows are the red-proof runs on mutated trees (below). `real-input:android:picker` is a run started
with the wrong argument (`picker` instead of `--control picker`: "unknown argument"); the `--control picker` row is the
real one. The first full `real-input:android` on this tree failed once at the picker's drop cycle 3
(`real-input-drop-gone` timeout); the picker alone and the full re-run above are green.

`need --for review`: `need: review is satisfied on this code tree.`

## Red proofs

- `materialTheme.test.ts` -> `target.expressive = theme !== 'baseline' && false` -> `✕ writes the opt-out and the default through to the Android object` (`Expected - 1 / Received + 1`)
- `materialTheme.test.ts` -> iOS guard became `Platform.OS === 'web'` -> `✕ touches nothing native on iOS`
- `MaterialTheme.harness` (Android) -> `if (NitroUiMaterialTheme.expressive || true)` -> `✕ opts every composition out…`: `4 roots composing under the standard motion scheme: never happened within 5000ms; last report setting=baseline;expressive=12;baseline=0;other=0` (and `✕ moves the controls already on screen`)
- `MaterialTheme.harness` (Android) -> setting held in a plain `@Volatile` field instead of snapshot state -> only `✕ moves the controls already on screen, both ways`: `4 mounted roots recomposing under the standard motion scheme: never happened…; last report setting=baseline;expressive=8;baseline=4;other=0`
- `BottomSheet.harness` "reads a medium sheet that is shorter than half the screen…" -> `val medium = value == SheetValue.PartiallyExpanded` (mapping dropped) -> `"short" never reached selected=1; … sheetValue=PartiallyExpanded;… selected=0` (other 25 cases green)
- Not mutated: the iOS no-op harness case (its unit-test twin is above) and the `static_assert` (no RN < 0.88 build here).

## Files changed

- Floor/docs: `package.json`, `bun.lock`, `README.md`, `CONTRIBUTING.md`, `.github/workflows/smoke.yml`, `scripts/smoke/rn-cli.sh`, `docs/{upstream,ci-runner-images}.md`, `docs/architecture/core.md`, `docs/components/slider.md`, `docs/tasks/FOLLOWUPS.md`, `.changeset/x18-current-platforms.md`
- Android deps and deprecations: `android/build.gradle`, `bench/modules/bench-probe/android/*`, `HybridNitroUi{Slider,BottomSheet,Dialog,Menu,Picker,Checkbox}.kt`
- Theme: `android/src/main/java/com/margelo/nitro/nitroui/core/NitroComposeHost.kt`, `android/src/main/java/com/margelo/nitro/nitroui/core/NitroUiMaterialTheme.kt`, `HybridNitroUiMaterialTheme.kt`, `src/{MaterialTheme.ts,NitroUiMaterialTheme.nitro.ts,NitroUiCore.ts,index.ts}`, `nitro.json`, `nitrogen/generated/**`, `etc/*`, `scripts/registry-core.mjs`
- C++/tooling: `cpp/NitroUiPropsCompat.hpp`, `scripts/doctor.mjs`
- Tests: `src/__tests__/materialTheme.test.ts`, `example/__tests__/{MaterialTheme,BottomSheet}.harness.tsx`, `example/src/readme-examples.tsx`

## Follow-ups

- material3 1.5: the per-component 1.4 workarounds stay for the Expressive passes; listed in one FOLLOWUPS line (Dialog rows, Picker selected row, Menu anchor, SegmentedButton, Chip slot, SearchField).
- RN 0.88 deprecations in `HybridNitroUiBottomSheet.kt` (`ReactFeatureFlags`, a deprecated `onChildStartedNativeGesture` override) show whenever its Kotlin recompiles; not from this bump.
- No consumer smoke run covers the floor raise or the compileSdk 37 requirement yet (CONTRIBUTING says so).
- Bench not run: Compose 1.12 / material3 1.5 and the per-root theme read are unmeasured on mount ratios (bench host).
- A runtime theme switch recomposes each control's content fresh (state inside the composition resets); `movableContentOf` would keep it if live switching ever matters.
- `real-input:android` picker drop cycle 3 timed out once on `real-input-drop-gone` (G7b saw the same at cycle 2); green alone and on the re-run.
- `docs/research/setup-decisions.md` still states the 0.86 floor (not ours to edit).
