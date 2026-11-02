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

export default {
  preset: 'react-native-harness',
  testMatch: isolated
    ? ['<rootDir>/**/__tests__/isolated/**/*.harness.[jt]s?(x)']
    : ['<rootDir>/**/__tests__/**/*.harness.[jt]s?(x)'],
  testPathIgnorePatterns: isolated
    ? ['/node_modules/']
    : ['/node_modules/', '/__tests__/isolated/'],
};
