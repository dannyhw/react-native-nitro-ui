const path = require('path');
const { getDefaultConfig } = require('@react-native/metro-config');
const { withMetroConfig } = require('react-native-monorepo-config');

const { withTimingGateRoute } = require('../scripts/harness-timing-gate.js');

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

// One extra route, for the harness's wall-clock gates (D21): a test running in
// the app cannot see this machine's load average, so the runner publishes it and
// reads it back over the dev server - the only host port an emulator is sure to
// reach. Metro serves no project files by itself, so the route is declared here;
// it answers exactly one path and hands everything else on. See
// `scripts/harness-timing-gate.js`.
config.server = {
  ...config.server,
  enhanceMiddleware: withTimingGateRoute({ exampleDir: __dirname }),
};

module.exports = config;
