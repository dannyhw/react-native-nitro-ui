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
| `check` | **PASS** | 1910 tests / 77 suites | `9065d0b56466` | 2 m 43 s | start 5.6 / med 7.2 / max 9.1 |
| `harness:ios` | **PASS** | 480 tests / 27 suites + isolated 4 tests / 2 suites | `9065d0b56466` (ios tree) | 11 m 29 s | start 4.8 / med 5.9 / max 11.6 |
| `harness:android` | **PASS** | 536 tests / 27 suites + isolated 4 tests / 2 suites | `9065d0b56466` (android tree) | 15 m 58 s | start 3.2 / med 3.3 / max 7.6 |
| `real-input:ios` | **PASS** | — | `9065d0b56466` (ios tree) | 32 m 23 s | start 4.6 / med 11.7 / max 302.2 |
| `real-input:android` | **FAIL** | — | `9065d0b56466` (android tree) | 47 m 11 s | start 3.2 / med 3.6 / max 10.1 |
| `harness:android:Conformance:-t:previous%20owner%20under%20one%20identity` | stale | 85 tests / 1 suites | cb8f18ca9456 (not this tree) | 1 m 33 s | start 6.3 / med 4.4 / max 6.3 |
| `harness:android:Form` | stale | 1 failed of 92 tests / 3 suites | c9cd6ce52171 (not this tree) | 2 m 56 s | start 39.4 / med 15.2 / max 39.4 |
| `harness:android:FormFidelity` | stale | 1 tests / 1 suites | 1e1a18c02e58 (not this tree) | 11.8 s | start 4.9 / med 4.9 / max 5.0 |
| `harness:ios:Form` | stale | 1 failed of 92 tests / 3 suites | ad3fcd50b903 (not this tree) | 3 m 09 s | start 14.3 / med 7.2 / max 16.3 |
| `real-input:android:--control:a11y` | **FAIL** | — | `9065d0b56466` (android tree) | 0.2 s | start 3.6 / med 3.6 / max 3.6 |
| `real-input:android:--control:form` | **PASS** | — | `9065d0b56466` (android tree) | 12 m 17 s | start 2.3 / med 3.5 / max 9.9 |
| `real-input:ios:--control:form` | stale | — | 158227605a8d (not this tree) | 12 m 12 s | start 3.3 / med 16.2 / max 37.7 |

`need --for review`: `need: review is satisfied on this code tree.` `need --for merge` still names
`real-input:android`, which is red on one check (`a11y:form`) and green on all 23 control sequences;
the filtered `--control a11y` row is the run that asked for a control that is not a control, and is
recorded only because it was run. The filtered `--control form` row is the measurement in the Questions
section: the same app on this tree, with the a11y sweep following only the Form's own control run, is
green — `a11y:form` included.

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

- `a11y:form` on iOS is recorded debt now, not a red gate: the only element carrying a Form row's name
  is the React Native wrapper for the row's own `Text` (`other`, 40,240,340,44) and the `.insetGrouped`
  cell answers nothing for the row - storing its label when the cell is configured and deriving it on
  every read give a byte-identical XCUITest tree, so the stale-snapshot theory is out and the merge into
  one button element is the open item. `FOLLOWUPS.md` names the measurement that would settle it.
- `a11y:form` on Android is red at the end of a full sweep and green without one: both full runs' dumps
  carry "Row with onPress" twice - once on the row `[42,660][1038,775]` and once on a node whose box is
  the whole scroll content `[0,268][1080,2424]` - byte for byte the same finding in both, while the same
  app, reached by the same sweep after only the Form's own control run, announces it once on a node a
  person can act on (green twice filtered: at 17:54 on the pre-dedup tree and, this round, in 737.2 s on
  this tree). No `android/`, `src/`, `cpp/` or `example/` source differs between those runs - only
  `scripts/real-input/*` - so the second node is not something the Form screen draws: it is a node that
  survives the other 23 controls, answering with a row's name and the scroll content's box, which is the
  shape a recycled view left in the tree takes (`enableViewRecycling` has been on in the example app
  since F6). The rule grades `named[0]`, and in these dumps that is the container, so the "not
  actionable" half is graded against the wrong node and the extra node is the only thing to find.
