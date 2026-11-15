import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  androidEmulator,
  androidPlatform,
} from '@react-native-harness/platform-android';
import {
  applePlatform,
  appleSimulator,
} from '@react-native-harness/platform-apple';
import { assertSupportedNode } from '../scripts/node-version.mjs';
import {
  StaleAppError,
  artifactPath,
  assertFreshApp,
  colorize,
} from '../scripts/app-stamp.mjs';
import {
  platformForArtifact,
  selectHarnessApp,
} from '../scripts/app-stamp-core.mjs';
import {
  checkEmulatorEnv,
  emulatorSerial,
  requireLeaseDevice,
} from '../scripts/lease-core.mjs';
import {
  NITRO_UI_TEST_LOCALE_ENV,
  NITRO_UI_TEST_TZ_ENV,
  appLaunchOptionsFromEnv,
  describeAppLaunchOptions,
} from '../scripts/app-launch-env.mjs';
import {
  suiteTimingPluginFromEnv,
  SUITE_TIMING_ENV,
} from '../scripts/harness-suite-timing.mjs';
// CommonJS, because `example/metro.config.js` requires the same module to serve
// the state this publishes.
import harnessRunState from '../scripts/harness-run-state.js';

const { publishRunState } = harnessRunState;

// The harness transforms `.harness.tsx` with Jest on this machine, and that
// transform breaks on Node 25/26 with an ESM error that reads like a bug in the
// test file.
assertSupportedNode({ command: 'bun run harness:ios|android' });

// An app that was not built from this checkout is refused here, before a
// simulator or emulator is touched. The platform comes from argv first and then
// the environment: the `react-native-harness` GitHub Action loads this config
// with no runner on the command line.
const exampleDir = path.dirname(new URL(import.meta.url).pathname);
const { runner, artifact, ciStep } = selectHarnessApp({
  argv: process.argv,
  env: process.env,
  existsSync: (file) => fs.existsSync(file),
  cwd: process.cwd(),
  // The repo root: the CLI always starts in `example/`, and an app path typed
  // relative to the repository root has to be understood too.
  parentDir: path.resolve(exampleDir, '..'),
  artifactFor: (platform) => artifactPath({ platform }),
});

if (ciStep) {
  console.log(
    'app.stamp: not checked - this step reads the config to plan a cache, ' +
      'it is not a device run.'
  );
} else if (artifact != null) {
  process.env.HARNESS_APP_PATH = artifact;
  const platform = platformForArtifact(artifact) ?? runner;
  try {
    const stamp = assertFreshApp({
      platform,
      artifact,
      command: `bun run harness:${platform}`,
    });
    console.log(
      colorize(
        `app is fresh: ${artifact} (tree ${stamp.tree.slice(0, 12)}, ` +
          `${Object.keys(stamp.counts).length} components registered)`,
        'green'
      )
    );
  } catch (error) {
    console.error(
      colorize(
        error instanceof StaleAppError
          ? String(error.message)
          : `app.stamp: ${String(error?.message ?? error)}`,
        'red'
      )
    );
    throw error;
  }
} else if (process.env.NITRO_UI_ALLOW_UNSTAMPED === '1') {
  // For the runs that legitimately have no stamped app: one built by Xcode or
  // Android Studio, and a CI action that builds the app itself.
  console.log(
    colorize(
      'app.stamp: NITRO_UI_ALLOW_UNSTAMPED=1 - no artifact was checked, so this ' +
        'run proves nothing about any app in this checkout.',
      'red'
    )
  );
} else {
  // The harness never builds, so with no artifact an Android run would go on
  // against whatever the emulator already has installed.
  throw new Error(
    `bun run harness:${runner}: no app to test.\n` +
      `       build it: node scripts/build-app.mjs --platform ${runner}\n` +
      '       (it writes app.stamp, which is what this check reads)\n' +
      '       an app built another way has no stamp and is refused too -\n' +
      '       NITRO_UI_ALLOW_UNSTAMPED=1 runs the suite with no artifact check\n' +
      '       at all, against whatever the device already has installed.'
  );
}
// Everything device-related is environment-driven, because several checkouts
// can run concurrently on one machine, each with its own simulator, AVD and
// Metro port: IOS_SIM_UDID (or IOS_SIM), ANDROID_AVD and METRO_PORT.
const CI = process.env.CI === 'true';

const DEFAULT_IOS_NAME = 'iPhone 17';
const DEFAULT_IOS_VERSION = '27.0';
const DEFAULT_AVD = 'nitroui';

/**
 * `appleSimulator()` selects by name + system version, so a UDID has to be
 * translated into those two. Fails when the UDID is unknown or when two
 * simulators share a name and runtime, because the harness could not tell them
 * apart either.
 * @returns {ReturnType<typeof appleSimulator>}
 */
