/**
 * The harness's Jest config.
 *
 * `__tests__/isolated/` holds suites that must run in an app instance of their own -
 * a case that, if it regressed, would break every file after it in the same process
 * (G14's stranded-Modal hazard, DECISIONS D35 item 5). The shared run never sees them;
 * `NITRO_UI_HARNESS_ISOLATED=1` runs only them:
 *
 *   NITRO_UI_HARNESS_ISOLATED=1 node scripts/gate.mjs harness:ios -- BottomSheetModalHazard
 */
const isolated = process.env.NITRO_UI_HARNESS_ISOLATED === '1';

/*
 * The exclusion is a negated `testMatch` glob, not `testPathIgnorePatterns`:
 * `react-native-harness` passes its own `--testPathIgnorePatterns` (for
 * platform-suffixed files), and a CLI flag replaces the config's list - so an
 * ignore pattern here was dropped, and the shared run ran `__tests__/isolated/`
 * after all (G14 fix round 1). The negation comes after the pattern it narrows,
 * as Jest's globs require.
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