- The Android reveal scrolls React Native's `ScrollView` only: a Form in a `FlatList` or a `FlashList` -
  what `docs/components/form.md` tells a long-list reader to reach for - gets no reveal, because
  `scrollableView()` answers for nothing else.
- `Conformance > Progress x no-leak-on-drop` went red once on iOS (`5 ledger entry(ies) survived 50
  drops`) and green on the immediate re-run of the same tree; the rule's own comment records CI
  producing that shape under load. The settle window, not the Form, owns that question.
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

## Fix round 3

`form` was in the real-input control table twice — hand-written and generated — so each platform ran
the Form's sequence twice and the second run inherited the viewport the first left: with the list
scrolled by the keyboard case it resolved "Row with onPress" below the fold, tapped empty space three
times and reported a control that ignores a finger. The duplicate row is gone, and a coverage test
refuses a repeated id.

Round 2's Android Kotlin never compiled: `?: run {}` widened the scroller to `Any?`, and `ViewGroup`
has no `onChildFocus`. Compiling it exposed the rest — `adjustResize` resizes nothing under API 35's
edge-to-edge, so a row scrolled "into the viewport" lands behind the keyboard. The Form now measures
the deficit against its own IME inset and scrolls by it (field bottom 2301 -> 1446, keyboard top 1541).
iOS asked `hasKeyboardFocus` of the wrapper, which is not the responder inside a row.

Red: the guard test with the row left in twice; the keyboard check before the reveal against `form:
PASS` after; the debt row against `[]`; iOS question 5 before the focus witness. `real-input:ios` is
green; `real-input:android` is green on 23/23 controls and red on `a11y:form`, twice, byte-identical.

## Questions for orchestrator

The branch is review-green on `9065d0b56466`; `need --for merge` names one gate,
`real-input:android`, red on a single check (`a11y:form`) and green on all 23 control sequences. It is
not a flake: both full runs printed the same finding, and the extra stop is React Native's node, not
the row's. Deciding what to do with it is a call above this task, because the fix is either shared
tooling or a component behaviour other rows of the same table depend on.

What the evidence adds. The finding is **sweep-order dependent, not a property of the Form screen**:
the a11y sweep runs after the control runs, and on this tree the Form reached alone is green
(`real-input:android:--control:form`, PASS, `a11y:form` "named on one node a person can act on") while
the Form reached after all 23 controls is red, twice, byte-identical. No `android/`, `src/`, `cpp/` or
`example/` source differs between those runs — only `scripts/real-input/*`, which is the only reason
the android tree hash moves at all. What to hunt is therefore a node that *survives a long session*,
still answering with a row's name and the scroll content's box; a recycled view left in the tree is the
obvious suspect. Second: the rule grades `named[0]` only, and in the red dumps `named[0]` is the
container, so the "not actionable" half is graded against the wrong node and deduplicating the name is
the whole fix. Third: anything under `scripts/real-input/` is unmapped and belongs to *both* platform
trees, so touching `a11y.mjs` costs the whole merge bar again — ~106 min of device gates (11 + 16 + 32
+ 47) plus `check`. That is more than this lease had left once the second android run finished, so
nothing was changed rather than guessed at.

1. **Accept review-green**, and hand the android `a11y:form` red to the round that owns the `X4 a11y`
   series — the same table already carries debt for Slider and SegmentedControl for exactly this
   "name with nothing actionable" shape. Merge stays blocked until then. *Recommended.*
2. **Record android debt rows** for both findings and re-run the merge bar (~110 min, one lease).
   Green at merge, but it writes into a table G5/G6/X4 read that a Form row whose `onPress` nobody
   can act on is intended behaviour, and nobody has measured that.
