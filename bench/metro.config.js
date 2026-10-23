const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const repositoryRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// `bench/` is a workspace of the library, so Metro has to watch the repository
// root (same trick `example/` uses via react-native-monorepo-config).
config.watchFolders = [repositoryRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(repositoryRoot, 'node_modules'),
];

/**
 * The library is not installed into `node_modules` - it is this repository. Map
 * the package name to its root (not to `src/`), so Metro reads the real
 * `package.json` `exports` map, and ask for the source condition the package
 * publishes for exactly this case. `example/metro.config.js` does the same thing
 * through `react-native-monorepo-config`, which reaches the same two settings.
 *
 * The bench app imports `react-native-nitro-ui` from
 * `bench/src/implementations/nitroUi.tsx`, so this mapping is what makes the
 * `nitro-ui` arm build at all - and the release bench never starts Metro, so it
 * is exercised only by `expo export`/the native build.
 */
config.resolver.extraNodeModules = {
  'react-native-nitro-ui': repositoryRoot,
};
config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = [
  'react-native-nitro-ui-source',
  'require',
  'import',
];

module.exports = config;
