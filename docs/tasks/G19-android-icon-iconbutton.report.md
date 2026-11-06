# G19 — `androidIcon` on Button, the two new rungs, and the Expo plugin

**Branch:** `task/G19-android-icon-iconbutton` (from `main` at `9626bbe7`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `G19-8d0j7` (pair-b — `nitro-ui B` / iPhone Air 27.0 + `emulator-5570` / API 35 · Metro 8293)

## Summary

**Shipped:** `Button`'s `androidIcon`, the resolver behind it, the `xlarge`/`xxlarge`
rungs, and the Expo config plugin. **Not shipped:** IconButton — brief items 4 and 7 —
which is the one question at the end.

`androidIcon: string` names a drawable the app ships; iOS ignores it and draws
`systemImage`, so a control that wants a glyph on both platforms names both and needs
no `Platform.select`. Android resolves the name through React Native's own
`ResourceDrawableIdHelper`, so the lookup behaves like `Image`'s, not a
second `getIdentifier` call with its own rules
(`android/src/main/java/com/margelo/nitro/nitroui/NitroUiIcon.kt`). It loads once per
process, behind a name-change guard in the prop setter: Q9 C1 asked for
`afterUpdate()`, the host has no such hook, and in composition it would call that
`synchronized` helper on every recomposition of every Button.

**A name that cannot resolve is treated as no icon, not as a smaller icon**: no slot,
no padding change, one warning per name in `adb logcat -s NitroUi`. The alternative
reserves a gap for artwork that never arrives. The name is checked twice so a developer
still hears about it: natively once per name, and from JS in development for a string
that could never be a resource name (`Share Icon`, `24px`) — which native cannot tell
from a file that was not shipped, since both are id `0`.

**The glyph is tinted with `LocalContentColor`, not with `ButtonColors.contentColor`.**
That is a bug this round found and fixed, not a flourish: `contentColor` is the resting
colour and ignores `enabled`, so a disabled Button drew its label at 38 % and its glyph
at full strength. Every other reading of the prop is an echo: the handle answers what React
sent, `measureContent()` that a slot was taken. Only sampled pixels could see it (`android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiButton.kt:726`).
Button's new `nuiTestPixelProbe`/`nuiTestPixelReport` pair is that sampler, lifted out
of SegmentedControl into core; iOS answers `no pixels`, having no glyph to sample.

Measured, `filled` on the API 35 emulator at 420 dpi (dp): the slot widens `medium`
`title="Share"` from 68.19 to 96.38, and a 32 × 12 slab lands on the same 96.38 — the
ladder sizes the artwork, not the reverse; an unresolvable name stays exactly 68.19.
Rung heights are 48 / 48 / 56 / 96 / 136 for the five rungs: Material's touch-target
floor, then `LargeContainerHeight` and `ExtraLargeContainerHeight`. iOS has four usable
`.controlSize` values against five rungs, so the top two are both `.extraLarge`.

## APIs

```ts
// src/components/Button/Button.tsx — the only new public surface
export type ButtonSize = 'small' | 'medium' | 'large' | 'xlarge' | 'xxlarge'; // D42 item 4
export interface ButtonProps { androidIcon?: string }
// The Hybrid View spec is `androidIcon: string | null`, non-optional, and Button always
// sends it — `?? null` — per the nitro#1184 rule in AGENTS.md.
```

- `androidIcon`: a drawable the app ships, by resource name; `Share-24px` and `share_24px`
  are one name. iOS accepts and ignores it, because `systemImage` is iOS's glyph — a Button
  with an icon on both platforms sends both and needs no `Platform.select`.
- `src/iconName.ts`: `normalizeAndroidIconName`, `androidIconNameProblem`,
  `warnAndroidIconName` (dev-only, once per name), `resetAndroidIconNameWarningsForTests`.
- Expo: `react-native-nitro-ui/plugin` with `{ androidIcons: '<dir>' }` copies that
  folder's `.xml` vectors into `res/drawable/` and writes the `keep.xml` the resource
  shrinker reads into the app's `res/raw/`. An app that never uses `androidIcon` needs no plugin.
- Not public API: `nuiTestPixelProbe(color)` / `nuiTestPixelReport()` on the Button spec —
  the sampler that proves a glyph was drawn, now in `NitroUiPixelProbe.kt` and shared with
  SegmentedControl. iOS answers `no pixels`, having no Android glyph to sample.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1794 tests / 72 suites | `cb51a5a30283` | 2 m 50 s | start 87.1 / med 38.9 / max 100.4 |
| `harness:ios` | **PASS** | 448 tests / 25 suites + isolated 4 tests / 2 suites | `cb51a5a30283` (ios tree) | 10 m 56 s | start 12.8 / med 5.7 / max 67.4 |
| `harness:android` | **PASS** | 497 tests / 25 suites + isolated 4 tests / 2 suites | `cb51a5a30283` (android tree) | 14 m 58 s | start 6.4 / med 4.9 / max 13.3 |
| `real-input:ios` | **PASS** | — | `cb51a5a30283` (ios tree) | 29 m 03 s | start 13.3 / med 8.0 / max 60.6 |
| `real-input:android` | **PASS** | — | `cb51a5a30283` (android tree) | 40 m 41 s | start 6.6 / med 4.2 / max 18.5 |
| `harness:android:Button` | stale | 18 tests / 1 suites | 3c9ad09176b0 (not this tree) | 19.3 s | start 12.0 / med 10.4 / max 12.0 |
| `harness:android:draws%20the%20glyph:--background` | stale | — | 1f8981779e76 (not this tree) | 1.0 s | start 8.4 / med 8.4 / max 8.4 |
| `harness:android:glyph` | stale | — | 1f8981779e76 (not this tree) | 1.3 s | start 9.9 / med 9.9 / max 9.9 |
| `harness:ios:Button` | **PASS** | 18 tests / 1 suites | `cb51a5a30283` (ios tree) | 20.3 s | start 7.1 / med 12.7 / max 14.3 |

`need --for review`: `need: review is satisfied on this code tree.` — and `need --for merge` says
the same, so the ledger needs nothing further from this round. Both `real-input:*` gates were run
again on this tree rather than reused: the earlier `real-input:android` pass was on the
immediately-preceding code tree, whose only difference is `example/__tests__/Button.harness.tsx`
and a docs page. The `stale` rows are filtered diagnostic runs (`harness:android:Button`, and two
filters spelled wrong enough to become their own gate name); filtered runs satisfy nothing but
their own name, which is why the five unfiltered rows above are the evidence.

Ledger exported to `docs/tasks/G19/gates.jsonl` (34 lines, none dropped) with the scrubbed excerpt
of every failed run beside it in `docs/tasks/G19/failures/`.

## Red proofs

Recorded as data in `docs/tasks/G19/mutations.json` — 23 rows. The 16 Jest and JVM rows were
re-run line for line at the end of the round by a driver that applies one mutation, runs the
named suite, then restores the file (`git status` clean after the batch); the seven device rows
were run against an app rebuilt for that mutation, one of them is the shipped bug rather than a
mutation, and one is a mutation the suite does *not* catch. `run` says which.

JS (`npx jest src/__tests__/iconName.test.tsx`, ~2 s a run):

- `androidIcon name rules › reads a name the way the file had to be renamed to build` -> drop the `-`/`.` to `_` replace in `normalizeAndroidIconName` -> `Expected: "share_24px" / Received: "share-24px"` (4 of 10 red)
- `androidIcon name rules › names the reason a name can never resolve` -> the validity branch never fires -> `Received has value: null` (3 of 10)
- `androidIcon name rules › warns once per bad name, and never about a good one` -> delete the `warnedNames.has(key)` guard -> `Expected number of calls: 1 / Received number of calls: 3`
- `Button · androidIcon › warns in development about a name the app can never ship` -> delete the `warnAndroidIconName` call site -> `Received number of calls: 0`
- `Button · androidIcon › escapes a pipe in the drawable name, spelled out` -> join `androidIcon` unescaped -> `Expected: "filled|medium||a\\|b|c" / Received: "filled|medium||a|b|c"`
- `Button · sizing key › is the variant, the scale, both icon fields and the title` -> delete the `androidIcon` field from `sizingVariantFor` -> `Expected: "tonal|small|square.and.arrow.down||Save" / Received: "tonal|small|square.and.arrow.down|Save"` (5 of 14 red)

JVM (`bash scripts/native-tests-android.sh --tests "<Class>"`, 1-8 s a run with the warm daemon):

- `NitroUiIconTest.aNameIsNormalisedTheWayAFileHasToBeRenamedToBuild` -> drop `.replace('-', '_')` from `NitroUiIconNames.normalize` -> `AssertionError at NitroUiIconTest.kt:57`, and the `isValid` case red with it
- `NitroUiIconTest.aNameThatCannotBeAResourceNameIsSaidSo` -> `isValid(name) = name.isNotEmpty()` -> `AssertionError at NitroUiIconTest.kt:60`
- `NitroUiIconTest.aBadNameIsReportedOnceHoweverManyTimesItIsSent` -> `shouldWarn` returns `true` every call -> `AssertionError at NitroUiIconTest.kt:70`
- `NitroUiIconTest.theStoreStopsGrowingAtItsBoundAndDropsTheLeastRecentlyUsedFirst` -> `LinkedHashMap(16, 0.75f, false)` (insertion-ordered) -> `AssertionError at NitroUiIconTest.kt:113`
- `ButtonModelTest.aRecycledModelForgetsTheCornerAndEverythingElseSentWithIt` -> delete `androidIcon = null` from the model's reset -> `AssertionError at ButtonModelTest.kt:57`
- `NitroUiIconTest.theTwoNewRungsAreMaterialsLargeAndExtraLargeContainerHeights` -> `XLarge -> ButtonDefaults.MediumContainerHeight` -> `everyRungIsTallerThanTheOneBelowIt` fails with `xlarge must be taller than large`

The plugin (`npx jest plugin/`, ~2 s a run, on a generated fixture project):

- `copies the vectors and names them in the shrinker keep file` -> `fs.copyFileSync(sourceFile, …)` becomes `void sourceFile` -> that test and `leaves out what aapt would reject, and says why` red on the copied-file diff (2 of 10)
- `leaves out what aapt would reject, and says why` -> delete the `RESOURCE_NAME.test(name)` guard -> `Not_A_Valid_Name.xml` is copied and named (3 of 10)
- `keeps the app’s own keep rules when it merges` -> delete the `writeKeepFile` call -> `Expected substring: "@drawable/share"` against a keep file that was never written (5 of 10)
- `keeps the app’s own keep rules when it merges` -> merge only the plugin's own entries (`${attribute[1]},${ours}` -> `${ours}`) -> `Expected substring: "@font/brand"`

Device — Android (`emulator-5570`, `harness:android:Button`, each with `node scripts/build-app.mjs
--platform android` between the mutation and the run):

- `androidIcon · … › draws the glyph in the control content colour` -> never draw the glyph (`if (false && painter != null)`) -> `expected 0 to be greater than 0`
- `androidIcon · … › takes the icon slot for a name that resolves` -> the same mutation -> `expected 68.19047619047619 to be greater than 68.79047619047618` (the star stopped widening the control)
- `… takes the icon slot …` -> an unresolved name returns a 1 × 1 transparent bitmap instead of `null` (the realistic "it loaded, it is just empty" bug) -> `sameSize(boxOf('missing'), plain)` -> `expected false to be true`
- both `androidIcon` describes -> delete the `androidIcon` field from the JS sizing key -> `testID "slot-star" (the star Button) never reached 96.38x48.00 - last box 68.19x48.00, control measured 96.38x48.00`: two Buttons differing only by an icon shared one cached size
- `… draws the glyph …` -> the shipped code before `4689d0d2` *is* the mutation (`tint = colors.contentColor`) -> `expected 641 to be +0` on the disabled probe, whose report was byte-identical to the enabled control's; with `LocalContentColor.current` the same run reads `probe-icon hits=641 … probe-disabled hits=0 mean=#7F7F7F`

Device — iOS (`nitro-ui B` / iPhone Air 27.0, `harness:ios:Button`):

- `androidIcon · … › takes the icon slot …` -> iOS falls back to a placeholder symbol when only `androidIcon` is sent -> `iOS drew an Android icon: star=98.00x35.00 vs plain=68.00x34.33: expected false to be true`
- `androidIcon · … › draws the glyph …` -> `nuiTestPixelReport`'s iOS answer from `no pixels` to `sampled pixels` -> `the pixel probe for "probe-icon" reported a line that is neither a sample nor a refusal: n=1 sampled pixels platform=ios`, which is the wiring (JS -> Swift -> back) being live rather than the assertion reading a constant

**One mutation this suite does not catch,** so it is recorded rather than glossed: taking Material's
`hasStartIcon` padding unconditionally (every Button ~8 dp too wide, icon or not) left all 18 Button
tests **green** on the emulator. The slot assertions compare controls to each other, so a constant
added to all of them is invisible; only an absolute-box golden would see it. The bug the assertions
*do* pin — an unresolved name reserving a slot for one control and not the others — is the third
line above.

The iOS branch of the probe test was **broken until its first full run**: a `.borderless` label with
an empty title measures zero wide on iOS, so the five probe controls never reported a size and the
harness timed out — `"probe-icon" (probe-icon) never reported a measured size.` on an all-green
Android. Fixed in `bf046323` (Android keeps the empty title, iOS gets a label) and re-run green.

## Files changed

- `android/src/main/java/com/margelo/nitro/nitroui/NitroUiIcon.kt` — the name rules, the once-per-name warning, the bounded LRU of loaded artwork, drawable to bitmap, and the glyph composable
- `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiButton.kt` — `androidIcon` on the model and the one renderer, the icon slot and its padding, the two new rungs, and the `LocalContentColor` tint fix
- `android/src/main/java/com/margelo/nitro/nitroui/core/NitroUiPixelProbe.kt` — the pixel sampler, lifted out of `HybridNitroUiSegmentedControl.kt` so Button and SegmentedControl share one
- `ios/components/Button/HybridNitroUiButton.swift` — `androidIcon` accepted and not drawn; `xlarge`/`xxlarge` to `.extraLarge`
- `src/iconName.ts`, `src/components/Button/{Button,Button.nitro,NativeNitroUiButton,NitroUiButtonConfig}.ts` — the prop, its docs, its sizing-key field, the JS name rules
- `plugin/index.js`, `plugin/__tests__/plugin.test.js`, `plugin/__fixtures__/android-icons/*` — the Expo config plugin, its fixture-project tests, and its fixtures
- `example/android/app/src/main/res/drawable/` — three Material Symbols vectors the device tests name: `nitroui_test_star.xml`, `nitroui_test_wide.xml`, `nitroui_test_shape.xml` (Apache 2.0)
- `src/__tests__/iconName.test.tsx`, `src/__tests__/buttonSizingKey.test.tsx`, `android/src/test/java/com/margelo/nitro/nitroui/NitroUiIconTest.kt`, `android/src/test/java/com/margelo/nitro/nitroui/ButtonModelTest.kt`, `example/__tests__/Button.harness.tsx` — tests
- `docs/components/button.md`, `.changeset/g19-android-icon.md`, `package.json`, `etc/*`,
  `nitrogen/generated/**` — the Android-icons and ladder docs, the minor changeset, the plugin's
  package entry, and the regenerated spec and API report
- `eslint.config.mjs` — a Node/CommonJS lint block for `plugin/`, which `expo prebuild` runs
  unbundled rather than the React Native environment the rest of the package is written for
- `docs/tasks/G19/mutations.json` — the red proofs above as data

## Follow-ups

- IconButton: brief items 4 and 7 — not built; see Questions.
- Coverage: unconditional `hasStartIcon` padding leaves the Button suite green (proved above); only an absolute-box golden would catch a constant that moves every Button.
- Tooling: two full `harness:android` runs looked hung from the outside because jest's reporter buffers when its stdout is a pipe — the ledger line only appears at the end, and `gate.mjs wait` resolves the *previous* line while a run with the same gate name is in flight. Both runs were fine; one I killed at 7 min (its ledger line reads `treeAfter` mismatched, as designed).
- Tooling: a gate refused by the Metro preflight leaves the port held by the run that owns it, so a retry must wait for that run rather than assume the refusal was free.
- Bench: no bench arm for `androidIcon` (and none for an IconButton that does not exist). Running one needs an `--exclusive` lease, which powers down devices another task is holding — E3 held one all round, so the bench stayed unbuilt.
- `n=` in the probe report shape is what lets a test tell its own answer from the previous control's; two controls now share that shape and only the harness helper asserts it.
- Q9 C2 item 3 (`androidIcon` on Menu/ContextMenu rows, SplitButton, Chip) untouched, as the brief said.
- `test:native:android` skips itself when `CI` is set without `NITRO_UI_ANDROID_JVM_TESTS=1`, so a hosted green `check` says nothing about the Kotlin tests.

## Questions for orchestrator

**1. IconButton: give it its own task, or owe it to a fix round here?** Brief items 4 and 7 are not built. This round shipped `androidIcon`, the ladder and the plugin with device evidence on both platforms, and IconButton would have shipped as prose: the README row, the import block, the Usage section, both screenshots, a `docs/components/` page of its own, the registry entry, sizing through the core path with conformance rules and a fallback, recycling with a full reset, the XS-XL x narrow/uniform/wide grid, the 48 dp target at XS, the toggle handshake including a refused change reverting, the required label at runtime in dev, and real-input taps on both platforms. That is Checkbox/G15-scale work, not a tail on this one, and D4 exists precisely to stop a component landing as a paragraph. **Recommendation: a task of its own** (`G19b`/`G22`), which is also what makes its bench arm possible on the bench host. Facts it should not have to re-derive: material3 1.5.0-beta02 has `IconButtonDefaults.{extraSmall…extraLarge}ContainerSize(widthOption)` with `IconButtonWidthOption.{Narrow,Uniform,Wide}`, `shapes(shape, pressedShape)`/`toggleableShapes(...)`, and per-size `…RoundShape/SquareShape/PressedShape/SelectedRoundShape/SelectedSquareShape` that are all `@Composable`; `androidx.compose.material3.Icon` is deprecated, and `androidx.compose.ui.graphics.Bitmap` does not exist (use `android.graphics.Bitmap`).

**2. Is the padding coverage hole worth a golden?** See the red-proofs note. My recommendation: leave the harness comparing controls to each other and take an absolute-box golden as its own small task, because a golden on a text-sized control is a maintenance promise (font scale, density, Compose bumps) that one task should not sign quietly.
