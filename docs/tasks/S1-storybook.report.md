# S1 — React Native Storybook in the example app — report

Branch `task/S1-storybook`. Every gate below was run on the final commit of this branch.

## Summary

The example app now doubles as a Storybook showcase app, built on the documented
v10 layout of React Native Storybook 10.7 (`@storybook/react-native@10.7`, npm
`latest` — `next` is 11.x and was not used):

- `.rnstorybook/{main.ts,preview.tsx,index.tsx}` config, `withStorybook` as the
  last wrapper in `example/metro.config.js`, generated `storybook.requires.ts`
  (gitignored, regenerated on every start).
- `STORYBOOK_ENABLED` is the only switch: four `example/` scripts (`storybook`,
  `storybook:ios`, `storybook:android`, `storybook:generate`) plus root aliases.
  Nothing in `src/App.tsx`, the harness config or the real-input runner mentions
  Storybook.
- Five CSF3 story files, one per v0.1 component, under `example/src/stories/`,
  each with a `Playground` story plus showcase stories, and a small
  `showcase.tsx` of shared layout/readout pieces reused from the example screens.
- Every Storybook-only dependency lives in `example/`; the library's
  `dependencies`/`peerDependencies` are untouched.

Disabled-mode bundling is **byte-identical** to the pre-Storybook commit on both
platforms (see "The disabled build is unchanged").

## Added dependencies, and why

All in `example/package.json`. Each one is a documented `peerDependencies` entry
of the Storybook packages — read from the installed packages, not from a blog
post. Nothing was added to the library.

`devDependencies`:

- `@storybook/react-native` `^10.7.0` — the on-device UI itself.
- `storybook` `^10.6.3` — peer `storybook: ^10.5.4` of every Storybook package;
  `^10.6.3` because npm `latest` for `storybook` is 10.6.3 (`npm view storybook
  version`).
- `@storybook/addon-ondevice-controls` `^10.7.0` — the Controls panel.
- `@storybook/addon-ondevice-actions` `^10.7.0` — the Actions panel.
- `@storybook/addon-ondevice-backgrounds` `^10.7.0` — the Backgrounds panel; see
  the decisions section for why this is a package and not the feature flag.

`dependencies` (the native modules the on-device UI needs):

- `react-native-reanimated` `^4.7.1` + `react-native-worklets` `0.13.0` — peer
  `react-native-reanimated: >=3` of `@storybook/react-native`, whose README
  requires the Babel plugin setup; in Reanimated 4 the transform lives in
  `react-native-worklets/plugin`, which is why `example/babel.config.js` gained
  exactly one plugin entry.
- `react-native-gesture-handler` `^3.4.0` — peer `>=2`.
- `react-native-safe-area-context` `^5.10.1` — peer `*`.
- `@gorhom/bottom-sheet` `^5.2.14` — peer `>=4`; it is the addons panel.
- `@react-native-community/slider` `^5.2.2` — peer of the controls addon (range
  controls).
- `@react-native-community/datetimepicker` `^9.2.2` — peer of the controls addon
  (date controls).

`example/ios/Podfile.lock` is +418 lines, purely additive (`0` deletions), and
every new path is relative (`../../node_modules/...`), so there is no
worktree-path churn to restore. `example/ios/Podfile` is unchanged.

## Files changed

- `example/package.json`, `bun.lock` — the dependencies and scripts above.
- `example/metro.config.js` — `withStorybook(config, { configPath })` last.
- `example/babel.config.js` — `react-native-worklets/plugin`.
- `example/.rnstorybook/main.ts` — `stories`, `deviceAddons` (controls, actions,
  backgrounds).
- `example/.rnstorybook/preview.tsx` — controls/actions parameters, the
  `withBackgrounds` decorator and the light/dark/surface swatches.
- `example/.rnstorybook/index.tsx` — the swapped app entry; registers the root
  component.
- `example/src/stories/{Switch,Slider,Progress,Button,SegmentedControl}.stories.tsx`,
  `example/src/stories/showcase.tsx`.
- `example/README.md`, `README.md` — how to run it.
- `.gitignore`, `.prettierignore`, `eslint.config.mjs` — the generated
  `storybook.requires.*` stays out of review, formatting and linting.
- `package.json` — root `storybook*` aliases.

No harness test file, no real-input runner file and no `src/` file changed.

## Decisions

**Backgrounds come from the standalone addon, not `features.ondeviceBackgrounds`.**
The flag is the documented v10.3+ route, and it crashes on launch here. Metro's
ESM→CJS transform inlines an import at its *use site*, so in the bundle the app
actually loads the generated statement runs before `@storybook/react-native` has
created the object it writes to. From the dev bundle the simulator fetches from
Metro:

- line 85902 `globalThis.FEATURES.ondeviceBackgrounds = true;`
- line 85905 `globalThis.view = (0, require(_dependencyMap[6], "@storybook/react-native").start)({...})`
  — the `require` is only reached here
