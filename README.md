# react-native-nitro-ui

Native SwiftUI and Jetpack Compose components for React Native, built on
[Nitro Modules](https://nitro.margelo.com/).

Most "native" component libraries re-implement a platform control in React
Native and copy the screenshots. This one hosts the real thing: each control is
a SwiftUI view or a Jetpack Compose composable inside a Nitro Hybrid View, so
the toggle animates like Apple's, the slider takes drags the way `UISlider`
does, the iOS segmented row truncates labels the way the OS does, and VoiceOver and
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
58 app and fresh React Native CLI apps, and every row below was re-run for 0.1:

| Consumer              | iOS | Android |
| --------------------- | --- | ------- |
| Expo SDK 58 (RN 0.88) | ✅  | ✅      |
| RN CLI 0.88.0         | ✅  | ✅      |
| RN CLI 0.86.3         | n/a | ✅      |

RN 0.86.3 is supported (it is our floor); its Android install was re-run for
0.1. Its iOS install is not verifiable on an iOS 27 simulator runtime — a fresh
0.86.3 app without this library hangs at launch there too — so it has a row on
an older runtime in the CI smoke workflow (`.github/workflows/smoke.yml`), which
has not run yet.

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

The release-readiness runs for 0.1 — `bun bench --plan quick`, one run per
component, on one commit, on an iPhone 17 simulator and an API 35 emulator whose
ART state was primed to `speed-profile` — measured against `expo-ui-shared-host`
(`✓` meets the ≤ 1.0× target, `✗` misses it, `n/v` means the harness's own rules
deny that cell a verdict: the frame probe's sanity counters were non-zero, or the
per-launch spread was over 10 %, so the number is a measurement and not a pass):

| Component          | iOS presented | iOS UI CPU  | iOS memory | Android presented | Android UI CPU | Android memory |
| ------------------ | ------------- | ----------- | ---------- | ----------------- | -------------- | -------------- |
| `Switch`           | 0.31× `n/v`   | 0.74× ✓     | 0.99× ✓    | 1.00× ✓           | 1.64× ✗        | 2.74× ✗        |
| `Slider`           | 0.34× `n/v`   | 0.81× ✓     | 1.44× ✗    | 1.01× ✗           | 1.56× ✗        | 2.57× ✗        |
| `Progress`         | 0.45× `n/v`   | 1.11× ✗     | 1.36× ✗    | 0.95× ✓           | 0.93× ✓        | 1.61× `n/v`    |
| `Button`           | 0.49× `n/v`   | 1.23× `n/v` | 1.35× ✗    | 1.01× ✗           | 1.52× ✗        | 2.50× ✗        |
| `SegmentedControl` | 1.00× `n/v`   | 0.68× ✓     | 0.83× ✓    | 1.31× ✗           | 1.28× ✗        | 1.09× ✗        |

Reading it honestly: on **Android** the memory bill is the consistent miss — 2.5×
for three of the five controls (Switch costs 141 KiB per instance where the shared
host costs 52 KiB) — and mount UI CPU runs 1.28–1.64×, with `Progress` the only
control that meets both. On **iOS** mount `presented` never carries a verdict (the
frame lands early on every arm, so a 0.31× direction is not a pass), mount UI CPU
meets on three controls and misses on `Progress`, and memory is a per-control
affair: `Switch` at parity, `SegmentedControl` 17 % below the shared host, and
+44 to +80 KiB per instance on the other three. On the update path, presented is 1.00× parity on
iOS and 0.43–1.02× on Android (`Slider`'s 1.02× is the one miss), iOS UI CPU meets on
four of five (0.73–0.87×, `Button` 1.48×), and Android update UI CPU is still above the
shared host on all four controls whose update cell is comparable (1.01–1.87×).

`<Host>` — opt-in, Android, `Switch` today — is the one place that bill is paid the
other way, and it is the arm this library now measures. Measured the same way on the
same emulator (one run, `quick`, `speed-profile`, five arms, machine load median 2.99
over 14 cores, `problems: none`): 200 Switches inside one Host cost **0.85×** the
shared host's mount memory — 45.3 KiB per instance against its 53.3 KiB — and **0.81×**
its mount UI CPU per op, where the same Switches unhosted cost 2.68× and 1.38×;
`mounted` is 0.98× and `presented` 1.00×. The axis it loses on is the JS thread:
1.26× the shared host on mount JS CPU per op, against 0.78× for the unhosted control,
because a hosted control is still a React Native node _and_ a child of somebody
else's composition. That is why the container is something an app opts into for a dense
list rather than what every `<View>` does (`docs/components/host.md`, and
`docs/tasks/H1-android-host.report.md` for the absolutes, spreads and `update` cells).

Against `expo-ui-host-per-control` — the same one-host-per-control shape, reached
through `@expo/ui` — we are below it on every cell that carries a verdict:
Android presented 0.66–0.94×, UI CPU 0.40–0.60×, memory 0.56–0.82×; iOS UI CPU
0.38–0.53× and memory 0.66–0.87× (its presented cells reach 1.00× on
`Button` rather than beating the arm, and the probe denies all five a verdict). One axis runs the other way, and it is iOS-only:
the time spent _inside_ the mount callback is 2.0–5.3× the shared host and
1.12–1.41× the per-control arm on every cell that carries a verdict (the fifth,
`Button`, is noise-flagged at 3.06× / 0.91×), because creating a
`UIHostingController` per instance is work the other arms amortise or never do. That one is profiled as a
follow-up, not papered over.

The memory and UI-CPU misses are one architectural bill, not five separate ones:
`expo-ui` pays **one** hosting subtree for all N controls, while every control in
this library owns its `UIHostingController` / Compose `AbstractComposeView`, view
model and sizing entry — that is the +44…+80 KiB per instance on iOS and the
+26…+112 KiB on Android, and most of the extra UI CPU per mount. T13 measured what
is left after the framework's own sharing (Compose owner services are already
per-window) and the only remaining lever is an opt-in Expo-style shared `<Host>`
container — which is what `Host` is today, and the paragraph above is what it pays
(DECISIONS D19 asked for the decision, D24 records the sizing rule it lives by). Absolute numbers, per-launch spreads and the noise flags
for these runs are in `docs/tasks/R2-release-0.1.report.md`, the per-component
history in `docs/tasks/`. Committed ratio baselines live in `bench/baselines/`,
one per canonical device, and both now exist: Android at `3533d64` (which
reproduces this table — memory 1.10–2.72×, mount UI CPU 1.02–1.59×, presented
0.89–1.02×) and iOS at `c9548f6`, whose idle `--plan full --launches 8` run
reproduces the iOS side of it too (memory 0.83–1.48× the shared host, mount UI
CPU 0.66–1.20×, presented 0.24–1.00×). So `bun bench --check` gates on both
platforms.

## Known limitations

The full list per control is in its doc; these are the ones that bite.

- **An over-wide row still reads badly on Android.** `SegmentedControl` and
  `Button` now fit what they are given: content wider than its box is laid out at
  the box's width, where it used to be drawn at its measured width, centred, with
  both ends cut off and the hidden part of the outer segments untappable. Fitting
  is not the same as legible, though - Material 3 shares a row's width equally
  between its segments, so four labels in 140 dp each collapse to an ellipsis.
  Keep option lists and titles within the available width.
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
- **RN 0.86 on iOS is not yet verified** — it hangs on the iOS 27 simulator
  even without this library; the CI row for an older runtime has not run yet.
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
- [Storybook](example/README.md#storybook) - the example app is also a showcase
  app: `bun run storybook:ios` / `bun run storybook:android` starts it, and
  `bun run storybook` runs its Metro server separately
- [Sending a pull request](CONTRIBUTING.md#sending-a-pull-request)
- [Code of conduct](CODE_OF_CONDUCT.md)

## License

MIT
