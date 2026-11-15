/**
 * Device and port leases, apart from the CLI: who holds which simulator, emulator and Metro
 * port on this machine. No `import.meta` here, so the jest tests can import it.
 */

import {
  closeSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** A lease that never releases (a killed task) must not wedge the machine. */
export const DEFAULT_TTL_MINUTES = 240;

/**
 * The default for an `--exclusive` lease: a bench run takes many hours, and a lease that
 * expired midway would let a device task start next to the measurement.
 */
export const EXCLUSIVE_TTL_MINUTES = 960;

/**
 * How long a waiting exclusive request's `pendingExclusive` marker lives without a
 * refresh. The waiter refreshes it on every poll, so a killed waiter's marker expires
 * in about a minute instead of holding new leases back forever.
 */
export const PENDING_EXCLUSIVE_TTL_MS = 60_000;

/**
 * How long a waiting acquire's queue ticket lives without a refresh. A waiter stamps
 * `refreshedAt` on every poll, so a killed one drops out of the queue after this gap.
 */
export const WAITER_TICKET_TTL_MS = PENDING_EXCLUSIVE_TTL_MS;

/** How long a lock file may sit before its owner is assumed dead. */
export const LOCK_STALE_MS = 30_000;

/** How long to hold the lock before giving up - it guards one file read/write. */
export const LOCK_TIMEOUT_MS = 10_000;

/**
 * Emulator ports that are never leased: the emulator on them belongs to a person, not
 * to the pool. Checked against the serial, so a lease cannot dodge it by naming a port.
 */
export const RESERVED_EMULATOR_PORTS = [5560];

/** What `withLock` needs from the filesystem; the tests inject their own. */
const NODE_FS = {
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
  statSync,
  unlinkSync,
  renameSync,
  linkSync,
};

/** More concurrent device tasks than this load the machine enough to make device runs flaky. */
export const DEFAULT_MAX_DEVICE_LEASES = 2;

/**
 * How long a pool device may sit idle before `lease.mjs reap` powers it off. A machine
 * overrides it through devices.json's `idleShutdownMinutes`.
 */
export const IDLE_SHUTDOWN_DEFAULT_MINUTES = 30;

/** The gap between two looks at `adb devices` / `simctl list` while a device boots. */
export const DEVICE_POLL_MS = 2_000;

/** Format version of `~/.nitro-ui/pool.json`. */
export const POOL_STATE_VERSION = 1;

/**
 * A boot is settled once the machine's 1-minute load average drops below this multiple
 * of the core count: a suite started earlier runs while the boot is still draining.
 */
export const LOAD_SETTLE_CORE_MULTIPLIER = 0.5;

/** Cap on waiting for the load to settle: a busy machine must not hang a lease forever. */
export const LOAD_SETTLE_TIMEOUT_MS = 180_000;

/** Cap on waiting for a cold boot to attach (`emulator` + `simctl` can be slow, not stuck). */
export const DEVICE_SETTLE_TIMEOUT_MS = 420_000;

/**
 * How long a `phase: 'booting'` record keeps a device off the reaper: the same bound the boot wait
 * itself has, because a boot that outlives its own timeout is no longer a boot in progress.
 */
export const BOOTING_PROTECTION_MS = DEVICE_SETTLE_TIMEOUT_MS;

/**
 * Is a device in use? A gate claims its lease's devices for the duration of a run, so busy
 * means a claim whose pid is still alive, or a boot that has not finished. A claim left by a
 * killed process counts for nothing.
 */
export function deviceIsBusy(entry, nowMs, isPidAlive = pidIsAlive) {
  if (!entry) return false;
  // A boot protects the device only for as long as a boot can take, so a task that died
  // mid-boot does not leave it un-reapable. A `booting` record with no timestamp protects nothing.
  if (entry.phase === 'booting') {
    const since = Number(entry.phaseAtMs);
    return Number.isFinite(since) && nowMs - since < BOOTING_PROTECTION_MS;
  }
  return (entry.claims ?? []).some((claim) => isPidAlive(claim?.pid));
}

export function pidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

/**
 * Reaping decision for one pool record. A device with a run in flight is never reaped, and
 * neither is one a live lease holds, however long it has idled: a working task (a build, Metro,
 * a pause between two commands) holds its lease without writing a claim. Anything else is
 * reaped once its idle limit has passed.
 */
export function poolReapDecision(
  entry,
  {
    nowMs,
    leases,
    defaultIdleMinutes = IDLE_SHUTDOWN_DEFAULT_MINUTES,
    isPidAlive = pidIsAlive,
    overrideIdleMinutes = null,
  }
) {
  const started = entry?.bootedAtMs ?? nowMs;
  const lastSeen = Math.max(started, entry?.lastUsedMs ?? 0);
  const idleMs = Math.max(0, nowMs - lastSeen);
  const lease = entry?.leaseId
    ? (leases ?? []).find((x) => x.id === entry.leaseId)
    : undefined;
  // Any live lease holds the device, including the lease of the task that runs the reap.
  const leaseIsLiveNow = lease != null && leaseIsLive(lease, nowMs);
  const held = leaseIsLiveNow;
  // The CLI's `--idle-minutes` outranks the record's value. `0` is a real override, hence `??`.
  const idleMinutes =
    overrideIdleMinutes ??
    entry?.idleShutdownMinutes ??
    defaultIdleMinutes ??
    IDLE_SHUTDOWN_DEFAULT_MINUTES;
  if (deviceIsBusy(entry, nowMs, isPidAlive)) {
    return {
      action: 'keep',
      reason: entry.phase === 'booting' ? 'booting' : 'busy',
      idleMs,
      protected: true,
    };
  }
  if (held) {
    return {
      action: 'keep',
      reason: idleMs >= idleMinutes * 60_000 ? 'lease-held' : 'idle-grace',
      idleMs,
      protected: true,
      leaseId: lease.id,
    };
  }
  if (idleMs >= idleMinutes * 60_000) {
    return {
      action: 'reap',
      reason: leaseIsLiveNow ? 'idle' : 'lease-gone',
      idleMs,
      protected: false,
    };
  }
  return {
    action: 'keep',
    reason: 'unowned-grace',
    idleMs,
    protected: true,
  };
}

/** Load-average ceiling under which a device run is measured on a settled machine. */
export function loadSettleCeiling(cores) {
  return Math.max(
    1,
    Math.round(cores * LOAD_SETTLE_CORE_MULTIPLIER * 100) / 100
  );
}

/** @param {NodeJS.ProcessEnv} [env] @returns {string} */
export function stateHome(env = process.env) {
  return env.NITRO_UI_HOME ?? join(homedir(), '.nitro-ui');
}

/** @param {string} home */
export function statePaths(home) {
  return {
    home,
    devices: join(home, 'devices.json'),
    leases: join(home, 'leases.json'),
    lock: join(home, 'leases.lock'),
  };
}

/**
 * Validate a `devices.json` and fill the defaults, throwing one message that lists
 * every problem.
 *
 * @param {unknown} config
 * @returns {{pairs: object[], maxDeviceLeases: number, idleShutdownMinutes: number, reservedEmulatorPorts: number[], reservedIdentifiers: string[]}}
 */
export function normalizeDevices(config) {
  const problems = [];
  const pairs = Array.isArray(config?.pairs) ? config.pairs : null;
  if (pairs == null || pairs.length === 0) {
    problems.push(
      'pairs must list at least one { id, ios, android, metroPort }'
    );
  }

  const seen = new Set();
  const cleanPairs = [];
  for (const [index, pair] of (pairs ?? []).entries()) {
    const id = typeof pair?.id === 'string' && pair.id !== '' ? pair.id : null;
    if (id == null) {
      problems.push(`pairs[${index}] needs a string id`);
      continue;
    }
    if (seen.has(id)) problems.push(`pairs has "${id}" twice`);
    seen.add(id);

    const ios = pair.ios;
    if (ios != null && (typeof ios.udid !== 'string' || ios.udid === '')) {
      problems.push(`pair ${id}: ios needs a udid`);
    }
    const android = pair.android;
    if (android != null) {
      if (typeof android.avd !== 'string' || android.avd === '') {
        problems.push(`pair ${id}: android needs an avd name`);
      }
      if (!Number.isInteger(android.emulatorPort)) {
        problems.push(`pair ${id}: android needs an integer emulatorPort`);
      } else if (!isConsolePort(android.emulatorPort)) {
        // The emulator ignores a port it cannot take and comes up on any free console, so the
        // serial the lease exports would not exist.
        problems.push(
          `pair ${id}: android.emulatorPort ${android.emulatorPort} is not a console port the ` +
            `emulator can take (even numbers ${EMULATOR_PORT_FLOOR}-${EMULATOR_PORT_CEILING})`
        );
      }
    }
    if (!Number.isInteger(pair.metroPort)) {
      problems.push(`pair ${id}: needs an integer metroPort`);
    }
    cleanPairs.push({
      id,
      ios: ios ?? null,
      android: android ?? null,
      metroPort: pair.metroPort,
    });
  }

  const reservedEmulatorPorts = [
    ...RESERVED_EMULATOR_PORTS,
    ...(Array.isArray(config?.reservedEmulatorPorts)
      ? config.reservedEmulatorPorts
      : []),
  ];

  // The built-in reserved ports apply whatever a devices.json says.
  for (const pair of cleanPairs) {
    const port = pair.android?.emulatorPort;
    if (port != null && reservedEmulatorPorts.includes(port)) {
      problems.push(
        `pair ${pair.id}: emulator port ${port} is reserved and can never be leased ` +
          `(serial emulator-${port})`
      );
    }
  }

  const maxDeviceLeases =
    Number.isInteger(config?.maxDeviceLeases) && config.maxDeviceLeases > 0
      ? config.maxDeviceLeases
      : DEFAULT_MAX_DEVICE_LEASES;

  // `idleShutdownMinutes: 0` is a real answer ("reap as soon as a run lets go"), so the test is
  // "a non-negative number", not truthiness.
  const idleRaw = config?.idleShutdownMinutes;
  const idleShutdownMinutes =
    typeof idleRaw === 'number' && Number.isFinite(idleRaw) && idleRaw >= 0
      ? idleRaw
      : IDLE_SHUTDOWN_DEFAULT_MINUTES;

  if (problems.length > 0) {
    throw new Error(
      `devices.json is not usable:\n${problems.map((p) => `  - ${p}`).join('\n')}`
    );
  }

  return {
    pairs: cleanPairs,
    maxDeviceLeases,
    idleShutdownMinutes,
    reservedEmulatorPorts,
    reservedIdentifiers: Array.isArray(config?.reservedIdentifiers)
      ? config.reservedIdentifiers
      : [],
  };
}

/** @param {number} port */
export function emulatorSerial(port) {
  return `emulator-${port}`;
}

/**
 * The identifiers a lease would hand out, as the env file will name them.
 * @param {object} pair
 * @param {'ios'|'android'|'both'} platform
 */
export function identifiersFor(pair, platform) {
  const ids = [];
  if (platform !== 'android' && pair.ios?.udid != null) ids.push(pair.ios.udid);
  if (platform !== 'ios' && pair.android?.avd != null)
    ids.push(pair.android.avd);
  return ids;
}

/**
 * Why a pair may not be leased (a reserved identifier, or an emulator port that
 * produces a reserved serial), or null when it may.
 *
 * @param {object} pair
 * @param {{reservedEmulatorPorts: number[], reservedIdentifiers: string[]}} devices
 * @param {'ios'|'android'|'both'} platform
 */
export function assertLeasable(pair, devices, platform) {
  const serialPort = pair.android?.emulatorPort;
  if (
    platform !== 'ios' &&
    serialPort != null &&
    devices.reservedEmulatorPorts.includes(serialPort)
  ) {
    return `pair ${pair.id} uses emulator port ${serialPort} (serial ${emulatorSerial(serialPort)}), which is reserved`;
  }
  const clash = identifiersFor(pair, platform).find((id) =>
    devices.reservedIdentifiers.includes(id)
  );
  if (clash != null) {
    return `pair ${pair.id} uses the reserved identifier "${clash}"`;
  }
  return null;
}

/**
 * The emulator console ports the emulator binary accepts: even numbers from 5554
 * to 5682, one per device (5555 is the console of 5554, 5575 of 5574).
 */
export const EMULATOR_PORT_FLOOR = 5554;
export const EMULATOR_PORT_CEILING = 5682;

/** Can the emulator binary take this console port? Even, and in range. */
export function isConsolePort(port) {
  return (
    Number.isInteger(port) &&
    port % 2 === 0 &&
    port >= EMULATOR_PORT_FLOOR &&
    port <= EMULATOR_PORT_CEILING
  );
}

/**
 * Is this adb serial one nobody may use?
 *
 * @param {string} serial e.g. `emulator-5574`
 * @param {number[]} [reservedPorts]
 */
export function isReservedSerial(
  serial,
  reservedPorts = RESERVED_EMULATOR_PORTS
) {
  const match = /^emulator-(\d+)$/.exec(String(serial ?? ''));
  if (match == null) return false;
  return reservedPorts.includes(Number(match[1]));
}

/**
 * Check the emulator environment a lease exported, before anything boots or
 * installs: a port that is set must be one the emulator can take, neither
 * `EMULATOR_PORT` nor `ANDROID_SERIAL` may name a reserved serial, and the two
 * must agree. Setting neither is legal (a CI job boots its own emulator).
 *
 * @param {Record<string, string | undefined>} [env]
 * @param {number[]} [reservedPorts]
 * @returns {{ port: number | null, serial: string | null }}
 */
export function checkEmulatorEnv(
  env = process.env,
  reservedPorts = RESERVED_EMULATOR_PORTS
) {
  const rawPort = env.EMULATOR_PORT == null ? '' : String(env.EMULATOR_PORT);
  const rawSerial =
    env.ANDROID_SERIAL == null ? '' : String(env.ANDROID_SERIAL);
  let port = null;
  if (rawPort !== '') {
    if (!/^\d+$/.test(rawPort)) {
      throw new Error(
        `lease: EMULATOR_PORT="${rawPort}" is not a port number. It comes from ` +
          '`node scripts/lease.mjs acquire` and must be `source`d, not edited.'
      );
    }
    port = Number(rawPort);
    if (
      port < EMULATOR_PORT_FLOOR ||
      port > EMULATOR_PORT_CEILING ||
      port % 2 !== 0
    ) {
      throw new Error(
        `lease: EMULATOR_PORT=${port} is not a console port the emulator can ` +
          `take (even numbers ${String(EMULATOR_PORT_FLOOR)}-${String(EMULATOR_PORT_CEILING)}). ` +
          'Change `android.emulatorPort` in devices.json.'
      );
    }
    if (reservedPorts.includes(port)) {
      throw new Error(
        `lease: EMULATOR_PORT=${port} is reserved (serial ` +
          `${emulatorSerial(port)}) and can never be used.`
      );
    }
  }
  if (rawSerial !== '') {
    if (isReservedSerial(rawSerial, reservedPorts)) {
      throw new Error(
        `lease: ANDROID_SERIAL=${rawSerial} is the reserved serial and can ` +
          'never be used, whoever owns the device behind it.'
      );
    }
    const match = /^emulator-(\d+)$/.exec(rawSerial);
    if (match != null && port != null && Number(match[1]) !== port) {
      throw new Error(
        `lease: ANDROID_SERIAL=${rawSerial} and EMULATOR_PORT=${String(port)} ` +
          'disagree about which emulator this run owns. Re-source the lease ' +
          'file (`source <(node scripts/lease.mjs acquire ...)`) rather than ' +
          'exporting one of them by hand.'
      );
    }
  }
  return { port, serial: rawSerial === '' ? null : rawSerial };
}

/** The instructions every device-side refusal ends with: lease it, source it. */
export const ACQUIRE_HINT =
  '  node scripts/lease.mjs acquire --task <ID> --boot --out /tmp/<ID>.env\n' +
  '  set -a; source /tmp/<ID>.env; set +a\n' +
  '  (CONTRIBUTING.md: "Leasing a device or port")';

/**
 * The device a run may use, read from the lease environment and from nowhere else: a
 * runner that picks a device itself can pick another task's. A named lease
 * (`NITRO_UI_LEASE_ID`) must come with every identifier it exported; a half-sourced env
 * is refused, not completed from defaults. With neither a lease nor `requireDevice`, the
 * answer is whatever the environment says, including nothing (a developer's own run, CI).
 *
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {'ios'|'android'|null} [options.platform] what the run drives; null = both sides the lease has
 * @param {string} [options.command] how to name the run in the refusal
 * @param {boolean} [options.requireDevice] insist on a device even with no lease named
 * @returns {{leased: boolean, leaseId: string | null, udid: string | null, serial: string | null,
 *   avd: string | null, adbServerPort: number | null, emulatorPort: number | null}}
 * @throws when the device the run may use cannot be read from the environment
 */
export function requireLeaseDevice({
  env = process.env,
  platform = null,
  command = 'this run',
  requireDevice = false,
} = {}) {
  const leaseId = String(env.NITRO_UI_LEASE_ID ?? '').trim();
  const leased = leaseId !== '';
  // A lease env that names no platform has no opinion, so every side the caller
  // asked for has to be there.
  const forPlatform =
    String(env.NITRO_UI_LEASE_PLATFORM ?? '').trim() ||
    (leased ? 'both' : null);
  const wants = (side) =>
    (platform == null || platform === side) &&
    (forPlatform == null || forPlatform === 'both' || forPlatform === side);
  const strict = leased || requireDevice;
  const answer = {
    leased,
    leaseId: leased ? leaseId : null,
    udid: null,
    serial: null,
    avd: null,
    adbServerPort: null,
    emulatorPort: null,
  };

  if (wants('ios')) {
    const udid = String(env.IOS_SIM_UDID ?? '').trim();
    if (udid === '' && strict) {
      throw new Error(
        `${command}: no simulator to run on - IOS_SIM_UDID is not set. This\n` +
          '       script never picks a simulator itself, because the one named\n' +
          "       here may be another task's or the maintainer's. Lease one\n" +
          '       and source it:\n' +
          ACQUIRE_HINT
      );
    }
    answer.udid = udid === '' ? null : udid;
  }

  if (wants('android')) {
    // Runs first, so a wrong device (a reserved serial, a serial that disagrees with
    // its port) is reported as that and not as a missing one.
    answer.emulatorPort = checkEmulatorEnv(env).port;
    const serial = String(env.ANDROID_SERIAL ?? '').trim();
    const avd = String(env.ANDROID_AVD ?? env.AVD ?? '').trim();
    const rawServer = String(env.ANDROID_ADB_SERVER_PORT ?? '').trim();
    if (rawServer !== '' && !/^\d+$/.test(rawServer)) {
      throw new Error(
        `lease: ANDROID_ADB_SERVER_PORT="${rawServer}" is not a port number. ` +
          'It comes from `node scripts/lease.mjs acquire` and must be `source`d, ' +
          'not edited.'
      );
    }
    if (serial === '' && strict) {
      throw new Error(
        `${command}: no emulator to run on - ANDROID_SERIAL is not set. This\n` +
          '       script does not pick an emulator: `adb devices` answers with\n' +
          '       every emulator on the machine, which is how a run with no lease\n' +
          "       ended up driving someone else's on 2026-11-11. Lease one and\n" +
          '       source it:\n' +
          ACQUIRE_HINT
      );
    }
    if (leased) {
      if (rawServer === '') {
        throw new Error(
          `${command}: ANDROID_SERIAL=${serial} with no ANDROID_ADB_SERVER_PORT ` +
            "would address the machine's own adb server, which also sees every " +
            `device on it. Lease ${leaseId} exports a private server port for this ` +
            'pair - re-source its env file rather than exporting one variable.'
        );
      }
      if (avd === '') {
        throw new Error(
          `${command}: lease ${leaseId} exports ANDROID_AVD and this run cannot ` +
            'find it, so the emulator behind ANDROID_SERIAL cannot be checked ' +
            'against the lease. Re-source the lease env file.'
        );
      }
    }
    answer.serial = serial === '' ? null : serial;
    answer.avd = avd === '' ? null : avd;
    answer.adbServerPort = rawServer === '' ? null : Number(rawServer);
  }

  return answer;
}

/**
 * The `lsof` arguments that list who is listening on one TCP port. `-Fpc` prints `p<pid>` and
 * `c<command>` on their own lines, which does not depend on the column layout of a macOS release.
 *
 * @param {number} port
 * @returns {string[]}
 */
export function lsofListenArgs(port) {
  return ['-nP', `-iTCP:${String(port)}`, '-sTCP:LISTEN', '-Fpc'];
}

/**
 * @param {string | null | undefined} text lsof's `-Fpc` stdout
 * @returns {Array<{ pid: number, command: string }>} one entry per listener pid, in file order
 */
export function parseLsofListeners(text) {
  const listeners = [];
  let current = null;
  for (const line of String(text ?? '').split('\n')) {
    const kind = line[0];
    const value = line.slice(1).trim();
    if (kind === 'p' && /^\d+$/.test(value)) {
      if (current != null) listeners.push(current);
      current = { pid: Number(value), command: '' };
    } else if (kind === 'c' && current != null && value !== '') {
      current.command = value;
    }
  }
  if (current != null) listeners.push(current);
  return listeners;
}

export function describeListener(listener) {
  return `pid ${String(listener.pid)}${
    listener.command === '' ? '' : ` (${listener.command})`
  }`;
}

/**
 * Is anything listening on `port`? Fails open when `lsof` is missing or refused, but never
 * silently: an unchecked answer carries `error`, which every caller prints.
 * `NITRO_UI_LSOF_BIN` names the program, so the tests can supply a canned answer.
 *
 * @param {object} options
 * @param {number} options.port
 * @param {(command: string, args: string[]) => {ok: boolean, text: string} | null} [options.run]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {{ port: number, checked: boolean, error: string | null, listeners: Array<{pid: number, command: string}> }}
 */
export function portListeners({ port, env = process.env, run = runLsof }) {
  const command = env.NITRO_UI_LSOF_BIN ?? 'lsof';
  if (!Number.isInteger(port) || port <= 0) {
    return {
      port: Number.isFinite(port) ? port : 0,
      checked: false,
      error: `${String(port)} is not a port number`,
      listeners: [],
    };
  }
  const answer = run(command, lsofListenArgs(port));
  if (answer == null) {
    return {
      port,
      checked: false,
      error: `${command} gave no answer`,
      listeners: [],
    };
  }
  const text = String(answer.text ?? '');
  if (answer.ok !== true && text.trim() === '') {
    // lsof's "no matching files" answer is exit 1 with nothing printed.
    return { port, checked: true, error: null, listeners: [] };
  }
  const listeners = parseLsofListeners(text);
  if (answer.ok !== true && listeners.length === 0) {
    return {
      port,
      checked: false,
      error: text.trim() || 'lsof failed',
      listeners: [],
    };
  }
  return { port, checked: true, error: null, listeners };
}

/** `lsof`, bounded and never fatal. @returns {{ok: boolean, text: string} | null} */
function runLsof(command, args) {
  try {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      timeout: 10_000,
    });
    if (result.error != null) return null;
    return {
      ok: result.status === 0,
      text: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    };
  } catch {
    return null;
  }
}