- line 250210 `globalThis.FEATURES = Object.assign(globalThis.FEATURES ?? {}, {`
  — where the object is created, 164k lines later

so the launch dies with `TypeError: Cannot set property 'ondeviceBackgrounds' of
undefined`. It is worth reporting upstream: everywhere else in that generated
file and in the library the object is touched optionally
(`globalThis.FEATURES?.backgrounds`, `globalThis.FEATURES ?? {}`); this one
generated line is the only unguarded write. The addon needs no feature flag, so
nothing depends on that evaluation order. Its API is `deviceAddons` +
`withBackgrounds` + `parameters.backgrounds = { default, values }`, which is what
`main.ts`/`preview.tsx` now use, with the default swatch following
`Appearance.getColorScheme()`.

**The Storybook entry registers a root component.** The documented setup replaces
`index.js` with `.rnstorybook/index.tsx`, and an entry has to register, not only
export: without `AppRegistry.registerComponent(appName, () => StorybookUIRoot)`
the untouched native side asks for a component nobody registered and launch fails
with `"NitroUiExample" has not been registered`. `appName` comes from
`example/app.json`, so the name cannot drift.

**`withStorybook` is the last Metro wrapper**, so it composes the finished config:
the `withMetroConfig` monorepo resolver and the D21 timing-gate route
(`enhanceMiddleware`) both survive it. `configPath` is absolute, so the config is
found whatever the working directory is.

**The worklets plugin is unconditional.** It must stay last, and it only rewrites
files that use worklets; the disabled-bundle diff below shows it changes nothing
when nothing in the graph uses them.

**Controls cover every component-specific prop.** Checked mechanically: each
story's `argTypes` keys against the prop table in the `## API` section of
`docs/components/*.md`. The only documented props without a control are the
inherited pass-through `ViewProps` (`style`, `testID`,
`accessibilityLabel`) — a colour/select/range panel is not what makes those
worth showing, and the internal `hybridRef`/`nuiPerfId` handles are disabled and
hidden from the table (D14).

**iOS captures use `initialSelection`**, a documented `getStorybookUI` option,
because the on-device story list is not in the accessibility tree (see
follow-ups). It was only ever written into a scratch copy of the entry, which is
restored — the committed entry has no `initialSelection` in it.

## The disabled build is unchanged

`withStorybook` returns the config untouched when `STORYBOOK_ENABLED` is unset
(`dist/withStorybook.js:117`), so the graph should be exactly what it was. Proved
by bundling this branch and its base `6f185e2` with no Storybook environment
variables at all:

```sh
# from example/, on each commit
npx react-native bundle --dev true --entry-file index.js --platform ios \
  --bundle-output /tmp/s1-bundles/<head|base>-ios.bundle
npx react-native bundle --dev true --entry-file index.js --platform android \
  --bundle-output /tmp/s1-bundles/<head|base>-android.bundle
cmp -s base-ios.bundle head-ios.bundle          # → IDENTICAL
cmp -s base-android.bundle head-android.bundle  # → IDENTICAL
```

Both platforms: **byte-identical**, not merely equivalent. No Storybook module,
no resolver hook, no generated file in the graph when it is off.

## Gate results

Node for the device gates: `fnm use v24.18.0` (`.nvmrc` pins 24.x; the runners
refuse Node 25/26). Devices: iPhone 17 `F08675D3-…`, AVD `nitroui_t01`
(`emulator-5570`), adb server on 5041, Metro/harness port 8293.

| Command                                                            | Result |
| ------------------------------------------------------------------ | ------ |
| `bun run check` (root)                                              | PASS (exit 0) |
| `xcodebuild … NitroUiExample … Debug … build` (per CONTRIBUTING)     | PASS — `** BUILD SUCCEEDED **` |
| `bun run build:android` (from `example/`)                            | PASS — `BUILD SUCCESSFUL in 2m 14s` |
| `IOS_SIM_UDID=… METRO_PORT=8293 HARNESS_APP_PATH=… bun run harness:ios` | PASS — 7 suites, 99/99 tests |
| `ANDROID_AVD=nitroui_t01 METRO_PORT=8293 HARNESS_APP_PATH=… bun run harness:android` | PASS — 7 suites, 99/99 tests |
| `IOS_UDID=… METRO_PORT=8293 bun run test:real-input:ios`             | PASS — 4/4 controls |
| `ANDROID_AVD=nitroui_t01 ANDROID_ADB_SERVER_PORT=5041 METRO_PORT=8293 bun run test:real-input:android` | PASS — 4/4 controls |
| `bun run typecheck` / `lint` / `format`                              | PASS (also inside `check`) |

