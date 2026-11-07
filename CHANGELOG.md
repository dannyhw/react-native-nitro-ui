# Changelog

All notable changes to this project are documented here, newest version first.
Version numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`0.1.0` below was written by hand. Every entry above it is written by Changesets
out of the release notes contributors record with `bun run changeset`, grouped
under the bump each change asked for: `### Major Changes`, `### Minor Changes`,
`### Patch Changes`.

## 0.8.0

### Minor Changes

- 5f5c2e5: Give `Button` a `shape` prop, and take Android's three button-shaped controls onto Material 3 Expressive's own size and shape tokens.

  - **`shape: 'round' | 'square' | null` on `Button`** (default `'round'`, which draws what it drew before; `null` means the same thing). On Android a Button now goes through Material's `shapes: ButtonShapes` overload, so the corner _morphs_ while the button is held: a round one squares off, a square one rounds out. iOS has no cornerless button style, so `square` is the nearest border shape it has — `.roundedRectangle(radius: 8)` — and it is static, because a `ButtonBorderShape` cannot animate. The `text` variant has no container to give a corner, so it ignores `shape` on both platforms and draws the round corner on Android. `Menu`'s trigger is a Button and gets all of this too; its popup is unchanged.
  - **Android `size` is Material's height ladder.** `small` / `medium` / `large` now _select_ one of Material 3's XS / S / M container tokens, and the content padding, label style and corner are read from that height through `ButtonDefaults.contentPaddingFor` / `textStyleFor` / `shapesFor` instead of three hand-rolled tables. `small` therefore selects the XS token's padding, type and corner; it is not a 32 dp box — Material floors the container at its own 40 dp minimum and the box at the 48 dp interactive one, so `small` and `medium` draw the same height and differ in what is inside it. Visible effect: 16 dp less width at `medium`, 19 dp less at `large`, which is 5.7 dp taller.
  - **`SegmentedControl` on Android is a connected button group** — a row spaced by `ButtonGroupDefaults.ConnectedSpaceBetween` whose items rest on Material's own connected leading / middle / trailing corners, and whose width is the sum of its segments rather than n × the widest one — about 27% narrower than the `SingleChoiceSegmentedButtonRow` it replaces, at the same 48 dp height. The API and TalkBack's "1 of 3, selected" are unchanged; the drawing is not. The row has no track: an unselected segment is an outlined item, round at its outside end and cut to 8 dp where it faces a neighbour, and the selected segment takes Material's stadium.
  - **A selected filter chip has its own corner**, via Material's `shapes: ChipShapes` overload; filter chips measure 3.81 dp narrower at both states than before, by a constant, so a chip still grows by exactly its check mark when selected.

- bcf42b2: Make `Menu`'s `primaryAction` work on Android, where it used to be ignored.

  - **`primaryAction` is no longer iOS-only.** On iOS nothing changed: the trigger stays one button, a tap runs the action and a long-press opens the list. On Android the trigger becomes Material 3 Expressive's split button — the leading half shows the title and runs the action, the trailing half is a chevron that opens the list and whose checked state _is_ the menu's open state, so its inner corner stays morphed while the list is up. A press on the action half never opens the list on either platform, and `disabled` disables both halves and closes an open menu.
  - **The split button takes your variant.** `filled`, `tonal`, `outlined` and `elevated` draw the matching `SplitButtonDefaults` set; `text` has no split set of its own (a split button is two containers and the text variant has none), so it draws the outlined pair, hairline included — a `variant="text"` Menu changes looks the moment a `primaryAction` arrives.
  - **Android is wider, and the sizing key knows.** A second container plus its gap is a wider box, so Menu's configuration gains an `action`/`plain` field and the split configuration is measured as its own. On iOS the same prop costs one extra cache entry and no layout, because there it is a gesture rather than a second half.
  - **Two announcement sites, not one.** The action half is a button named by the title, and the chevron half is a button named "More options" that says expanded or collapsed — the single dropdown node a plain Menu has cannot survive being two controls that do different things.

