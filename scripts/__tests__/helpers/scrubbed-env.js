/**
 * The environment a test's spawned CLI runs with: the machine's, minus anything a lease put
 * there, so a suite run from a leased shell does not aim its children at that lease's devices.
 */

/**
 * Names that belong to this shell's lease rather than to the machine. `ANDROID_AVD` is matched
 * exactly rather than by prefix so `ANDROID_AVD_HOME`, which only says where the SDK lives,
 * survives.
 */
const LEASE_SCOPED_NAMES = [
  // The lease itself.
  'NITRO_UI_LEASE_ID',
  'NITRO_UI_LEASE_TASK',
  'NITRO_UI_LEASE_PLATFORM',
  'NITRO_UI_LEASE_BOOT',
  'NITRO_UI_TASK',
  'NITRO_UI_HOME',
  // iOS half. Also matched by the `IOS_` prefix below.
  'IOS_SIM',
  'IOS_SIM_UDID',
  'IOS_UDID',
  'IOS_VERSION',
  'IOS_DEVICE',
  // Android half. Every one of these can aim a command at another task's emulator.
  'ANDROID_SERIAL',
  'ANDROID_AVD',
  'ANDROID_API_LEVEL',
  'ANDROID_ADB_SERVER_PORT',
  'AVD',
  'AVD_PROFILE',
  'EMULATOR_PORT',
  'EMULATOR_BIN',
  // Metro and the artifact a device gate installs.
  'METRO_PORT',
  'METRO_PORT_IOS',
  'METRO_PORT_ANDROID',
  'HARNESS_APP_PATH',
];

/**
 * Prefixes whose whole namespace is this repo's own, so nothing outside a lease or a gate run has a
 * reason to set them.
 */
const LEASE_SCOPED_PREFIXES = ['NITRO_UI_', 'IOS_'];

/**
 * `env` with every lease-scoped name removed, as a new object.
 *
 * @param {NodeJS.ProcessEnv} env usually `process.env`
 * @returns {NodeJS.ProcessEnv}
 */
export function withoutLeaseEnv(env) {
  const out = { ...env };
  for (const name of Object.keys(out)) {
    if (
      LEASE_SCOPED_NAMES.includes(name) ||
      LEASE_SCOPED_PREFIXES.some((prefix) => name.startsWith(prefix))
    ) {
      delete out[name];
    }
  }
  return out;
}

/**
 * `process.env`, minus this shell's lease, plus what one test wants the child to see. `extra`
 * always wins, so a case that means to hand a child a lease value still can.
 *
 * @param {Record<string, string>} [extra] the test's own environment, spread last
 * @param {NodeJS.ProcessEnv} [base] usually `process.env`
 * @returns {NodeJS.ProcessEnv}
 */
export function childEnv(extra = {}, base = process.env) {
  return { ...withoutLeaseEnv(base), ...extra };
}

/** The names a test can assert a child never saw, derived from the lists the scrub uses. */
export const LEASE_SCOPED_PROBE_NAMES = [
  ...LEASE_SCOPED_NAMES,
  // Prefix representatives: a name that only the prefix would catch.
  'NITRO_UI_GATE_LOG',
  'NITRO_UI_CHECK_STEPS_FILE',
  'NITRO_UI_SIMCTL_BIN',
  'NITRO_UI_ADB_BIN',
];

/**
 * Whether the scrub removes `name`.
 *
 * @param {string} name
 */
export function isLeaseScopedEnvName(name) {
  return (
    LEASE_SCOPED_NAMES.includes(name) ||
    LEASE_SCOPED_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}