/**
 * The sentence that says a pair's Metro port is in use, or null when nothing is
 * listening on it.
 *
 * @param {{id: string, metroPort: number}} pair
 * @param {Array<{pid: number, command: string}>} listeners
 */
export function metroPortReason(pair, listeners) {
  if (listeners.length === 0) return null;
  return (
    `Metro port ${String(pair?.metroPort)} (pair ${String(pair?.id ?? '?')}) is ` +
    `served by ${listeners.map(describeListener).join(', ')} - a run is still using ` +
    'that port, and two Metro servers on one port is the ' +
    '`app bridge was replaced by a newer app connection` failure'
  );
}

/**
 * A gate's pre-flight: is the Metro port this run was handed free? The lease asked once,
 * at acquire time, and an earlier run may have left a server on the port since. An unset
 * `METRO_PORT` means no lease was sourced, so there is nothing to check; a machine with no
 * `lsof` gets a warning, not a refusal.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {(command: string, args: string[]) => {ok: boolean, text: string} | null} [run]
 * @returns {{ checked: boolean, port: number | null, reason: string | null, warning: string | null, listeners: Array<{pid: number, command?: string}> }}
 */
export function metroPreflightFromEnv(env = process.env, run) {
  const raw = env.METRO_PORT == null ? '' : String(env.METRO_PORT);
  if (raw === '')
    return {
      checked: false,
      port: null,
      reason: null,
      warning: null,
      listeners: [],
    };
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0) {
    return {
      checked: false,
      port: null,
      reason: `METRO_PORT="${raw}" is not a port number`,
      warning: null,
      listeners: [],
    };
  }
  const answer = portListeners({ port, env, run });
  if (!answer.checked) {
    return {
      checked: false,
      port,
      reason: null,
      warning: `could not check Metro port ${String(port)} (${String(answer.error)})`,
      listeners: [],
    };
  }
  const reason = metroPortReason(
    { id: 'leased', metroPort: port },
    answer.listeners
  );
  // The listeners travel with the answer: a second `lsof` for the pids could disagree with it.
  return {
    checked: true,
    port,
    reason,
    warning: null,
    listeners: answer.listeners,
  };
}

