# G20 — ButtonGroup

**Branch:** `task/G20-button-group` (from `main` at `bd6a3f6c`) · **Round:** 2 of up to 3 (D19) ·
**Lease:** `G20-d5vr8` (pair-a: iPhone 17 iOS 27.0 / `emulator-5574` / Metro `8295`); round 1
ran on `G20-3ylcl`, the same pair

## Summary

`ButtonGroup` ships: a row of commands (`Copy | Paste | Share`) that can hold independent
toggles and moves whatever the box cannot fit into an overflow menu. Items are data
(`id`, `title`, `systemImage`, `androidIcon`, `disabled`, `toggle`, `checked`,
`defaultChecked`); `appearance: 'standard' | 'connected'`; size and variant come from the
shared ladder; `onPress(id)` and `onCheckedChange(id, checked)` — the toggle half on the
event-count handshake, with one counter for the group and per-item controlled-ness. Registry
entry, conformance fixture, stories, a screen, `docs/components/button-group.md`, the README
row/import/Usage, both screenshots and a minor changeset are in.

**Android** is Material 3's `ButtonGroup` with `customItem` — `clickableItem`/`toggleableItem`
hard-code a filled button and could not carry `variant`, `size` or `tintColor`. Overflow, its
indicator and its menu are Material's own. **iOS** is a row of bordered controls, or
`ControlGroup` for `connected`; `ControlGroup` ignores `.controlSize`, `.tint` and
`.buttonStyle` and draws no on state for a `Toggle`, so a connected iOS group with a toggle
in it falls back to the standard row (D42 item 2). Overflow on iOS is a `ViewThatFits` over
"all items, then k items + a `Menu`", decided at the width the row is actually given — the
control is `fillWidth` on both platforms, because overflow can only be decided at the box.

Two decisions a reviewer should see before the diff. **The row reports its own placement:**
which items overflowed lives in Material's private overflow state and inside SwiftUI's
`ViewThatFits` choice, so neither can be asked; the row stamps visible/overflow/shown as it
lays out (`nuiTestProbeRow`), and the probe forces a layout pass before answering so a
recycled host cannot answer "nothing" about a row that is on screen. **D29 on iOS is
structural**: a disabled group composes no overflow control at all (Android dismisses its own
window), so iOS's `menu=` field answers whether the control is composed — and the placement
witness now records what was *composed*, not what the candidate asked for.

Fix round 1 found and fixed five red probes and one accessibility defect: a recorder that dropped
the checked flag (so a conformance expectation could never match), three probe fixtures that
asserted things the fixtures do not do, and an overflow control whose label concatenated with
Material's own — TalkBack read "More More options", which `docs/components/button-group.md`
never claimed. All five gates below are on one code tree.

## API

Compact form of `docs/components/button-group.md`: `items`, `appearance`, `variant`, `size`,
`labelStyle`, `disabled`, `tintColor`, `overflowAccessibilityLabel`, `accessibilityLabel`,
`onPress`, `onCheckedChange`, plus `testID`/`style`. Items carry `id`, `title`, `systemImage`
(iOS), `androidIcon` (Android), `disabled`, `toggle`, `checked` (`null` = uncontrolled) and
`defaultChecked`. Methods: `measureContent()`, `nuiTestPressItem(id)`, `nuiTestProbeRow()`,
`nuiTestProbeAccessibility()`, `nuiTestStateReport()`.

## Early checks (Q9 Appendix D)

1. **`ControlGroup` probe** — joined row, 31 pt for three items; it ignores `.controlSize`
   (stays 31 pt at every rung), `.tint` (`.tint(.red)` leaves the probe row at 174.00 × 31.00)
   and `.buttonStyle`; six plain buttons measure 396 pt of content inside a 369 pt box and
   draw outside it. So `connected` takes its look from `ControlGroup` and nothing else.
   The brief also asked for this on **iOS 26.5 and 27.1**, as shots under `docs/tasks/G20/`.
   **Not done:** the runtime simulators (`lease.mjs acquire --ios-runtime 26.5`) were never
   free — this task's gates held its pair, then the pool's two slots went to other tasks, and
   the queued acquire at the end of the round timed out. Every number above is iOS 27.0's, and
   `docs/components/button-group.md` now reads "Not checked" there instead of claiming
   photographs. See Questions.
