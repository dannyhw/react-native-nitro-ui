# G19 — `androidIcon` on Button, the two new rungs, and the Expo plugin

**Branch:** `task/G19-android-icon-iconbutton` (from `main` at `9626bbe7`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `G19-8d0j7` (pair-b — `nitro-ui B` / iPhone Air 27.0 + `emulator-5570` / API 35 · Metro 8293)

**Fix round 1 changed what this branch ships:** `androidIcon` now takes a Metro `.xml` asset and the
config plugin in the title is gone. The summary below is round 1's, kept as written; the state of
the branch is `## Fix round 1`, at the end.

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

| Gate (round 1) | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` (round 1) | **PASS** | 1794 tests / 72 suites | `cb51a5a30283` | 2 m 50 s | start 87.1 / med 38.9 / max 100.4 |
| `harness:ios` (round 1) | **PASS** | 448 tests / 25 suites + isolated 4 tests / 2 suites | `cb51a5a30283` (ios tree) | 10 m 56 s | start 12.8 / med 5.7 / max 67.4 |
| `harness:android` (round 1) | **PASS** | 497 tests / 25 suites + isolated 4 tests / 2 suites | `cb51a5a30283` (android tree) | 14 m 58 s | start 6.4 / med 4.9 / max 13.3 |
| `real-input:ios` (round 1) | **PASS** | — | `cb51a5a30283` (ios tree) | 29 m 03 s | start 13.3 / med 8.0 / max 60.6 |
| `real-input:android` (round 1) | **PASS** | — | `cb51a5a30283` (android tree) | 40 m 41 s | start 6.6 / med 4.2 / max 18.5 |
| `harness:android:Button` (round 1) | stale | 18 tests / 1 suites | 3c9ad09176b0 (not this tree) | 19.3 s | start 12.0 / med 10.4 / max 12.0 |
| `harness:android:draws%20the%20glyph:--background` (round 1) | stale | — | 1f8981779e76 (not this tree) | 1.0 s | start 8.4 / med 8.4 / max 8.4 |
| `harness:android:glyph` (round 1) | stale | — | 1f8981779e76 (not this tree) | 1.3 s | start 9.9 / med 9.9 / max 9.9 |
| `harness:ios:Button` (round 1) | **PASS** | 18 tests / 1 suites | `cb51a5a30283` (ios tree) | 20.3 s | start 7.1 / med 12.7 / max 14.3 |

`need --for review`: `need: review is satisfied on this code tree.` — and `need --for merge` says
the same, so the ledger needs nothing further from this round. Both `real-input:*` gates were run
again on this tree rather than reused: the earlier `real-input:android` pass was on the
immediately-preceding code tree, whose only difference is `example/__tests__/Button.harness.tsx`
and a docs page. The `stale` rows are filtered diagnostic runs (`harness:android:Button`, and two
filters spelled wrong enough to become their own gate name); filtered runs satisfy nothing but
their own name, which is why the five unfiltered rows above are the evidence.

Ledger exported to `docs/tasks/G19/gates.jsonl` (34 lines, none dropped) with the scrubbed excerpt
of every failed run beside it in `docs/tasks/G19/failures/`. The rows above are labelled as
round 1's because a gate appears in this report once, with the ledger's numbers for the tree
being handed in — see Fix round 1.

## Red proofs

Recorded as data in `docs/tasks/G19/mutations.json` — 23 rows. The 16 Jest and JVM rows were
re-run line for line at the end of the round by a driver that applies one mutation, runs the
named suite, then restores the file (`git status` clean after the batch); the seven device rows
were run against an app rebuilt for that mutation, one of them is the shipped bug rather than a
mutation, and one is a mutation the suite does *not* catch. `run` says which. Every device row's
failing run is committed as a scrubbed excerpt beside the ledger (the `68.19047619047619`,
`641 to be +0`, `false to be true`, `96.38x48.00` and `iOS drew an Android icon` lines below are
quoted from those files, not from notes).

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
- the Expo config plugin (`react-native-nitro-ui/plugin`): its entry, its fixture-project tests and its fixtures. Round 1 added them and fix round 1 deleted them, both inside this branch, so those paths open at neither end of the diff — `git show 5b7f4330 --stat` lists them, `git show a49eba03 --stat` deletes them.
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

---

## Fix round 1

**Lease:** `G19-w2v9t` (pair-b — `nitro-ui B` / iPhone Air 27.0 + `emulator-5570` / API 35 ·
Metro 8293) · **Design change (D43 item 2), not a review fix.**

`androidIcon` now takes the `.xml` the app *imports* —
`androidIcon={require('./icons/share.xml')}` — beside round 1's drawable-name string.
The prop is `ImageSourcePropType` narrowed to `string | number | ImageURISource`
(`AndroidIconProp`, now public). One plain string crosses into native, with a `url:`
marker on the file form: no AnyMap, and no patch to React Native's global asset
resolver — that promise is a spy in `iconSource.test.ts`, not a sentence.

**Release:** the asset is an ordinary drawable. The name sent is React Native's own
`getAndroidResourceIdentifier` (`/src/assets/icons/share_24px.xml` →
`src_assets_icons_share_24px`), pinned in test against the function itself, then
resolved by round 1's resolver and cached per id.

**Development:** that file is not in the APK and `assetSupportsNetworkLoads` refuses
`xml` on Android, so the wrapper builds the URL the dev server answers
(`assetServerURL` + `pickScale`, both copied — neither is a public entry) from
`SourceCode.scriptURL`, cached for the process. `NitroUiIconFiles` reads it on one
worker thread, our SAX reader parses it into an `ImageVector`, cached per URL, waiters
coalesced, failures remembered. `NitroUiIconContent` is what the composition reads:
`Absent`, `Pending`, artwork.

**Round 1's rule for unresolvable artwork is unchanged and now covers files: draw
nothing, reserve nothing** — a 404, a non-`<vector>`, a `.png` asset, one warning each.
The slot is `iconSizeFor(size)` from the ladder. **This round found the bug in that
sentence:** the slot was painted only with a painter, so `Pending` measured narrow and
the Button grew sideways when the file arrived — invisible in release, where an icon is
a resource and never in flight.

**Removed:** `react-native-nitro-ui/plugin`, whole. **Docs:** Material Symbols (Android
format), `@expo/material-symbols` as an option an Expo app may take, the drawable-name
form, and iOS using `systemImage`. **IconButton stays out**, as the brief now says.

### Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` (fix round 1) | **PASS** | 1839 tests / 73 suites | `a8a616bb161f` | 2 m 44 s | start 12.4 / med 10.4 / max 14.6 |
| `harness:ios` (fix round 1) | **PASS** | 456 tests / 25 suites + isolated 4 tests / 2 suites | `a8a616bb161f` (ios tree) | 14 m 03 s | start 3.6 / med 11.5 / max 195.2 |
| `harness:android` (fix round 1) | **PASS** | 505 tests / 25 suites + isolated 4 tests / 2 suites | `a8a616bb161f` (android tree) | 16 m 47 s | start 4.4 / med 5.1 / max 13.4 |
| `real-input:ios` (fix round 1) | **PASS** | — | `a8a616bb161f` (ios tree) | 29 m 25 s | start 6.7 / med 8.6 / max 71.8 |
| `real-input:android` (fix round 1) | **PASS** | — | `a8a616bb161f` (android tree) | 42 m 13 s | start 56.3 / med 5.6 / max 56.3 |
| `harness:android:Button` (fix round 1) | **PASS** | 21 tests / 1 suites | `a8a616bb161f` (android tree) | 39.0 s | start 5.7 / med 11.3 / max 13.9 |
| `harness:android:draws%20the%20glyph:--background` (fix round 1) | stale | — | 1f8981779e76 (not this tree) | 1.0 s | start 8.4 / med 8.4 / max 8.4 |
| `harness:android:glyph` (fix round 1) | stale | — | 1f8981779e76 (not this tree) | 1.3 s | start 9.9 / med 9.9 / max 9.9 |
| `harness:ios:Button` (fix round 1) | stale | 1 failed of 18 tests / 1 suites | 92c648d1da04 (not this tree) | 17.7 s | start 8.1 / med 7.3 / max 8.1 |

`need --for review` and `need --for merge` are both satisfied on this code tree, so the ledger wants
nothing further from this round. Round 1's table above is labelled as round 1's: a gate appears in
this report once, with the numbers the ledger holds for the tree being handed in, and every run of
both rounds lives in `docs/tasks/G19/gates.jsonl` after the export below.

`gate.mjs export --task G19` carried 34 lines to 65 and lost none: the exported file is the ledger,
line for line, with a scrubbed excerpt of every failed run beside it — including one
`real-input:android` run of 0.5 s that is this round's own mistake, started before the lease
environment was sourced, so its preflight found no emulator. The passing 42 m 13 s run follows it.

**Measured** — the `Button` suite's console block on the API 35 emulator at 420 dpi, in dp. The
imported icon painted **442** probed pixels **31.3 ms** after its URL was asked, and the control's
box was `60.19x48.00` before the glyph and `60.19x48.00` after it. The ladder, not the file, sizes
the artwork: `title="Share"` is `68.19x48.00` with no icon, `96.38x48.00` through a Metro `.xml`
and `96.38x48.00` through the drawable name — the two forms land on one box. Titled rung boxes with
an icon: `small=57.90x48.00`, `medium=64.38x48.00`, `large=85.71x56.00`, `xlarge=150.86x96.00`,
`xxlarge=200.76x136.00`. The wire for the file form is one string, e.g.
`url:http://localhost:8293/assets/src/assets/icons/star_24px.xml?platform=android&hash=af48588b…`.
Those numbers come from the run at `34bbc3eb53af`, because jest prints console output only for a
failing suite and the shipped tree's run passes; that tree differs from the shipped one by
`example/__tests__/Button.harness.tsx` alone, so the library and the app under the probe are this
round's. No bench arm this round either — one needs an `--exclusive` lease, which powers down
devices other tasks hold.

### Red proofs

Eighteen mutations, each reverted; `->` separates test, mutation and the line that went red.
Every row is data in `docs/tasks/G19/mutations.json`, and every row here was run against the
tree this report ships at.

One run found a bug in this report rather than in the code. The device test first asserted that
an imported icon publishes *one* size box for its mount, and a clean run went red on it: every
Button publishes the component's declared fallback (`12.50x71.50`) and is corrected after, so
the claim was never true of the named form either. The test now asserts what the design
promises — the file adds no layout state the resource form lacks — by requiring that every box
the imported icon published is one the named icon published, with guards pinning that each
control measured its own box.

JVM (`bash scripts/native-tests-android.sh --tests "<Class>"`, 1-8 s a run with the warm daemon):

- `NitroUiIconReleasePathTest > aCommitThatSendsTheSameIconAgainAsksTheResourceTableOnce` -> drop the same-icon guard, so every prop commit re-asks the table -> `expected:<[src_assets_icons_share_24px]> but was:<[src_assets_icons_share_24px, src_assets_icons_share_24px, …]>` — three questions for one prop
- `NitroUiIconReleasePathTest > aBundledAssetIsLookedUpUnderTheNameMetroFiledItUnder` -> the release path stops asking for the drawable at all -> `the resource table is asked for the name the wrapper built, character for character expected:<[src_assets_icons_share_24px]> but was:<[]>`; 5 of the class, incl. `aBundledNameThatIsNotInTheTableDrawsNothingAndReservesNothing` — `a miss is still a question that was asked`
- `NitroUiIconSourceTest > aMarkedStringIsAFileAndItsUrlIsUntouched` -> the marker's scheme test asks the whole URL to be a scheme, so no dev-server icon is ever a file -> `aDevServerIconIsNeverAskedOfTheResourceTable`: `the slot is reserved while the file is read expected:<Pending> but was:<Absent>`; 6 red across the two classes
- `NitroUiIconReleasePathTest > anAnswerToALoadRetiredByRecycleIsDropped` -> drop the generation counter -> `the retired load cannot overwrite the recycled Button's own icon`
- `NitroUiIconReleasePathTest > aDevLoadFillsTheSlotItReservedAndAnAnswerOfNothingClearsIt` -> a failed load leaves its slot reserved -> `a 404 is round 1's missing-name answer, not a permanently empty box expected:<Absent> but was:<Pending>`
- `NitroUiIconReleasePathTest > anAlreadyReadFileIsDrawnWithoutWaiting` -> key the per-URL cache wrong -> `AssertionError` — a file this process already read is read again, and the answer arrives late
- `NitroUiVectorDrawableTest > theBrokenFixtureInTheExampleAppIsRefusedToo` -> accept a file with no `<vector>` element -> `wellFormedXmlThatIsNotAVectorIsRefusedNotDrawn`: `"has no <path> to draw" does not say "no <vector> element"`; 2 red
- `NitroUiVectorDrawableTest > googlesOwnMaterialSymbolsFileIsReadAsItIsWritten` -> take the viewport to be the 24 dp box, not the 960-unit grid Google writes paths in -> `expected:<960.0> but was:<24.0>`; 3 red (Google's file, the units case, the `ImageVector` comparison)

JS (`npx jest src/__tests__/iconSource.test.ts` 0.3 s a run, `buttonSizingKey.test.tsx` 1 s):

- `androidIcon · the release build › names a bundled asset exactly the way React Native files it` -> the leading slash of the asset path survives into the drawable name -> `Expected: "src_assets_icons_share_24px" / Received: "_src_assets_icons_share_24px"`; 3 of 13, incl. the wire form and two paths for one glyph
- `androidIcon · the development build › asks Metro for the file React Native refuses to load` -> every URL carries a scale suffix, including the single-scale ones Metro 404s on -> `Expected: "…/share_24px.xml?platform=android&hash=a1b2c3d4" / Received: "…/share_24px@1x.xml?…"`; 2 red, one of them the copy of React Native's own builder
- `androidIcon · the development build › asks Metro for the file React Native refuses to load` -> the wrapper stops asking the dev server -> `Received: null` — the same test, from the other side
- `androidIcon · the development build › never registers a transformer with React Native` -> the forbidden fix, teach React Native to load `.xml` -> `Expected number of calls: 0` on the spy over `addCustomSourceTransformer`/`setCustomSourceTransformer`
- `androidIcon · the development build › refuses an asset that is not a vector drawable` -> stop checking the asset's type -> `Received: "url:http://10.0.2.2:8081/src/assets/icons/share_24px.png?platform=android&hash=a1b2c3d4"` — a `.png` handed to the vector parser
- `androidIcon · the forms a caller can write › refuses the sources that cannot name artwork, and says why once each` -> drop the once-per-source guard -> `Expected length: 1 / Received length: 4` on the warning array
- `Button · sizing key › separates two assets and refuses to key on an asset id` -> the icon leaves the size configuration -> `Expected: not "filled|medium|||Save"` — two assets, one measurement

Device — Android (`emulator-5570`, `harness:android:Button`, the app rebuilt per mutation, 37-52 s
a run, lease `G19-w2v9t`):

- `androidIcon · an icon the app imports (D43) › draws the imported icon, and does not move the box when the bytes arrive` -> a file that loaded is thrown away -> `expected 0 to be greater than 0` on the pixel probe, and `widens the control by the ladder, not by the file it loaded` red with it at `expected 28.19047619047619 to be less than 0.6`
- `… draws the imported icon, and does not move the box when the bytes arrive` -> the empty slot is not held while the file is in flight -> `expected 'only the imported icon published 57.9…' to deeply equal 'every box the imported icon published…'`: the file alone published `57.90x48.00`, a box the named icon never measured (`12.50x71.50`, `12.57x72.00`, `60.19x48.00`) — the control grew sideways when the bytes landed
- `androidIcon · an icon the app imports (D43) › draws nothing for a file the dev server does not have, and keeps the no-icon box` -> a failed load keeps its slot -> `expected false to be true` on `sameSize(box404, boxPlain)` (`example/__tests__/Button.harness.tsx:2105`)

### Files changed

- `src/iconSource.ts` (new), `src/components/Button/Button.tsx`, `src/index.ts` — the
  prop, the two resolutions, the marker, the cached dev-server origin.
- `android/src/main/java/com/margelo/nitro/nitroui/NitroUiVectorDrawable.kt` (new),
  `android/src/main/java/com/margelo/nitro/nitroui/NitroUiIcon.kt`,
  `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiButton.kt` — the
  reader, the source/marker split, the per-URL file cache, the model's resolve step,
  the empty slot.
- `android/src/test/java/com/margelo/nitro/nitroui/NitroUiVectorDrawableTest.kt`,
  `android/src/test/java/com/margelo/nitro/nitroui/NitroUiIconSourceTest.kt`,
  `android/src/test/java/com/margelo/nitro/nitroui/NitroUiIconReleasePathTest.kt`
  (new); `src/__tests__/iconSource.test.ts` (new),
  `src/__tests__/buttonSizingKey.test.tsx`; `example/__tests__/Button.harness.tsx`;
  `example/src/assets/icons/`.
- `plugin/` deleted; `package.json`, `eslint.config.mjs`, `etc/package-files.txt`.
- `docs/components/button.md`, `README.md`, `.changeset/g19-android-icon.md`,
  `example/src/ButtonScreen.tsx`, `example/src/readme-examples.tsx`.

### Follow-ups

- `docs/tasks/G19/mutations.json` still carries round 1's five plugin rows for a plugin
  this round deleted; the rows are history, not a suite anyone can run.
- `docs/images/components/button-{ios,android}.png` predate the "App icon (Android)"
  row the Button screen gained; they show Buttons, not this one.
- The example app keeps both an imported icon (`example/src/assets/icons/`) and a
  `res/drawable/nitroui_test_*` one, which is now two fixtures for one prop by design —
  the second form needs a drawable that is not a Metro asset.
- The imported-icon test carries one dead probe: it samples `#000000`, a colour the glyph never
  paints, so it logs `hits=0 drawnInMs=15026` and spends 15 s of every `Button` suite run to say
  nothing. The pixel claim rests on the other probe, which counted 442 hits; deleting the dead
  one changes the harness file, so it belongs with the IconButton task that opens it next.
- `check`'s `ci-workflows` step failed once on `-accel-check` under load and passed on retry and
  standalone; owned by X20's tooling, not by this diff.
- FIX4 is moving the library's own glyphs to `res/drawable/nitroui_*` in `android/`. This round
  touched none of them: its named-drawable fixtures are `nitroui_test_*` in
  `example/android/app/src/main/res/drawable/`, the app's folder, and no name is shared. A merge
  that renames one side should still not rename the other.
- Tooling: `gate.mjs` could refuse a device gate outright when `NITRO_UI_LEASE_ID` is absent,
  rather than starting a run whose preflight cannot find a device and leaving a FAIL row behind.

### Questions for orchestrator

None. The one thing a reviewer should look at twice is the provenance of the two
fixture icons: `example/src/assets/icons/{share,star}_24px.xml` are recorded in that
folder's README as Google's Material Symbols download, unedited, with their SHA-256
digests — this round could not reach Google's canonical bytes to re-download and
compare (the GitHub API is not reachable from here), so the claim is the digest, not a
fresh diff. `@expo/material-symbols@0.1.1` was fetched and *is* reachable, and its
`star.xml` path data matches `star_24px.xml` segment for segment, which is the closest
independent check available.

Fixed by part B: `scripts/icons/fetch-material-symbols.mjs` now fetches both files at a pinned
commit and records their digests in its lock, which `android-icons.test.js` re-checks at `check`
time — the provenance is a script and a hash, not a README.

## Fix round 2

**Lease:** `G19-3ttma` (`emulator-5570` + iPhone Air · Metro 8293). Part A `4c08f16e`, accepted;
part B merges `origin/main` (FIX4, E3, X20) at `c487d84b`. 13 mutations in `docs/tasks/G19/mutations.json`,
plus 3 organic reds.

**Part A.** A bundler-derived asset name crosses with its own `res:` marker and is looked up
verbatim: `__node_modules_expo_materialsymbols_star` obeys no rule for typed names. An asset's
answer follows the dev-server origin, not `__DEV__`. Only a verdict on the *file* is remembered,
so a Metro restart no longer sticks an icon. `Menu` gained both rungs and
`androidIcon` (sizing key, model, trigger `icon =`, split leading half, `menu.md`), sharing
`NitroUiIconSlot` with `Button`. The changeset reads as release notes; `ButtonSize`'s TSDoc says
what `button.md` measures.

**Part B, item 3.** A `<vector>` in the app's resources goes through FIX4's `NitroUiIcons`
(`ImageVector.vectorResource`) and is drawn at the slot's size; only a non-vector drawable
rasterises, at its own. Round 1 stretched a 24 dp bitmap into the 32/40 dp slots and held one
parsed shape in two caches. The root tag is read with `next()`, not `nextTag()` — `nextTag()`
throws on AAPT2 output, so every drawable answered "not a vector". `android-icons.test.js`
exempts one file by path, `NitroUiVectorDrawable.kt`, for `ImageVector.Builder` and `PathParser`
only. The example's fixtures are Google's files, hash-checked under `exampleFiles` in FIX4's
lock; four non-upstream ones state a reason. `MenuProps.hybridRef`'s inline handle had no
`androidIcon` — `tsc` caught it. `etc/package-files.txt` and the API report are regenerated, and
round 1's open fixture-provenance question closes with that lock.

### Gates (fix round 2)

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1863 tests / 75 suites | `829a6e682e46` | 2 m 45 s | start 3.5 / med 6.9 / max 13.6 |
| `harness:ios` | **PASS** | 467 tests / 25 suites + isolated 4 tests / 2 suites | `829a6e682e46` (ios tree) | 11 m 21 s | start 4.7 / med 8.4 / max 33.1 |
| `harness:android` | **PASS** | 518 tests / 25 suites + isolated 4 tests / 2 suites | `829a6e682e46` (android tree) | 15 m 36 s | start 30.2 / med 10.1 / max 53.8 |
| `real-input:ios` | **PASS** | — | `829a6e682e46` (ios tree) | 28 m 40 s | start 2.5 / med 7.1 / max 219.6 |
| `real-input:android` | **PASS** | — | `829a6e682e46` (android tree) | 41 m 26 s | start 5.5 / med 4.4 / max 25.0 |
| `harness:android:-t:sharp` | stale | 1 failed of 518 tests / 25 suites | 977e600cbe93 (not this tree) | 45.3 s | start 5.1 / med 5.5 / max 5.6 |
| `harness:android:Button` | stale | 1 failed of 21 tests / 1 suites | 2f7adac9a84f (not this tree) | 37.0 s | start 5.5 / med 4.7 / max 5.5 |
| `harness:android:draws%20the%20glyph:--background` | stale | — | 1f8981779e76 (not this tree) | 1.0 s | start 8.4 / med 8.4 / max 8.4 |
| `harness:android:glyph` | stale | — | 1f8981779e76 (not this tree) | 1.3 s | start 9.9 / med 9.9 / max 9.9 |
| `harness:android:sharp` | stale | — | 72182da36f76 (not this tree) | 1.8 s | start 18.0 / med 18.0 / max 18.0 |
| `harness:ios:Button` | stale | 1 failed of 18 tests / 1 suites | 92c648d1da04 (not this tree) | 17.7 s | start 8.1 / med 7.3 / max 8.1 |

`need --for review` and `need --for merge` are both satisfied on this code tree, so the whole bar
— `check`, both harnesses, both real-input runs — ran at `829a6e682e46`.

One thing the table cannot show: the 09:50 `harness:android` line recorded **PASS** (678.9 s,
518/518) and a `fail` line followed it, because that wrapper was still holding Metro when it was
terminated to free the port for the next platform. The newest line is what `need` reads, so the
row above is the 10:14 re-run, which ran to its own end; both lines are in the exported ledger.

### Red proofs (fix round 2)

Part A's nine mutations, then part B's four plus the three that went red on a device or in `tsc`
without a mutation. `->` separates test, mutation and the line that went red.

- `iconSource.test.ts` -> release name sent bare -> `sends a bundled asset as that name, marked as the bundler's`: Expected `res:src_assets_icons_share_24px`, Received `src_assets_icons_share_24px` (+3 more).
- `NitroUiIconSourceTest.kt` -> `parse` drops the `res:` branch -> `aBundlerDerivedNameIsLookedUpAsSent` (kt:128), `twoDifferentSourcesAreNeverEqual` (kt:146).
- `iconSource.test.ts` -> `__DEV__` decides again -> `asks Metro for a dev=false bundle that Metro is serving`: Expected the `…share_24px.xml?platform=android&hash=…` URL, Received `null`.
- `iconSource.test.ts` -> the false warning returns -> `names the drawable when the bundle is embedded, and says nothing`: +`nitro-ui: androidIcon cannot reach the dev server for the asset at id 6`.
- `menuSizingKey.test.tsx` -> `SIZES` back to three rungs -> `sends xlarge …`: Expected `xlarge`, Received `medium` (and `xxlarge`).
- `menuSizingKey.test.tsx` -> key field present but mute -> `is Button's key with the icon…`: Expected `tonal|small|plain|square.and.arrow.down|share|Publish`, Received `…down||Publish` (+2 collisions).
- `menuSizingKey.test.tsx` -> prop resolved, never sent -> `Expected: "share" / Received: undefined` (+1).
- `NitroUiIconReleasePathTest.kt` -> Menu stores, never resolves -> `aMenuTriggerResolvesTheNameExactlyAsAButtonDoes` (kt:259), `aMenuRecycleRetiresThePreviousOwnersFileLoad` (kt:301).
- `NitroUiIconFailureMemoryTest.kt` -> remember every non-Loaded answer -> `aRefusedConnectionLeavesTheUrlReadable` (kt:59) expected `false`, was `true`; `aDevServerStillCompilingIsNotAVerdict` (kt:100).
- `android-icons.test.js` -> the exemption widened from two patterns to the whole parser file -> the expected finding `NitroUiVectorDrawable.kt:3: a path command` is missing: a hand-typed path inside the parser would be silent too.
- `android-icons.test.js` -> a stray `ImageVector.Builder` in `HybridNitroUiButton.kt`, next to the exemption -> `+android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiButton.kt:42: ImageVector.Builder` — the exemption is one file, not a pattern.
- `android-icons.test.js` -> one vertex of the fetched `star_24px.xml` moved by a unit -> `star_24px.xml: sha256 b60478e6fe5c5584…, recorded 49d8cf2a439f18bc… - edited by hand? Rerun scripts/icons/fetch-material-symbols.mjs`.
- `android-icons.test.js` -> a hand-typed `nitroui_sneaky.xml` dropped into the example's icons folder -> `neither fetched from Material Symbols by fetch-material-symbols.mjs nor declared in EXAMPLE_FIXTURES with the reason it cannot be upstream`.
- `tsc` -> not a mutation: part A shipped the prop and the spec handle but left the inline copy on `MenuProps.hybridRef` behind -> `Menu.harness.tsx: Property 'androidIcon' does not exist on type …` (fixed by `06e1ef10`).
- `Button.harness.tsx` -> not a mutation, a device: round 1's rasterising loader put back in the APK -> `close_24px` in the 40 dp slot reported 957 tinted pixels against the Metro-drawn file's 1138 (0.841, under the 0.95 line); the vector branch with `nextTag()` as its peek measured the same 957, because AAPT2's compiled XML makes `nextTag()` throw and every drawable answered "not a vector".
- `Menu.harness.tsx` -> not a mutation either: three of the four new cases measured on their first device run; the fourth died with `"button-icon" (button-icon) never reported a measured size`, because the parity case asked the Menu handle map about a Button (`9feb4290`).

Green without a mutation: 1863 JS tests / 75 suites, 144 JVM tests, `nitrogen:check`,
`registry:check`, `autolinking:check`, `manifest:check`, `readme:check`, eslint, prettier, and
`bun run task-ready`. The four new `Menu.harness.tsx` cases — rung heights at `xlarge`/`xxlarge`,
the glyph's box against a Button's, the split leading half, the unresolvable name — ran and
passed on both platforms this time, 30 Menu tests each; so did iOS, which part A could only
parse-check.

### Follow-ups (fix round 2)

- `harness:android`: `Slider › steps to the next legal value when a screen reader asks` went red in
  the 09:11 run (`expected [ 3, 6, 3 ] to deeply equal [ 3, 6, 9 ]`, at `load1` 7 rising to 30 with
  E5 beside me). Both runs on this tree drew 518/518, and the line is in four other tasks' logs:
  E5/F1's flake, not this diff's.
- Tooling: a gate whose child is killed after its summary was written appends a `fail` line over
  the recorded `pass`, and `need` reads the newest. Leave a finished harness run's Metro alone and
  it goes by itself (~2 min); `stopOwnMetro` never reaches it while the wrapper waits.
- `Menu.harness.tsx`'s `sizingKey` mirror and `Menu.tsx`'s `sizingVariantFor` are two copies of one
  key format; a shared helper would make the poisoning self-updating.
- `example/__tests__/Button.harness.tsx:1693` still says "the top two are the same control" where
  `button.md` measures three rungs at one height; a comment only, left alone by scope.
- Carried from part A's brief, unchanged: OTA `file://` bundles, `..` in dev URLs, `URI()` on paths
  with spaces, a release-bundle content check, the root `android:alpha`, iOS `pixelProbes` on
  recycle.