- 8ed2ff3: Give `Progress` Material 3 Expressive's wave and its morphing loading shape.

  - **`appearance: 'flat' | 'wavy'` on `Progress`** (default `'flat'`, which draws what it drew before). On Android `'wavy'` is `LinearWavyProgressIndicator` / `CircularWavyProgressIndicator`, determinate and indeterminate, at Material's own amplitude, wavelength and speed — a wavy bar is 10 dp thick where the flat one is 4, and a wavy ring is a 48 dp box where the flat one is 40. iOS has no wavy progress indicator, so it stores the prop, answers it back through the handle and draws the flat control; no wave is faked.
  - **`variant: 'loading'`, with `contained: boolean`** (default `false`). Android draws `LoadingIndicator` / `ContainedLoadingIndicator` — the morphing polygon shape, determinate when `value` is set and indeterminate without one — in a 48 dp box around Material's 38 dp shape. iOS draws a circular `ProgressView`, the closest control it has, at the ring's 20 pt. Those two are `@ExperimentalMaterial3ExpressiveApi`, so they sit behind one `@OptIn` on one private composable: the library's only `ExperimentalMaterial3ExpressiveApi` opt-in, and the one place a Material 1.5.0-stable change to them would compile red.
  - **`appearance` does not apply to `variant="loading"`, and `contained` does not apply to a bar or a ring.** The wrapper resolves both before they reach native, so a combination that has no drawing gets neither a pixel nor a cache entry. On the one shape that does have a container, `trackColor` paints the container — which is what the prop means everywhere else.
  - **Each configuration has its own size and its own cache entry.** The sizing key now carries the shape, the appearance and the container (`''`, `'wavy'`, `'circular'`, `'circular|wavy'`, `'loading'`, `'loading|contained'`), so switching `appearance` mid-download re-measures the way switching `variant` always did. `appearance` and `contained` do not remount the native view — only a shape change does — and the recycle reset clears both.

- 110df07: `Button` gains `androidIcon`, and the size ladder gains `xlarge` and `xxlarge`.

  - **`androidIcon` is Android's counterpart to `systemImage`.** `<Button title="Share" systemImage="square.and.arrow.up" androidIcon={require('./icons/share.xml')} />` draws an SF Symbol on iOS and your own vector drawable on Android, with each platform ignoring the other's prop — one call, no `Platform.select`. The glyph is painted with the control's own text colour, so it follows the variant, `disabled` and `tintColor` instead of needing a colour of its own, and it is sized by the size ladder: the same numbers the label beside it is read from. Each file is loaded once per process and shared, so a list of forty rows with the same icon rasterises it once. `docs/components/button.md`, "Android icons", has the file format, where to get Material Symbols, and what each failure looks like.
  - **An icon is a file your app imports.** `androidIcon` takes an Android vector drawable the way `<Image>` takes a picture: `androidIcon={require('./icons/share.xml')}`. Metro carries that file, so there is no setup step to run and no plugin to register — a release build turns the `.xml` into an ordinary drawable resource (named the way React Native files any bundled asset: `src_assets_icons_share_24px` for `src/assets/icons/share.xml`), and a development build has nitro-ui read it from the dev server itself, because React Native deliberately will not serve Android `.xml` assets. That read is off the main thread, parsed into a Compose `ImageVector`, and cached per URL for the process. Nothing is patched along the way: nitro-ui never registers a custom asset transformer, so how your `Image`s resolve their sources is untouched. An app that already ships drawables can keep naming them — `androidIcon="share"` for `res/drawable/share.xml` — and every rule that form has always had still applies.
  - **An icon's size comes from the size ladder, never from the file.** The slot is `iconSizeFor(size)` wide and the label is laid out beside it, both read from the rung that sets the control's height, so the first frame of a development build already has the box: while the file is being read the slot is reserved and empty, the glyph then appears in it, and nothing moves. A `<vector>` drawable is drawn _at_ that size, so the same file is as crisp on `xxlarge`'s 40 dp slot as on `medium`'s 24 dp one; a drawable that is not a vector — a PNG, a layer-list — is drawn as one bitmap in a release build (a development build can only read `<vector>` files from the dev server, so it draws nothing for those). Artwork that cannot be resolved — a name that is not in the resource table, a 404 from the dev server, an imported asset that is a `.png` — draws nothing and reserves nothing, so the control is exactly its no-icon self, and says so once.
  - **`size` now has five rungs.** `xlarge` and `xxlarge` are Material 3's own `LargeContainerHeight` (96 dp) and `ExtraLargeContainerHeight` (136 dp), so the ladder has the five rungs the tokens publish and Material's XS–XL button row is this ladder under other names — `small`=XS, `medium`=S, `large`=M, `xlarge`=L, `xxlarge`=XL. iOS has fewer button sizes than the ladder has rungs, and its two largest draw the same box for these controls, so five rungs are five heights on Android and three on iOS: `large`, `xlarge` and `xxlarge` are one button there (`docs/components/button.md` prints both columns, measured). The three rungs that already existed are unchanged on both platforms.
  - **`Menu`'s trigger takes all of it.** A Menu's trigger is a Button — the same ladder, the same box — so it now has the same `size` rungs and the same `androidIcon`, drawn on the trigger it draws whether that is the plain button or the leading half of a split one. `systemImage` stays iOS's prop, as it was.

