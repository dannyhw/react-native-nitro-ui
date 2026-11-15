const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const repositoryRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// `bench/` is a workspace of the library, so Metro has to watch the repository
// root.
config.watchFolders = [repositoryRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(repositoryRoot, 'node_modules'),
];

// The library is this repository, not a `node_modules` install. Map the package
// name to its root (not to `src/`) so Metro reads the real `exports` map, and
// ask for the source condition the package publishes.
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