/**
 * When a lease was taken, in milliseconds. The state file is hand-editable, so an ISO string is
 * read as well as a number: an unreadable date would make a live lease look expired.
 *
 * @returns {number | null}
 */
export function leaseAcquiredAtMs(lease) {
  const raw = lease?.acquiredAt;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return parsed;
    const asNumber = Number(raw);
    if (Number.isFinite(asNumber)) return asNumber;
  }
  return null;
}

/**
 * Is this lease still alive? Judged by its own ttl, never by the ttl of whoever is asking.
 * A lease whose date cannot be read counts as alive: expiring it would power off a device
 * somebody is using, while keeping it only blocks a slot until someone releases it.
 *
 * @param {{acquiredAt: number | string, ttlMinutes?: number}} lease
 * @param {number} now
 */
export function leaseIsLive(lease, now) {
  const ttlMinutes = Number(lease?.ttlMinutes) || DEFAULT_TTL_MINUTES;
  const acquiredAt = leaseAcquiredAtMs(lease);
  if (acquiredAt == null) return true;
  return now - acquiredAt < ttlMinutes * 60_000;
}

/**
 * One timestamp field of a state file, in milliseconds: a number or an ISO string.
 *
 * @returns {number | null}
 */
function timestampMs(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return parsed;
    const asNumber = Number(raw);
    if (Number.isFinite(asNumber)) return asNumber;
  }
  return null;
}