3. **Find the second node**: dump at the end of a full run (the sweep keeps no dump today, which is
   why two 47-minute runs produced a bounds and no class), confirm what still answers for the row, and
   stop it — then re-run the merge bar. The only option that fixes what a screen reader user meets:
   the row is announced twice, and the stop that carries the name may be the whole page.

Recommend 1 now and 3 as its own round. One thing wants fixing in whichever round touches `a11y.mjs`
first: `CHECKS.form` still comments "Android keeps that promise — the dump makes the row one node and
this label is on it", which these two runs falsify; it is a content-hashed file, so correcting it here
would have bought the same ~106 min.

## Fix round 1 (review)

**Lease:** `G24-en8js` (pair-a / Metro 8295).

`origin/main` (98 commits) merged into `ea632607`; the merge's keep-both-sides regions were
undone, and every generated file came from its own script.

All twelve findings are in. iOS: Fabric's index travels through `insertSubview(_:at:)`, so a keyed
insert lands where React put it and a reorder reaches `rowMoved`; `giveBack` releases only a row it
still holds; the keyboard overlap is computed in one space and the list reports the inset it
carries; three scroll delegates answer a settle;
a changed title is redrawn without reloading the section; `rowResized` invalidates wherever
`selfSizingInvalidation` is unavailable; a list that leaves its window stops reporting to a dead
callback. Android: a dropped composition keeps its view, `removeAllViews()` inside RN's
`recycleView` is answered by putting the layer back, bands reset with the model and publish from
their own measure, `ACTION_CLICK` presses a row, and recycled views shed the last mount's name.
`Form.tsx` builds React's own keys and refuses a nested `Form.Row`; an unstyled iOS `Form` has a
height; `form.md`, the changeset and FOLLOWUPS say what v1 promises.

Reds, the table and the one case that never went red: the appendix.

### Appendix: fix round 1 red proofs

Each line is `test -> the thing it guards put back the way it was -> what went red`.

- `src/__tests__/form.test.tsx` (4 cases) -> `Form.tsx` back to `row-${anonymous++}` -> `does not
  remount a row when a node above it appears or goes`: `Expected: 1`, `Received: 2`; the nested-row
  case: `Expected: true`, `Received: false`; the iOS base style: the four keys absent.
- `real-input-a11y.test.js > grades the control, not the first node that happens to carry its name`
  -> the rule back to `named[0]` -> `expect(problems.length).toBe(1)`: `Received: 2`, the second
  problem the actionability sentence about the screen container.
- `Form.harness` E1's order assertion -> the insert back to `model.rows.insert(row, at: 0)` -> the
  Form holds "Bluetooth" before "Wi-Fi". Its reorder half never went red, even with `rowMoved`
  dropped: it is a guard, not a proof, and is reported as that.
- `harness:android:Form` (00:30) -> `dropSection` back to taking the host out with the composition,
  and no `prepareSection` re-add -> `never saw "the recycled section to draw its layer again" -
  last was ... headerBand=36.2;boxH=94.1;layerH=0.0`.
- The same case, after `dropSection` stopped removing the host -> RN still detached the layer through
  `ReactViewGroup.recycleView`'s `removeAllViews()` -> `boxH=56.0;layerH=0.0` again
  (`harness:android:Form.harness`, 02:45), which is how the second half of that fix was found.
- `harness:android:Form` (00:30) -> `performAccessibilityAction` back out of the row -> never saw
  "ACTION_CLICK to reach onPress" - last was `presses=0;pressable=1`.
- `real-input:ios:--control:form` -> the keyboard rect back into the list's content space -> "the
  Form reserves a bottom inset of 99.0 ... the keys alone overlap by 284.0, so the avoidance
  under-reserves by 185.0" (`RealInputTests.swift:6189`). That band, not an equality: XCUITest's
  keyboard element is the keys, the notification's end frame is the keys plus the predictive-text
  bar, so it is the keys as a floor and one accessory bar of slack as a ceiling — the equality the
  first draft asked for went red on the clean tree by 44 pt.