2. **`.labelStyle(.titleAndIcon)` inside `ControlGroup`** — drops the titles (116.33 pt of
   icons where the text should be), which is why `labelStyle` on a connected iOS group is
   icons-only and `automatic` resolves to titles outside it.
3. **Material's overflow `DropdownMenu` under the theme this library ships** — it opens, and
   a real injected tap on a row inside it reports: `real-input:android` on the example app,
   `ButtonGroup.harness.tsx` in the plain host. The theme is the one every Compose surface of
   this library gets — `MaterialExpressiveTheme` at
   `android/src/main/java/com/margelo/nitro/nitroui/core/NitroComposeHost.kt:1483` — and the
   row's own `DropdownMenu` is the popup E2 already owns, so no second popup path was built.
   The brief's "photograph it" was not captured, and no suite puts a `ButtonGroup` inside a
   shared `<Host>`, so those two rest on the code path rather than on a run: Follow-ups.
4. **Under `NitroUiMeasuredRoot`** — `fillWidth` gives a stable height (34.33 pt for three
   action items, measured; the box in the harness reads 34.33) and one `measure()` per pass;
   a press's `animateWidth` moves the item, not the box.

## Gates

Round 2's table: the five required gates are green on the tree this report is handed in at
(`478658ef7419`, HEAD `e9feb5e`), so it replaces round 1's instead of sitting beside it. The
rows whose code tree is not this one print `stale`: they are the filtered probe runs
(`--control:button-group`, `G20probe`) from earlier rounds, and they satisfy nothing. The
green filtered row is a 9-minute look at this control alone; the full `real-input:ios` row
is the suite.

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1945 tests / 81 suites | `478658ef7419` | 3 m 09 s | start 32.0 / med 28.7 / max 46.0 |
| `harness:ios` | **PASS** | 531 tests / 28 suites + isolated 6 tests / 3 suites | `478658ef7419` (ios tree) | 13 m 49 s | start 6.2 / med 15.1 / max 108.2 |
| `harness:android` | **PASS** | 587 tests / 28 suites + isolated 6 tests / 3 suites | `478658ef7419` (android tree) | 17 m 24 s | start 9.5 / med 6.1 / max 26.8 |
| `real-input:ios` | **PASS** | — | `478658ef7419` (ios tree) | 33 m 30 s | start 3.9 / med 5.4 / max 14.1 |
| `real-input:android` | **PASS** | — | `478658ef7419` (android tree) | 55 m 40 s | start 92.8 / med 5.9 / max 92.8 |
| `harness:android:ButtonGroup` | stale | 8 tests / 1 suites | ee221b7d7c04 (not this tree) | 18.0 s | start 7.5 / med 6.7 / max 7.5 |
| `harness:android:ButtonGroup:Conformance` | stale | 2 failed of 103 tests / 2 suites | bd1832fc2325 (not this tree) | 3 m 24 s | start 7.6 / med 3.6 / max 7.6 |
| `harness:ios:ButtonGroup` | stale | 8 tests / 1 suites | bd1832fc2325 (not this tree) | 18.5 s | start 9.5 / med 8.6 / max 9.5 |
| `harness:ios:ButtonGroup:Conformance` | stale | 3 failed of 103 tests / 2 suites | cf6ce0348685 (not this tree) | 3 m 28 s | start 5.6 / med 7.2 / max 19.0 |
| `harness:ios:G20probe` | stale | 3 failed of 3 tests / 1 suites | cba3dec213ac (not this tree) | 16.3 s | start 4.9 / med 5.1 / max 5.1 |
| `real-input:android:--control:button-group` | **FAIL** | — | `6727b487c9ab` (android tree) | 0.5 s | start 5.3 / med 5.3 / max 5.3 |
| `real-input:ios:--control:button-group` | **PASS** | — | `478658ef7419` (ios tree) | 9 m 18 s | start 3.6 / med 6.4 / max 17.1 |

`need --for review`: `need: review is satisfied on this code tree.` — and so is
`need --for merge`, which asks for the same five gates with both platforms' real-input runs.

## Red proofs

