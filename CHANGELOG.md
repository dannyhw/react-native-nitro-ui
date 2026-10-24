# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.1.0 — 2026-10-24

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

`Picker` and `DatePicker` are planned for 0.2, along with an opt-in shared-host
container for the Android mount CPU / memory gap
([why it exists](README.md#performance)). Known limitations are listed in the
[README](README.md#known-limitations) and per control in the component docs.
