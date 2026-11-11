# G30 — ListItem

**Branch:** `task/G30-list-item` (from `main` at `e3e0b297`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `G30-16rcb` (`pair-a`: iPhone 17 / iOS 27.0 + `emulator-5574` / API 35 · Metro 8295)

## API

One leaf, `ListItem`, for the *content* of a list row — `title`, `subtitle`, `value`
(trailing text on the headline's own line), `systemImage` (iOS) / `androidIcon` (Android)
as the two spellings of the leading glyph, `accessory: 'none' | 'disclosure'`, `disabled`,
`onPress`, `accessibilityLabel`, plus `testID`/`style`. Every native prop is passed on every
render with `T | null` — no optional spec props (nitro#1184) — and `onPress` goes through
`useStableCallback`, with `onPressNotProvided` standing in when the app passed none, so the
row's pressability is a prop (`pressable`) rather than the presence of a callback.

It is content, not a cell (D46 item 2): inside a `Form.Row` the row owns the cell, the
insets, the shape and the press; standalone the item pays the list's own 16 pt / 16 dp
insets and paints its own highlight. Nothing configures that — `Form.Row` publishes it
through context and the leaf reads it. iOS draws `UIListContentView` with
`.cell()` / `.subtitleCell()` plus a baseline-pinned value label; Android draws material3
1.5's `ListItem` with `containerColor = Transparent`, because M3 paints a `Surface` by
default and Form's segmented row owns the shape.

## Early checks

1. **iOS — `UIListContentView` hosted in our view** self-sizes from
   `systemLayoutSizeFitting(width:)`: 52 pt for one line and 68.33 pt for two at the large
   content size (rounded up to 69 pt by layout), and the configuration's content margins are
   the same 16 pt as a `.insetGrouped` cell, a `.plain` cell and a standalone row — measured,
   all three, which is why `listInset` is one number for both hosts. Recorded in
   `docs/components/list-item.md`.
2. **Android — Material 3 `ListItem` inside `NitroUiMeasuredRoot`**: 56 dp for one line and
   72 dp for two are Material's own container minima, and a 24 dp leading glyph
   (`ListTokens.ItemLeadingIconSize`) raises neither, so `containerColor = Transparent` is
   the only container work the leaf has to do. The centred `trailingContent` slot is *not*
   used for `value`: measured, it sits between the two lines of a two-line item, so the value
   goes into `headlineContent` behind the headline — UIKit's arrangement, one line, on both.
3. **Inside a `Form.Row`, both platforms**: `example/__tests__/ListItem.harness.tsx` reads
   the leaf's own report — `insets=<l>,<t>;shape=<0|1>;box=<w>x<h>` — where `insets=` is
   where the content column actually landed and `shape=` is read at the branch that chooses
   the painter. Standalone: `16,16` and `shape=1`. In a row: `0,0` and `shape=0`, with the
   content still displayed and a press on it still arriving as one press. Both numbers come
   from the drawn row, so the two hosts cannot both be "right" by accident.

## Summary

`ListItem` ships as the platform's row content on both platforms: `UIListContentView` on
iOS, material3's `ListItem` on Android, one shared size key (`''`, `'i'`, `'s'`, `'s|i'`)
whose height is 52/69 pt and 56/72 dp, with a declared fallback of 300 × 52 / 300 × 56 that
deliberately is *not* any other configuration's real size, so every non-headline row is
corrected from a wrong box rather than landing in a lucky one. `value` and a `disclosure`
chevron are outside the key because measured they cost no height — and the harness asserts
that changing them opens no configuration at all. Dynamic Type and `fontScale` go through the
sizing engine's epoch: one-line rows measured 52 → 54 → 56 → 113.33 pt as the content size climbs — UIKit's row growing, not arithmetic here.

Three findings changed the component, all of them from real input rather than the harness:

- **The row never pressed on iOS.** The press recogniser is a `UILongPressGestureRecognizer`
  whose comment claimed "no minimum" while its `minimumPressDuration` was left at UIKit's
  default of 0.5 s, so every real tap recognised as nothing: no highlight, no `onPress`.
  Setting it to 0, which is what `Form`'s cell does, is the fix.
- **The Android row had no press feedback at all.** Material 1.5's interactive
  `ListItem(onClick:)` answers a press by morphing the container it paints plus
  `ripple(bounded = false)`, and this row keeps its container transparent so `Form.Row`
  owns the shape. Measured with a real gesture stream held on a 996x189 px row: 0.9880 mean
  luma at rest and 0.9880 luma 900 ms later across all 15 grid cells — while the row's own
  `onClick` fired twice. The row now takes the plain overload with Material's own bounded
  `ripple()`, as `Form`'s rows do: 0.9133 held, 0.9880 released. `pressPath` still answers
  `own`, so `shape=` is unchanged.
- **The disclosure chevron was a second a11y stop**, an element named `Forward` on the
  arrow's own 14 pt box. Both obvious fixes (`isAccessibilityElement = false`,
  `accessibilityElementsHidden = true`) were measured and both failed; what works is the
  Slider's idiom — the glyph in a container whose `accessibilityElements` is the empty
  array — and the dump then shows one named element per row.

Recycling resets fully and cleans up in `onDropView`; the registry, conformance, sizing and
smoke tables, the README row, import, Usage, both screenshots and a minor changeset are in.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 2016 tests / 85 suites | `81198946c770` | 2 m 52 s | start 5.7 / med 8.7 / max 20.7 |
| `harness:ios` | **PASS** | 605 tests / 32 suites + isolated 6 tests / 3 suites | `81198946c770` (ios tree) | 14 m 53 s | start 6.5 / med 5.8 / max 20.2 |
| `harness:android` | **PASS** | 661 tests / 32 suites + isolated 6 tests / 3 suites | `81198946c770` (android tree) | 18 m 33 s | start 18.3 / med 5.3 / max 18.3 |
| `real-input:ios` | **PASS** | — | `81198946c770` (ios tree) | 43 m 23 s | start 4.4 / med 7.5 / max 24.6 |
| `real-input:android` | **PASS** | — | `81198946c770` (android tree) | 65 m 23 s | start 22.2 / med 5.2 / max 22.2 |
| `real-input:android:--control:list-item` | **PASS** | — | `81198946c770` (android tree) | 12 m 47 s | start 10.3 / med 6.7 / max 17.1 |
| `real-input:ios:--control:list-item` | **PASS** | — | `81198946c770` (ios tree) | 13 m 42 s | start 9.0 / med 9.0 / max 28.3 |

`need --for review`: need: review is satisfied on this code tree.

One superseded run: the first `harness:ios` on this tree went red at 02:06Z on
`ListItem × no-leak-on-drop: 1 ledger entry(ies) survived 50 drops` (both attempts), at
load1 21.6 at start and 24.8 peak while another task's gates were running on the other
device pair. `Conformance.harness.tsx` alone on the same app at load1 ~5 passed all 110
tests, including the churn, and the row in the table above is the full run re-taken. The
rule waits three seconds for the ledger to go quiet before it reads, and this is the shape
its own comment records from CI — `Menu × no-leak-on-drop: 1 ledger entry(ies) survived 50
drops` at load1 152-380, the same tree green on the next dispatch. Recorded here because a
red that came and went is what a reviewer would otherwise rediscover.

## Red proofs

Each line is `test -> what was broken -> the line that went red`.

- `real-input:ios list-item press` -> the recogniser as first shipped, `minimumPressDuration`
  left at UIKit's 0.5 s -> `it reads "0" after 8s — it is behind, so a tap was dropped before
  it reached the content` (run `2026-11-10T23:40Z`, tree at `ddd90c24`).
- `real-input:android list-item highlight` -> the row as first shipped, on Material's
  interactive overload with a transparent container -> `the row is darker with the finger
  down than at rest (0.9880 against 0.9880)` at 00:13Z, and with the grid sampler added,
  `best held reading 0.9880 — 0.9880 under a raw DOWN, 0.9880 under a held swipe — against
  rest 0.9880` at 01:32Z; green after the fix on the same fixture: 0.9133 under a raw DOWN,
  0.9162 mid-gesture, 0.9880 released. iOS's twin of the same claim measured
  `rest=0.9843137254901959 held=0.9416235294117646` sampled 1.24 s into a 2.5 s press.
- `real-input:android list-item barrier` -> the check's own hard-coded `expected: "11"` ->
  `at "14" rather than "11"`: the highlight check's held press is itself a counted press, so
  the absolute number was never the claim. Both halves now count from the counter.
- `real-input:ios list-item a11y` -> the disclosure glyph left as its own element ->
  `XCTAssertEqual failed: ("11") is not equal to ("0")`, with the dump printing
  `type-43 id="chevron.right" label="Forward" … box (364, 278, 14×13.7)` (runs `22:23Z`,
  `22:38Z`, `22:54Z`).
- `a11y rule, offline` (`scripts/__tests__/real-input-a11y.test.js` on
  `scripts/__tests__/fixtures/a11y/list-item.xml`, clean run answers `[]`) -> the row's name
  deleted from the dump -> `no node in the accessibility tree carries the name "Real-input
  item" at all…`; -> the action taken off the row node -> `the node that carries
  "Real-input item" is not actionable, and nothing whose box is the control's is either…`.
- The harness device rules (poisoned fallback, glyph drawn not parsed, disabled inert,
  recycling reset, `Form.Row` `insets=`/`shape=`) were each seen red while the leaf was being
  written, before the fix they guarded landed. That was earlier in this round than any recorded
  gate run and no red line from it was kept, so those five are asserted here, not evidenced;
  what the runs above evidence is the press, highlight, barrier and a11y reds plus the offline
  a11y rule's two mutations. Both harnesses re-ran green on the final tree.


## Files changed

- **Component**: `src/components/ListItem/ListItem.tsx`, `src/components/ListItem/ListItem.nitro.ts`, `src/components/ListItem/NativeNitroUiListItem.ts`, `src/components/ListItem/NitroUiListItemConfig.ts`, `src/components/ListItem/component.json`, `src/index.ts`, `src/components/Form/Form.tsx` (publishes `insideRow`).
- **iOS**: `ios/components/ListItem/HybridNitroUiListItem.swift`, `ios/core/NitroUiDeclaredFallbacks.swift`.
- **Android**: `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiListItem.kt`, `android/src/main/java/com/margelo/nitro/nitroui/NitroUiPackage.kt`, `android/src/main/java/com/margelo/nitro/nitroui/core/NitroUiDeclaredFallbacks.kt`.
- **Generated**: `nitrogen/generated/` (spec, component, autolinking, config), `nitro.json`, `nitro-ui.sizing.json`, `etc/react-native-nitro-ui.api.md`, `etc/package-files.txt`.
- **Tests**: `example/__tests__/ListItem.harness.tsx`, `example/__tests__/Conformance.harness.tsx`, `example/ios/NitroUiExampleUITests/RealInputTests.swift`, `scripts/real-input/android.mjs`, `scripts/real-input/screens.mjs`, `scripts/real-input/controls.mjs`, `scripts/real-input/a11y.mjs`, `scripts/__tests__/fixtures/a11y/list-item.xml`, `scripts/__tests__/real-input-a11y.test.js`, `scripts/__tests__/smoke-ready-line.test.js`, `src/__tests__/viewConfigs.test.ts`, `scripts/__tests__/conformance.test.js`, `scripts/conformance-core.mjs`, `scripts/conformance/make-a11y-fixtures.mjs`.
- **App/docs**: `example/src/ListItemScreen.tsx`, `example/src/stories/ListItem.stories.tsx`, `example/src/readme-examples.tsx`, `scripts/smoke/App.tsx`, `README.md`, `docs/components/list-item.md`, `docs/images/components/list-item-ios.png`, `docs/images/components/list-item-android.png`, `.changeset/g30-list-item.md`, `bench/src/plan.ts`, `bench/src/types.ts`, `bench/src/implementations/nitroUi.tsx`, `bench/src/implementations/rnCore.tsx`, `bench/src/implementations/expoUi.ios.tsx`, `bench/src/implementations/expoUi.android.tsx`, `bench/src/implementations/shared.ts`.

## Follow-ups

- bench: the `mount.list-item` arms are in `bench/src/implementations/nitroUi.tsx` and `bench/src/plan.ts`, but no numbers here: `scripts/bench/run.mjs --plan quick --component list-item --dry-run` answers `matched no cell in plan "quick"` (and the same for `full`, whose components stop at `form`), so the cell needs adding to the scheduled plan before it can be measured; the runner also refuses this box at load1 5.2-6.5 against its 5.0 ceiling. Benches belong to the bench host (D15) and are not in `need`.
- iOS real input: XCUITest taps an element's frame without scrolling a plain view, so every press fixture in `example/ios/NitroUiExampleUITests/RealInputTests.swift` now has to call `scrollIntoView` first — the older cases only get away without it because their fixtures happen to sit in the band.
- harness: `ListItem × no-leak-on-drop` went red once at load1 21-25 and green at load1 ~6 on the same tree; the churn's three-second quiescence window is what absorbs it, so a recurrence at ordinary load is a real retention, not a scheduling artefact.
- a11y: a `Form.Row`'s UIKit cell accessory publishes its own "Forward" element, so a whole-screen count of that name includes G24's row, not just this leaf's disclosure.

- device settings: the screenshot round left an `adb reverse tcp:8080` on `emulator-5574`, now removed; `debug_http_host=localhost:8295` is left as `scripts/real-input/android.mjs` leaves it after any run on that device, because its teardown removes only its own reverse and the next run overwrites the preference.
