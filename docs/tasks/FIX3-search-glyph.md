# FIX3 — SearchField's Android search glyph is drawn wrong

**Worktree / branch:** named in your delegation message (`task/FIX3-search-glyph`). **Round cap:** 1 round, plus at
most 2 fix rounds (D19). **Devices:** your lease (`node scripts/lease.mjs acquire --task FIX3 --boot`), Android only.

## Read first

AGENTS.md (red proofs, **never `pkill`/`killall`**, the lease rules) and CONTRIBUTING "README screenshots" (720 px,
Storybook, light).

## The bug

`SearchGlyph` in `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiSearchField.kt` is a mistyped copy of
Material's `search` icon. The lens's outer edge uses a radius of 3.32 around the wrong centre instead of Material's
6.5 around (9.5, 9.5). So instead of a ring, the lens draws as a filled blob with a smaller hole cut off-centre, which
looks like a key. `docs/images/components/search-field-android.png` shows it.

Material's path, 24-unit viewport (Apache 2.0):

```
M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z
```

The check, close and chevron glyphs (Chip, MenuRows, SearchField's close, E3's chevron) were compared with Material's
paths and match. Only the search glyph is wrong.

## Do

1. Replace the path with Material's geometry above. Comparing them by eye isn't enough: render both, for example with
   `rsvg-convert` on an SVG made from the Kotlin builder calls, and say in the report how you checked.
2. Add a test that fails on the old path. For example, a harness pixel probe or node-tree check on Android: the centre
   of the lens (9.5, 9.5 in glyph units, scaled) is unpainted, and a point on the ring (3.5, 9.5) is painted. A
   JVM test over the built `ImageVector`'s path is fine if it truly separates the two. Show it red against the old
   path.
3. Retake `docs/images/components/search-field-android.png` (720 px, Storybook, light). adb `-s <serial>` on your own
   leased emulator is approved for that. Undo `adb reverse` and the debug-host preference afterwards, and restore any
   setting you change (read it first; don't use `cmd uimode night`).
4. Add a patch changeset: "SearchField: the Android search icon now draws as a magnifying glass".

## Not in scope

Anything else, which goes as one FOLLOWUPS line.

## Gates

`check`, `harness:android` and `real-input:android`, then `need --for review`. Report at
`docs/tasks/FIX3-search-glyph.report.md`. Export the ledger with `gate.mjs export --task FIX3`.