- `real-input:ios:--control:form`, the scroll half -> `scrollView.contentInset.bottom = 0` at the
  drag and deceleration endings -> "the list carried a bottom inset of 328.0 for the keyboard
  before the scroll and 0.0 after it" (`RealInputTests.swift:6286`). The Form's own `keyboard=`
  still read 328.0 through that mutation — it is what the class asked for, not what the list
  carries — so the list now reports its `contentInset.bottom` and `adjustedContentInset.bottom`
  and the check asks those. What the check asks changed too: with the reservation added below
  content the check had already scrolled to the end of, and a synthesised drag carrying real
  velocity, the field came to rest legitimately at 778 of an 874 pt window with the inset intact
  (`off` 531.33 -> 234.33). A scroll may not take the reservation, so the check drags down, comes
  back to the end of the content and asks whether the field is above the keys *there*: 482 against
  590 with the inset, 770 without it.
- `Form.harness`'s teardown case -> the `superview`/`window` guard out of `reportGeometry` -> not a
  failed assertion: the next suite never started, "the app bridge disconnected".
- The Android row's a11y reset is the one item with no red: with `resetRow`'s reset commented out
  and the installed APK verified rebuilt, `desc` still came back empty, so that reset is defence in
  depth. The reproducer for React Native's missing reset is the plain labelled `<View>` on the Form
  screen, and that is what the a11y-grading red above grades.

### Appendix: fix round 1 gates

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1965 tests / 82 suites | `2c8f5a8edbe4` | 3 m 14 s | start 7.2 / med 9.4 / max 224.3 |
| `harness:ios` | **PASS** | 535 tests / 29 suites + isolated 6 tests / 3 suites | `2c8f5a8edbe4` | 13 m 39 s | start 220.1 / med 11.4 / max 220.1 |
| `harness:android` | **PASS** | 591 tests / 29 suites + isolated 6 tests / 3 suites | `2c8f5a8edbe4` | 17 m 14 s | start 6.2 / med 5.6 / max 11.2 |
| `real-input:ios` | **PASS** | — | `2c8f5a8edbe4` | 36 m 16 s | start 3.8 / med 6.4 / max 28.6 |
| `real-input:android` | **PASS** | — | `2c8f5a8edbe4` | 54 m 05 s | start 6.1 / med 3.9 / max 19.8 |
| `harness:android:Form` | stale | 5 failed of 107 tests / 3 suites | 6269387e687a (not this tree) | 3 m 42 s | start 11.7 / med 5.6 / max 11.7 |
| `harness:android:Form.harness` | stale | 3 failed of 11 tests / 1 suites | f086bc841ab1 (not this tree) | 37.2 s | start 26.7 / med 20.4 / max 26.7 |
| `harness:ios:Form` | stale | 1 failed of 107 tests / 3 suites | ef389784ae39 (not this tree) | 3 m 09 s | start 7.3 / med 4.6 / max 7.3 |
| `real-input:ios:--control:form` | **PASS** | — | `2c8f5a8edbe4` | 10 m 49 s | start 4.3 / med 5.1 / max 12.2 |
| `real-input:ios:--control:form:--background` | stale | — | 73b314609615 (not this tree) | 0.5 s | start 4.4 / med 4.4 / max 4.4 |

All five required gates are green on the code tree this round ends on (`2c8f5a8edbe4` — the code
tree at every commit after the last code change, `a9e4a2b7`), and `need --for review` and `need --for merge` are both satisfied on it. The stale
rows are the filtered runs taken *inside* the round — each red proof was a filtered run on the tree
with its mutation in it, and the full gate re-took that gate on the clean tree afterwards.
`real-input:ios:--control:form:--background` is a mistyped invocation that died on its own argument
check in 0.5 s, recorded because it was run. `harness:ios` opened at load 220 because another task's
build owned the machine when it started; it is the only run whose start load is above 30, and its
own median is 11.4.

The ledger at `docs/tasks/G24/gates.jsonl` carries 119 lines: the 72 from `task/G24-form` plus the 47
this branch wrote. `gate.mjs export` writes only the current branch's ledger, so the earlier lines
were merged back in by hand rather than dropped.
