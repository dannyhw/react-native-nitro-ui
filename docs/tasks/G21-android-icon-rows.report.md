# G21 — `androidIcon` on menu rows, the split trigger and Chip

**Branch:** `task/G21-android-icon-rows` (from `main` at `bd6a3f6c`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `<lease-id>` (`<device>` / Metro `<port>`)

## Summary

`androidIcon` now reaches every leading-glyph slot the brief names, through G19's one path:
JS resolves the asset or drawable name (`src/iconSource.ts`), native gets a string, and
`NitroUiIcon.kt` turns it into artwork. No second resolver was built.

- **Rows** (`Menu` + `ContextMenu`, one `MenuRowIcons` shared by both): every row that
  takes `systemImage` now takes `androidIcon` — actions, submenu rows, section items. On
  Android the row hands Material a `leadingIcon`, so size, colour, gap and group insets are
  Material's; the slot is `MenuDefaults.LeadingIconSize` = **20 dp**, not 24. The colour is
  read from `LocalContentColor` **as the row draws**, so a disabled row dims its glyph the
  way it dims its title. A checked row's check takes that same slot (the check is what the
  row *means*), which keeps the popup one width.
- **Split trigger**: `primaryAction`'s leading half draws the glyph; the chevron half is
  untouched. Already true from G19, and now measured (see red proofs).
- **Chip**: 18 dp (`FilterChipDefaults.IconSize`, the same on both kinds), the check taking
  the slot on a selected filter chip, and `androidIcon` added to the sizing key.

Two decisions a reviewer needs:

1. **A glyph that cannot be resolved reaches `leadingIcon` as `null`, not as an empty
   lambda.** A non-null lambda still costs 20 dp, so "an unresolvable name leaves the row
   exactly its no-icon self" had to be decided before the lambda exists. `MenuRowIcons` has
   no `requested` guard of its own — the slot's equality guard plus `mutableStateOf`'s
   structural policy already make a re-sent menu a no-op, and a second guard would be a
   second thing to keep wrong.
2. **Pixel claims are differences, and the fixture is a solid square.** A probe counts every
   pixel of one colour in the sampled view, and Material draws row titles in the icon's own
   colour — so a raw count would pass on the text alone. Subtracting a menu that differs
   only by the icon leaves the artwork, and because `nitroui_test_slab` fills its canvas,
   what is left *is* the slot's area. The colour cannot be written down (it comes from the
   device's dynamic palette), so each row reports the colour it tinted its glyph with and
   the test samples for that.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |

`need --for review`: <pending>

## Red proofs

<!-- JVM/JS ones are done; device ones land with the harness runs. -->

## Files changed

## Follow-ups
