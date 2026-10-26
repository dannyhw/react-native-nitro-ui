# Changelog

All notable changes to this project are documented here, newest version first.
Version numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`0.1.0` below was written by hand. Every entry above it is written by Changesets
out of the release notes contributors record with `bun run changeset`, grouped
under the bump each change asked for: `### Major Changes`, `### Minor Changes`,
`### Patch Changes`.

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
