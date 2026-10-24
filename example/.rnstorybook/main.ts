// Storybook configuration for the example app (S1).
//
// `stories` is relative to this folder and points at the example app's own
// stories; `deviceAddons` are the addons bundled into the on-device UI
// (replaces the deprecated `addons` field).
//
// Backgrounds use the standalone addon rather than the `ondeviceBackgrounds`
// feature flag: with React Native 0.88 Metro the flag crashes on launch. Metro
// inlines module imports at their use site, so the generated
// `globalThis.FEATURES.ondeviceBackgrounds = true` line runs before
// `@storybook/react-native` has created `globalThis.FEATURES` (TypeError on a
// property of undefined). The addon needs no feature flag, so nothing depends
// on that evaluation order. See S1-storybook.report.md.
import type { StorybookConfig } from '@storybook/react-native';

const main: StorybookConfig = {
  stories: ['../src/stories/**/*.stories.?(ts|tsx|js|jsx)'],
  deviceAddons: [
    '@storybook/addon-ondevice-controls',
    '@storybook/addon-ondevice-actions',
    '@storybook/addon-ondevice-backgrounds',
  ],
  framework: '@storybook/react-native',
};

export default main;
