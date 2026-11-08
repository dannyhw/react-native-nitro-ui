# G24 — Form and Section

**Branch:** `task/G24-form` (from `main` at `60dda361`) · **Round:** 1 of up to 3 (D19) ·
**Lease:** `G24-n0vyo` (pair B / Metro `8293`)

## API

`Form` is a grouped, scrolling settings list whose rows are ordinary React Native views.

| Component | Props | Notes |
| --- | --- | --- |
| `Form` | `children`, `keyboardAvoidance` (default `true`), `style` | Not self-sizing: it takes the box it is given (`sizing: null`). Give it `flex: 1`. |
| `Form.Section` | `children`, `title`, `footer` | Strings, not nodes, in v1. Every direct child becomes one row. |
| `Form.Row` | `children`, `onPress`, `accessory: 'none' \| 'disclosure' \| 'checkmark'`, `selected`, `style` | An app names the component only to add a press or an accessory. |

Exported types: `FormAccessory`, `FormProps`, `FormSectionProps`, `FormRowProps`,
`FormComponent`. The three `hybridRef` handles stay internal (D14), written inline the way
`TextField` writes its own so api-extractor never asks for a native type.

The platform mapping, the settle-time `measure()` contract and the off-screen-row rule are in
`docs/components/form.md`.

## Summary

`Form` is iOS's list and Android's shapes. On iOS the container is a
`UICollectionView` in `.insetGrouped` appearance whose list cells hold the rows; on Android
there is no platform `Form` to host, so rows stay exactly where Yoga put them inside React
Native's own `ScrollView` and each section draws Material 3 Expressive's segmented-list shapes
behind them (D45). A nitro-ui control in a row is the same standalone control it is anywhere
else — no `Host`, no re-parenting into Compose.

Four mechanisms carry it, each one a spike would have skipped:

- **Three numbers make `measure()` right.** iOS lays a row out at the width a cell hands it
  (`onContentBox`); the cell puts 4 pt above and below every row, so the Section reports that
  space between rows and each row takes half of it as a margin (`onMetrics`); a section reports
  the y the list gave it, so a row's Yoga origin is where its cell is drawn. The shadow-node
  correction is then the scroll offset alone (`cpp/NitroUiScrollOffset.hpp`, D45 item 3);
  without the middle number, row 14 measured 176 pt out. Mid-fling lag and off-screen rows are
  documented as deliberate.
- **A settle is not only a scroll.** UIKit applies the list's top inset to `contentOffset.y`
  inside the layout pass that reports the list at rest, and a list's first geometry pass can run
  before `onContentOffset` is attached. The holding view notices the safe area moving,
  and an offset counts as published only when a listener heard it: otherwise a form at rest
  measures 68 pt above its pixels, with nothing left to trigger a second publish.
- **The keyboard is insets, not a scroll hack.** Android reserves `ime()` in its scroll content
  and asks the scroller to make the focused row visible; iOS grows the list's bottom inset.
- **A press belongs to the cell.** A row with `onPress` is UIKit's cell highlight and one button
  element; on Android it is M3's pressed state and one merged node that does not steal touches
  from a `Switch` in the row.

The real-input fixes came first, in their own commit: `imeShown()` was asking whether
`"[object Object]"` contains `mInputShown=true`, and the keyboard edge came from the IME's window
record — since API 30 a full-height insets host whose `frame=` never moves. Both readers are
pure functions in `scripts/real-input/ime-frame.mjs`, unit-tested, so a dumpsys format change
fails in `check` rather than on a device.

## Gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |

`need --for review`: <pending>

## Red proofs

Host (each mutation applied to the source, reverted after the run):