/** When this waiter started waiting (its queue position), or null when unreadable. */
export function waiterRequestedAtMs(waiter) {
  return timestampMs(waiter?.requestedAt);
}

/** The last time this waiter touched its record, or null when unreadable. */
export function waiterTouchedAtMs(waiter) {
  return timestampMs(waiter?.refreshedAt) ?? waiterRequestedAtMs(waiter);
}

/**
 * Is this waiting request still refreshing its record? An unreadable timestamp means
 * dead, the opposite of `leaseIsLive`: a record that wrongly stays alive reserves a pair
 * nobody is coming back for, and a live waiter rewrites its record on its next poll.
 */
export function waiterIsLive(waiter, now) {
  const touched = waiterTouchedAtMs(waiter);
  if (touched == null) return false;
  return now - touched < WAITER_TICKET_TTL_MS;
}

/** A waiting exclusive request that is still refreshing its marker? */
export function pendingIsLive(pending, now) {
  return waiterIsLive(pending, now);
}

/**
 * Queue order: the time a waiter started waiting, oldest first, with the task name
 * breaking an exact tie. Without the tie-break, two tickets written in the same
 * millisecond would each see the other as not older and reserve the same free pair.
 */
export function compareWaiters(a, b) {
  const byRequested =
    (waiterRequestedAtMs(a) ?? Number.POSITIVE_INFINITY) -
    (waiterRequestedAtMs(b) ?? Number.POSITIVE_INFINITY);
  if (byRequested !== 0) return byRequested;
  return String(a?.task ?? '').localeCompare(String(b?.task ?? ''));
}

