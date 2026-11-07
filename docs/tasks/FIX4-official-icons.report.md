# FIX4 — The library's own icons from Google's official Material Symbols files

**Branch:** `task/FIX4-official-icons` (from `main` at `2361ff12`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `FIX4-qo15u` (android, `emulator-5574` / Metro `8295`), then `FIX4-tk2ce` (both, adds iPhone 17
`F08675D3`) for the iOS SearchField run

## Summary

Every glyph the library draws itself on Android is now one of Google's Material Symbols Android vector
drawables, copied unchanged (D43 item 1). The five hand-built `ImageVector.Builder` glyphs in
`android/src/main` were:

| Was (file) | Now (resource) | Material Symbols variant |
| --- | --- | --- |
| `SearchGlyph` (`HybridNitroUiSearchField.kt`), the mistyped path that drew a key | `nitroui_search` | `search`, Outlined, wght 400, fill 0, grade 0, 24 px |
| `CloseGlyph` (same file), the clear button | `nitroui_close` | `close`, the same variant |
| `ChipCheckIcon` (`HybridNitroUiChip.kt`) | `nitroui_check` | `check`, the same variant |
| `MenuCheckIcon` (`MenuRows.kt`), Menu and Picker rows | `nitroui_check` | `check`, the same variant |
| `MenuChevronIcon` (`MenuSplitButton.kt`), was `ExpandMore` | `nitroui_keyboard_arrow_down` | `keyboard_arrow_down`, the same variant: the icon Material's own split button uses |

**Script and hashes.** `scripts/icons/fetch-material-symbols.mjs` downloads each `<name>_24px.xml` from
`google/material-design-icons` pinned at `10ecc147`, plus that commit's Apache 2.0 `LICENSE`. It writes them
byte for byte into `android/src/main/res/drawable/` and `licenses/material-symbols/`, and records each URL and
SHA-256 in `scripts/icons/material-symbols.lock.json`. `--verify` downloads them again and compares, writing
nothing (it passed). `scripts/__tests__/android-icons.test.js` runs in `check` and covers four things: no hand-built glyph in
`android/src/main`; every `nitroui_*.xml` and the licence match their recorded hash; the lock lists every
drawable; and `etc/package-files.txt` ships them with `NOTICE`. `NOTICE` and `licenses/` are in `files`,
and `.gitattributes` marks the copied files `-text` so line-ending conversion can't break a hash.

**Loading.** `android/src/main/java/com/margelo/nitro/nitroui/core/NitroUiIcons.kt` parses each drawable once per process with the non-composable
`ImageVector.vectorResource(theme, res, id)` and caches it in a `ConcurrentHashMap`. The old glyphs were
process-wide lazies, so the caching stays where it was. `Icon` replaces the file's
`?attr/colorControlNormal` tint with the content colour.

**What material3 draws itself.** Nothing that applies here. `FilterChip`, `DropdownMenuItem` and the split
button's trailing slot all leave the icon to the caller. I checked the public classes in 1.5.0-beta02:
material3 draws its own icon only in `SegmentedButtonDefaults.ActiveIcon` (a check, fixed at 18 dp) and
`ExposedDropdownMenuDefaults.TrailingIcon` (the `arrow_drop_down` triangle). Both belong to other components,
and the triangle is not the split button's chevron.

**On device.** A SearchField test probes the glyph's pixels through a new example-app method,
`NitroUiProbe.searchGlyphPixels`. G19's `NitroUiPixelProbe` hasn't merged. The method finds the icon by a
production test tag (`SEARCH_FIELD_GLYPH_TAG`), draws the host and reads four points: the lens centre must be
the backdrop, and two points on the ring must be the glyph. The example app gains `androidx.compose.ui:ui`
(the library's BOM) on its compile classpath for the semantics tree.

**Screenshots.** Retook `docs/images/components/search-field-android.png` (Storybook `searchfield--states`,
light, 1080 → 720 px). The new check is under 1 dp off the old one: barely visible at 3× zoom of a fresh Chip
capture, invisible at the README's 300 px. So the Chip, Menu and Picker shots stay. No README shot shows the
split button.

## Gates

Refreshed for fix round 1 (code tree `288374fe4fff`); the iOS and `real-input` rows are round 1's.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1819 tests / 72 suites | `288374fe4fff` | 1 m 55 s | start 6.1 / med 12.3 / max 14.2 |
| `harness:ios` | **PASS** | 450 tests / 25 suites + isolated 4 tests / 2 suites | `c865893c76dd` (ios tree) | 10 m 43 s | start 23.0 / med 6.9 / max 26.2 |
| `harness:android` | **PASS** | 499 tests / 25 suites + isolated 4 tests / 2 suites | `288374fe4fff` (android tree) | 14 m 48 s | start 2.9 / med 3.0 / max 4.0 |
| `real-input:ios` | missing | — | — | — | — |
| `real-input:android` | stale | — | c865893c76dd (not this tree) | 40 m 29 s | start 2.6 / med 2.7 / max 5.0 |
| `harness:android:SearchField` | stale | 1 failed of 15 tests / 1 suites | 8f25de914898 (not this tree) | 14.4 s | start 4.3 / med 5.1 / max 5.9 |

`need --for review`: `need: review is satisfied on this code tree.` `harness:ios` ran because the diff edits
`SearchField.harness.tsx` (AGENTS.md: a harness file runs on both platforms); the new test returns early on iOS.
`real-input:ios` is left for merge. The stale `harness:android:SearchField` row is the red proof's run against
the old path.

The first `harness:android` failed only `BottomSheet · 50 cycles` (mount count 9 of 10). That is the known
flake E2 also re-ran; the re-run passed.

## Red proofs

- `android-icons.test.js` "builds no glyph by hand" -> main's four Kotlin files checked out -> 59 hits, first `HybridNitroUiChip.kt:186: ImageVector.Builder`
- `android-icons.test.js` "ships every drawable unchanged" -> `M382,720` -> `M383,720` in `nitroui_check.xml` -> `nitroui_check.xml: sha256 215393e3…, recorded b38c518a… - edited by hand?`
- `android-icons.test.js` "catches a hand-built glyph and a hand-typed drawable" -> its fixture is the red case (a builder, a path command and an unlisted `<vector>`), asserted line by line
- `SearchField.harness.tsx` "draws its search glyph as a magnifier" -> 0.7.0's `SearchGlyph` path restored (test tag kept), app rebuilt -> `expected 'lens=painted ring=clear ringTop=clear…' to be 'lens=clear ring=painted ringTop=paint…'` (`harness:android:SearchField`, 1 failed of 15)

## Files changed

- Android: `android/src/main/java/com/margelo/nitro/nitroui/core/NitroUiIcons.kt` (new), `HybridNitroUiSearchField.kt`, `HybridNitroUiChip.kt`, `MenuRows.kt`, `MenuSplitButton.kt`; `android/src/main/res/drawable/nitroui_*.xml` (4, generated)
- Tooling: `scripts/icons/fetch-material-symbols.mjs`, `scripts/icons/material-symbols.lock.json`, `scripts/__tests__/android-icons.test.js`
- Package: `NOTICE`, `licenses/material-symbols/LICENSE`, `package.json` `files`, `etc/package-files.txt`, `.gitattributes`
- Example: `NitroUiProbePackage.kt` (`searchGlyphPixels`), `example/android/app/build.gradle`, `SearchField.harness.tsx`
- Docs: `docs/components/menu.md` (chevron paragraph), `docs/images/components/search-field-android.png`, `.changeset/fix4-official-icons.md` (patch)

## Follow-ups

- Chip/Menu/Picker README shots: they still show the old check (under 1 dp off); retake them with the next pass that photographs those components.
- `gate.mjs need`: on this clone it diffs against the stale local `main` (`a760514`), so its "both platforms" note lists files this branch never touched.
- Harness: `BottomSheet · 50 cycles` flaked again (mount 9 of 10), as in E2.
- G19: when `NitroUiPixelProbe` merges, the SearchField glyph probe could move onto it and off the example app's Compose dependency.
- `nitroUiIcon(id)`: the `Int` resource id is boxed into the `ConcurrentHashMap` lookup on every composition.
- `example/android/app/build.gradle` repeats the library's Compose BOM version (`2026.09.00`); nothing keeps the two in step.
- `fetch-material-symbols.mjs --verify` runs only by hand; a scheduled CI job could re-check the pinned files against Google's.
- The no-hand-built rule catches path code, not raster glyphs or arbitrary `DrawScope` shapes.
- `SearchField.harness.tsx` glyph test: its final `expect` can't fail, because the `throw` before it already covers every mismatch.
- `NitroUiProbe.searchGlyphPixels`: `answer` is written on the UI thread and read after a 5 s latch wait with no synchronisation (a timeout reads a stale value).

## Fix round 1

- **Wider rule** (`scripts/__tests__/android-icons.test.js`). It now also fails on `PathNode.`, Compose
  `relative{Move,Line,Cubic,Quadratic(Bezier)}To(`, `cubicTo`/`quadraticTo`/`quadraticBezierTo(`,
  `android.graphics.Path`'s `r{Move,Line,Cubic,Quad}To(`, and `materialPath` with or without `(`. The header
  lists them. "catches a hand-built glyph" gains a fixture file `B.kt` with one line for each form.
  Red proof: the fixture against round 1's patterns → `Expected - 8`, every new line missing (`B.kt:1: PathNode` …
  `B.kt:8: materialPath`). With the new patterns, "builds no glyph by hand" finds nothing in `android/src/main`.
- **False comment.** `MenuSplitButton.kt`'s label KDoc cited D40 item 2's "bundles no icon set"; it now names
  only the string catalogue. Nothing else in `android/src` or `docs/` makes that claim; DECISIONS records its
  withdrawal.
- **`NitroUiIcons.kt` KDoc** now says the cached vector's intrinsic tint is the first parsing theme's, so callers
  tint through `Icon` or a colour filter, never a bare `Image`. It also says parsing needs
  `?attr/colorControlNormal`, which React Native's AppCompat theme provides.

The Kotlin comment edits changed the Android tree, so `need` asked for `harness:android`. Its first run failed
only the `BottomSheet · 50 cycles` flake; the rerun passed. The Gates table above is this round's.

`need --for review`: `need: review is satisfied on this code tree.`
