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
| `check` | **PASS** | 1936 tests / 81 suites | `14ecf52303c1` | 2 m 44 s | start 4.1 / med 11.3 / max 19.0 |
| `harness:ios` | **PASS** | 530 tests / 27 suites + isolated 6 tests / 3 suites | `14ecf52303c1` (ios tree) | 13 m 29 s | start 7.1 / med 5.7 / max 11.2 |
| `harness:android` | **PASS** | 586 tests / 27 suites + isolated 6 tests / 3 suites | `14ecf52303c1` (android tree) | 17 m 02 s | start 5.0 / med 5.7 / max 24.3 |
| `real-input:ios` | **PASS** | — | `14ecf52303c1` (ios tree) | 32 m 44 s | start 2.6 / med 12.6 / max 100.7 |
| `real-input:android` | **PASS** | — | `14ecf52303c1` (android tree) | 49 m 22 s | start 7.7 / med 3.5 / max 13.3 |
| `harness:android:(Menu%7CContextMenu)%5C.harness` | stale | 1 failed of 59 tests / 2 suites | ff52f6368fc5 (not this tree) | 1 m 39 s | start 10.7 / med 9.4 / max 11.5 |
| `harness:android:%5E__tests__%2FChip%5C.harness` | stale | 2 failed of 17 tests / 1 suites | 764db4e10651 (not this tree) | 31.3 s | start 7.5 / med 8.2 / max 9.7 |
| `harness:android:%5E__tests__%2FContextMenu%5C.harness` | stale | 1 failed of 25 tests / 1 suites | cab771e3d510 (not this tree) | 1 m 09 s | start 7.1 / med 6.6 / max 7.1 |
| `harness:android:%5E__tests__%2FMenu%5C.harness` | stale | 2 failed of 34 tests / 1 suites | 676c9c74d6c3 (not this tree) | 34.9 s | start 5.6 / med 5.5 / max 5.8 |
| `harness:android:G21` | stale | — | ff52f6368fc5 (not this tree) | 2.0 s | start 9.8 / med 9.8 / max 9.8 |
| `harness:android:Menu%5C.harness` | stale | 1 failed of 59 tests / 2 suites | 0d09ffbf1ab4 (not this tree) | 1 m 55 s | start 7.6 / med 38.0 / max 46.0 |
| `harness:ios:(Menu%7CContextMenu)%5C.harness` | stale | 59 tests / 2 suites | 50b37147ab09 (not this tree) | 1 m 14 s | start 7.6 / med 8.5 / max 10.9 |

### need --for merge

```text
      ✓ check — green
      ✓ harness:ios — green
      ✓ harness:android — green
      ✓ real-input:ios — green
      ✓ real-input:android — green
      note: treated as both platforms (outside the known prefixes): example/__tests__/Chip.harness.tsx, example/__tests__/ContextMenu.harness.tsx, example/__tests__/Menu.harness.tsx, example/src/assets/icons/slab_24px.xml
    need: merge is satisfied on this code tree.
```

In round 1, `harness:android` failed its first run at `50b37147ab09` on `Host.harness` F8 with a
30 s timeout, at a 10-minute load of 17-21 because `G20`'s `real-input:android` shared the box, and
passed unchanged on the retry. Nothing under `Host.harness` reads anything G21 touched. In the merge
round the table's five rows are one tree, `14ecf52303c1`: `check` plus both harnesses plus both
`real-input`s, on lease `G21-uz5lj` (pair-b — `emulator-5570` and the iOS 27.0 iPhone Air, Metro
8293), after the pair sat behind `G24` and `G20` for three hours and two `acquire` budgets.

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

Each of the five is in the ledger (`docs/tasks/G21/gates.jsonl`) under its own filtered name and its
own (mutated) code tree, which is why `status` calls them stale — the table prints one row per gate
name, so it shows the newest of the three that share `^__tests__/Menu\.harness`. They ran before the
iOS-only fixes to these two suites; no `.kt` file and no Android assertion changed after them, so the
same mutations break the same lines at `50b37147ab09`. They were not re-run there — the lease ran
down to zero with the four device gates and `check` already green — and the merge round re-ran h1,
h3, h4 and the recycle case on the merged tree, below.

