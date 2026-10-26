# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

On `main`, not yet released. Nothing from this project has been published to
npm yet, including 0.1.0 below.

### Added

- **`Picker`** — SwiftUI `Picker` (`.menu` / `.wheel`) / Material 3
  `ExposedDropdownMenuBox`. `options`, controlled or uncontrolled
  `selectedIndex`, `onChange` with `{ index, value }`, `variant`, `label`,
  `disabled`, `tintColor`. Android has no wheel, so `variant="wheel"` renders
  the menu there. [`docs`](docs/components/picker.md)
- **`DatePicker`** — SwiftUI `DatePicker` (`.graphical` / `.wheel`, behind a
  compact field that opens a popover) / Material 3 `DatePicker` and
  `TimePicker` (inline, or `DatePickerDialog` / `TimePickerDialog` behind a
  compact field). `mode="date" | "time" | "datetime"`,
  `variant="compact" | "inline" | "wheel"`, `minimumDate` / `maximumDate`,
  `disabled`, `tintColor`, controlled or uncontrolled `value`. Android has no
  wheel and no combined date-and-time control.
  [`docs`](docs/components/date-picker.md)
- **`<Host>`** — an opt-in container. On **Android** its direct nitro-ui
  `Switch` children render in one shared Compose composition instead of one
  each: measured at 0.86× `expo-ui-shared-host` mount memory and 0.87× mount UI
  CPU for 200 Switches (2.75× and 1.39× without a Host), at the cost of about
  1.2× mount JS CPU. `Switch` is the only control it can hold; any other child
  throws in development. On **iOS** it is a passthrough `View` by design: a
  shared iOS host was measured and not shipped (DECISIONS D23).
  [`docs`](docs/components/host.md)

### Fixed

- **Android: content wider than its box now fits the box.** A
  `SegmentedControl` or `Button` whose content measured wider than the box
  Yoga gave it was drawn at its measured width, centred, with both ends cut off
  and the hidden parts untappable. The host now lays such content out a second
  time at the box's width, so Material 3 shares the row out and ellipsizes;
  content that fits is measured once, as before.
- **Android: every mount leaked its control.** Each Compose view stayed
  registered on the activity's `LifecycleRegistry` after it was dropped, so a
  screen that mounted and unmounted controls retained one host per mount (a
  benchmark cell of 200 Switches ran the heap out). `drop()` now uninstalls the
  composition strategy and the sizing engine's pre-draw listeners, and an
  on-device churn test gates the retained heap per cycle.
- A render React discarded could leave an entry behind in the sizing engine
  (`useSizingId` is now state-based), and `Progress` now uses one normalised
  variant for its remount key, its sizing key and its native prop.

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

## 0.1.0 — 2026-10-24

_Scope frozen on 2026-10-24. Not published to npm and not tagged._

First release with components. Five controls, each one the real platform view
hosted by a shared native core: SwiftUI inside a `UIHostingController`, Jetpack
Compose inside an `AbstractComposeView`, both wrapped in a Nitro Hybrid View.

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

### Not in 0.1

`Picker`, `DatePicker` and the opt-in `<Host>` container for the Android mount
CPU / memory gap came after 0.1 and are listed under
[Unreleased](#unreleased). Known limitations are listed in the
[README](README.md#known-limitations) and per control in the component docs.