- `ime-frame.test.js` -> `imeInsetTop` ignores `visible=` -> `says nothing when the source is there but not visible`
- `ime-frame.test.js` -> `imeServiceTopPx` drops the `mInputShown` gate -> `refuses the same number once the input view is down`
- `ime-frame.test.js` -> `imeInsetTop` answers `0` instead of `null` -> 4 red, incl. `says nothing, rather than 0, for a dump that never mentioned an IME`
- `scroll-offset.test.cpp` -> `scrollOffsetOf` passes a NaN through -> `5 of 16 checks FAILED`
- `scroll-offset.test.cpp` -> a negative offset clamps to `0` -> `1 of 16 checks FAILED` (the negative-offset case)
- `registry.test.js` -> `subViewsOf` stops marking sub-views -> `refuses a sub-view that claims a name another component has`
- `registry.test.js` -> a sub-view name loses its parent prefix -> 12 red, from `the tree in front of us is in step with its manifests`
- `patch-nitrogen.test.js` -> `HybridNitroUiForm` out of `CONTENT_CHILDREN_VIEWS` -> `mounts the children into the content view, inside the @implementation`
- `patch-nitrogen.test.js` -> `SCROLL_SHADOW_VIEWS` emptied -> `repoints the shadow node and keeps nitrogen's state`
- `viewConfigs.test.ts` -> the Row's config copy drops `pressable` -> `NitroUiFormRowConfig.json matches nitrogen output`
- `conformance.test.js` -> the Form's a11y case points at another screen -> `navigates once per screen, not once per case`
- `bench-gate.test.js` -> the Form's four quick-plan cells removed -> `schedules one complete component per --component, never a mix`
- `readme-components.test.js` -> no `docs/images/components/form-ios.png` -> `Form: docs/images/components/form-ios.png does not exist`

On device — the two shipped bugs, red before their fix on the fixture they ship with, and the
two mutations that show the scroll half of `E7` can fail:

- `E7` -> the Section reporting `0` for the space between rows, as it did -> `m13:
  measureInWindow 40.0,612.3,340.0,44.0 vs UIKit 40.0,788.3,340.0,44.0 (off by 176.0 pt)`, the
  error growing exactly 8 pt per row (`harness:ios` at 11:13)
- `E7` -> the Form recording an offset it never published, as it did ->
  `geometry{offset=-68.00,origin=-68.00,received=0.00}` with all 14 rows `off by 72.0 pt`
  (`harness:ios:Form` at 11:36)
- `E7` -> `nuiContentOffsetY={null}` (the shadow node never told) -> all 14 rows `off by 68.0 pt`
  at rest, `geometry{offset=-68.00,origin=-68.00,received=0.00}` (`harness:ios:Form` at 12:29)
- `E7`'s "did the list move" ask -> `nuiTestScrollTo` made to do nothing -> `Form report never
  satisfied "the list to have scrolled to 180 pt" - last was ...offset=-68.00`
  (`harness:ios:Form` at 12:47)
- `FormFidelity` -> the layer back on `fillMaxSize` instead of the section's box, as it shipped ->
  `the section draws into a layer 54.1 dp tall while the section itself is 296.4 dp ... (out by
  242.3 dp)` (`harness:android:FormFidelity` at 14:15)
- `FormFidelity` -> the accessory's `align(TopStart)` back to `TopEnd`, as it shipped ->
  `the accessory ends at x=707.0 dp, past its row's trailing edge at x=367.6 dp`
  (`harness:android:FormFidelity` at 14:16)

Two things were *dropped* rather than shipped because no mutation made them red: a read-back of
the row list the layer drew (`drawnShapes`), and an `OnLayoutChangeListener` on the row that
published its frame - both redundant against paths the case already exercises (round 2).

## Files changed

- `src/components/Form/*` — the wrapper: rows as children, the content-width box, the
  settle-time offset prop, the Android accessory reserve, the registry-generated view configs.
- `ios/components/Form/*` — the `.insetGrouped` list, cells, `UICellAccessory`, the cell
  highlight, the keyboard inset, the SwiftUI reference screen for the fidelity table.
- `android/.../HybridNitroUiForm*.kt` — the segmented shapes, the reserved header band, the
  pressed state, the IME inset, the two Material Symbols accessories.