- `Conformance.harness.tsx › ButtonGroup recycle probe` -> `recordRecycle` takes one value, so
  a ButtonGroup event recorded `id` and never `id:false` -> `reads conformance-button-group:bold
  where the props say conformance-button-group:bold:false`.
- `ButtonGroup.harness.tsx › names every item kind` -> `label=More More options` before
  `clearAndSetSemantics` on the overflow indicator (Material's "More options" concatenated with
  ours) -> `expected 'nodes=3;…2[Button,none,disabled=false,label=More More options]' to
  contain ',label=More]'`.
- `ButtonGroup.harness.tsx › takes some back when it grows` -> the row answered the last layout
  the host happened to do, and a probe that only reads that record cannot see a new width ->
  `widening the well from 220 pt brought no more of the 6 items into the row - the row reports
  "…visible=2;overflow=1;shown=day,week…"`; green after `nuiTestProbeRow` lays the row out
  first (`visible=4;shown=day,week,month,quarter`).
- `ButtonGroup.harness.tsx › carries no items … across a remount` -> the fixture pressed an
  *action* item and expected a flip -> `expected events ["bg-recycle:check:month:true"], saw []`.
- `ButtonGroup.harness.tsx › seeds an uncontrolled item once` -> the second `render()` is a
  second mount, which *should* seed -> `expected 'checked=bold;…' to contain 'checked=none'`;
  the claim is about a re-render, so the fixture now uses `rerender`.
