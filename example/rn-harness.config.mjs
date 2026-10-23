import { execFileSync } from 'node:child_process';

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
//
// Everything device-related is environment-driven, because several tasks run
// this repo concurrently on one machine, each with its own simulator/AVD and
// its own Metro port. Defaults are neutral (no task name in them); a brief
// selects its devices with IOS_SIM_UDID (or IOS_SIM), ANDROID_AVD and
// METRO_PORT.
const CI = process.env.CI === 'true';

const DEFAULT_IOS_NAME = 'iPhone 17';
const DEFAULT_IOS_VERSION = '27.0';
const DEFAULT_AVD = 'nitroui';

/**
 * `appleSimulator()` selects by name + system version, so a UDID has to be
 * translated into those two. Fails loudly when the UDID is unknown or when two
 * booted/crashed devices share a name and runtime - then the harness could not
 * tell them apart either, and picking one at random in a shared machine is
 * worse than stopping.
 * @returns {ReturnType<typeof appleSimulator>}
 */
function iosDevice() {
  const udid = process.env.IOS_SIM_UDID;
  if (udid == null || udid === '') {
    return appleSimulator(
      process.env.IOS_SIM ?? DEFAULT_IOS_NAME,
      process.env.IOS_VERSION ?? DEFAULT_IOS_VERSION
    );
  }

  /** @type {{ devices: Record<string, { name: string, udid: string, isAvailable: boolean }[]> }} */
  const list = JSON.parse(
    execFileSync('xcrun', ['simctl', 'list', '-j', 'devices'], {
      encoding: 'utf8',
    })
  );
  for (const [runtimeId, devices] of Object.entries(list.devices)) {
    const match = devices.find((device) => device.udid === udid);
    if (match == null) {
      continue;
    }
    // com.apple.CoreSimulator.SimRuntime.iOS-27-0 -> 27.0
    const runtime = runtimeId.slice(runtimeId.lastIndexOf('.') + 1);
    const systemVersion = runtime
      .slice(runtime.indexOf('-') + 1)
      .replaceAll('-', '.');
    const twins = devices.filter(
      (device) => device.name === match.name && device.isAvailable !== false
    );
    if (twins.length > 1) {
      throw new Error(
        `IOS_SIM_UDID ${udid} resolves to a simulator named "${match.name}", ` +
          `but ${twins.length} available simulators share that name and ` +
          `runtime (${runtimeId}). react-native-harness selects by name, so it ` +
          'cannot honour the UDID. Rename this simulator to something unique ' +
          '(xcrun simctl rename <udid> <new-name>) or give IOS_SIM the new name.'
      );
    }
    return appleSimulator(match.name, systemVersion);
  }
  throw new Error(
    `IOS_SIM_UDID ${udid} is not a known simulator. Run ` +
      '`xcrun simctl list devices` and use one of those UDIDs, or create it ' +
      'with `xcrun simctl create <name> "iPhone 17" "iOS 27.0"`.'
  );
}

/** @returns {string} the AVD name to use (the harness creates it if missing). */
function avd() {
  return process.env.ANDROID_AVD ?? process.env.AVD ?? DEFAULT_AVD;
}

export default {
  entryPoint: './index.js',
  appRegistryComponentName: 'NitroUiExample',
  // Metro runs on this port. We use 8291 rather than the 8081 default so that
  // several checkouts (and a stock `react-native start`) can share one machine.
  // Simulators/emulators learn the port from the harness at launch, so it is not
  // baked into the build. Every concurrent task must set its own METRO_PORT.
  metroPort: Number(process.env.METRO_PORT ?? 8291),
  runners: [
    applePlatform({
      name: 'ios',
      bundleId: 'nitroui.example',
      device: iosDevice(),
    }),
    androidPlatform({
      name: 'android',
      bundleId: 'nitroui.example',
      // `AVD` is accepted as a legacy alias for `ANDROID_AVD`.
      device: androidEmulator(avd(), {
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
  // react-native-harness 1.6 has no per-test timeout: this is the budget for
  // the slowest test in the suite, not the average one. The sizing suite mounts
  // 200 hosted controls in a single test, which does not fit in 10s, so the
  // floor is 30s everywhere. Several tasks share one machine's simulators, so
  // HARNESS_TEST_TIMEOUT raises it further for a run on a loaded host.
  testTimeout: Number(process.env.HARNESS_TEST_TIMEOUT ?? 30000),
  platformReadyTimeout: CI ? 900000 : 300000,
  bridgeTimeout: CI ? 180000 : 120000,
  bundleStartTimeout: CI ? 180000 : 120000,
  maxAppRestarts: 4,
  detectNativeCrashes: true,
  forwardClientLogs: true,
};
