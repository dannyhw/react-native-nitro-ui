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
  runnerFromArgv,
} from '../scripts/app-stamp-core.mjs';
import { checkEmulatorEnv, emulatorSerial } from '../scripts/lease-core.mjs';
// CommonJS, because `example/metro.config.js` requires the same module to serve
// the state this publishes.
import harnessTimingGate from '../scripts/harness-timing-gate.js';

const { publishTimingGate } = harnessTimingGate;

// The harness transforms `.harness.tsx` with Jest on this machine, and that
// transform breaks on Node 25/26 with an ESM error that reads like a bug in the
// test file. Say so here, before any device work, rather than after a build.
assertSupportedNode({ command: 'bun run harness:ios|android' });

// Second gate at the same point, for the other way a device run goes wrong:
// `HARNESS_APP_PATH` pointing at an app that is not this checkout's (a stale
// build, or an APK whose dex lost a generated hybrid). Refusing here happens
// before a simulator or emulator is touched, so a refusal cannot hold a device
// another task needs. `scripts/build-app.mjs` writes the stamp this reads.
const runner = runnerFromArgv(process.argv) ?? 'ios';
const explicitApp = process.env.HARNESS_APP_PATH ?? '';
// No explicit path means the fixed one this worktree's build writes, when it is
// there: publishing it back to the environment is what lets
// `bun run harness:ios` run with no environment at all.
const artifact =
  explicitApp === ''
    ? fs.existsSync(artifactPath({ platform: runner }))
      ? artifactPath({ platform: runner })
      : null
    : path.resolve(explicitApp);

if (artifact != null) {
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
    // Red because the alternative - a green run against someone else's binary -
    // reads like evidence. Printed before rethrowing so the fix is the last
    // thing on the screen of whoever ran it.
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
  // The escape hatch, for the runs that legitimately have nothing here: an app
  // built by Xcode or Android Studio at a path this file does not know, and a CI
  // action that builds the app itself. Loud, because the day a suite runs with
  // this set is the day its green means something else.
  console.log(
    colorize(
      'app.stamp: NITRO_UI_ALLOW_UNSTAMPED=1 - no artifact was checked, so this ' +
        'run proves nothing about any app in this checkout.',
      'red'
    )
  );
} else {
  // Review S10. The harness never builds, so with no artifact there is no binary
  // at all - and on Android the run then goes on against whatever the emulator
  // already has installed, which is a previous task's app or none. Printing a
  // note and continuing is how a suite ends up reporting results for a binary
  // nobody has, which is the exact failure this file exists to stop.
  throw new Error(
    `bun run harness:${runner}: no app to test.\n` +
      `       build it: node scripts/build-app.mjs --platform ${runner}\n` +
      '       (it writes app.stamp, which is what this check reads)\n' +
      '       or point HARNESS_APP_PATH at an app built another way;\n' +
      '       NITRO_UI_ALLOW_UNSTAMPED=1 runs the suite without this check.'
  );
}
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

/**
 * Which console port the emulator may boot on, checked before the first device
 * is touched (review S5).
 *
 * A lease names a serial, and that promise only holds while the emulator really
 * boots on the port behind it. `react-native-harness` starts the emulator
 * itself and used to pass no `-port`, so the console port was whatever happened
 * to be free: a leased AVD could come up as the one serial this repo never
 * touches, and the `ANDROID_SERIAL` the lease exported would name a device that
 * does not exist. The port now travels through `EMULATOR_PORT`, which the
 * harness reads through the patch in `patches/` (it adds `-port`, and the
 * emulator refuses to start rather than quietly picking another port).
 *
 * What is checked here is what the patch is about to act on: a port that the
 * emulator cannot take, a reserved serial in either variable, and a serial that
 * disagrees with its own port. Refusing at config time means no device work has
 * happened yet, so a mistake cannot leave a booted emulator behind.
 */
const emulatorBoot = checkEmulatorEnv(process.env);
if (emulatorBoot.port != null) {
  console.log(
    `lease: ${avd()} boots on console port ${String(emulatorBoot.port)} ` +
      `(serial ${emulatorSerial(emulatorBoot.port)})`
  );
}

/**
 * The machine state the wall-clock gates need (D21), published for the app to
 * read. `example/` is Metro's project root, and Metro serves a file under it
 * from disk per request, so an assertion reads a current load average instead
 * of one frozen at bundle time. Structural counters stay gated everywhere; this
 * only decides the duration gates, which run just under `HARNESS_TIMING=1`.
 */
const metroPort = Number(process.env.METRO_PORT ?? 8291);
const stopTimingGate = publishTimingGate({
  exampleDir: path.dirname(new URL(import.meta.url).pathname),
  port: metroPort,
  log: (message) => console.log(message),
});
process.once('exit', stopTimingGate);

export default {
  entryPoint: './index.js',
  appRegistryComponentName: 'NitroUiExample',
  // Metro runs on this port. We use 8291 rather than the 8081 default so that
  // several checkouts (and a stock `react-native start`) can share one machine.
  // Simulators/emulators learn the port from the harness at launch, so it is not
  // baked into the build. Every concurrent task must set its own METRO_PORT.
  metroPort,
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
  defaultRunner: runner,
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
