/**
 * The example app's e2e suite: the real-input checks, driven by `@e2e-dev/mobile`
 * (agent-device) on the emulator the lease exported.
 *
 * Everything device-shaped comes from the environment, and the only device in
 * it is the leased one: `ANDROID_SERIAL` picks the emulator, and the adb server
 * behind `ANDROID_ADB_SERVER_PORT` is the one the lease owns.
 */
import type { E2EConfig } from 'e2e';
import { mobile } from '@e2e-dev/mobile';

const serial = process.env.ANDROID_SERIAL;
if (serial == null || serial === '') {
  throw new Error(
    'e2e: ANDROID_SERIAL is required — source the lease before running this suite.'
  );
}

export default {
  projectId: 'nitro-ui-real-input',
  tests: ['real-input/**/*.e2e.ts'],
  targets: [
    {
      name: 'android',
      engine: mobile({ platform: 'android', device: serial }),
      app: { bundleId: 'nitroui.example' },
    },
  ],
  // One emulator, one run: two workers would drive the same device at once.
  workers: 1,
  // A flaky check is fixed or reported, never retried green.
  retries: 0,
  // The gate reads the JSON report e2e writes to `output`; the list is for a
  // human running the suite by hand.
  reporters: ['list'],
  output: '.e2e',
  timeout: 240_000,
  launchTimeout: 180_000,
  actionTimeout: 30_000,
  assertionTimeout: 10_000,
  cache: 'off',
  agents: { default: {} },
} satisfies E2EConfig;
