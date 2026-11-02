/**
 * The environment a test's spawned CLI runs with: the machine's, minus anything a **lease** put
 * there.
 *
 * Why this exists (X16 item 1, FOLLOWUPS 92 / the G8 report): a task works from a shell that has
 * `set -a; source <(node scripts/lease.mjs acquire --task X --boot)`, because that is how AGENTS.md
 * says to run a device gate. Those variables then reach every child of `bun run test`, including
 * the CLI children of `gate.test.js`, `gate-check.test.js` and `gate-logs.test.js` — and those
 * suites drive `gate.mjs` inside a *throwaway checkout with a fake lease file*, so the sourced
 * values are read as if the test itself had set them. `gate.mjs` believes them: with `METRO_PORT`
 * exported it runs the Metro pre-flight (X15 item 1) and refuses the run when something is served
 * on that port, which wrote no ledger line and took out 25 tests in three files. G8's report is the
 * measurement; the workaround it recorded was "run `check` with the lease env unset", i.e. the
 * suite passed only in a shell a task does not have.
 *
 * This is a deny-list, not an allow-list, on purpose. The suites need a real environment (`PATH`,
 * `HOME`, `TMPDIR`, `ANDROID_HOME`, the Node version the fixtures are gated on); what has to go is
 * exactly the identity a lease adds — which device, which port, which lease file, which log.
 * Everything else passes through, so the helper cannot break a test by being over-strict, and a new
 * lease variable is covered by the `NITRO_UI_` / `IOS_` prefixes rather than by an edit here.
 *
 * A test that *means* to set one of these still can: every caller spreads this before its own
 * `extraEnv`, so an intentional value wins. That is what makes the deny-list usable — `gate.test.js`
 * asserts device-claim behaviour by handing a child `NITRO_UI_HOME` and a lease id of its own.
 *
 * @file Not a jest module: no fixtures, no assertions. `scripts/__tests__/helpers/free-lsof-stub.js`
 *       is the same shape.
 */

/**
 * Names that belong to *this shell's* lease rather than to the machine. Each is a fact a gate child
 * must never infer from the environment it happened to be launched in.
 *
 * `ANDROID_HOME`, `ANDROID_SDK_ROOT` and `ANDROID_AVD_HOME` are deliberately absent: those say
 * where the SDK lives, they are the same for every task on the box, and `ANDROID_AVD` is matched
 * exactly rather than by prefix precisely so `ANDROID_AVD_HOME` survives.
 */
const LEASE_SCOPED_NAMES = [
  // The lease itself.
  'NITRO_UI_LEASE_ID',
  'NITRO_UI_LEASE_TASK',
  'NITRO_UI_LEASE_PLATFORM',
  'NITRO_UI_LEASE_PAIR',
  'NITRO_UI_LEASE_BOOT',
  'NITRO_UI_TASK',
  'NITRO_UI_HOME',
  // iOS half. `IOS_` is also matched by prefix below; the names are here so a reader sees which
  // ones `renderEnvFile` actually prints.
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
  'HARNESS_APP_PATH',
];

/**
 * Prefixes whose whole namespace is this repo's own, so nothing outside a lease or a gate run has a
 * reason to set them: `NITRO_UI_GATE_LOG` (a backgrounded launcher's log path), `NITRO_UI_GATE_*`
 * forces, `NITRO_UI_CHECK_STEPS_FILE`, `NITRO_UI_LSOF_BIN`, `NITRO_UI_SIMCTL_BIN`/`NITRO_UI_ADB_BIN`
 * (the device-stub overrides `gate-logs.test.js` writes), the dwell probe's `IOS_` knobs.
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
 * The names a test can assert a child never saw, in the form a child prints them.
 *
 * Derived from the same two lists the scrub uses, so a guard that enumerates them cannot drift
 * away from the scrubber it is meant to test.
 */
export const LEASE_SCOPED_PROBE_NAMES = [
  ...LEASE_SCOPED_NAMES,
  // Prefix representatives: a name that only the prefix would catch.
  'NITRO_UI_GATE_LOG',
  'NITRO_UI_CHECK_STEPS_FILE',
  'NITRO_UI_SIMCTL_BIN',
  'NITRO_UI_ADB_BIN',
];

/**
 * Does `name` belong to the scrubber? Exported so the guard test can check the helper against
 * `scripts/lease.mjs`'s own output rather than against a list this file wrote for itself.
 *
 * @param {string} name
 */
export function isLeaseScopedEnvName(name) {
  return (
    LEASE_SCOPED_NAMES.includes(name) ||
    LEASE_SCOPED_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}
