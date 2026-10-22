const path = require('node:path');
const pkg = require('../package.json');

/**
 * The library is this repository's root package, so it is not a normal
 * workspace dependency of `bench/`. Declaring it here is what makes
 * `expo prebuild` / CocoaPods / Gradle autolink it - the same trick
 * `example/react-native.config.js` uses for the bare-RN app.
 *
 * `nitro-bench-probe` is a real workspace package, so it is discovered through
 * `node_modules` and needs no entry.
 */
module.exports = {
  project: {
    ios: {
      automaticPodsInstallation: true,
    },
  },
  dependencies: {
    [pkg.name]: {
      root: path.join(__dirname, '..'),
      platforms: {
        ios: {},
        android: {},
      },
    },
  },
};
