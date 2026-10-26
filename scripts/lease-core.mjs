/**
 * Device and port leases, apart from the CLI.
 *
 * Why (docs/tasks/PROCESS-review-2026-10-26.md §4 rank 7): several tasks work on
 * one machine at once, and every brief hand-wrote which simulator, AVD and ports
 * its task may use. That produced device-lending messages, one task booting
 * another's emulator, and Metro-port collisions. A lease file turns the rule into
 * a gate: ask, get an env file, release.
 *
 * State lives per *machine* - `~/.nitro-ui/` (override with `NITRO_UI_HOME`, which
 * is also how the tests stay off the real file):
 *
 *   devices.json  what may be leased (see `scripts/devices.example.json`)
 *   leases.json   who holds what
 *   leases.lock   the lock around leases.json (see `withLock`)
 *
 * No `import.meta` here, so `scripts/__tests__/lease.test.js` can import it -
 * the same reason `scripts/bench/render.mjs` exists next to `report.mjs`.
 */

import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** A lease that never releases (a killed task) must not wedge the machine. */
export const DEFAULT_TTL_MINUTES = 240;

/** How long a lock file may sit before its owner is assumed dead. */
export const LOCK_STALE_MS = 30_000;

/** How long to hold the lock before giving up - it guards one file read/write. */
export const LOCK_TIMEOUT_MS = 10_000;

/**
 * The serial this repo never lets anyone lease, whoever it belongs to: an adb
 * command without `-s` reaches every emulator the server can see, including the
 * maintainer's own (AGENTS.md). Checked against the *serial*, so a lease cannot
 * dodge it by naming a port instead.
 */
export const RESERVED_EMULATOR_PORTS = [5560];

/** What `withLock` needs from the filesystem; the tests inject their own. */
const NODE_FS = {
  openSync,
  closeSync,
  writeFileSync,
  statSync,
  unlinkSync,
};

/** Two device tasks is what one 14-core machine does without load-induced flakes. */
export const DEFAULT_MAX_DEVICE_LEASES = 2;

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
 * Validate a `devices.json` and fill the defaults, throwing one readable message
 * listing every problem: a half-usable pool is worse than none, because a task
 * would discover the gap after booting a device.
 *
 * @param {unknown} config
 * @returns {{pairs: object[], maxDeviceLeases: number, reservedEmulatorPorts: number[], reservedIdentifiers: string[]}}
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

  // Reserved on principle, not by config: whatever a devices.json says.
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

  if (problems.length > 0) {
    throw new Error(
      `devices.json is not usable:\n${problems.map((p) => `  - ${p}`).join('\n')}`
    );
  }

  return {
    pairs: cleanPairs,
    maxDeviceLeases,
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
 * Refuse a pair whose identifiers are reserved, or whose emulator port would
 * produce a reserved serial.
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
 * @param {unknown} state the parsed leases.json
 * @param {number} now
 * @param {number} ttlMinutes
 */
export function activeLeases(state, now, ttlMinutes = DEFAULT_TTL_MINUTES) {
  const ttlMs = ttlMinutes * 60_000;
  return (Array.isArray(state?.leases) ? state.leases : []).filter(
    (lease) => now - lease.acquiredAt < ttlMs
  );
}

/**
 * Is a new device lease allowed, and on which pair?
 *
 * Two limits, per the brief: at most `maxDeviceLeases` device leases at a time,
 * and an `--exclusive` lease only once every other lease has ended (the bench and
 * baseline runs that need a quiet machine - D21's wall-clock gates are refused at
 * load 10+ for a reason).
 *
 * @param {object} options
 * @param {object[]} options.active the active leases
 * @param {object[]} options.pairs the configured pairs
 * @param {number} options.maxDeviceLeases
 * @param {boolean} options.exclusive
 * @param {'ios'|'android'|'both'} options.platform
 * @param {string} options.task
 * @returns {{ok: true, pair: object} | {ok: false, reason: string, waiting: string[]}}
 */
export function decideAcquire({
  active,
  pairs,
  maxDeviceLeases,
  exclusive,
  platform,
  task,
}) {
  const held = active.filter((lease) => lease.task !== task);
  const waiting = held.map((lease) => `${lease.task} (${lease.id})`);

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
  const usable = free.filter((pair) => {
    if (platform === 'ios' && pair.ios == null) return false;
    if (platform === 'android' && pair.android == null) return false;
    return pair.ios != null || pair.android != null;
  });
  if (usable.length === 0) {
    return {
      ok: false,
      reason:
        held.length === 0
          ? `no configured pair has ${platform === 'both' ? 'a device' : `a ${platform} device`}`
          : `every pair is already leased (${[...taken].join(', ')})`,
      waiting,
    };
  }
  return { ok: true, pair: usable[0] };
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
      // Every gate must address the device by serial (AGENTS.md): the adb server
      // on a shared machine also sees other people's emulators.
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
 * with `O_EXCL` (atomic on every platform this repo runs on). Without it, two
 * tasks asking at the same second both read an empty file and both take the same
 * simulator.
 *
 * A lock older than `staleMs` belongs to a process that died mid-write, so it is
 * stolen rather than kept: a wedged lease file would block every task on the
 * machine, which is the failure this whole file exists to prevent.
 *
 * @param {object} options
 * @param {string} options.lockFile
 * @param {() => object} options.mutate runs inside the lock and returns the state to keep
 * @param {{openSync: Function, closeSync: Function, writeFileSync: Function, statSync: Function, unlinkSync: Function}} [options.fsImpl]
 * @param {((ms: number) => void)} [options.sleep]
 * @param {(() => number)} [options.now]
 * @param {() => object} [options.empty]
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
}) {
  const fs = fsImpl;
  const deadline = now() + timeoutMs;
  for (;;) {
    try {
      mkdirSync(dirname(lockFile), { recursive: true });
      const fd = fs.openSync(lockFile, 'wx');
      try {
        fs.writeFileSync(fd, `${pid} ${now()}\n`);
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
        continue; // released between the EEXIST and the stat - retry at once
      }
      if (holderMtime != null && now() - holderMtime > staleMs) {
        try {
          fs.unlinkSync(lockFile);
          continue;
        } catch {
          // Someone else stole it first; fall through to waiting.
        }
      }
      if (now() >= deadline) {
        throw new Error(
          `could not take ${lockFile} within ${timeoutMs} ms - another lease ` +
            'command is still running, or a stale lock (older than ' +
            `${staleMs} ms) is held by a dead process`
        );
      }
      sleep(20);
    }
  }

  try {
    return mutate();
  } finally {
    try {
      fs.unlinkSync(lockFile);
    } catch {
      // Already gone (stolen as stale): releasing someone else's lock would be worse.
    }
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