/**
 * The queue: every waiter still refreshing its record, oldest first, each stamped with
 * its `position` (1 = next in line) and `waitedMs`. An ordinary waiter records in
 * `waiters`; a waiting exclusive acquire records in `pendingExclusive`, the marker that
 * holds new device leases back, and is folded in here as a ticket.
 */
export function waitQueue(state, now) {
  const tickets = (Array.isArray(state?.waiters) ? state.waiters : []).filter(
    (ticket) => waiterIsLive(ticket, now)
  );
  const waiting = new Set(tickets.map((ticket) => ticket?.task));
  for (const marker of Array.isArray(state?.pendingExclusive)
    ? state.pendingExclusive
    : []) {
    if (waiting.has(marker?.task) || !waiterIsLive(marker, now)) continue;
    // An exclusive request needs the whole machine, so it queues as a `both` request.
    tickets.push({ ...marker, exclusive: true, platform: 'both' });
  }
  return tickets.sort(compareWaiters).map((ticket, index) => {
    const requestedAt = waiterRequestedAtMs(ticket);
    return {
      ...ticket,
      position: index + 1,
      waitedMs: requestedAt == null ? 0 : Math.max(0, now - requestedAt),
    };
  });
}

/**
 * Would this pair satisfy this waiting request? Must mirror the filter `decideAcquire`
 * applies to the pairs it offers. An exclusive waiter claims every pair.
 */
export function pairSatisfiesWaiter(pair, waiter) {
  if (pair == null || waiter == null) return false;
  if (waiter.exclusive) return true;
  if (waiter.platform === 'ios' && pair.ios == null) return false;
  if (waiter.platform === 'android' && pair.android == null) return false;
  return pair.ios != null || pair.android != null;
}

