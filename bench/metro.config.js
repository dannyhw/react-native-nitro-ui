const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const repositoryRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// `bench/` is a workspace of the library, so Metro has to watch the repository
// root and resolve the library's source condition (same trick `example/` uses
// via react-native-monorepo-config).
config.watchFolders = [repositoryRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(repositoryRoot, 'node_modules'),
];
config.resolver.extraNodeModules = {
  'react-native-nitro-ui': path.resolve(repositoryRoot, 'src'),
};
config.resolver.unstable_enablePackageExports = true;
config.resolver.packageExportConditionTranslations = [
  ['react-native-nitro-ui-source', 'import'],
];

module.exports = config;
