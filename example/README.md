# nitro-ui example app

The example app of `react-native-nitro-ui`: a bare React Native app (React
Native CLI, new architecture) with one tab per component — Switch, Slider,
Button, Progress, SegmentedControl, DatePicker, Picker, Menu and Host — in
`src/App.tsx` and the `src/*Screen.tsx` files. It is also the app the
on-device tests run in (`__tests__/*.harness.tsx`, through
`react-native-harness`) and a Storybook showcase (below).

It shares the repo root's bun install. Run its scripts from this directory with
`bun run …`, or from the repo root with `bun run example <script>`. See
[../CONTRIBUTING.md](../CONTRIBUTING.md) for prerequisites, the repository's
gates and the on-device (Harness) tests.

## Running it

Make sure you have completed React Native's
[Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment)
guide, and run `bun install` at the repo root.

```sh
bun run start      # Metro, on 8081
bun run android    # build, install and launch on an emulator or device
bun run ios        # build, install and launch on a simulator
```

On iOS, install the pods first, and again whenever native dependencies change:

```sh
cd ios
bundle install            # once, for CocoaPods itself
bundle exec pod install
```

Metro uses port 8081 here; the Harness tests use `METRO_PORT` (8291 by default)
instead — see [`rn-harness.config.mjs`](rn-harness.config.mjs).

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
  component props. Each control has a `Playground` story whose Controls panel
  carries every public prop, plus showcase stories for its variants, sizes,
  states, both appearances and its sizing behaviour. `Host` has no playground:
  its stories compare hosted and unhosted Switches, churn a hosted batch, mix
  Switch, Slider, both Progress variants and Button in one Host, and host the
  SegmentedControl, Picker and DatePicker whose menu and dialog open from it.
  Events log to the Actions panel.
- **`storybook.requires.ts` is generated** (by the `withStorybook` Metro wrapper,
  or `bun run storybook:generate`) and is gitignored, so it is not reviewed.
- **Adding a story file needs a Metro restart**: the generated file globs
  `src/stories` with `require.context`, and a running server keeps its existing
  module map.

Metro's default port (8081) is what these use; the Harness tests keep using
`METRO_PORT` (8291 by default) with Storybook disabled - see
[`rn-harness.config.mjs`](rn-harness.config.mjs).

# Troubleshooting

See React Native's
[Troubleshooting](https://reactnative.dev/docs/troubleshooting) page for build
and Metro problems that are not specific to this library.