### Patch Changes

- e20433d: Android `Slider` fixes.

  - **A touch now reports its start and end.** `onSlidingStart` fires when a finger goes down on the thumb or track, and `onSlidingComplete` when it lifts, even if the value never changed. Before, the start was only reported on the first value change, so a touch that didn't move the thumb reported nothing. A drag reports start, then its value changes, then complete, in that order, as on iOS.
  - **Screen-reader steps no longer jump back.** After a few TalkBack increments in a row, a step could land on an earlier value instead of the next one. Each step now moves on from the value on screen.

- 0dfdb15: Android icons drawn by the library (SearchField's search and clear, the checks in Chip and Menu, and the split button's chevron) now use Google's official Material Symbols; the search icon was drawn wrong.

## 0.7.0

### Minor Changes

- ee359d0: Add `ContextMenu`: a `View` that opens a menu on a long press, with Menu's `group` as its items. On iOS it is a `UIContextMenuInteraction` with the system's lifted preview; on Android a Material 3 `DropdownMenu` opened at the finger. The children stay in place and keep their own gestures, a hold that opens the menu cancels their touch, and `onOpen`/`onClose` fire on both platforms.
- 333e761: Menus on Material 3 Expressive, and two new row props. On Android, `Menu` and `ContextMenu` open Expressive's menu: each section, each submenu and each run of top-level actions is its own rounded group instead of being split by dividers, and `Picker`'s dropdown takes the same container and draws its selected row as selected, with a check. Every menu row (`MenuAction`) gains `subtitle` (a second line: `UIAction.subtitle` on iOS, supporting text on Android) and `checked` (a check: a menu toggle on iOS, a selected row with a leading check on Android). A checked row still reports a pick through `onSelect`; the app flips its own state.
- ee1199c: Add `Checkbox`: Material 3 `Checkbox`, and `TriStateCheckbox` while `indeterminate`, on Android, and SwiftUI `Toggle(isOn:)` with the switch style on iOS — which has no checkbox, so this is what Expo's universal `Checkbox` renders there too. `checked` is a controlled value on Switch's event-count handshake, `defaultChecked` starts an uncontrolled one, and `label` is part of the control and of its size on both platforms, with the whole row tappable. `indeterminate` is a display and Android-only: a press reports the opposite of what the box shows, so a _checked_ third-state box reports `false` and Android callers clear `indeterminate` in `onCheckedChange`, while iOS reads the third state as off and reports `!checked`.
- e883af4: `SearchField`: a search field that is the platform's own — `UISearchTextField` on iOS, Material 3's search input field on Android. One line, the keyboard's Search key, a clear button that appears with the query and takes it out without losing focus, and React Native `TextInput`'s prop names.
- e3d664a: Add `Tooltip`: a tooltip the app opens next to its own views, with a message, an
  optional title and up to two actions. Material 3's `PlainTooltip` / `RichTooltip`
  on Android and a popover with SwiftUI content on iOS. It is controlled
  (`isPresented` / `onIsPresentedChange`), never times out, reports an action
  before the close it causes, and follows its anchor through layout changes and
  scrolls.
- 58fa2b5: Require React Native 0.88 or newer (Expo SDK 58), and draw Android controls with Material 3 Expressive by default.

  - **New floor.** The peer range is now `react-native >= 0.88.0`. On Android the library builds against Compose 1.12 and Material 3 1.5 - `material3:1.5.0-beta02`, a beta - which need your app to compile with `compileSdkVersion` 37 and Android Gradle Plugin 9.1 or newer. New RN 0.88 and Expo SDK 58 apps already compile that way; an app upgraded from an older template that still says `compileSdkVersion = 36` has to raise it to 37. If your app uses Material 3 itself, Gradle resolves it to that beta too.
  - **Material 3 Expressive on Android.** Every Android control and `<Host>` now uses `MaterialExpressiveTheme`, over the same dynamic or default colours as before. Today the visible change is motion: a Switch's thumb, a Checkbox's mark, a menu or a sheet opening move with Material's expressive springs.
  - **`setMaterialTheme('baseline')`** keeps the baseline Material 3 theme instead. Call it once at startup, before the first screen renders; it applies to the whole app, there is no per-control prop, and it does nothing on iOS.

