const path = require('path');
const { getConfig } = require('react-native-builder-bob/babel-config');
const pkg = require('../package.json');

const root = path.resolve(__dirname, '..');

module.exports = getConfig(
  {
    presets: ['module:@react-native/babel-preset'],
    // Storybook's on-device UI is built on `react-native-reanimated` (see
    // `@storybook/react-native`'s README: "Make sure you have
    // react-native-reanimated in your project and the plugin setup in your
    // babel config"). Reanimated 4 moved the transform to worklets, and the
    // plugin must stay last. It only rewrites files that use worklets, so the
    // default (Storybook-disabled) bundle is unaffected - `bun run storybook`
    // is the only route that pulls reanimated into the graph at all.
    plugins: ['react-native-worklets/plugin'],
  },
  { root, pkg }
);
