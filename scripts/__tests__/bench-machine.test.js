import { describe, expect, it } from '@jest/globals';

import { installedDependenciesProblem } from '../bench/deps.mjs';
import { runDependencies } from '../bench/machine.mjs';

describe('the app versions a run records', () => {
  const FILES = {
    // bun's own shape: trailing commas, which strict JSON refuses.
    '/base/v0.9.0/bun.lock': [
      '{',
      '  "packages": {',
      '    "react-native": ["react-native@0.80.0", {},],',
      '    "@expo/ui": ["@expo/ui@54.1.2", {},],',
      '  },',
      '}',
    ].join('\n'),
    '/base/v0.9.0/bench/package.json': JSON.stringify({
      dependencies: { 'react-native': '0.80.0', '@expo/ui': '^54.0.0' },
    }),
    '/base/v0.9.0/node_modules/react-native/package.json': JSON.stringify({
      version: '0.79.9',
    }),
    '/base/v0.9.0/node_modules/@expo/ui/package.json': JSON.stringify({
      version: '54.0.0',
    }),
  };
  const read = (files) => (file) => {
    if (!Object.hasOwn(files, file)) {
      throw new Error(`ENOENT ${file}`);
    }
    return files[file];
  };

  it('records what the lock resolves beside what is installed', () => {
    const recorded = runDependencies({
      lockPath: '/base/v0.9.0/bun.lock',
      nodeModulesDir: '/base/v0.9.0/node_modules',
      read: read(FILES),
    });
    expect(recorded).toEqual({
      reactNative: '0.80.0',
      expoUi: '54.1.2',
      installedReactNative: '0.79.9',
      installedExpoUi: '54.0.0',
      source: 'bun.lock in the working tree',
    });
    expect(
      installedDependenciesProblem({
        resolved: recorded,
        installed: {
          reactNative: recorded.installedReactNative,
          expoUi: recorded.installedExpoUi,
        },
      })
    ).toContain('react-native: installed 0.79.9, lock 0.80.0');
  });

  it('records nulls, not guesses, for a lock or an install it cannot read', () => {
    expect(
      runDependencies({
        lockPath: '/base/v0.9.0/bun.lock',
        nodeModulesDir: '/base/v0.9.0/node_modules',
        read: read({}),
      })
    ).toEqual({
      reactNative: null,
      expoUi: null,
      installedReactNative: null,
      installedExpoUi: null,
      source: 'bun.lock in the working tree',
    });
  });
});