### Patch Changes

- f69a97d: The README is written for app developers: the full benchmark write-up moved to `docs/performance.md`, the consumer smoke-test results to CONTRIBUTING, and the component table now says which release each component shipped in.

## 0.6.0

### Minor Changes

- 19b73e7: Add `BottomSheet`: a modal sheet whose content is React Native, laid out at the sheet's width and mounted only while it is up. iOS presents UIKit's sheet (`UISheetPresentationController`) in the screen's own chain, and from a window of its own when a React Native `Modal` is on top, so closing that `Modal` cannot strand it; Android shows Material 3's `ModalBottomSheet`. Detents use SwiftUI's names (`'fit'` - the default, which follows the content - `'medium'`, `'large'`, `{ height }`, `{ fraction }`); Android's sheet has two rest positions. `isPresented` is controlled through the event-count handshake, `onDetentChange` reports a drag to another detent, and `onDismiss` fires once the sheet has gone.
- c55896e: Add `Chip`, a label-sized control in two kinds. A filter chip has a selection: SwiftUI `Toggle` with the button style on iOS, Material 3 `FilterChip` on Android. Its `selected` is controlled through the event-count handshake, so a toggle the app refuses snaps back, and an uncontrolled chip takes `defaultSelected`. An assist chip is an action: a bordered capsule `Button` on iOS, Material 3 `AssistChip` on Android, with `onPress`. Both measure themselves from their label, take `disabled`, and on iOS can show a leading SF Symbol with `systemImage`.
- d50f27e: Add `TextField`: a single- or multi-line text field with React Native `TextInput`'s prop names, on `UITextField` (a `UITextView` when `multiline`) on iOS and Compose `BasicTextField(TextFieldState)` on Android. The text is controlled through the event-count handshake, a `value` written while an IME composition is open is dropped rather than applied over it, `maxLength` counts UTF-16 code units without splitting an emoji, a multi-line field grows with its text, and `ref` gives `focus()` and `blur()`. `docs/components/text-field.md` lists the props and the platform differences.

### Patch Changes