- `ButtonGroup.harness.tsx › default row at the size it measured` -> `waitForBox` compared the
  box to `measureContent()` and the two disagree on width by design (iOS answers the box's
  width, Android the content's: 411.43 vs 214.10) -> `testID "bg-default" … never reached
  214.10x48.00 - last box 411.43x48.00`; it now waits on the height, which is the measured half.
- `real-input:android` (full run, tree `2b0145a1`) -> the item read through the node
  that carries its title -> `✗ the item publishes its own checked state — expected on,
  saw null`, and four more lines the same way, all five from one cause.
- `real-input:android` / `real-input:ios` -> the barrier tap aimed at the actions row's
  counter -> `the barrier tap beside the disabled item: 3 real taps left
  button-group-presses at "3" rather than "4"`, and on iOS `tap 3/3 left "Copy" in
  real-input-button-group-disabled-item at "3"`.
- `real-input:ios:--control button-group` -> pressing the group's own `testID` to open
  the overflow -> `3 real presses on the overflow control
  (real-input-button-group-overflow) left it at "0 row(s) named \"Quarter\""`.
- `real-input-android-tree.test.js › answers the item, not the title, the decoration or
  the row` -> `tightestFlaggedNode` told to take the loosest container (`area >
  tightest.area`) -> the `toBe` names the row's clickable decoy `[189,947][891,1073]`
  where the item's own box is `[189,948][421,1073]`; its sibling `carries the disabled
  answer out of the item` goes `Expected: "false" / Received: "true"`.
- No mutation was run against the sizing poison, the handshake or the recycling reset beyond
  the failures above — those fixtures were written in round 1 and their own red proofs did not
  survive into this round's ledger.

## Files changed

- `src/components/ButtonGroup/*`, `ios/components/ButtonGroup/*`,
  `android/src/main/java/com/margelo/nitro/nitroui/HybridNitroUiButtonGroup.kt` — the control;
  fix round 1's native changes are the placement witness (`overflow:` = what was composed) and the
  probe's layout pass, and the Kotlin change is the overflow indicator's `clearAndSetSemantics`.
- `example/__tests__/ButtonGroup.harness.tsx`, `example/__tests__/Conformance.harness.tsx` —
  the six fixtures above, plus `waitForBoxHeight` and probe-answered waits.
- `example/src/ButtonGroupScreen.tsx`, `example/src/stories/ButtonGroup.stories.tsx` — screen
  and registered stories.
- `docs/components/button-group.md`, `README.md`, `docs/images/components/button-group-*.png`,
  `.changeset/g20-button-group.md` — the docs page, the README row, the pair, the changeset.
- `scripts/real-input/android.mjs`, `scripts/real-input/android-tree.mjs`,
  `scripts/__tests__/real-input-android-tree.test.js`,
  `example/ios/NitroUiExampleUITests/RealInputTests.swift` — the real-input checks for
  the control, and the container rule they share (fix round 2).
- `bench/src/*` — `mount.button-group` against RN `Pressable`s and @expo/ui's equivalent.

## Bench

Not run in this round: `bun run bench -- --mount button-group` needs the bench host's device
pair, which the gate chain held for the whole round. `need --for review` does not require
benches, so the numbers are an explicit gap rather than a claim.

## Fix round 2

Round 1's five probes are green on device; `real-input` then went red on both platforms.
Every failure was the check reading the wrong node or the wrong counter, and a dump of
the running app settled each one:

- **an item was read through its title.** Material merges the row: each item is its own
  box, the title a separate `TextView`, the role a third node. The title's node says
  `checkable=false enabled=true` whatever the item is, so a checked toggle read as
  unchecked and a disabled item as enabled. The search now resolves a title to the box
  containing it — `nativeChecked`'s rule for Switch and Chip, now one shared
  `tightestFlaggedNode`, the dump as its unit fixture.
- **the barrier tap watched the wrong counter** on both platforms: the half-disabled
  group reports into the disabled pair's own counter — the reason that counter exists —
  so three real taps left it at 3, iOS and Android alike.
- **iOS pressed the group to open the overflow.** On a `fillWidth` row the container's
  centre is an ordinary item; the step now presses `overflowAccessibilityLabel`.

The **Gates** table is this round's: `478658ef7419`, `need --for review` and
`need --for merge` both satisfied.

## Follow-ups

- bench: `mount.button-group` numbers by merge mint are still unmeasured (command above).
- `ButtonGroup.harness.tsx`: six long titles do not fit a phone's 402 pt box, so "all items
  fit" is asserted with a three-item group — a wider fixture would need a tablet-width box.
- `docs/components/button-group.md`: on iOS a disabled group fits *more* items than an enabled
  one (the dropped menu frees the space) — documented as a consequence of the D29 shape, but
  worth a line of its own in the table.
- `labelStyle='iconOnly'` on a connected iOS group is icons-only because of check 2; if Apple
  ever honours `.labelStyle` there, the fallback can go.
- check 3: no photograph of Material's overflow is in the tree, and no suite puts a
  `ButtonGroup` under a shared `<Host>` — one harness fixture, or one shot on any leased
  emulator, closes both.
- check 1: the iOS 26.5 / 27.1 half — see Questions; one `--ios-runtime` lease and two shots.

## Questions for orchestrator

Nothing blocks review: all five gates are green on this tree. One thing is still owed by the
brief and it is small — **half of early check 1**, the iOS 26.5 / 27.1 look at the connected
row. The page now reads "Not checked" for those runtimes, which is honest but weak:
`ControlGroup` is the one thing on it Apple has changed before, and the brief said to probe
rather than read a release note.

- (a) Take it on the next iOS-only lease: `node scripts/lease.mjs acquire --task <id>
  --ios-runtime 26.5 --boot`, install the Debug example app, point `RCT_jsLocation` at that
  lease's Metro port, screenshot the `connected` row under **Appearance** on the Groups tab,
  and read its box out of the same accessibility tree — 31 pt and grey on 26.5 lets the page
  say so. Ten minutes per runtime; `gate.mjs` correctly refuses a *gate* there, so it stays a
  look check.
- (b) Leave it: the page says "Not checked", and whoever next touches `connected` on iOS pays
  the same ten minutes.

**Recommend (a).** I queued for that lease at the end of this round; both pool slots were held
(`G21`, and `G24` on the pair this task released, with a 4 h TTL), so it did not happen here.
Whoever takes it is on an iOS-only lease, and the Android half of check 3 — one shot of the
overflow menu open, which needs only an ordinary emulator — is worth taking in the same pass.

## Fix round 1 (review)

Nine items, all taken. iOS decides `ControlGroup` once for the group in `body`
(`ios/components/ButtonGroup/HybridNitroUiButtonGroup.swift:408`), so the width a row wins
cannot also decide the row it draws; the witness now says which row it got
(`row=controlGroup|standard`). An Android `iconOnly` item with no glyph draws its title with
symmetric padding, and the a11y probe reports `text=` and `desc=` apart, which is what makes
that visible. The overflow control keeps Material's localised "More options" unless
`overflowAccessibilityLabel` names it, and the label is `mutableStateOf` + `markDirty()`, so
words changed after mount reach the row; comments, changeset and docs table follow. iOS's
`stateReport()` reads only strings published under `reportLock` — **that race could not be
made to fail reliably**: no mutation turned it red, so it is fixed by construction.
Disabled-closes-menu and seeds-once are now proved: Android opens Material's menu before
`disabled` arrives, and the re-render adds an item. Early check 1 stands — `connected` reads
31.00 pt as a `UISegmentedControl` and `standard` 34.67 pt, identically on 26.5, 27.0 and
27.1 (shots in `docs/tasks/G20/`; iOS-only leases `G20-udnz5`, `G20-usy3e`, `G20-v5om7`, so
`gate.mjs` rightly refused a gate there and it stayed a look check).

### Gate table (fix round 1)

| Gate | Result | Counts | Code tree | Duration | Load |
| --- | --- | --- | --- | --- | --- |
| `check` | **PASS** | 1945 tests / 81 suites | `6be475dbe11d` | 2 m 46 s | start 19.9 / med 11.1 / max 19.9 |
| `harness:ios` | **PASS** | 532 tests / 28 suites + isolated 6 tests / 3 suites | `6be475dbe11d` (ios tree) | 13 m 43 s | start 5.8 / med 6.5 / max 25.9 |
| `harness:android` | **PASS** | 588 tests / 28 suites + isolated 6 tests / 3 suites | `08759de94cdf` (android tree) | 17 m 12 s | start 19.3 / med 8.4 / max 33.1 |
| `real-input:ios` | **PASS** | — | `6be475dbe11d` (ios tree) | 35 m 39 s | start 11.5 / med 8.4 / max 42.0 |
| `real-input:android` | **PASS** | — | `6be475dbe11d` (android tree) | 53 m 19 s | start 3.9 / med 5.2 / max 13.1 |

`need --for review` exits 0 on this tree. The table also lists nine stale filtered or
mutation runs from this round's red proofs; they satisfy nothing.

### Red proofs (fix round 1)

- `ButtonGroup.harness › seeds an uncontrolled item once` -> `applyDefaults` ignoring `seeded` -> `expected 'checked=bold;visible=none;…' to contain 'checked=none'`
- `… › takes nothing from a disabled group … and closes an open menu` -> drop `menuState?.dismiss()` in `afterUpdate` -> `menu="open" (expected "closed" on this platform)`
- `… › names every item kind, and an icon-only item by its title` -> re-add the hard-coded `"More"` -> `expected 'nodes=7;0[Button,none,disabled=false,…' to contain 'More options'`
- same test -> `buttonGlyphDrawsTitle` -> `glyph != ButtonGlyph.IconOnly` -> `expected 'nodes=4;…' to match /text=Paste,desc=none/`
- same test -> drop the item's `contentDescription` -> `expected 'nodes=4;…' to match /text=none,desc=Copy/`
- `… › lays the default row out at the size it measured` -> remove `NitroUiSizing.report(…)` in `NitroComposeHost` -> `never reached height 48.00 - last box 411.43x99.05, control measured 214.10x48.00`
- `… › carries no items, checked state or event count across a remount` -> sizing policy `fillWidth` -> `intrinsic` -> `expected '0' to be '1'`
- `… › keeps one row when the trailing toggle … overflows` -> the row decision back at the `ViewThatFits` call site -> `expected 'controlGroup' to be 'standard'`
- `… › moves the items a 220-point well cannot hold` -> draw every item, no `ViewThatFits` -> `expected 6 to be less than 6`
- sizing key drops `androidIcon` (round 0's proof, still the guard) -> key mismatch; `ButtonGroupModelTest` event-count guard -> `ButtonGroupModelTest.kt:75`; `seeded.add(id)` -> `id.isNotEmpty()` -> `:129`
- `testRealInputPopover` (G22's fixture, not this control's) -> one `typeText("ab")` for two keystrokes -> `typed:a` and never `typed:ab`, red in three full `real-input:ios` runs (load1 medians 6.5-9.1) and green typed one character at a time, which is what the tree now does
- iOS `stateReport()` race -> no mutation: it cannot be made to fail reliably; fixed by publishing `checkedReport` under `reportLock` instead
