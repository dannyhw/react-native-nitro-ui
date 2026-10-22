import {
  androidEmulator,
  androidPlatform,
} from '@react-native-harness/platform-android';
import {
  applePlatform,
  appleSimulator,
} from '@react-native-harness/platform-apple';

// react-native-harness does not build the app: build a Debug iOS .app or an
// Android APK first and point HARNESS_APP_PATH at it (see CONTRIBUTING.md).
const CI = process.env.CI === 'true';

export default {
  entryPoint: './index.js',
  appRegistryComponentName: 'NitroUiExample',
  // Metro runs on this port. We use 8291 rather than the 8081 default so that
  // several checkouts (and a stock `react-native start`) can share one machine.
  // Simulators/emulators learn the port from the harness at launch, so it is not
  // baked into the build. Override per run with METRO_PORT.
  metroPort: Number(process.env.METRO_PORT ?? 8291),
  runners: [
    applePlatform({
      name: 'ios',
      bundleId: 'nitroui.example',
      device: appleSimulator(
        process.env.IOS_SIM ?? 'iPhone 17',
        process.env.IOS_VERSION ?? '27.0'
      ),
    }),
    androidPlatform({
      name: 'android',
      bundleId: 'nitroui.example',
      device: androidEmulator(process.env.AVD ?? 'nitroui_t01', {
        apiLevel: Number(process.env.ANDROID_API_LEVEL ?? 35),
        profile: process.env.AVD_PROFILE ?? 'pixel_9',
        diskSize: '2G',
        heapSize: '1G',
        snapshot: { enabled: CI },
      }),
    }),
  ],
  defaultRunner: 'ios',
  resetEnvironmentBetweenTestFiles: 'runtime',
  testTimeout: CI ? 30000 : 10000,
  platformReadyTimeout: CI ? 900000 : 300000,
  bridgeTimeout: CI ? 180000 : 120000,
  bundleStartTimeout: CI ? 180000 : 120000,
  maxAppRestarts: 4,
  detectNativeCrashes: true,
  forwardClientLogs: true,
};
