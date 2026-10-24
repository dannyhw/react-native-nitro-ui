# react-native-nitro-ui

Native SwiftUI and Jetpack Compose components for React Native, built on
[Nitro Modules](https://nitro.margelo.com/).

Most "native" component libraries re-implement a platform control in React
Native and copy the screenshots. This one hosts the real thing: each control is
a SwiftUI view or a Jetpack Compose composable inside a Nitro Hybrid View, so
the toggle animates like Apple's, the slider takes drags the way `UISlider`
does, the segmented row truncates labels the way the OS does, and VoiceOver and
TalkBack get the control's own accessibility instead of an approximation of it.
Layout still belongs to Yoga — the control measures itself, reports its size to
the layout engine, and React never sees a native node. v0.1 ships five controls
(Switch, Slider, Progress, Button, SegmentedControl), the shared native core
they are built on, and a benchmark rig that prices them against the same
controls reached through `@expo/ui`.

## Components

| Component          | iOS                                                        | Android                                                      | Docs                                                         |
| ------------------ | ---------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| `Switch`           | `Toggle(…).toggleStyle(.switch)`                           | `androidx.compose.material3.Switch`                          | [switch.md](docs/components/switch.md)                       |
| `Slider`           | `Slider(value:in:step:onEditingChanged:)`                  | `androidx.compose.material3.Slider`                          | [slider.md](docs/components/slider.md)                       |
| `Progress`         | `ProgressView` + `.progressViewStyle(.linear / .circular)` | `LinearProgressIndicator` / `CircularProgressIndicator` (M3) | [progress.md](docs/components/progress.md)                   |
| `Button`           | `Button(action:) { Label }` + `.buttonStyle(…)`            | the five Material 3 button composables                       | [button.md](docs/components/button.md)                       |
| `SegmentedControl` | `Picker(…).pickerStyle(.segmented)`                        | `SingleChoiceSegmentedButtonRow`                             | [segmented-control.md](docs/components/segmented-control.md) |

Everything is exported from the package root, along with `nitroUiCore` (a
monotonic clock, `CLOCK_UPTIME_RAW` / `CLOCK_MONOTONIC`) and `prewarm` (see
[Sizing](#sizing)):

```ts
import {
  Button,
  Progress,
  SegmentedControl,
  Slider,
  Switch,
} from 'react-native-nitro-ui';
```

## Requirements

| Platform | Minimum                                                                     |
| -------- | --------------------------------------------------------------------------- |
| iOS      | `min_ios_version_supported` (RN's floor — 15.1 on RN 0.86 / 0.88)           |
| Android  | `minSdkVersion` 24, `compileSdkVersion` 36 (inherited from the RN template) |
| RN       | `>= 0.86` with the new architecture                                         |
| Nitro    | `react-native-nitro-modules ^0.37.1`                                        |

Jetpack Compose (compiler plugin + Material 3 BOM) is configured inside this
package's `android/build.gradle`, so your app does not have to opt in to Compose
to use one slider, and no Podfile or Gradle edits are needed either way.

## Installation

React Native autolinks the native code: no config plugin, no Podfile or Gradle
edits, no manual linking. The steps below are the ones our consumer smoke tests
run (`scripts/smoke/`, with `npm` and a Release build) against a fresh Expo SDK
58 app and fresh React Native CLI apps, verified green on:

| Consumer              | iOS | Android |
| --------------------- | --- | ------- |
| Expo SDK 58 (RN 0.88) | ✅  | ✅      |
| RN CLI 0.88.0         | ✅  | ✅      |
| RN CLI 0.86.3         | n/a | ✅      |

RN 0.86.3 is supported (it is our floor) and its Android install is covered by
a nightly smoke row. Its iOS run is not verifiable on this machine's iOS 27
simulator runtime — a fresh 0.86.3 app without this library hangs at launch
there too — so it is verified in CI on an older runtime instead.

### Expo (Continuous Native Generation)

```sh
npm install react-native-nitro-ui react-native-nitro-modules
npx expo prebuild   # or: npx expo run:ios / npx expo run:android / eas build
```

Requires a dev build - Expo Go is not supported.

### Bare React Native CLI

```sh
npm install react-native-nitro-ui react-native-nitro-modules
cd ios && bundle install && bundle exec pod install
```

Rebuild the app (`npx react-native run-ios` / `run-android`) so the new native
code is compiled in.

## Usage

Each control has the props of the platform control it wraps, not a
lowest-common-denominator subset. The tables in the component docs list every
prop against the TypeScript type; these are the shapes you will actually write.

### Switch

Controlled by `value`; omit it and native owns the displayed state (a toggle
then costs no React render).

```tsx name=switch
export function WifiSettings() {
  const [enabled, setEnabled] = useState(false);

  return (
    <>
      <Text>Wi-Fi</Text>
      <Switch
        accessibilityLabel="Wi-Fi"
        value={enabled}
        onValueChange={setEnabled}
      />
    </>
  );
}
```

### Slider

`onValueChange` fires at most once per frame during a drag;
`onSlidingComplete` always fires once with the value the gesture settled on.

```tsx name=slider
export function VolumeSlider() {
  const [volume, setVolume] = useState(0.5);

  return (
    <Slider
      accessibilityLabel="Volume"
      value={volume}
      onValueChange={setVolume}
      minimumValue={0}
      maximumValue={1}
      step={0.05}
    />
  );
}
```

### Progress

`value` is a fraction of the whole; `null` means indeterminate rather than
empty.

```tsx name=progress
export function UploadProgress({ fraction }: { fraction: number | null }) {
  // `null` is indeterminate ("working"); a number 0…1 is a determinate bar.
  return <Progress accessibilityLabel="Uploading" value={fraction} />;
}
```

### Button

`variant` and `size` map to the closest idiomatic style on each platform, so the
two columns deliberately do not look alike — neither one fakes the other.

```tsx name=button
export function SaveButton() {
  const [saving, setSaving] = useState(false);

  return (
    <Button
      title={saving ? 'Saving…' : 'Save'}
      variant="filled"
      size="medium"
      disabled={saving}
      onPress={() => setSaving(true)}
    />
  );
}
```

### SegmentedControl

`options` is the whole API surface of a segmented row, and it is also what
decides the control's width.

```tsx name=segmented-control
export function ViewToggle() {
  const [index, setIndex] = useState(0);

  return (
    <SegmentedControl
      options={['Day', 'Week', 'Month']}
      selectedIndex={index}
      onChange={(event) => setIndex(event.index)}
    />
  );
}
```

## Sizing

A control's box is **its own measurement**, taken at runtime on the device your
app is running on, and reported to the layout engine — not a constant written
into the library. A Switch is 61 × 28 pt on iOS 26+ and 51 × 31 pt on iOS 15–25
because the running OS says so; `Slider` and `variant="linear"` `Progress` are
the two `fillWidth` controls, so their width is the box their parent gives them
and only their height is their own.

- **Your styles win.** `width`, `height` or `flex` fix the box and the control
  centres inside it, exactly as with a stock RN component.
- **One difference from stock RN:** measured sizes leave Yoga nothing to stretch,
  so a parent's `alignItems: 'stretch'` does not widen an intrinsic control. Ask
  for the fill on the control itself: `alignSelf: 'stretch'`.
- **The first mount of a new configuration can be one frame off.** A
  "configuration" is the set of props a control's size depends on — a Button's
  title, a SegmentedControl's option list, a Progress's variant. The very first
  instance of one is laid out at a declared fallback size for a single frame and
  then corrected; every later instance of that configuration lays out exactly on
  its first frame, and an app never pays it for a Switch or a Slider (they have
  one configuration each). On iOS 26+ an app that sets
  `UIDesignRequiresCompatibility` pays that one-frame correction even for a
  Switch, because the OS control is a different size than the one the platform
  now declares.
- **`prewarm` makes the first mount exact.** `prewarm(['NitroUiSwitch'])` adopts
  a component's declared size as this environment's provisional answer before the
  first screen mounts, so nothing shows the fallback frame. It is cheap, safe to
  call with a name a future version does not know, and the sizing engine still
  treats it as provisional: a real measurement replaces it if it disagrees.

`docs/architecture/sizing.md` has the rule, the counters and the traps;
`docs/architecture/core.md` has the hosting model underneath it.

## Performance

`bun bench` (`docs/architecture/benchmarks.md`) measures this library against
three arms in the same run, on the same device, in Release builds:

- `rn-core` — the pure-JS answer (row of `Pressable`s, stock `ActivityIndicator`,
  …). A floor, not a peer: it draws fewer pixels and hosts nothing.
- `expo-ui-host-per-control` — the same SwiftUI / Compose controls through
  `@expo/ui`, one hosting view per control.
- `expo-ui-shared-host` — the same controls through `@expo/ui`, one hosting view
  for all of them. This is the arm worth being measured against, and the target
  is ≤ 1.0× on mount latency, UI CPU and memory.

The honest summary, from the release-readiness runs and the merged component
reports (`mount presented` / `mount UI CPU` / `memory` vs `expo-ui-shared-host`):

| Platform    | Where we meet or beat the shared host                                                                                                                       | Where we miss                                                                                                                                                                                                              |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **iOS**     | memory on `SegmentedControl` (0.82×, two runs); the whole update path (`Progress` 0.53× mounted, `Switch` and `Slider` UI CPU ≤ 0.8×); JS commit everywhere | memory on the other four components, 1.35–1.45× (+45 KiB per control); mount latency and UI CPU have **no verdict** — the frame probe's sanity counters are non-zero on every arm, so the direction (≤ 1.0×) is not a pass |
| **Android** | mount latency at parity or better (0.81–1.11×)                                                                                                              | mount UI CPU, 1.14–1.56×; memory, 1.10–2.52× (`Switch` worst, 134 KiB vs 53 KiB per instance)                                                                                                                              |

Against `expo-ui-host-per-control` we are **below** the reference on every gated
metric on both platforms (typically 0.5–0.8×), which is the other half of the
target.

The misses are one architectural bill, not five separate ones: `expo-ui` pays
**one** hosting subtree for all N controls, while every control in this library
owns its `UIHostingController` / Compose `AbstractComposeView`, view model and
sizing entry — that is the +45 KiB per instance on iOS, the 134 KiB on Android,
and most of the extra UI CPU per mount. T13 measured what is left after the
framework's own sharing (Compose owner services are already per-window) and the
only remaining lever is an opt-in Expo-style shared `<Host>` container, which is
a public-API decision for 0.2 (DECISIONS D19: documented with a follow-up, not
chased). Absolute numbers, per-launch spreads and the noise flags are in
`docs/architecture/benchmarks.md` and the reports in `docs/tasks/`; committed
ratio baselines live in `bench/baselines/`.

## Known limitations

The full list per control is in its doc; these are the ones that bite.

- **Android clips content that is wider than its box.** An over-wide
  `SegmentedControl` row or `Button` is placed centred at its measured width, so
  both rounded ends are cut off and the hidden part of the outer segments cannot
  be tapped. Keep option lists and titles within the available width; fitting
  intrinsic content to its box is a 0.2 fix. iOS is unaffected (it compresses and
  truncates labels instead).
- **iOS `SegmentedControl` ignores `tintColor`.** A SwiftUI segmented `Picker`
  ignores `.tint()`, so a tinted row looks like the default one on iOS. It works
  on Android.
- **A determinate circular `Progress` draws a spinner on iOS.** SwiftUI's
  `.circular` `ProgressView` keeps spinning whatever fraction it is handed; the
  value reaches VoiceOver, not the pixels. Android draws the ring filled. An
  indeterminate **linear** bar on iOS shows an empty track and does not visibly
  animate.
- **`trackColor` is Android-only** (nothing in SwiftUI addresses the track) and
  **`systemImage` is iOS-only** (Android ignores it). Both are accepted on both
  platforms so the JS API means one thing.
- **Expo Go is not supported** — a dev build is required, because Nitro Modules
  needs native code.
- **RN 0.86 iOS is verified in CI, not on every dev machine** — see the
  installation table above.
- **`testID` lands on the host** on Android (`View.tag`): Compose has no test id,
  which is what `findNodeByName` and the harness read.
- **Accessibility props belong on the control, not the box.** The label lives on
  the hosted control, so adding `accessible` or an `accessibilityRole` to a
  control's container can hide that control from VoiceOver / TalkBack. Style the
  box; do not re-role it. `aria-label` / `aria-disabled` are not translated.
- **Small platform differences:** iOS `Slider` answers drags that start on the
  thumb (that is `UISlider`); Android infers `onSlidingStart` from the first
  value change; a rejected controlled change reverts without animation; segment
  widths are equal shares on Android and SwiftUI's own distribution on iOS.
- **Coming in 0.2:** `Picker` and `DatePicker`, and the shared-host container
  above.

## How it works

- `src/*.nitro.ts` are Nitro IDL specs; `nitrogen` generates the C++ specs into
  `nitrogen/generated/`, which is **committed and drift-checked**.
- `cpp/`, `ios/`, `android/` hold the C++ core, SwiftUI hosting and Compose
  hosting. Compose and SwiftUI build configuration lives in this package, not in
  the example app, so consumers inherit it.
- Every control follows the same perf contract: prop setters only store and mark
  dirty, one `afterUpdate()` applies, the hosting view is created once at init
  and never rebuilt, and controlled values use an event-count handshake so a
  write in flight can never clobber what the user just did.
- Sizing is a shared C++ engine (`docs/architecture/sizing.md`) that measures
  each control, caches per configuration, and corrects a wrong guess in one
  frame.

See `docs/research/` in the repository for the architecture and constraint
notes that shaped these choices, and `docs/DECISIONS.md` for the calls.

## Contributing

- [Development workflow](CONTRIBUTING.md#development-workflow)
- [Sending a pull request](CONTRIBUTING.md#sending-a-pull-request)
- [Code of conduct](CODE_OF_CONDUCT.md)

## License

MIT
