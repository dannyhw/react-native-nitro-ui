const path = require('path');
const { getDefaultConfig } = require('@react-native/metro-config');
const { withMetroConfig } = require('react-native-monorepo-config');

const { withStorybook } = require('@storybook/react-native/withStorybook');

const { withRunStateRoute } = require('../scripts/harness-run-state.js');

const root = path.resolve(__dirname, '..');

/**
 * Metro configuration
 * https://facebook.github.io/metro/docs/configuration
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = withMetroConfig(getDefaultConfig(__dirname), {
  root,
  dirname: __dirname,
  conditions: ['react-native-nitro-ui-source'],
});

// The harness runner publishes what a run opted out of and the app reads it back over
// the dev server, the only host port an emulator is sure to reach.
config.server = {
  ...config.server,
  enhanceMiddleware: withRunStateRoute({ exampleDir: __dirname }),
};

// Storybook wraps last so it sees the finished config. With `STORYBOOK_ENABLED`
// unset it returns the config untouched, so no Storybook module enters the
// bundle. When set, it swaps the app entry for `.rnstorybook/index.tsx`; the
// entry is found relative to Metro's working directory, so run it from
// `example/`.
module.exports = withStorybook(config, {
  configPath: path.resolve(__dirname, './.rnstorybook'),
});
