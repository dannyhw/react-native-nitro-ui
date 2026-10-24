const path = require('path');
const { getDefaultConfig } = require('@react-native/metro-config');
const { withMetroConfig } = require('react-native-monorepo-config');

const { withStorybook } = require('@storybook/react-native/withStorybook');

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

// Storybook (S1): the last wrapper, so it sees the finished config - the
// monorepo resolver above and the timing-gate route are both preserved (it
// composes `resolver.resolveRequest` and spreads the rest of the config).
//
// This is the bundler-agnostic wrapper, i.e. the documented entry-point
// swapping setup. It reads `STORYBOOK_ENABLED` itself (`enabled` defaults to
// `false` here), and when enabled it resolves the app entry - `index.js`, found
// through `package.json#main` relative to the Metro process's working directory,
// so run it from `example/` - to `.rnstorybook/index.tsx` instead, and
// regenerates `storybook.requires.ts`.
//
// With the variable unset it returns this config untouched, before any of that:
// no resolver, no generated file, no channel server. That strict no-op is what
// keeps the app, the harness (`rn-harness.config.mjs`) and the real-input runner
// bundling exactly what they bundled before Storybook existed - no Storybook
// module in the graph at all. Verified by diffing the disabled bundle against
// the pre-Storybook one (`docs/tasks/S1-storybook.report.md`).
//
// `configPath` is absolute so the config is found whatever the working directory
// is, unlike the entry-point detection above.
module.exports = withStorybook(config, {
  configPath: path.resolve(__dirname, './.rnstorybook'),
});
