/**
 * The harness's Jest config. `__tests__/isolated/` holds suites that must run in an app
 * instance of their own; `NITRO_UI_HARNESS_ISOLATED=1` runs only them.
 */
const isolated = process.env.NITRO_UI_HARNESS_ISOLATED === '1';

/*
 * The exclusion is a negated `testMatch` glob, not `testPathIgnorePatterns`:
 * `react-native-harness` passes its own `--testPathIgnorePatterns`, and a CLI flag
 * replaces the config's list. The negation must come after the pattern it narrows.
 */
export default {
  preset: 'react-native-harness',
  testMatch: isolated
    ? ['<rootDir>/**/__tests__/isolated/**/*.harness.[jt]s?(x)']
    : [
        '<rootDir>/**/__tests__/**/*.harness.[jt]s?(x)',
        '!**/__tests__/isolated/**',
      ],
};