/** A wait as `4m` or `2h 11m`. */
export function formatWaited(ms) {
  const minutes = Math.max(0, Math.round(Number(ms) / 60_000 || 0));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * @param {unknown} state the parsed leases.json
 * @param {number} now
 * @returns {object[]} the leases that have not outlived their own ttl
 */
export function activeLeases(state, now) {
  return (Array.isArray(state?.leases) ? state.leases : []).filter((lease) =>
    leaseIsLive(lease, now)
  );
}

/**
 * Drop what has expired - each lease by its own ttl, each waiting request by
 * its refresh gap - and return the state to write back.
 *
 * @param {unknown} state
 * @param {number} now
 */
export function pruneExpired(state, now) {
  const pending = (
    Array.isArray(state?.pendingExclusive) ? state.pendingExclusive : []
  ).filter((entry) => pendingIsLive(entry, now));
  const waiters = (Array.isArray(state?.waiters) ? state.waiters : []).filter(
    (ticket) => waiterIsLive(ticket, now)
  );
  const pruned = { ...state, leases: activeLeases(state, now) };
  if (pending.length > 0) pruned.pendingExclusive = pending;
  else delete pruned.pendingExclusive;
  if (waiters.length > 0) pruned.waiters = waiters;
  else delete pruned.waiters;
  return pruned;
}

/**
 * Is a new device lease allowed, and on which pair?
 *
 * At most `maxDeviceLeases` device leases are held at a time, and an `--exclusive`
 * lease (a bench, which needs a quiet machine) waits until every other lease has ended.
 *
 * @param {object} options
 * @param {object[]} options.active the active leases
 * @param {object[]} options.pairs the configured pairs
 * @param {number} options.maxDeviceLeases
 * @param {boolean} options.exclusive
 * @param {'ios'|'android'|'both'} options.platform
 * @param {string} options.task
 * @param {object[]} [options.pending] live `pendingExclusive` requests (others')
 * @param {Array<{id: string, reason?: string}>} [options.portBlocked] the pairs whose
 *   Metro port a live process still serves. Such a pair is skipped the way a leased pair
 *   is, except by an exclusive acquire, which proceeds over it with a `note`.
 * @param {object[]} [options.waiters] the live queue, as `waitQueue` returns it; this task's own
 *   ticket is ignored. A pair is granted only when no older ticket can use it.
 * @param {number | null} [options.waitedSince] when this request started waiting. `null` means it
 *   holds no ticket - a `--wait-minutes 0` acquire, which is served immediately when nothing older
 *   is waiting, and refused rather than queued when something is.
 * @param {number} [options.now] used to word a queue refusal and to order an unreadable ticket,
 *   never to grant one
 * @returns {{ok: true, pair: object, note?: string} | {ok: false, reason: string, waiting: string[], queueAhead?: object[]}}
 */
export function decideAcquire({
  active,
  pairs,
  maxDeviceLeases,
  exclusive,
  platform,
  task,
  pending = [],
  portBlocked = [],
  waiters = [],
  waitedSince = null,
  now = Date.now(),
}) {
  const held = active.filter((lease) => lease.task !== task);
  const waiting = held.map((lease) => `${lease.task} (${lease.id})`);

  // New non-exclusive leases are held back while somebody waits for the whole machine:
  // otherwise overlapping device tasks refill each other's slots and the waiter starves.
  const blockers = pending.filter((entry) => entry.task !== task);
  if (!exclusive && blockers.length > 0) {
    return {
      ok: false,
      reason:
        `${blockers.map((entry) => entry.task).join(', ')} is waiting for an ` +
        'exclusive lease, so new device leases are held back while the machine drains',
      waiting: [
        ...waiting,
        ...blockers.map((entry) => `${entry.task} (waiting, exclusive)`),
      ],
    };
  }

  if (held.length === 0) {
    // Nothing to wait for; the exclusive case still has to take a pair below.
  } else if (exclusive) {
    return {
      ok: false,
      reason: `an exclusive lease waits for every other lease to end`,
      waiting,
    };
  } else if (held.length >= maxDeviceLeases) {
    return {
      ok: false,
      reason: `${held.length} device leases are already held (the limit is ${maxDeviceLeases} - two device tasks on one machine is what keeps the load away from the gates)`,
      waiting,
    };
  }

  // A lease holds one pair, an exclusive lease holds every pair (it needs a
  // quiet machine, not a free simulator).
  const taken = new Set(held.flatMap((lease) => lease.holds ?? []));
  const free = pairs.filter((pair) => !taken.has(pair.id));
  // A pair nobody holds is still unusable while a live process serves its Metro port, so
  // it is skipped like a leased one. A pair this task already holds is not blocked by
  // its own Metro.
  const ownHolds = new Set(
    active
      .filter((lease) => lease.task === task)
      .flatMap((lease) => lease.holds ?? [])
  );
  const blocked = new Map(
    (portBlocked ?? [])
      .filter((entry) => entry?.id != null && !ownHolds.has(entry.id))
      .map((entry) => [entry.id, entry.reason ?? 'its Metro port is in use'])
  );
  const portWait = free
    .filter((pair) => blocked.has(pair.id))
    .map((pair) => blocked.get(pair.id));
  // An exclusive lease is a bench, which builds its bundle into a Release app and never
  // uses Metro, so it does not wait on a busy port.
  const usable = free
    .filter((pair) => exclusive || !blocked.has(pair.id))
    .filter((pair) => {
      if (platform === 'ios' && pair.ios == null) return false;
      if (platform === 'android' && pair.android == null) return false;
      return pair.ios != null || pair.android != null;
    });
  if (usable.length === 0) {
    if (portWait.length > 0) {
      return { ok: false, reason: portWait.join('; '), waiting };
    }
    return {
      ok: false,
      reason:
        held.length === 0
          ? `no configured pair has ${platform === 'both' ? 'a device' : `a ${platform} device`}`
          : `every pair is already leased (${[...taken].join(', ')})`,
      waiting,
    };
  }
  // First come, first served: a freed pair goes to the oldest ticket that can use it, not
  // to whoever polls first. A request that holds no ticket counts as the newest, so a task
  // that releases a pair and asks again queues behind everybody already waiting. An
  // exclusive acquire is not held to the queue: the drain rule above already holds the
  // queue back for it.
  const served = new Set(held.map((lease) => lease.task));
  const myTurnAt = waitedSince ?? now;
  const aheadOfMe = (ticket) => {
    // A ticket of a task that already holds a lease is stale, not senior.
    if (served.has(ticket?.task)) return false;
    const theirs = waiterRequestedAtMs(ticket);
    // An unreadable start time counts as ahead: its ticket holds a pair for at most a
    // minute before it expires.
    if (theirs == null) return true;
    // The same millisecond: the task name decides, as in `compareWaiters`.
    if (theirs === myTurnAt) return String(ticket.task).localeCompare(task) < 0;
    return theirs < myTurnAt;
  };
  // Positions come from `waitQueue`; raw tickets are numbered here, in the same order.
  const line = (Array.isArray(waiters) ? waiters : [])
    .filter((ticket) => ticket?.task != null && ticket.task !== task)
    .sort(compareWaiters)
    .map((ticket, index) => {
      const requestedAt = waiterRequestedAtMs(ticket);
      return {
        ...ticket,
        position: ticket.position ?? index + 1,
        waitedMs:
          ticket.waitedMs ??
          (requestedAt == null ? 0 : Math.max(0, now - requestedAt)),
      };
    });
  // The oldest live ticket a pair would satisfy owns that pair, so a waiter reserves only
  // pairs it can use, and such a pair may sit idle until that waiter's next poll.
  const claims = exclusive
    ? new Map()
    : new Map(
        usable.map((pair) => [
          pair.id,
          line.find((ticket) => pairSatisfiesWaiter(pair, ticket)),
        ])
      );
  const mine = usable.filter((pair) => {
    const claimant = claims.get(pair.id);
    return claimant == null || !aheadOfMe(claimant);
  });
  if (mine.length === 0) {
    const claimants = [
      ...new Set(
        usable
          .map((pair) => claims.get(pair.id))
          .filter((claimant) => claimant != null && aheadOfMe(claimant))
      ),
    ];
    const who = claimants.map(
      (waiter) =>
        `${waiter.task} (queue position ${waiter.position}, waited ${formatWaited(
          waiter.waitedMs
        )})`
    );
    return {
      ok: false,
      reason:
        `${who.join(', ')} ${who.length === 1 ? 'is' : 'are'} already waiting for ` +
        `a pair this one could satisfy, and leases go first come, first served - ` +
        `node scripts/lease.mjs list shows the queue`,
      waiting: [
        ...waiting,
        ...claimants.map(
          (waiter) =>
            `${waiter.task} (waiting ${formatWaited(
              waiter.waitedMs
            )}, queue position ${waiter.position})`
        ),
      ],
      queueAhead: claimants.map((waiter) => ({
        task: waiter.task,
        id: waiter.id ?? null,
        platform: waiter.platform ?? null,
        position: waiter.position,
        waitedMs: waiter.waitedMs,
      })),
    };
  }
  // An exclusive acquire proceeds over a busy Metro port, with a note for `lease.mjs` to print.
  if (exclusive && portWait.length > 0) {
    return {
      ok: true,
      pair: mine[0],
      note:
        `an exclusive lease does not wait on Metro ports (a bench builds its bundle in, ` +
        `so it never uses one): proceeding over ${portWait.join('; ')}`,
    };
  }
  return { ok: true, pair: mine[0] };
}

/**
 * One `export NAME='value'` line. Quoted because a simulator name has a space in
 * it (`iPhone 17`), and an unquoted one would `source` as two words and hand the
 * next command `17` as its argument.
 *
 * @param {string} name
 * @param {string|number} value
 * @returns {string}
 */
function exportLine(name, value) {
  const text = String(value);
  return `export ${name}='${text.replaceAll(`'`, `'\\''`)}'`;
}

/**
 * The env file the caller `source`s. Names match what the gates already read
 * (`example/rn-harness.config.mjs`, `scripts/real-input/*`, `scripts/smoke/*`), so
 * leasing is a `source` and not a code change.
 *
 * @param {object} lease
 * @param {object} pair
 * @param {'ios'|'android'|'both'} [platform] what the lease was for (defaults to the lease's)
 * @returns {string}
 */
export function renderEnvFile(lease, pair, platform = lease.platform) {
  const lines = [
    `# nitro-ui lease ${lease.id} for ${lease.task} (${platform}${lease.exclusive ? ', exclusive' : ''})`,
    `# release with: node scripts/lease.mjs release ${lease.id}`,
    exportLine('NITRO_UI_LEASE_ID', lease.id),
    exportLine('NITRO_UI_LEASE_TASK', lease.task),
    exportLine('NITRO_UI_LEASE_PLATFORM', platform),
  ];
  if (platform !== 'android' && pair?.ios != null) {
    lines.push(exportLine('IOS_SIM_UDID', pair.ios.udid));
    if (pair.ios.name != null) lines.push(exportLine('IOS_SIM', pair.ios.name));
    if (pair.ios.system != null) {
      lines.push(exportLine('IOS_VERSION', pair.ios.system));
    }
  }
  if (platform !== 'ios' && pair?.android != null) {
    lines.push(exportLine('ANDROID_AVD', pair.android.avd));
    if (pair.android.apiLevel != null) {
      lines.push(exportLine('ANDROID_API_LEVEL', pair.android.apiLevel));
    }
    if (pair.android.profile != null) {
      lines.push(exportLine('AVD_PROFILE', pair.android.profile));
    }
    if (pair.android.emulatorPort != null) {
      lines.push(exportLine('EMULATOR_PORT', pair.android.emulatorPort));
      // Gates address the device by serial: the adb server on a shared machine
      // also sees other people's emulators.
      lines.push(
        exportLine('ANDROID_SERIAL', emulatorSerial(pair.android.emulatorPort))
      );
    }
    if (pair.android.adbPort != null) {
      // A private adb server, so this task never queues behind another's.
      lines.push(exportLine('ANDROID_ADB_SERVER_PORT', pair.android.adbPort));
    }
  }
  lines.push(exportLine('METRO_PORT', pair.metroPort));
  return `${lines.join('\n')}\n`;
}

/**
 * Read -> decide -> write around `leases.json`, guarded by a lock file created
 * with `O_EXCL`, so two tasks asking in the same second cannot both take the same
 * simulator.
 *
 * A lock older than `staleMs` belongs to a process that died mid-write and is
 * stolen. The file records a random token, and a stealer moves it aside with
 * `rename` (one winner) instead of unlinking it: otherwise two processes that see
 * the same dead lock can each delete the other's fresh one.
 *
 * @param {object} options
 * @param {string} options.lockFile
 * @param {() => object} options.mutate runs inside the lock and returns the state to keep
 * @param {{openSync: Function, closeSync: Function, writeFileSync: Function, readFileSync: Function, statSync: Function, unlinkSync: Function, renameSync: Function, linkSync: Function}} [options.fsImpl]
 * @param {((ms: number) => void)} [options.sleep]
 * @param {(() => number)} [options.now]
 * @param {() => object} [options.empty]
 * @param {(() => string)} [options.token] written into the lock; release is by token
 * @returns {object} what `mutate` returned
 */
export function withLock({
  lockFile,
  mutate,
  fsImpl = NODE_FS,
  sleep = (ms) =>
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
  now = () => Date.now(),
  timeoutMs = LOCK_TIMEOUT_MS,
  staleMs = LOCK_STALE_MS,
  pid = process.pid,
  token = () => randomBytes(6).toString('hex'),
}) {
  const fs = fsImpl;
  const mine = token();
  const deadline = now() + timeoutMs;
  // The mtime of a lock we moved aside and found to belong to a live process.
  // The restore keeps that old mtime, so without remembering it every retry
  // would steal and hand back the same lock without ever sleeping.
  let provedAliveAt = null;
  // Set when this iteration removed a lock left by a dead process.
  let clearedCorpse = false;
  for (;;) {
    clearedCorpse = false;
    try {
      mkdirSync(dirname(lockFile), { recursive: true });
      const fd = fs.openSync(lockFile, 'wx');
      try {
        fs.writeFileSync(fd, `${pid} ${now()} ${mine}\n`);
      } finally {
        fs.closeSync(fd);
      }
      break;
    } catch (error) {
      if (/** @type {{code?: string}} */ (error).code !== 'EEXIST') throw error;
      let holderMtime = null;
      try {
        holderMtime = fs.statSync(lockFile).mtimeMs;
      } catch {
        // Released between the EEXIST and the stat: retry, subject to the
        // deadline below.
      }
      if (
        holderMtime != null &&
        holderMtime !== provedAliveAt &&
        now() - holderMtime > staleMs
      ) {
        // One stealer wins the rename; the loser retries and waits.
        const aside = `${lockFile}.stale-${mine}`;
        let stoleIt = false;
        try {
          fs.renameSync(lockFile, aside);
          stoleIt = true;
        } catch {
          // Someone else stole it first, or it was released a moment ago.
        }
        if (stoleIt) {
          // Confirm the file we moved is the corpse we stat'ed. A lock written
          // after our stat belongs to somebody live: put it back untouched.
          const movedAt = parseLockTime(fs, aside);
          if (movedAt != null && now() - movedAt <= staleMs) {
            provedAliveAt = holderMtime;
            restoreAside(fs, aside, lockFile);
          } else {
            clearedCorpse = true;
            try {
              fs.unlinkSync(aside);
            } catch {
              // Already cleaned up; the corpse is out of the way either way.
            }
          }
        }
      }
      // Every failure path must reach this check: a branch that skipped it
      // could retry forever.
      if (now() >= deadline) {
        throw new Error(
          `could not take ${lockFile} within ${timeoutMs} ms - another lease ` +
            'command is still running, or a stale lock (older than ' +
            `${staleMs} ms) is held by a dead process`
        );
      }
      // A corpse just cleared out of the way is worth an immediate retry;
      // anything else gets a short sleep before asking again.
      if (!clearedCorpse) sleep(20);
    }
  }

  try {
    return mutate();
  } finally {
    try {
      // Release by token: unlink only the lock this call wrote.
      if (fs.readFileSync(lockFile, 'utf8').includes(mine)) {
        fs.unlinkSync(lockFile);
      }
    } catch {
      // Already gone (stolen as stale, or never ours): whoever holds it keeps it.
    }
  }
}

/** The `now()` recorded inside a lock file, or null when it cannot be read. */
function parseLockTime(fs, file) {
  try {
    const parts = fs.readFileSync(file, 'utf8').trim().split(' ');
    const created = Number(parts[1]);
    return Number.isFinite(created) ? created : null;
  } catch {
    return null;
  }
}

/**
 * Put back a lock that turned out not to be stale. `link` refuses when the path
 * is taken again, so a lock another process created meanwhile is not overwritten.
 */
function restoreAside(fs, aside, lockFile) {
  try {
    fs.linkSync(aside, lockFile);
    fs.unlinkSync(aside);
  } catch {
    // A newer lock owns the path now. Leave ours aside under a `.stale-` name.
  }
}

/** @param {string} file @param {object} state */
export function writeJsonAtomic(file, state) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(tmp, file);
}

/** @param {string} file @returns {object} */
export function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if (/** @type {{code?: string}} */ (error).code === 'ENOENT')
      return fallback;
    throw new Error(`${file} is not readable JSON: ${String(error.message)}`);
  }
}

/**
 * Block without a timer (these scripts are synchronous by design: a lease is
 * taken before a build starts, not awaited inside one).
 *
 * @param {number} ms
 */
export function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** @returns {string} a lease id a human can read in `list` */
export function newLeaseId(task, now) {
  const slug = task.replace(/[^A-Za-z0-9._-]+/g, '-');
  return `${slug}-${now.toString(36).slice(-5)}`;
}