function iosDevice() {
  // A leased run always has a UDID; name and version are for a run outside a lease.
  const udid = leaseDevice.udid;
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

/**
 * The AVD name to use (the harness creates it if missing). `DEFAULT_AVD` is only
 * reachable with no lease named: a leased run must name its `ANDROID_AVD`.
 *
 * @returns {string}
 */
function avd() {
  return leaseDevice.avd ?? DEFAULT_AVD;
}

/**
 * The app's locale and time zone, for a run that sets neither.
 *
 * `en_US` because the DatePicker's field width is its locale's widest date, and
 * the sizes the suite expects were measured in that locale. `Europe/Lisbon`
 * because the DST round trip can only be exercised in a zone that shifts its
 * clock, and CI images boot at `UTC`.
 *
 * Override per shell with `NITRO_UI_TEST_LOCALE`/`NITRO_UI_TEST_TZ`; an empty
 * value means "ask the device".
 */
const DEFAULT_APP_TEST_LOCALE = 'en_US';
const DEFAULT_APP_TEST_TZ = 'Europe/Lisbon';

function appLaunchEnvironment() {
  const env = { ...process.env };
  if (env[NITRO_UI_TEST_LOCALE_ENV] == null) {
    env[NITRO_UI_TEST_LOCALE_ENV] = DEFAULT_APP_TEST_LOCALE;
  }
  if (env[NITRO_UI_TEST_TZ_ENV] == null) {
    env[NITRO_UI_TEST_TZ_ENV] = DEFAULT_APP_TEST_TZ;
  }
  const options = appLaunchOptionsFromEnv(env);
  const described = describeAppLaunchOptions(options);
  if (described != null) {
    console.log(
      `app-launch: the app runs at ${described} — ${NITRO_UI_TEST_LOCALE_ENV}/` +
        `${NITRO_UI_TEST_TZ_ENV}, pinned by this file (iOS launch arguments; ` +
        'the emulator takes neither, its zone is a device setting)'
    );
  }
  return options;
}

/**
 * The device this run may use. A run that names a lease (`NITRO_UI_LEASE_ID`)
 * has to name the whole device that lease exported; a half-sourced environment
 * is refused here, before the app is installed. With no lease named this
 * returns what the environment says.
 */
const leaseDevice = requireLeaseDevice({
  env: process.env,
  platform: runner,
  command: `bun run harness:${runner}`,
});
if (leaseDevice.leased) {
  console.log(
    `lease: ${leaseDevice.leaseId} runs this suite on ` +
      (runner === 'ios'
        ? `simulator ${leaseDevice.udid}`
        : `${leaseDevice.serial} (${leaseDevice.avd}) via adb server ` +
          String(leaseDevice.adbServerPort))
  );
}

/**
 * Which console port the emulator may boot on, checked before the first device
 * is touched. A lease names a serial, which only holds while the emulator boots
 * on the port behind it, so `EMULATOR_PORT` reaches the emulator as `-port`
 * through the `react-native-harness` patch in `patches/`.
 */
const emulatorBoot = checkEmulatorEnv(process.env);
if (emulatorBoot.port != null) {
  console.log(
    `lease: ${avd()} boots on console port ${String(emulatorBoot.port)} ` +
      `(serial ${emulatorSerial(emulatorBoot.port)})`
  );
}

/**
 * What this run decided, published for the app to read. Metro serves a file
 * under `example/` from disk per request, so an assertion reads the state of
 * the run that is judging it rather than a value frozen at bundle time.
 */
const metroPort = Number(process.env.METRO_PORT ?? 8291);
const stopRunStatePublisher = publishRunState({
  exampleDir,
  port: metroPort,
  log: (message) => console.log(message),
});
process.once('exit', stopRunStatePublisher);

/** Per-suite timings, when `HARNESS_SUITE_TIMING` names a file to write them to. */
const suiteTimingPlugin = suiteTimingPluginFromEnv(process.env);
if (suiteTimingPlugin != null) {
  console.log(
    `suite-timing: writing per-suite durations to ${process.env[SUITE_TIMING_ENV]}`
  );
}

export default {
  entryPoint: './index.js',
  appRegistryComponentName: 'NitroUiExample',
  // 8291 rather than the 8081 default so that several checkouts (and a stock
  // `react-native start`) can share one machine. Devices learn the port from the
  // harness at launch, so it is not baked into the build.
  metroPort,
  runners: [
    applePlatform({
      name: 'ios',
      bundleId: 'nitroui.example',
      device: iosDevice(),
      appLaunchOptions: appLaunchEnvironment(),
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
  defaultRunner: runner,
  resetEnvironmentBetweenTestFiles: 'runtime',
  // react-native-harness 1.6 has no per-test timeout: this is the budget for
  // the slowest test in the suite. The sizing suite mounts 200 hosted controls
  // in a single test, which does not fit in 10s. HARNESS_TEST_TIMEOUT raises it
  // further for a run on a loaded host.
  testTimeout: Number(process.env.HARNESS_TEST_TIMEOUT ?? 30000),
  platformReadyTimeout: CI ? 900000 : 300000,
  bridgeTimeout: CI ? 180000 : 120000,
  bundleStartTimeout: CI ? 180000 : 120000,
  maxAppRestarts: 4,
  detectNativeCrashes: true,
  forwardClientLogs: true,
  plugins: suiteTimingPlugin == null ? [] : [suiteTimingPlugin],
};
