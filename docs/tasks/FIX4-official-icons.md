# FIX4 — The library's own icons from Google's official Material Symbols files

**Worktree / branch:** named in your delegation message (`task/FIX4-official-icons`). **Round cap:** 1 round, plus
at most 2 fix rounds (D19). **Devices:** your lease (`node scripts/lease.mjs acquire --task FIX4 --boot`), Android
only.

## Why

D43 item 1: no glyph path is typed by hand. SearchField's search icon shipped in 0.7.0 as a mistyped copy of
Material's path, drawing a key instead of a magnifier (`docs/images/components/search-field-android.png` shows it).
Every icon the library draws itself now comes from Google's official files.

## Read first

AGENTS.md (red proofs, **never `pkill`/`killall`**, the lease rules), `docs/DECISIONS.md` D40 and **D43**, and
CONTRIBUTING "README screenshots" (720 px, Storybook, light).

## Do

1. **Find every hand-built glyph** on Android: every `ImageVector.Builder` and every `path { … }` in
   `android/src/main`. Today these are SearchField's search and clear (`HybridNitroUiSearchField.kt`), Chip's check
   (`HybridNitroUiChip.kt`), Menu's check (`MenuRows.kt`) and the split button's chevron (`MenuSplitButton.kt`).
   List them in the report.
2. **Replace each one with Google's official Material Symbols Android vector drawable** (Apache 2.0): outlined, weight
   400, fill 0, grade 0, 24 px, unless Material's own component uses another variant. Say which variant each one uses.
   - Ship them as library resources under `android/src/main/res/drawable/`, with a `nitroui_` prefix so they can't
     collide with an app's resources. Load them with `ImageVector.vectorResource` (or `painterResource`), once per
     process where the current code caches.
   - Add a script (`scripts/icons/fetch-material-symbols.mjs` or similar) that downloads the listed icons from
     Google's official source and writes them unchanged. Commit its output; nothing downloads at build time.
   - Add a `check`-time test that every `nitroui_*.xml` matches the hash the script recorded for it, so a hand edit
     fails `check`.
   - Add Google's Apache 2.0 notice for the icons where the package's licence files live, and check the package
     files and `check`'s package checks include the drawables.
3. **Where material3 already draws the icon,** use material3's own (for example, a component's default check or
   chevron, if it has one), and say so.
4. **Retake `docs/images/components/search-field-android.png`** (720 px, Storybook, light). Retake any other README
   shot whose icon visibly changes, and say which. adb `-s <serial>` on your own leased emulator is approved for that.
   Undo `adb reverse` and the debug-host preference afterwards, and restore any setting you change (read it first;
   don't use `cmd uimode night`).
5. **A patch changeset:** "Android icons drawn by the library (SearchField's search and clear, the checks in Chip and
   Menu, and the split button's chevron) now use Google's official Material Symbols; the search icon was drawn wrong."

## Tests, each shown red first

- **No hand-built glyphs:** a `check`-time test that fails if `android/src/main` contains `ImageVector.Builder` or
  a hand-written path builder for an icon. Show it red against `main`.
- **The hash test** from item 2: edit one coordinate in a shipped `.xml` and see `check` go red.
- **On device (Android harness):** SearchField's search icon draws a ring, not a filled disc. Use a pixel probe: the
  lens centre is unpainted and a point on the ring is painted. It must go red against the old path.
  `core/NitroUiPixelProbe.kt` comes with G19; if that hasn't merged, use the example app's `PixelCopy` probe.
- Chip, Menu and SplitButton harness tests stay green.

## Not in scope

`androidIcon` and anything apps pass in (G19's rework), iOS (SF Symbols are the system's), and anything else, which
goes as one FOLLOWUPS line.

## Gates

`check`, `harness:android` and `real-input:android`, then `need --for review`. Report at
`docs/tasks/FIX4-official-icons.report.md`. Export the ledger with `gate.mjs export --task FIX4`.
