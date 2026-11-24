/**
 * The `test` every real-input test is registered through. Its one fixture runs before
 * each test, whether or not the test names it: the app is stopped and out of the
 * window manager's focus before the test's own `app.open()` launches it fresh.
 */
import { test as base } from '@e2e-dev/mobile';

import { stopAppUntilOutOfFront } from './device-read';

export const test = base.extend<{ appOutOfFront: void }>({
  appOutOfFront: async (_fixtures, provide) => {
    await stopAppUntilOutOfFront();
    await provide(undefined);
  },
});
