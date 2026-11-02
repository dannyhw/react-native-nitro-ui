# Changelog

All notable changes to this project are documented here, newest version first.
Version numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`0.1.0` below was written by hand. Every entry above it is written by Changesets
out of the release notes contributors record with `bun run changeset`, grouped
under the bump each change asked for: `### Major Changes`, `### Minor Changes`,
`### Patch Changes`.

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
