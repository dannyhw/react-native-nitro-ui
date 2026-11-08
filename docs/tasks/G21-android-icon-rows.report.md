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

JVM (`bash scripts/native-tests-android.sh --rerun-tasks --tests …`, re-run on this tree):

- `MenuRowIconsTest` -> `noteTint` never records (`MenuRows.kt`) -> `a tint is reported per row and only for the rows that drew FAILED`.
- `MenuModelTest` -> the report line drops `iconTints=` (`HybridNitroUiMenu.kt`) -> `aMenuWithNoPrimaryActionHasOneTriggerAndNoHalves FAILED`, `aRecycleClearsTheSplitTriggerAndItsHalves FAILED`.
- `MenuRowIconsTest` -> one slot shared across every row id -> the per-row content case; -> a fresh slot per `apply()` -> the "a re-sent menu keeps its loaded artwork" and retire cases; -> the retire loop dropped -> the retire case; -> `reset()` keeps its slots -> the recycle case; -> `apply()` on an unknown name lands `Pending` instead of `Absent` -> three cases.
- `MenuRowsTest` -> `parseMenuRows` drops the `androidIcon` field -> both wire cases.

JS (`bunx jest src/__tests__/rowAndroidIcon.test.tsx`, re-run on this tree):

- `rowAndroidIcon` -> a row's `androidIcon` sent as `null` (`MenuRows.ts`) -> five cases red, first at `src/__tests__/rowAndroidIcon.test.tsx:65`.
- -> the asset is not resolved (the `require` id goes out) / the component name is wrong / a submenu row is skipped / the chip's sizing key drops the field / the raw prop reaches the key / `escapeField` is not applied -> one or more named cases each; all eight mutations were run.

Device (harness) proofs are recorded below the gate table once the runs land.

## Files changed

- **Specs and generated code**: `src/components/Menu/Menu.nitro.ts`, `src/components/ContextMenu/ContextMenu.nitro.ts`, `src/components/Chip/Chip.nitro.ts`, `src/components/Chip/NitroUiChipConfig.ts` and everything under `nitrogen/generated/` they regenerate.
- **JS**: `src/components/Menu/MenuRows.ts` (resolve + warn + the row field), `src/components/Chip/Chip.tsx` (prop, resolve, sizing key), `src/components/Menu/Menu.tsx`, `src/components/ContextMenu/ContextMenu.tsx`, the three `NativeNitroUi*.ts` handle types.
- **Android**: `MenuRows.kt` (`MenuRowIcons`, the row's `leadingIcon`, `MenuLeadingCheck`), `HybridNitroUiMenu.kt` / `HybridNitroUiContextMenu.kt` (apply on prop set, `iconTints=` in each report, the popup pixel probe), `HybridNitroUiChip.kt` (the glyph, the check, `recordIconTint`, the probe), `NitroUiIcon.kt` (`NitroUiIconSlotGlyph`), `core/NitroUiPixelProbe.kt` (the shared probe store and `Color.toRgbHex`).
- **iOS**: the stubs that keep the shape — `androidIcon` stored and never drawn, `iconTints=-` / `iconTint=-`, and a probe that answers `no pixels platform=ios` rather than `0`.
- **Tests**: `src/__tests__/rowAndroidIcon.test.tsx`, `MenuRowIconsTest.kt`, additions to `MenuRowsTest.kt` / `MenuModelTest.kt`, and the three harness suites; fixture pair `slab_24px.xml` / `nitroui_test_slab.xml` declared in `scripts/__tests__/android-icons.test.js`.
- **Docs**: `docs/components/{menu,context-menu,chip}.md`, `README.md` + `example/src/readme-examples.tsx`, `.changeset/g21-android-icon-rows.md`, `etc/react-native-nitro-ui.api.md`.

## Follow-ups

- harness: the popup pixel probes are new device code paths; if a run shows a Material popup dismissing another, the one-popup-at-a-time rule below the suites is where to look.
- chip: `docs/components/chip.md` still documents "no check mark slide-in" as a limit; `androidIcon` does not change that, but a reader may now expect the swap to animate.
- tooling: `bun run api-extractor` is not part of `check`'s repair loop — `check` goes red on `api-extractor:check` and names the copy, which is right, but a task that has never hit it loses a cycle.
- menu: `MenuSection` has no `androidIcon` (a section has no row of its own to draw one on); only `MenuAction` and `MenuSubmenu` take it.