One caveat, recorded because it was not obvious: the **first** `harness:ios` run
failed one test — `Sizing · intrinsic (T11) › lays a cold Switch out at the size
the control measures` — on a host at load average 108 over 14 cores. The re-run
at load ~40 was green (99/99), as was `harness:android` first time. The earlier
`perf:renders` failure in the first `check` run was the same shape: jest's
default 5 s timeout on the first suite under load, with the render counts
themselves identical to baseline on the quiet re-run
(`Button/Progress/SegmentedControl/Slider/Switch` all 6/7 = baseline, `PASS -
5 wrapper(s) render exactly as many times as the baseline says`). Nothing in the
branch touches `src/`, jest, or the harness, and neither failure reproduced.

## Stories and screenshots

`docs/tasks/S1-storybook/` — 25 screenshots: every component's `Playground` plus
at least one showcase story on each platform, and the addons panels.

- iOS: `ios-{switch,slider,progress,button,segmented-control}-playground.png`,
  `ios-switch-appearances.png`, `ios-slider-steps.png`,
  `ios-progress-states.png`, `ios-button-appearances.png`,
  `ios-segmented-control-option-sets.png`,
  `ios-addons-{controls,actions,actions-payload}.png`
- Android: `android-{switch,slider,progress,button,segmented-control}-playground.png`,
  `android-switch-appearances.png`, `android-slider-steps.png`,
  `android-progress-states.png`, `android-button-appearances.png`,
  `android-segmented-control-option-sets.png`,
  `android-addons-{controls,backgrounds-dark}.png`

Coverage is the brief's: each component's `Playground` plus at least one showcase
story per platform, rendered on-device. The remaining showcase stories
(`Uncontrolled`, `Controlled`, `Sizing`, `Variants`, `Tints`, `Icons`, `Press
Counter`, `Live`, `States` on some components) are typechecked and linted as
stories against the real component props, but not individually captured.

Story inventory per file: Switch `Playground, Uncontrolled, Controlled, States,
Sizing, Appearances`; Slider `Playground, Steps, Controlled, Uncontrolled,
Sizing`; Progress `Playground, States, Live, Sizing, Appearances`; Button
`Playground, Variants, Tints, Icons, Press Counter, Sizing, Appearances`;
SegmentedControl `Playground, Uncontrolled, Controlled, Option Sets, States,
Sizing, Appearances`.

What the screenshots show, beyond "it rendered":

- Controls lists the real props (`value`, `defaultValue`, `disabled`,
  `tintColor` for Switch) and the colour row renders a working swatch on both
  platforms.
- Backgrounds lists light/`#ffffff`, dark/`#000000`, surface/`#1c1c1e`; picking
  dark paints the story background black
  (`android-addons-backgrounds-dark.png`).
- Actions does **not** double-log: one toggle produces exactly one
  `onValueChange` entry, two produce two, three produce three, and the expanded
  payload is `[false]` (`ios-addons-actions-payload.png`). So the `fn()` arg
  plus the `argTypes.*.action` pair are both kept — neither is redundant.

## Follow-ups

Not fixed — all outside this brief, none a correctness bug in it:

- Upstream: `features.ondeviceBackgrounds` writes
  `globalThis.FEATURES.<flag>` before the object exists under Metro's inline
  requires (evidence above) — the flag route is unusable on React Native 0.88.
- Upstream: the on-device story list is absent from the iOS accessibility tree
  (an XCTest snapshot exposes only the preview and the bottom bar), so iOS
  Storybook automation needs `initialSelection` or coordinate taps.
- Upstream: one Storybook launch emits 74 `ReactNativeJS` warnings - 24 times
  `[Reanimated] Dependencies should only be used on the web and are always
  ignored on native` (from `@storybook/react-native-ui`'s
  `MobileAddonsPanel`/`MobileMenuDrawer` and the `@gorhom/bottom-sheet` peer under
  Reanimated 4) and 50 times the colour-inference warning below. That is why
  Storybook mode shows React Native's "Open debugger to view warnings" badge.
  Disabled-mode runs emit no JS warnings at all (the harness forwards client
  logs, and both harness logs are empty of them).
- Upstream noise: `Addon controls: Control of type color only supports string,
  received "object" instead` — `inferControls` in `storybook` declines the
  library's `ColorValue | null` prop types; the explicit
  `control: { type: 'color' }` still renders a usable picker, so this is warning
  noise from inference, not a broken control.
- Note: `react-native bundle` does **not** apply the `withStorybook` entry swap
  (only `start` does). Not used by any gate here — the disabled-bundle proof
  needs no swap — but a Storybook-mode `bundle` silently produces the app bundle.

## Questions for orchestrator

None — nothing blocks merging. Two calls the human may want to sanity-check, both
documented above: the backgrounds addon instead of the `ondeviceBackgrounds`
feature flag (the flag crashes), and leaving `style`/`testID`/
`accessibilityLabel` off the Controls panel while every component-specific prop
has one.
