// Storybook configuration for the example app (S1).
//
// `stories` is relative to this folder and points at the example app's own
// stories; `deviceAddons` are the addons bundled into the on-device UI
// (replaces the deprecated `addons` field). Backgrounds come from the
// `ondeviceBackgrounds` feature flag, which needs no extra package in v10.3+.
import type { StorybookConfig } from '@storybook/react-native';

const main: StorybookConfig = {
  stories: ['../src/stories/**/*.stories.?(ts|tsx|js|jsx)'],
  deviceAddons: [
    '@storybook/addon-ondevice-controls',
    '@storybook/addon-ondevice-actions',
  ],
  features: {
    ondeviceBackgrounds: true,
  },
  framework: '@storybook/react-native',
};

export default main;
