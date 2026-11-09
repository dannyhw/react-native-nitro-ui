# G21 — `androidIcon` on menu rows, the split trigger and Chip

**Branch:** `task/G21-android-icon-rows` (from `main` at `bd6a3f6c`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `G21-dl60k` — pair-b, `emulator-5570` (`nitroui_b`) + the iOS 27.0 `iPhone Air`, Metro 8293.

## Summary

`androidIcon` now reaches every leading-glyph slot the brief names, through G19's one path:
JS resolves the asset or drawable name (`src/iconSource.ts`), native gets a string, and
`NitroUiIcon.kt` turns it into artwork. No second resolver was built.

- **Rows** (`Menu` + `ContextMenu`, one shared `MenuRowIcons`): every action row that takes
  `systemImage` now takes `androidIcon` — actions and the rows inside a submenu or a section —
  as Material's `leadingIcon`, so size, colour, gap and group insets stay Material's.
  The slot is
  `MenuDefaults.LeadingIconSize` = **20 dp**, not 24; the colour is read from
  `LocalContentColor` **as the row draws**, so a disabled row dims its glyph with its title; and
  a checked row's check takes that same slot, which keeps the popup one width.
- **Split trigger**: `primaryAction`'s leading half draws the glyph and the chevron half does not.
  Already true from G19; now measured.
- **Chip**: 18 dp (`FilterChipDefaults.IconSize`, the same on both kinds), the check taking the
  slot on a selected filter chip, and `androidIcon` added to the sizing key.

Two decisions a reviewer needs:

1. **A glyph that cannot be resolved reaches `leadingIcon` as `null`, not as an empty lambda** —
   a non-null lambda still costs 20 dp. `MenuRowIcons` adds no `requested` guard: the slot's
   equality guard and `mutableStateOf`'s policy already make a re-sent menu a no-op.
2. **Pixel claims are differences, and the fixture is a solid square.** A probe counts every
   pixel of one colour in the sampled view and Material draws row titles in the icon's own
   colour, so a raw count would pass on the text alone. Subtracting a menu that differs only by
   the icon leaves the artwork, and `nitroui_test_slab` fills its canvas, so what is left *is*
   the slot's area. The colour is the device's dynamic palette, so each row reports its own.

**What the devices settled** (the suites had never run on a device: wrong twice, and the code
once). A probe is **ask then poll** — reading the report on the probe's own tick answers `''`, not
the refusal. `split === true` lands **a frame before the halves are measured**, and reading between
them compares a zero-wide half with a measured one. `tintColor` is a `ColorValue` whose **number
form is ARGB**, so the `0xff00a0` first passed was alpha 0 — a transparent glyph. And iOS answers
`expanded=-1`/`menu=-1`, so its branches wait on `drawn`, the tree UIKit was handed.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1936 tests / 81 suites | `50b37147ab09` | 2 m 51 s | start 13.1 / med 14.1 / max 23.4 |
| `harness:ios` | **PASS** | 530 tests / 27 suites + isolated 6 tests / 3 suites | `50b37147ab09` (ios tree) | 13 m 28 s | start 9.2 / med 7.8 / max 29.1 |
| `harness:android` | **PASS** | 586 tests / 27 suites + isolated 6 tests / 3 suites | `50b37147ab09` (android tree) | 17 m 04 s | start 4.8 / med 4.5 / max 11.8 |
| `real-input:ios` | **PASS** | — | `50b37147ab09` (ios tree) | 34 m 59 s | start 108.3 / med 16.4 / max 270.3 |
| `real-input:android` | **PASS** | — | `50b37147ab09` (android tree) | 50 m 25 s | start 7.7 / med 5.0 / max 101.1 |
| `harness:android:(Menu%7CContextMenu)%5C.harness` | stale | 1 failed of 59 tests / 2 suites | ff52f6368fc5 (not this tree) | 1 m 39 s | start 10.7 / med 9.4 / max 11.5 |
| `harness:android:%5E__tests__%2FChip%5C.harness` | stale | 2 failed of 17 tests / 1 suites | 6385bed4a58d (not this tree) | 30.2 s | start 6.4 / med 12.8 / max 14.8 |
| `harness:android:%5E__tests__%2FContextMenu%5C.harness` | stale | 1 failed of 25 tests / 1 suites | c1c8886a00f9 (not this tree) | 1 m 05 s | start 15.5 / med 10.7 / max 15.5 |
| `harness:android:%5E__tests__%2FMenu%5C.harness` | stale | 2 failed of 34 tests / 1 suites | 53028c1bb3c1 (not this tree) | 32.8 s | start 6.7 / med 6.6 / max 7.3 |
| `harness:android:G21` | stale | — | ff52f6368fc5 (not this tree) | 2.0 s | start 9.8 / med 9.8 / max 9.8 |
| `harness:android:Menu%5C.harness` | stale | 1 failed of 59 tests / 2 suites | 0d09ffbf1ab4 (not this tree) | 1 m 55 s | start 7.6 / med 38.0 / max 46.0 |
| `harness:ios:(Menu%7CContextMenu)%5C.harness` | **PASS** | 59 tests / 2 suites | `50b37147ab09` (ios tree) | 1 m 14 s | start 7.6 / med 8.5 / max 10.9 |

### need --for review

```text
      ✓ check — green
      ✓ harness:ios — green on the ios code tree
      ✓ harness:android — green on the android code tree
      note: treated as both platforms (outside the known prefixes): example/__tests__/Chip.harness.tsx, example/__tests__/ContextMenu.harness.tsx, example/__tests__/Menu.harness.tsx, example/src/assets/icons/slab_24px.xml
    need: review is satisfied on this code tree.
```

`harness:android` failed its first run at this tree on `Host.harness` F8 with a 30 s timeout, at a
10-minute load of 17-21 because `G20`'s `real-input:android` shared the box, and passed unchanged on
the retry. Nothing under `Host.harness` reads anything G21 touched.

The README pair for `Menu`, `ContextMenu` and `Chip` was **not** retaken: those pictures are crops
of each component's Storybook story, and this task changed no story file (`git diff bd6a3f6c..HEAD
-- example/src/stories` is empty; the `androidIcon` samples went into
`example/src/readme-examples.tsx`, which no story imports). A retake would be the same pixels.

## Red proofs

JVM (`bash scripts/native-tests-android.sh --rerun-tasks --tests …`, re-run on this tree):

- `MenuRowIconsTest` -> `noteTint` never records (`MenuRows.kt`) -> `a tint is reported per row and only for the rows that drew FAILED`.
- `MenuModelTest` -> the report line drops `iconTints=` (`HybridNitroUiMenu.kt`) -> `aMenuWithNoPrimaryActionHasOneTriggerAndNoHalves FAILED`, `aRecycleClearsTheSplitTriggerAndItsHalves FAILED`.
- `MenuRowIconsTest` -> one slot shared across every row id -> the per-row content case; -> a fresh slot per `apply()` -> the "a re-sent menu keeps its loaded artwork" and retire cases; -> the retire loop dropped -> the retire case; -> `reset()` keeps its slots -> the recycle case; -> `apply()` on an unknown name lands `Pending` instead of `Absent` -> three cases.
- `MenuRowsTest` -> `parseMenuRows` drops the `androidIcon` field -> both wire cases.

JS (`bunx jest src/__tests__/rowAndroidIcon.test.tsx`, re-run on this tree):

- `rowAndroidIcon` -> a row's `androidIcon` sent as `null` (`MenuRows.ts`) -> five cases red, first at `src/__tests__/rowAndroidIcon.test.tsx:65`.
- -> the asset is not resolved (the `require` id goes out) / the component name is wrong / a submenu row is skipped / the chip's sizing key drops the field / the raw prop reaches the key / `escapeField` is not applied -> one or more named cases each; all eight mutations were run.

Device (`gate.mjs harness:android -- <path-regex>`; the filter is a jest **path** pattern, not a
test name, and each run records under its own name and satisfies nothing else). Each was applied,
built, run, then restored and rebuilt, with `git status` clean after every one:

- **h1** row slot `MenuDefaults.LeadingIconSize * 1.2f` (`MenuRows.kt`) →
  `Menu · the row glyphs (G21) › draws the row glyph at the slot size, from a Metro asset and from
  a name` `expected 3969 to be less than 3087`, and `› keeps the check in the slot when the row is
  checked` `expected '413x388' to be '423x389'` — the 20 dp slot measured once as ink area and once
  as a popup that grew because of it.
- **h2** the row never draws (`leadingIcon` from `if (true) null`) → both those Menu cases
  `expected false to be true` — `iconTints` stayed `-`, so no row claimed to have painted.
- **h3** `Absent` reserves the slot anyway (`if (false)` on the null branch) →
  `› refuses a popup probe with no popup, and a name that cannot resolve with no icon`
  `expected 'date#1A1B20,plain#40434B,slab#40434B' to be '-'` and the slot-size case
  `expected true to be false` — a name nobody can look up was reporting a glyph and costing 20 dp.
- **h4** chip slot `FilterChipDefaults.IconSize * 1.2f` (`HybridNitroUiChip.kt`) →
  `Chip · the androidIcon (G21) › draws the imported glyph in the slot, and leaves nothing else in
  its colour` `expected 3249 to be less than 2500.47`, with the filter chip's toggle case beside it.
- **h5** `MenuRowIcons.reset()` keeps the last owner's slots and tints →
  `ContextMenu · the row glyphs (G21) › hands the next owner no glyph of the last one’s`
  `expected 1 to be +0`.

Three of the four findings are visible in the store's own lines. The fourth — a probe read on its
ask's own tick answering `''` — showed as a popup probe that never reported, and left no
assertion behind to quote.

- the ARGB tint: `Menu … › puts the trigger glyph in the leading half, and only there`
  `expected 0 to be greater than 20` — the trigger's own glyph painted nothing, because the colour
  the app asked for was alpha 0 and the probe sampled that same invisible tint.
- the unmeasured half: the same case, `expected 87 to be less than 0.6` — the chevron's half
  "moved" by the whole width of a leading half that had not been measured yet.
- iOS's unreportable menu: `harness:ios` at `b82bf717` was 5 failed / 523 passed, on
  `Menu report for "rows-asset" never matched within 12000ms; last read {"expanded":null, …,
  "menu":[-1,-1,-1,-1], …}` and `the popup of "miss": the report never got there - open=1;…;
  menu=-1;…` — both waits were for a field that platform answers `-1` for by design.

Each of the five is in the table under its own filtered name and its own (mutated) code tree, which
is why `status` calls them stale; they ran before the iOS-only fixes to these two suites. No `.kt`
file and no Android assertion in either suite changed after them, so the same mutations break the
same lines at `50b37147ab09` — they were not re-run there, because the lease ran down to zero with
the four device gates and `check` already green.

## Files changed

- **Specs and generated code**: `src/components/Menu/Menu.nitro.ts`, `src/components/ContextMenu/ContextMenu.nitro.ts`, `src/components/Chip/Chip.nitro.ts`, `src/components/Chip/NitroUiChipConfig.ts` and everything under `nitrogen/generated/` they regenerate.
- **JS**: `src/components/Menu/MenuRows.ts` (resolve + warn + the row field), `src/components/Chip/Chip.tsx` (prop, resolve, sizing key), `src/components/Menu/Menu.tsx`, `src/components/ContextMenu/ContextMenu.tsx`, the three `NativeNitroUi*.ts` handle types.
- **Android**: `MenuRows.kt` (`MenuRowIcons`, the row's `leadingIcon`, `MenuLeadingCheck`), `HybridNitroUiMenu.kt` / `HybridNitroUiContextMenu.kt` (apply on prop set, `iconTints=` in each report, the popup pixel probe), `HybridNitroUiChip.kt` (the glyph, the check, `recordIconTint`, the probe), `NitroUiIcon.kt` (`NitroUiIconSlotGlyph`), `android/src/main/java/com/margelo/nitro/nitroui/core/NitroUiPixelProbe.kt` (the shared probe store and `Color.toRgbHex`).
- **iOS**: the stubs that keep the shape — `androidIcon` stored and never drawn, `iconTints=-` / `iconTint=-`, and a probe that answers `no pixels platform=ios` rather than `0`.
- **Tests**: `src/__tests__/rowAndroidIcon.test.tsx`, `MenuRowIconsTest.kt`, additions to `MenuRowsTest.kt` / `MenuModelTest.kt`, and the three harness suites; fixture pair `slab_24px.xml` / `nitroui_test_slab.xml` declared in `scripts/__tests__/android-icons.test.js`.
- **Docs**: `docs/components/{menu,context-menu,chip}.md`, `README.md` + `example/src/readme-examples.tsx`, `.changeset/g21-android-icon-rows.md`, `etc/react-native-nitro-ui.api.md`.

## Follow-ups

- harness: the popup pixel probes are new device code paths; if a run shows a Material popup dismissing another, the one-popup-at-a-time rule below the suites is where to look.
- chip: `docs/components/chip.md` still documents "no check mark slide-in" as a limit; `androidIcon` does not change that, but a reader may now expect the swap to animate.
- tooling: `bun run api-extractor` is not part of `check`'s repair loop — `check` goes red on `api-extractor:check` and names the copy, which is right, but a task that has never hit it loses a cycle.
- harness: `Host.harness` F8 has a 30 s budget and no load allowance; on a box shared with another
  task's `real-input` it times out and takes a whole `harness:android` run with it.
- menu: a submenu's label and a section's header take no `androidIcon` — neither has a leading slot on either platform, so only `MenuAction` does.