- 12d3d8c: A `Button` is no longer ever laid out at another `Button`'s width. Its size-configuration key joins four fields with a `|`, and the icon name and title are free-form, so a title containing that character could move the boundary between two fields: an icon named `x|a` with the title `b` and an icon named `x` with the title `a|b` both built one key, and the two buttons have different widths — the second was measured once and then answered from the first one's cache entry for the rest of the process. Both fields are escaped on the way in now (`\` becomes `\\`, `|` becomes `\|`), which is what the `Menu` trigger, `Picker` options and `SegmentedControl` labels already did. Titles and icon names without either character build exactly the key they built before, so nothing that was already correct re-measures.
- 23fefd2: A `Slider` no longer reports `onSlidingComplete` while the finger is still on the track. A screen reader's increment or decrement that arrived mid-drag ran its own start/change/complete triple, and closing that triple is what emits a completion — so the app got a "the user let go" for a thumb it was still holding, the frame pump that drag armed stopped, and the finger's next move opened a second gesture that reported the drag a second time. A step that lands inside a drag is now just another sample of that drag: the value moves at once, its `onValueChange` reaches the app on the drag's next frame like any other, and the gesture's start and completion stay with the finger. A step while nothing is being dragged is unchanged — it still reports all three callbacks, so an app does not have to tell an increment from a release.
- cb7a0d5: The Android `Slider`'s thumb lands on the same stop as iOS's when a stepped range's value sits a hair under the halfway point between two stops. The step count is now rounded on the number itself rather than on that number plus a half: adding the half can round too, and `(0.21 - 0.1) / 0.22` is `0.49999999999999994` — nearer 0 than 1 — while adding a half to it is exactly `1.0`. Android therefore moved the thumb one whole step above where iOS put it, on any range whose step count lands near a tie; a controlled `value={0.21}` on a `0.1…0.54` slider with `step={0.22}` sat on `0.1` on iOS and on `0.32` on Android. A genuine tie still rounds away from zero on both OSes.

## 0.5.0

### Minor Changes

- 5073fb3: Add `AlertDialog` and `ConfirmationDialog`: one native view behind both. iOS presents UIKit's `UIAlertController` (an alert, or an action sheet for a confirmation) from a window of its own, so it works inside and over a React Native `Modal`; Android shows Material 3's `AlertDialog`, and a `ModalBottomSheet` of rows for a confirmation. `isPresented` is controlled through the event-count handshake: every native open or close is reported with `onIsPresentedChange`, a tapped action reports `onAction(id)` before the close, and a dismissal the app refuses presents the dialog again.

## 0.4.3

### Patch Changes

- 5f67844: The Android `inline` / `wheel` `DatePicker`'s calendar is no longer clipped inside a box narrower than 360 dp. Its seven weekday columns used to be laid out unevenly there, so the ones on the right lost width and the day's own highlight drew over its neighbour; all seven are equal now. In a box narrower than 360 dp the calendar lays its grid out at 40 dp touch targets instead of Material's 48 dp, which is what lets them fit; the month's previous/next buttons and the year toggle shrink with it. 40 dp is above WCAG 2.2 AA's 24 px minimum and below Material's recommended 48 dp, so a squeezed calendar is smaller to tap than a roomy one, and nothing is lost at widths where 48 dp already fitted — a calendar 360 dp or wider is unchanged. A box narrower than 304 dp is still too small for a week's worth of days and is not made to pretend otherwise. `compact` is unchanged: its dialog is a window laid out at Material's 360 dp.
- b7693b0: The Android `Menu`'s list is now as wide as its items need instead of as wide as the trigger. Every row used to be measured against the button's width, so a label longer than the title lost its tail — the README screenshot rendered "AirDrop" as "AirDr". The list keeps Material's own sizing, so it is no narrower than its 112 dp floor and no wider than the 280 dp a row's content caps at, and a long group title is shortened with an ellipsis rather than stretching the list past that. Short items still get the 112 dp floor, and the list stays aligned with the trigger's start edge, so it still opens under its trigger.
- 5be8e1e: The iOS `Menu` now draws the rows of a section that has no `title`. Such a section was rendered as a SwiftUI `Section` with a `Divider()` header, and SwiftUI built that as an empty group, so every row in it (a destructive "Delete" under a bare divider, say) was missing from the menu on iOS while Android showed it. An untitled section is now a `Section` with no header: its rows appear, in their own group, set off from the rows above by the system's separator. Android is unchanged.

## 0.4.2

### Patch Changes

- c9df6a0: The iOS `DatePicker`'s declared fallback is now **107 × 36.33 pt** instead of 103 × 36.33, so a first `compact` `date` mount in `en_US` — and in most locales that write a date as `M/D/YYYY` — is laid out at its own size and costs no correction. The `compact` field's width is the widest string the _locale's_ date formatter produces, so the 103 that was declared is what the control measures under `en_PT`; in `en_US` the same control is 107 wide, which meant every cold mount was 4 pt narrow for a frame and then paid a horizontal correction to get it back. The height never moves with the locale and is unchanged. A locale _narrower_ than `en_US` now has the 4 pt of dead padding for one frame instead (no locale has been measured narrower than 103 wide), and `mode = "time"` is unaffected: it has its own sizing key either way.
- 5ac18ce: Fixed a per-instance memory leak that a scrolling or churning list hit once per dropped control, and two ways a control could be left at the wrong size. A dropped view whose size correction was still on its way, and a control whose mount was abandoned after it had been laid out, both left a record behind that nothing ever reclaimed — one per occurrence, for the life of the process, on top of showing up in `sizingStats()`.

  Also fixed: hiding a control with `display: none` and showing it again could leave it unable to accept a size correction for the rest of its life, so a later `sizingKey` or font-scale change had no effect on it. A long list's first frame, and a commit that re-showes more controls than before, are likewise no longer a case where some controls keep the guessed size instead of being corrected.

## 0.4.1

### Patch Changes

- d6c7b0d: Fix a recycled `DatePicker` keeping the previous owner's sizing policy on Android, which stretched a `compact` field to its parent's width. An app reached it by unmounting an `inline` (or `wheel`) picker and mounting a field afterwards in the same screen, with React Native's view recycling on.
- 45efa77: Android: a control whose view was unmounted no longer measures or lays itself out until it is attached for a new mount. Before this, a control that was dropped while still attached could answer a measure by building a user interface with nothing left to dispose it, which is a possible Compose leak when a surface stops.
- 38a1e93: Two test-only read-outs, so the recycle rule can be measured instead of inferred. `nuiTestDisplayedIndex()` on SegmentedControl answers which segment the control is really painting — the handle's `selectedIndex` only echoes what React sent. `nuiTestLifetimeReport()` on Switch answers `drops=` and `recycles=` per native object, and neither is cleared by a recycle, so a control that reports `recycles=1` while it is on screen can only be an instance the pool handed back. `nitroUiCore.drainPerf()` also answers two new kinds, `dropped` and `recycled`. Both methods appear on the `hybridRef` type, alongside the other `nuiTest*` probes; no behaviour an app can see changes.

## 0.4.0

### Minor Changes

- c6fa4ec: `Menu` — a button that opens a list of actions. The trigger is a `Button` (same `variant`s, same `size`s, same box); the items are a typed `group` of actions, sections and one level of submenu, never JSON and never child views. A pick reports `onSelect` with that row's `id`, then `onClose` — the choice first, so a listener never acts while the menu is still up (DECISIONS D32); there is no value, so there is nothing to keep in sync, and no imperative `open()`/`close()`. iOS is SwiftUI `Menu` and nests a submenu; Android anchors a Material 3 `DropdownMenu` to the trigger inside its own window and renders a submenu's items inline under a divider. Three splits are documented rather than papered over: `systemImage` is iOS-only, as it is on `Button`; `primaryAction` (tap runs it, long-press opens) is iOS-only, following the native idiom; and `onOpen`/`onClose` are **Android-only** — the iPhoneOS 27.0 SDK gives SwiftUI's `Menu` no expansion binding, so **iOS never fires either one**, which is the same answer `Picker` already gives for its popup. Android's popup is ours to witness, so it also closes on a layout move and on `disabled` arriving while open, as `Picker` and `DatePicker` do; on iOS that last one is neither enforced nor observable.

### Patch Changes

- 62597c5: The README now describes what 0.4.0 ships. `Menu` joins the components table, the root `import` list and Usage (its example is compiled by `check`, as the others are), the `<Host>` sections say eight controls rather than seven, the performance section carries Menu's measured numbers, and Known limitations names the iOS splits DECISIONS D32 recorded. Two claims that were simply out of date are corrected: the consumer smoke table says what the app mounts today and keeps its 0.1.0 ticks because no consumer run has been repeated, and the "GitHub workflows are disabled" line is gone — `CI`, `Release`, `Release tag` and `Changeset status` run, while `Bench` and `Smoke` are dispatch-only.

## 0.3.2

### Patch Changes

- 83b4552: `DatePicker` no longer rebuilds its calendar when a bound changes by less than the control can show. The record of the bounds a platform control was built with was taken once per mount, from outside the control's identity, so after `minimumDate`/`maximumDate` moved it still described the first build; a value crossing the bound the picker had just widened away from then looked out of range, and each crossing replaced the live calendar — resetting its page, and a wheel's scroll position — for no reason. The bounds are now recorded where the control is built, so the comparison uses the control that is actually on screen. One related rebuild goes with it: widening a bound and moving the value out of the old one in a single batch used to rebuild the calendar _twice_, because the identity that went on screen said "value outside" and the next render of anything said it no longer did. That second one, the render an app cannot predict, is gone; a widen-plus-move batch is now exactly one rebuild on both platforms.
- 83b4552: A `fillWidth` control (Slider, linear Progress) inside a parent that gives it no width — a horizontal `ScrollView`, for instance — no longer draws at the width a _different_ instance of the same control happened to be measured at. The size cache now stores the width the component declares for that case instead of the last box width any instance reported, which is the width `docs/components/slider.md` documents the declared number as existing for. Two consequences for anyone whose layout hits this: the bar or slider under an unbounded parent changes width (Slider 351 pt / 328 dp, Progress 320, instead of some other instance's box), and since that width is now the component's own, no later measurement replaces it — under an unbounded parent the declared width is what draws on every frame. Apps can't change the declared number, so give the control an explicit `width` style if that length is wrong for the layout.
- 83b4552: `SegmentedControl`'s `tintColor` documentation now says why iOS ignores it, and the behaviour is checked rather than asserted in prose. Nothing changes for an app: the prop paints the selected segment's container and border on Android and does nothing on iOS, as before. What changed is the reason given — the earlier text said the knob was unreachable from SwiftUI, and on iOS 27 that turned out not to be true. The hosted `UISegmentedControl` is reachable and setting its `selectedSegmentTintColor` does paint it (9253 pixels of the requested colour, against zero untinted), but the colour is off the screen after the first change of selection while the property still reports the colour that was written, and writing it again did not bring it back at either of the two timings tried. A tint that survives until the first tap is worse than a prop that never did anything, so the prop stays documented as Android-only — now with a pixel probe on both platforms that fails the suite if either one stops matching that sentence. Measured on iOS 27 only; earlier iOS releases were not tested.

## 0.3.1

### Patch Changes

- f8fec10: The README and component docs now describe what 0.3.0 ships: `<Host>` composes all seven controls on Android (it said three of them were coming in the next release), it is a documented passthrough on iOS, and a refused `<Host>` child is reported in development builds only.

## 0.3.0

### Minor Changes

- `<Host>` now composes every control the library ships: `SegmentedControl`, `Picker` and `DatePicker` join `Switch`, `Slider`, `Progress` and `Button` on Android. Each keeps its own documented sizing rule inside the shared composition; a hosted `Picker`'s menu and a hosted `DatePicker`'s dialog are windows of the Host's own composition, anchored to the row the Host drew and closed by the same outside tap, back gesture or row that has always closed them. A React Native `Modal` child is still refused: that window belongs to React Native, not to the composition. A hosted `DatePicker`'s dialog follows its row the same way: it closes when a layout move takes the row out from under it — including a neighbour row leaving the `<Host>` — rather than staying up over a row that is no longer there. One unhosted behaviour changes with it: an open `Picker` menu now closes when the picker's React Native view is moved by layout, since an anchor that has moved away from its row cannot keep a window pointing at it (`docs/components/picker.md`).

## 0.2.0

### Minor Changes

- 6b5b600: `<Host>` now composes `Slider`, `Progress` and `Button` as well as `Switch` on Android, each keeping its own documented sizing rule inside the shared composition.

## 0.1.1

### Patch Changes

- 306b07f: Ship `CHANGELOG.md` inside the published package, so the release notes travel with the code into `node_modules`.

## 0.1.0 — 2026-10-26

First release. Seven controls, each one the real platform view — SwiftUI inside
a `UIHostingController`, Jetpack Compose inside an `AbstractComposeView`, both
wrapped in a Nitro Hybrid View — on a shared native core that measures each one
on the device and reports its size to Yoga. Plus `<Host>`, an opt-in container
that renders a batch of Switches in one Compose composition on Android.

### Components

- **`Switch`** — SwiftUI `Toggle(.switch)` / Material 3 `Switch`. Controlled or
  uncontrolled, `disabled`, `tintColor`. [`docs`](docs/components/switch.md)
- **`Slider`** — SwiftUI `Slider` / Material 3 `Slider`. Range, `step`
  quantised natively, `onValueChange` coalesced to one event per frame,
  `onSlidingStart` / `onSlidingComplete`.
  [`docs`](docs/components/slider.md)
- **`Progress`** — SwiftUI `ProgressView` / Material 3 `LinearProgressIndicator`
  and `CircularProgressIndicator`. `variant="linear" | "circular"`, a
  determinate `0…1` value or `null` for indeterminate.
  [`docs`](docs/components/progress.md)
- **`Button`** — SwiftUI `Button` with five `.buttonStyle`s / the five Material 3
  button composables. `title`, `variant`, `size`, `disabled`, `tintColor`,
  `systemImage` (iOS). [`docs`](docs/components/button.md)
- **`SegmentedControl`** — SwiftUI segmented `Picker` / Material 3
  `SingleChoiceSegmentedButtonRow`. `options` is the label list and decides the
  control's width. [`docs`](docs/components/segmented-control.md)
- **`Picker`** — SwiftUI `Picker` (`.menu` / `.wheel`) / Material 3
  `ExposedDropdownMenuBox`. `options`, controlled or uncontrolled
  `selectedIndex`, `onChange` with `{ index, value }`, `variant`, `label`,
  `disabled`, `tintColor`. Android has no wheel, so `variant="wheel"` renders
  the menu there. [`docs`](docs/components/picker.md)
- **`DatePicker`** — SwiftUI `DatePicker` (`.graphical` / `.wheel`, behind a
  compact field that opens a popover) / Material 3 `DatePicker` and `TimePicker`
  (inline, or `DatePickerDialog` / `TimePickerDialog` behind a compact field).
  `mode="date" | "time" | "datetime"`,
  `variant="compact" | "inline" | "wheel"`, `minimumDate` / `maximumDate`,
  `disabled`, `tintColor`, controlled or uncontrolled `value`. Android has no
  wheel and no combined date-and-time control.
  [`docs`](docs/components/date-picker.md)

### Container

- **`<Host>`** — an opt-in container. On **Android** its direct nitro-ui
  `Switch` children render in one shared Compose composition instead of one
  each: measured at 0.86× `expo-ui-shared-host` mount memory and 0.87× mount UI
  CPU for 200 Switches (2.75× and 1.39× without a Host), at the cost of about
  1.2× mount JS CPU. `Switch` is the only control it can hold; any other child
  throws in development. On **iOS** it is a passthrough `View` by design: a
  shared iOS host was measured and not shipped (DECISIONS D23).
  [`docs`](docs/components/host.md)

### Core

- `nitroUiCore` — the shared native core every control is built on: one
  monotonic clock (`CLOCK_UPTIME_RAW` / `CLOCK_MONOTONIC`), perf marks, and the
  sizing diagnostics.
- `prewarm()` — adopt a component's declared size before its first mount, so the
  first instance lays out exact instead of correcting one frame later.
- Measured (not declared) sizing on both platforms, with one committed
  correction rule (DECISIONS D17): the first instance of a sizing configuration
  may show a declared fallback for one frame; every later instance is exact on
  its first frame.
- Autolinked on both platforms: no config plugin, no Podfile or Gradle edits.
  Jetpack Compose is configured inside this package, so consumers do not opt in.
- Supported floor: React Native `>= 0.86` with the new architecture,
  `react-native-nitro-modules ^0.37.1`, Android `minSdkVersion` 24.

### Platform behaviour

- **Android: content wider than its box fits the box.** A `SegmentedControl`,
  `Button` or `Picker` whose content measured wider than the box Yoga gave it is
  laid out a second time at the box's width, so Material 3 shares the row out
  and ellipsises it instead of drawing past the edge with the hidden part
  untappable. Content that fits is measured once.
- **Android: dropping a control releases it.** A Compose view uninstalls its
  composition strategy and the sizing engine's pre-draw listeners in `drop()`,
  so a screen that mounts and unmounts controls does not retain one host per
  mount; an on-device churn test gates the retained heap per cycle.
- **A render React discards leaves nothing behind.** Sizing ids are hook state
  rather than a ref written during render, and `Progress` derives one
  normalised variant for its remount key, its sizing key and its native prop.

### Benchmarks and tooling

- **Committed bench baselines for both canonical devices:**
  `bench/baselines/ios27-sim-iphone17.json` and
  `bench/baselines/android35-emu-pixel9.json`, each from one clean
  `--plan full --launches 8` run, so `bun bench --check` gates on iOS and
  Android. See [Performance](README.md#performance) for what they say.
- The bench's idle-machine rule judges the load average sampled across the
  whole run instead of one sample at its end, and `--update-baseline` refuses
  to start on a busy machine.
- The bench has a `nitro-ui-host` arm (Android, Switch) for `<Host>`.
- The consumer smoke test asserts that every control mounts with a non-zero
  box, not only that the app launches.
- The example app doubles as a React Native Storybook showcase
  (`bun run storybook:ios` / `bun run storybook:android`).

### Not in 0.1

- `<Host>` holds `Switch` only — hosting the other controls is 0.2.
- There is no shared iOS host: one was built and measured, and it lost on UI
  CPU (DECISIONS D23). iOS `<Host>` is a `View`.
- No imperative surface. The native handle (`hybridRef`) stays internal
  (DECISIONS D14); every prop flows through React.

Known limitations are listed in the [README](README.md#known-limitations) and
per control in the component docs.
