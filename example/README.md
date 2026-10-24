This is a new [**React Native**](https://reactnative.dev) project, bootstrapped using [`@react-native-community/cli`](https://github.com/react-native-community/cli).

> This app is the example app of `react-native-nitro-ui` and shares the repo
> root's bun install. Run its scripts from this directory with `bun run …`, or
> from the repo root with `bun run example <script>`. See
> [../CONTRIBUTING.md](../CONTRIBUTING.md) for the repository's own gates and
> for the on-device (Harness) tests.

# Getting Started

> **Note**: Make sure you have completed the [Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment) guide before proceeding.

## Step 1: Start Metro

First, you will need to run **Metro**, the JavaScript build tool for React Native.

To start the Metro dev server, run the following command from the root of your React Native project:

```sh
bun run start
```

Metro uses port 8081 here; the Harness tests use `METRO_PORT` (8291 by default)
instead — see `rn-harness.config.mjs`.

## Step 2: Build and run your app

With Metro running, open a new terminal window/pane from the root of your React Native project, and use one of the following commands to build and run your Android or iOS app:

### Android

```sh
bun run android
```

### iOS

For iOS, remember to install CocoaPods dependencies (this only needs to be run on first clone or after updating native deps).

The first time you create a new project, run the Ruby bundler to install CocoaPods itself:

```sh
bundle install
```

Then, and every time you update your native dependencies, run:

```sh
bundle exec pod install
```

For more information, please visit [CocoaPods Getting Started guide](https://guides.cocoapods.org/using/getting-started.html).

```sh
bun run ios
```

If everything is set up correctly, you should see your new app running in the Android Emulator, iOS Simulator, or your connected device.

This is one way to run your app — you can also build it directly from Android Studio or Xcode.

## Step 3: Modify your app

Now that you have successfully run the app, let's make changes!

Open `App.tsx` in your text editor of choice and make some changes. When you save, your app will automatically update and reflect these changes — this is powered by [Fast Refresh](https://reactnative.dev/docs/fast-refresh).

When you want to forcefully reload, for example to reset the state of your app, you can perform a full reload:

- **Android**: Press the <kbd>R</kbd> key twice or select **"Reload"** from the **Dev Menu**, accessed via <kbd>Ctrl</kbd> + <kbd>M</kbd> (Windows/Linux) or <kbd>Cmd ⌘</kbd> + <kbd>M</kbd> (macOS).
- **iOS**: Press <kbd>R</kbd> in iOS Simulator.

## Congratulations! :tada:

You've successfully run and modified your React Native App. :partying_face:

### Now what?

- If you want to add this new React Native code to an existing application, check out the [Integration guide](https://reactnative.dev/docs/integration-with-existing-apps).
- If you're curious to learn more about React Native, check out the [docs](https://reactnative.dev/docs/getting-started).

# Storybook

The example app doubles as a tester / showcase app built on [React Native
Storybook](https://storybook.js.org/docs/react-native/intro): one story file per
component under [`src/stories/`](src/stories), configured by
[`.rnstorybook/`](.rnstorybook).

Start Metro in Storybook mode and build the app against it:

```sh
bun run storybook          # Metro, in Storybook mode
bun run storybook:ios      # build + install + launch on the iOS Simulator
bun run storybook:android  # build + install + launch on a device / emulator
```

Or in one step, which starts its own Metro if none is running:

```sh
bun run storybook:ios      # from this directory (or `bun run storybook:ios` at
                           # the repo root - both are aliases)
```

From the repo root the same four scripts exist as
`bun run storybook[:ios|:android|:generate]`. The `STORYBOOK_ENABLED=true` the
scripts set is read by `withStorybook` in `metro.config.js`, and the inline
`VAR=value` form works on every platform because bun runs scripts with
[Bun Shell](https://bun.com/docs/runtime/shell).

- **What is swapped** is the app _entry_: with the variable set, Metro resolves
  `index.js` to `.rnstorybook/index.tsx`, so Storybook's UI is what launches and
  `src/App.tsx` is never in the graph. Detection reads `package.json#main`
  relative to the Metro process, so start it from this directory.
- **Without the variable `withStorybook` is a strict no-op** - no resolver hook,
  no generated file, no Storybook module in the bundle at all. The app, the
  Harness tests and the real-input runner therefore bundle exactly what they
  bundled before Storybook existed.
- **Stories** are CSF3 (`Meta` / `StoryObj`) and typecheck against the real
  component props. Each component has a `Playground` story whose Controls panel
  carries every public prop, plus showcase stories for its variants, sizes,
  states, both appearances and its sizing behaviour. Events log to the Actions
  panel.
- **`storybook.requires.ts` is generated** (by the `withStorybook` Metro wrapper,
  or `bun run storybook:generate`) and is gitignored, so it is not reviewed.
- **Adding a story file needs a Metro restart**: the generated file globs
  `src/stories` with `require.context`, and a running server keeps its existing
  module map.

Metro's default port (8081) is what these use; the Harness tests keep using
`METRO_PORT` (8291 by default) with Storybook disabled - see
[`rn-harness.config.mjs`](rn-harness.config.mjs).

# Troubleshooting

If you're having issues getting the above steps to work, see the [Troubleshooting](https://reactnative.dev/docs/troubleshooting) page.

# Learn More

To learn more about React Native, take a look at the following resources:

- [React Native Website](https://reactnative.dev) - learn more about React Native.
- [Getting Started](https://reactnative.dev/docs/environment-setup) - an **overview** of React Native and how setup your environment.
- [Learn the Basics](https://reactnative.dev/docs/getting-started) - a **guided tour** of the React Native **basics**.
- [Blog](https://reactnative.dev/blog) - read the latest official React Native **Blog** posts.
- [`@facebook/react-native`](https://github.com/facebook/react-native) - the Open Source; GitHub **repository** for React Native.
