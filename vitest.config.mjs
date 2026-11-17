import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'scripts/__tests__/**/*.test.js',
      'eslint-rules/__tests__/**/*.test.js',
    ],
    environment: 'node',
    globalSetup: ['./scripts/__tests__/helpers/test-global-setup.js'],
  },
});
