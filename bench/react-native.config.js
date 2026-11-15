const path = require('node:path');
const pkg = require('../package.json');

// The library is the repository root, not a workspace dependency of `bench/`,
// so autolinking finds it only through this entry.
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
