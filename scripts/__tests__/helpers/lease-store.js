/**
 * A lease store a spawned CLI can be pointed at: `NITRO_UI_HOME` + the two files
 * inside it (`leases.json`, `devices.json`) that `lease.mjs list` reads and that a
 * device gate now has to agree with (X28).
 *
 * Not a jest module: no fixtures, no assertions — the same shape as
 * `scrubbed-env.js` and `free-lsof-stub.js`. The point is that several suites
 * (`gate.test.js`, `gate-logs.test.js`, `lease-metro-port.test.js`) drive `gate.mjs`
 * with a lease in its environment, and each of them used to invent its own pair
 * shape. One helper means the pair a test claims and the env it exports cannot
 * quietly stop matching, which is the exact drift the gate now refuses.
 *
 * The identifiers here are placeholders by design (D25): no UDID, AVD name or port
 * from a real machine, and nothing a test asserts is a substring of a real one.
 *
 * @file
 */

import fs from 'node:fs';
import path from 'node:path';

/** The pair the helper writes when a test does not name one. */
export const DEFAULT_PAIR = {
  id: 'pair-a',
  ios: {
    name: 'iPhone 17',
    udid: 'AAAA0000-0000-4000-8000-00000000000A',
    system: '27.0',
  },
  android: {
    avd: 'nitro-ui-a',
    emulatorPort: 5574,
    adbPort: 5043,
    apiLevel: 35,
    profile: 'pixel_9',
  },
  metroPort: 8295,
};

/** A second pair, for the case "a device that exists but is not mine". */
export const OTHER_PAIR = {
  id: 'pair-b',
  ios: {
    name: 'iPhone 17 B',
    udid: 'BBBB0000-0000-4000-8000-00000000000B',
    system: '27.0',
  },
  android: {
    avd: 'nitro-ui-b',
    emulatorPort: 5576,
    adbPort: 5045,
    apiLevel: 35,
    profile: 'pixel_9',
  },
  metroPort: 8296,
};

/**
 * The serial a pair's emulator console port implies — the same derivation
 * `renderEnvFile` uses, repeated here so a fixture cannot pass by coincidence.
 */
export function serialFor(pair = DEFAULT_PAIR) {
  return `emulator-${String(pair.android.emulatorPort)}`;
}

/**
 * The lease record `decideAcquire` would have written for a pair.
 *
 * @param {object} [options]
 * @param {string} [options.id]
 * @param {string} [options.task]
 * @param {'ios'|'android'|'both'} [options.platform]
 * @param {object[]} [options.holds] the pair ids the lease holds
 * @param {number} [options.ttlMinutes]
 * @param {number} [options.ageMs] how long before `now` it was acquired
 * @param {boolean} [options.exclusive]
 * @param {number} [options.now]
 */
export function leaseRecord({
  id = 'X28-1',
  task = 'X28',
  platform = 'both',
  holds = [DEFAULT_PAIR.id],
  ttlMinutes = 240,
  ageMs = 60_000,
  exclusive = false,
  now = Date.now(),
} = {}) {
  return {
    id,
    task,
    platform,
    exclusive,
    holds,
    acquiredAt: now - ageMs,
    ttlMinutes,
  };
}

/** The `devices.json` for a set of pairs. */
export function devicesFile(pairs = [DEFAULT_PAIR, OTHER_PAIR]) {
  return {
    maxDeviceLeases: 2,
    maxConcurrentBuilds: 1,
    idleShutdownMinutes: 30,
    reservedEmulatorPorts: [5560],
    reservedIdentifiers: [],
    pairs,
  };
}

/**
 * Write the store into `home`, as `lease.mjs` would have left it.
 *
 * @param {string} home the value the child's `NITRO_UI_HOME` gets
 * @param {object} [options]
 * @param {object[]} [options.pairs]
 * @param {object[] | null} [options.leases] null writes an empty store
 * @param {boolean} [options.skipDevices] leave `devices.json` unwritten
 * @returns {string} the home, for chaining
 */
export function writeLeaseStore(
  home,
  {
    pairs = [DEFAULT_PAIR, OTHER_PAIR],
    leases = [leaseRecord()],
    skipDevices = false,
  } = {}
) {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(
    path.join(home, 'leases.json'),
    `${JSON.stringify({ version: 1, leases: leases ?? [] }, null, 2)}\n`
  );
  if (!skipDevices) {
    fs.writeFileSync(
      path.join(home, 'devices.json'),
      `${JSON.stringify(devicesFile(pairs), null, 2)}\n`
    );
  }
  return home;
}

/**
 * The environment sourcing that lease's env file would have exported (X28).
 *
 * Everything `renderEnvFile` prints for the pair — device ids, ports, Metro port and
 * the three `NITRO_UI_LEASE_*` names — so a fixture that passes the gate is a
 * fixture that could have come from `lease.mjs acquire`.
 *
 * @param {object} [options]
 * @param {string} [options.home]
 * @param {object} [options.pair]
 * @param {object} [options.lease] the record from {@link leaseRecord}
 * @param {'ios'|'android'|'both'} [options.platform] what to export; defaults to the lease's
 */
export function leasedEnv({
  home = null,
  pair = DEFAULT_PAIR,
  lease = leaseRecord(),
  platform = lease.platform,
} = {}) {
  const env = {
    NITRO_UI_LEASE_ID: lease.id,
    NITRO_UI_LEASE_TASK: lease.task,
    NITRO_UI_LEASE_PLATFORM: platform,
    METRO_PORT: String(pair.metroPort),
  };
  if (home != null) env.NITRO_UI_HOME = home;
  if (platform !== 'android') {
    env.IOS_SIM_UDID = pair.ios.udid;
    env.IOS_SIM = pair.ios.name;
    env.IOS_VERSION = pair.ios.system;
  }
  if (platform !== 'ios') {
    env.ANDROID_AVD = pair.android.avd;
    env.ANDROID_API_LEVEL = String(pair.android.apiLevel ?? 35);
    env.AVD_PROFILE = pair.android.profile ?? 'pixel_9';
    env.EMULATOR_PORT = String(pair.android.emulatorPort);
    env.ANDROID_SERIAL = serialFor(pair);
    if (pair.android.adbPort != null) {
      env.ANDROID_ADB_SERVER_PORT = String(pair.android.adbPort);
    }
  }
  return env;
}