- `cpp/NitroUiScrollOffset.hpp`, `cpp/NitroUiScrollShadow.hpp`, `scripts/patch-nitrogen.mjs`,
  `scripts/registry-core.mjs` — the scroll-corrected shadow node and the optional `subViews` key.
- `scripts/real-input/*` — the IME readers, the Form checks on both platforms, the a11y case.
- `example/__tests__/Form*.harness.tsx`, `example/src/FormScreen.tsx`,
  `example/src/stories/Form.stories.tsx` — the on-device tests, the real-input screen, the stories.
- `docs/components/form.md`, `README.md`, `docs/images/components/form-*.png`, `.changeset/`.

## Follow-ups

- `real-input:ios` is red on two Form checks, on the tree this branch ends with. `a11y:form`: the
  only node announced as "Row with onPress" is the React Native wrapper (trait `other` at
  40,240,340,44), so `NitroUiFormRowCell` is not the one button element the component page claims -
  the candidate cause to try first is that `refresh(cell:for:)` *snapshots* the aggregated label
  when the cell is configured, before React Native has put the label on the row's content.
- Same gate, question 5: three real taps on `form-note-field`, reached by scrolling the list to its
  end, never give it the keyboard (`focusByTap`, `RealInputTests.swift:4043`). Both need a device
  to iterate against; neither is visible to `check` or to the harness.
- `real-input:android` has not reached a verdict on this branch: its own Form checks
  (`requireControlOnScreen("Row with onPress")`) are untested by any run.
- `NitroUiFormSectionView` drives its Compose host the way `ContextMenuView` does, and this round
  showed what that costs: a decoration host has to be *told* its box, because a Nitro host measures
  content with an unbounded height. `ContextMenuView` deserves the same look.
- `bun run bench --platform <p> --plan quick --component form` has arms on both platforms
  (`FormBenchActivity.kt`, `BenchViews.swift`), a plan (`mount`/`update`/`memory` at N=50/50/200,
  64 launches) and still no numbers: the runner refuses to start above load1 10, and this box sits
  in the 30s-50s while device gates run. It wants the separate `bench/` Expo app too, so it belongs
  on the bench host.
- iOS 15.1-16.3 has no `scrollViewDidChangeAdjustedContentInset:` (a protocol requirement cannot
  be answered behind `@available` at this deployment target), so an inset change there rides on
  `NitroUiFormHoldingView.safeAreaInsetsDidChange` — enough for a safe-area-driven inset, which
  is the one measured, and one callback narrower for anything else.
- A row's `marginVertical` is now load-bearing geometry, not spacing taste: the space the
  platform draws between rows and the margin each row takes have to stay equal, and `E7` is the
  case that notices when they do not. Anything that later lets an app set row spacing has to
  re-report it, not style it.

## Fix round 2

Android's `Form` shipped two drawing defects, both in the screenshot this round replaces.
`createOutline` builds at the origin of the scope that asks for it, so one layer-wide canvas painted
every row's container at the layer's top-left corner: a card over each header, nothing behind the
rows. The accessory added a section-relative offset to `Alignment.TopEnd`, which adds it to the far
edge, so no disclosure ever drew. Each row's container is now its own canvas, placed like its press
box, and the accessory aligns `TopStart`. The layer is also *told* the section's box - a host's
content is measured with an unbounded height, where `fillMaxSize` answers "one row tall" (54.1 dp
measured inside a 296.4 dp section). `magick compare`: pixels unchanged. Round 1 blamed stale row
rects; it was wrong, and the comments now say what is known. The frame listener those comments
justified, and a read-back that could not be made red, are gone.

`real-input:ios` would not run: its UI-test bundle had not compiled since this component's check was
added (`formRowPresses` declared twice - `check` never compiles that bundle). Fixed, the gate
reached the Form and failed two of its own checks, both open in Follow-ups.
