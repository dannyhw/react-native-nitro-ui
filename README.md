# react-native-nitro-ui

Native SwiftUI and Jetpack Compose components for React Native, built on
[Nitro Modules](https://nitro.margelo.com/).

> **Status: pre-release.** The package currently ships the native core only —
> there are no UI components published yet. Controls (Switch first) and their
> docs land in the first real release.

The thesis: host real SwiftUI and Jetpack Compose views inside Nitro Hybrid
Views, so controls look and behave like platform controls — including
accessibility, RTL, dynamic type, cursor handling and platform quirks — instead
of re-implementing them in React Native.

## Requirements

| Platform | Minimum                                  |
| -------- | ---------------------------------------- |
| iOS      | `min_ios_version_supported` (RN's floor) |
| Android  | `minSdkVersion` 24                       |
| RN       | `>= 0.86` with the new architecture      |
| Nitro    | `react-native-nitro-modules ^0.37.1`     |

## Installation

React Native 0.76+ autolinks the native code; there is nothing to link by hand.

### Expo (Continuous Native Generation)

```sh
npx expo install react-native-nitro-ui react-native-nitro-modules
npx expo prebuild
```

No config plugin is needed. Rebuild the native project after installing.

### Bare React Native CLI

```sh
bun add react-native-nitro-ui react-native-nitro-modules
# or: npm install react-native-nitro-ui react-native-nitro-modules
cd ios && pod install
```

Rebuild the app (`npx react-native run-ios` / `run-android`) so the new native
code is compiled in.

## Usage

What exists today is the shared native core — a monotonic clock used by every
component for timing and by the benchmark harness. It resolves on both
platforms from one C++ implementation:

```ts
import { nitroUiCore } from 'react-native-nitro-ui';

const start = nitroUiCore.now(); // milliseconds, monotonic, sub-ms resolution
```

Components will be exported from the same entry point, e.g.
`import { Switch } from 'react-native-nitro-ui'`.

## How it works

- `src/*.nitro.ts` are Nitro IDL specs; `nitrogen` generates the C++ specs into
  `nitrogen/generated/`, which is **committed and drift-checked**.
- `cpp/`, `ios/`, `android/` hold the C++ core, SwiftUI hosting and Compose
  hosting. Compose and SwiftUI build configuration lives in this package, not in
  the example app, so consumers inherit it.
- Jetpack Compose is contained entirely in this package's `android/build.gradle`
  (compose compiler + BOM), so hosts do not have to opt in.

See `docs/research/` in the repository for the architecture and constraint
notes that shaped these choices.

## Contributing

- [Development workflow](CONTRIBUTING.md#development-workflow)
- [Sending a pull request](CONTRIBUTING.md#sending-a-pull-request)
- [Code of conduct](CODE_OF_CONDUCT.md)

## License

MIT
