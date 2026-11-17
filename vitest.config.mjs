import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'scripts/__tests__/**/*.test.js',
      'eslint-rules/__tests__/**/*.test.js',
    ],
    environment: 'node',
    globalSetup: ['./scripts/__tests__/helpers/test-global-setup.js'],
    // Jest never times out a synchronous test, and these block on spawnSync for
    // seconds; Vitest fails one that overran its timeout even without yielding.
    testTimeout: 30_000,
  },
});
