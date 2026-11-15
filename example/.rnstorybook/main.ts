// Backgrounds use the standalone addon, not the `ondeviceBackgrounds` feature
// flag: with React Native 0.88 Metro the flag is set before
// `@storybook/react-native` has created `globalThis.FEATURES`, and the app
// crashes on launch.
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
