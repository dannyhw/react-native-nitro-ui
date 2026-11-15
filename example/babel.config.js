const path = require('path');
const { getConfig } = require('react-native-builder-bob/babel-config');
const pkg = require('../package.json');

const root = path.resolve(__dirname, '..');

module.exports = getConfig(
  {
    presets: ['module:@react-native/babel-preset'],
    // Storybook's on-device UI needs react-native-reanimated, whose transform
    // is the worklets plugin. It must stay last.
    plugins: ['react-native-worklets/plugin'],
  },
  { root, pkg }
);
