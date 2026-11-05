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

Round 1 ran `check`, both `harness:*` and both `real-input:*` green on code tree `7f0cf1e4aab6`. That table is
superseded by the fresh one under "Fix round 1", the gate ledger's current view.

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
- `real-input:android` picker drop cycle 3 timed out once on `real-input-drop-gone` (G7b saw the same at cycle 2); green alone and on the re-run.
- `docs/research/setup-decisions.md` still states the 0.86 floor (not ours to edit).

## Fix round 1

Lease `X18-c6m3f` (pair-b: `emulator-5570`, iOS `3AE7EE8D…` / Metro `8293`).

- **Theme switch rebuilt every composition.** `NitroUiTheme` is now one `MaterialExpressiveTheme` call whose motion
  scheme the setting picks, so a switch recomposes and disposes nothing. On 1.5.0-beta02 that is exactly the baseline
  theme: same colours, `Shapes()`, `Typography()`, and the only extra (internal `LocalUsingExpressiveTheme`) is read by
  nothing but `MaterialThemeKt`. `NitroUiMaterialThemeLibraryTest` (JVM) scans the material3 jar and fails if that changes.
  The theme report gains `created`.
- **Detent convergence** now comes from the sheet surface's measured height and height constraint, the numbers Material's
  `draggableAnchors` uses, not the detent against the screen.
- README and changeset name material3 `1.5.0-beta02` and that it raises an app's material3. `upstream.md` drops "RN ≥ 0.86".

Red proofs:
- MaterialTheme harness -> old two-call-site `NitroUiTheme` -> `expected 4 to be +0` (`out.created`); `expected [ 'dismiss' ] to deeply equal []` (sheet); `expected [ 'blur', 'focus' ] to deeply equal []` (field).
- BottomSheet "just under half" -> old screen heuristic -> `"near" never reached selected=0 at PartiallyExpanded; … sheetValue=PartiallyExpanded; sheetPx=1285; containerPx=2424; selected=1`.
- ~~`NitroUiMaterialThemeLibraryTest` -> allowed prefix `NoSuchFileKt` -> `AssertionError at NitroUiMaterialThemeLibraryTest.kt:32`.~~ Superseded by the merge round's proof A: the prefix check is gone.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1724 tests / 69 suites | `ca401dcf7ffb` | 3 m 00 s | start 5.0 / med 11.4 / max 30.9 |
| `harness:ios` | **PASS** | 363 tests / 22 suites + isolated 2 tests / 1 suites | `ca401dcf7ffb` (ios tree) | 8 m 34 s | start 3.8 / med 5.5 / max 10.5 |
| `harness:android` | **PASS** | 412 tests / 22 suites + isolated 2 tests / 1 suites | `ca401dcf7ffb` (android tree) | 12 m 46 s | start 8.8 / med 4.8 / max 11.5 |
| `real-input:ios` | **PASS** | — | `ca401dcf7ffb` (ios tree) | 21 m 12 s | start 9.7 / med 6.0 / max 33.0 |
| `real-input:android` | **PASS** | — | `ca401dcf7ffb` (android tree) | 31 m 31 s | start 4.3 / med 5.3 / max 125.5 |
| `harness:android:BottomSheet` | **PASS** | 27 tests / 1 suites | `ca401dcf7ffb` (android tree) | 2 m 11 s | start 5.1 / med 6.1 / max 7.4 |
| `harness:android:MaterialTheme` | **PASS** | 6 tests / 1 suites | `ca401dcf7ffb` (android tree) | 18.6 s | start 5.2 / med 5.2 / max 5.3 |
| `real-input:android:--control:picker` | stale | — | 7f0cf1e4aab6 (not this tree) | 8 m 51 s | start 6.0 / med 3.9 / max 7.3 |
| `real-input:android:picker` | stale | — | 7f0cf1e4aab6 (not this tree) | 0.2 s | start 5.9 / med 5.9 / max 5.9 |

`need --for review`: `need: review is satisfied on this code tree.` (The two stale rows are round 1's picker runs.)

## Merge round

`origin/main` `07505e05` (Checkbox, ContextMenu) merged into `task/X18-merge`. Lease `X18-u6d8x` (`emulator-5574`).

- **Merge.** Menu rows stay in main's `MenuRows.kt`; X18's import change (`ExposedDropdownMenu`, no `@OptIn`) is on the rest of `HybridNitroUiMenu.kt`. `nitro.json` and FOLLOWUPS keep both sides.
- **Pinned shapes and type.** `NitroUiTheme` passes `Shapes()` and `Typography()`, built once, so a later Expressive default cannot reach the baseline opt-out.
- **Narrowed guard.** The jar scan requires `MaterialThemeKt` to be the only class referring to `LocalUsingExpressiveTheme`, and inside it only `MaterialExpressiveTheme`, the getter and `<clinit>` (`javap -c -p`). The old prefix match is gone.
- **Theme-switch cases.** A Checkbox joins the on-screen roots; an open ContextMenu stays open through a switch both ways, with no close event and no rebuilt root.

Red proofs:
- A: `NitroUiMaterialThemeLibraryTest` -> `<clinit>` dropped from `ALLOWED_METHODS` -> `NitroUiMaterialThemeLibraryTest.kt:55`: `methods of MaterialThemeKt other than [MaterialExpressiveTheme, getLocalUsingExpressiveTheme] touch LocalUsingExpressiveTheme - see NitroUiTheme expected:<[]> but was:<[<clinit>]>`
- B: MaterialTheme harness (Android) -> two-call-site `NitroUiTheme` -> ContextMenu `expected [ 'close' ] to deeply equal []` (`:436`); its `created` check, hoisted: `expected 1 to be +0`. Also red: roots `created` `expected 5 to be +0`, sheet, field.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1733 tests / 69 suites | `b2384ce43c9f` | 3 m 16 s | start 11.9 / med 15.6 / max 26.1 |
| `harness:ios` | **PASS** | 390 tests / 23 suites + isolated 2 tests / 1 suites | `b2384ce43c9f` (ios tree) | 9 m 23 s | start 2.4 / med 4.6 / max 6.6 |
| `harness:android` | **PASS** | 439 tests / 23 suites + isolated 2 tests / 1 suites | `b2384ce43c9f` (android tree) | 13 m 40 s | start 9.4 / med 4.2 / max 9.4 |
| `real-input:ios` | **PASS** | — | `b2384ce43c9f` (ios tree) | 22 m 17 s | start 4.1 / med 5.2 / max 27.4 |
| `real-input:android` | **PASS** | — | `b2384ce43c9f` (android tree) | 35 m 12 s | start 6.7 / med 3.2 / max 11.6 |
| `harness:android:MaterialTheme` | **PASS** | 7 tests / 1 suites | `b2384ce43c9f` (android tree) | 20.2 s | start 4.3 / med 4.3 / max 4.5 |

`need --for merge`: `need: merge is satisfied on this code tree.`