**Merge round** — the same recipe at the merged tree, and the two assertions the review asked for
proved against code rather than against a typed-in constant. Each mutation was applied, built, run,
then restored and rebuilt, with `git status` clean after every one:

- **h1** row slot `MenuDefaults.LeadingIconSize * 1.2f` (`MenuRows.kt`) →
  `Menu · the row glyphs (G21) › draws the row glyph at the slot size, from a Metro asset and from a
  name` `expected 3969 to be less than 3087.0000000000005`, and `› keeps the check in the slot when
  the row is checked` `expected '413x388' to be '423x389'` — the same two lines round 1 read.
- **h3** `Absent` reserves the slot anyway (`if (false)` on the null branch) →
  `› refuses a popup probe with no popup, and a name that cannot resolve with no icon`
  `expected 'date#1A1B20,plain#40434B,slab#40434B' to be '-'` and `expected true to be false`.
- **h4** chip slot `FilterChipDefaults.IconSize * 1.2f` (`HybridNitroUiChip.kt`) →
  `Chip · the androidIcon (G21) › draws the imported glyph in the slot, and leaves nothing else in
  its colour` `expected 21.714290618896484 to be less than 19` — the new width assertion, once the
  case was reordered to read the box before the pixels. Run before that reorder, the same mutation
  read `expected 3249 to be less than 2500.4700000000003` on the ink instead, which is what showed
  the order hid the line.
- **h5′** `MenuRowIcons.reset()` keeps the last owner's slots and `apply()` merges into them
  (`slots = slots + next`, nothing retired) →
  `ContextMenu · the row glyphs (G21) › hands the next owner no glyph of the last one's`
  `expected 2954 to be less than 689.0625` — the stale 20 dp square, sampled for the colour the
  first owner recorded rather than for `0x123456`.
- *probe, not a code mutation*: the width band temporarily raised to `ICON_DP + 30` →
  `expected 17.904766082763672 to be greater than 48`. That is how `docs/components/chip.md` got its
  17.90 dp: read off the device, not off the arithmetic.
- *JVM*: the compile-only overflow caller added to `MenuRowIconsTest.kt` → dropping `MenuRow`'s
  `icon` default → `compileDebugUnitTestKotlin FAILED … No value passed for parameter 'icon'`.
- *JS types*: putting `androidIcon?: AndroidIconProp | undefined` back on `MenuSubmenu` →
  `error TS2578: Unused '@ts-expect-error' directive` at `src/__tests__/rowAndroidIcon.test.tsx:147`;
  and sending `row.androidIcon` again for a submenu row → the wire case's `toEqual` mismatch on the
  `null` it must send.
- *the device corrected the fix once*: the first version of the recycle assertion,
  `expect(ink).toBe(0)`, went red against **green** code at `5167699903b2` with
  `expected 145 to be +0` — Material draws the popup's own row titles in the colour the glyph was
  tinted with, so the claim is no *slot* of it, not none of it.

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

## Merge round

Review said merge with fixes. `origin/main` merged clean (docs commits only); the four fixes
are in, each shown red above.

1. **`MenuSubmenu.androidIcon` is gone from the public type** and the wrapper sends `null` for that
   row: a group label on Android, a `UIMenu` title on iOS, no slot on either. Docs, changeset,
   KDoc and the API report followed.
2. **`MenuRow` takes a defaulted `icon` and an optional `onIconTint`** instead of a required
   `MenuRowIcons`, so ButtonGroup's overflow rows, which hold a slot already, compile unchanged;
   a compile-only caller pins that.
3. **The two checks that could not fail sample a colour that exists now**: the recycle case asks for
   the tint the first owner recorded. `toBe(0)` was wrong — Material tints these very titles that
   colour, 145 px of them — so the bound is a quarter of a 20 dp square, and h5′ lands at 2954.
4. **`chip.md` states the measured 17.90 dp**, which the harness logs and asserts; h4 moves it to
   21.71.

`check`, both harnesses and both `real-input`s are green at `14ecf52303c1` and `need --for merge`
is satisfied. No README screenshot was retaken: no story file changed. Seven review lines went
to `FOLLOWUPS.md`.
