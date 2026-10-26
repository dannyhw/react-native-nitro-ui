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
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** A lease that never releases (a killed task) must not wedge the machine. */
export const DEFAULT_TTL_MINUTES = 240;

/**
 * The default for an `--exclusive` lease. A bench or baseline mint runs 8 to 14
 * hours (PROCESS review §4), so inheriting the 4-hour default would expire
 * mid-run and let a device task start next to the very measurement that needs a
 * quiet machine (D21). Sixteen hours covers the longest run so far, and `renew`
 * covers anything longer.
 */
export const EXCLUSIVE_TTL_MINUTES = 960;

/**
 * How long a *waiting* exclusive request's `pendingExclusive` marker stays
 * without a refresh. The waiter refreshes it on every poll, so this only has to
 * outlive one poll gap: a killed waiter stops refreshing and its marker expires
 * in about a minute instead of holding the machine drain forever.
 */
export const PENDING_EXCLUSIVE_TTL_MS = 60_000;

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
  readFileSync,
  statSync,
  unlinkSync,
  renameSync,
  linkSync,
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
 * The emulator console ports the emulator binary accepts: even numbers from 5554
 * to 5682, one per device (5555 is the console of 5554, 5575 of 5574).
 */
export const EMULATOR_PORT_FLOOR = 5554;
export const EMULATOR_PORT_CEILING = 5682;

/**
 * Is this adb serial the one nobody may use? Compared on the serial rather than
 * the configuration, because by the time a script holds a serial the lease may
 * have come from anywhere.
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
 * installs.
 *
 * The lease is the only thing standing between six concurrent tasks and one
 * person's device, and it works by naming a serial - which holds only while the
 * emulator really boots on that port. Two rules keep the promise honest (review
 * S5): a port that is set has to be one the emulator can take, and nothing may
 * name a reserved serial, whether it arrived as `EMULATOR_PORT` or as
 * `ANDROID_SERIAL`. A serial and a port that disagree is the same mistake in
 * two places, so it is refused as well rather than resolved by whoever reads
 * them first.
 *
 * Nothing here requires a lease: a CI job boots its own emulator and sets
 * neither variable, which is legal - the rule is about what is named, not about
 * what is missing.
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

/**
 * Is this lease still alive? Every lease is judged by **its own** ttl, never by
 * the ttl of whoever happens to be asking (review M1): a `--ttl-minutes 1`
 * probe must not evict the 16-hour exclusive lease a bench is running under, and
 * a bench must not evict a short one.
 *
 * @param {{acquiredAt: number, ttlMinutes?: number}} lease
 * @param {number} now
 */
export function leaseIsLive(lease, now) {
  const ttlMinutes = Number(lease?.ttlMinutes) || DEFAULT_TTL_MINUTES;
  return now - lease.acquiredAt < ttlMinutes * 60_000;
}

/** A waiting exclusive request that is still refreshing its marker? */
export function pendingIsLive(pending, now) {
  return now - pending.requestedAt < PENDING_EXCLUSIVE_TTL_MS;
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
 * Pure and shared, so the eviction rule has one home and one test. It used to
 * live in the CLI, take the *caller's* ttl and get persisted, which is how a
 * short probe deleted someone else's long lease (review M1).
 *
 * @param {unknown} state
 * @param {number} now
 */
export function pruneExpired(state, now) {
  const pending = (
    Array.isArray(state?.pendingExclusive) ? state.pendingExclusive : []
  ).filter((entry) => pendingIsLive(entry, now));
  const pruned = { ...state, leases: activeLeases(state, now) };
  if (pending.length > 0) pruned.pendingExclusive = pending;
  else delete pruned.pendingExclusive;
  return pruned;
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
 * @param {object[]} [options.pending] live `pendingExclusive` requests (others')
 * @returns {{ok: true, pair: object} | {ok: false, reason: string, waiting: string[]}}
 */
export function decideAcquire({
  active,
  pairs,
  maxDeviceLeases,
  exclusive,
  platform,
  task,
  pending = [],
}) {
  const held = active.filter((lease) => lease.task !== task);
  const waiting = held.map((lease) => `${lease.task} (${lease.id})`);

  // A waiting exclusive request has to see the machine go quiet. Without this,
  // two overlapping device tasks refill each other's slots forever and the bench
  // starves until its `--wait-minutes` runs out (review S4): new non-exclusive
  // leases are held back while somebody is waiting for the whole machine.
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
 * Two rules keep the steal honest (review S3): the file records a random token,
 * and a stealer moves it aside with `rename` - a single-winner operation -
 * instead of unlinking whatever is there. Otherwise two processes that both see
 * the same corpse can each delete the other's fresh lock, and the release of the
 * first then deletes the lock of an unrelated third writer.
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
  // The restore puts the file back with that same old mtime, so without
  // remembering it every retry steals and hands back the same lock forever: a
  // waiter that should sleep turns into a core pinned at 100%.
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
        // Released between the EEXIST and the stat. Retry, but the deadline
        // below still applies: a loop that only reaches it by falling through
        // is how a wait turns into a spin.
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
      // Every failure path reaches this check. A loop where one branch jumps
      // past it is how a wait becomes a spin: the restore above puts the old
      // mtime back, so re-stealing the same lock never ends by itself.
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
      // Release by token: unlink only the lock this call wrote. Deleting an
      // unrelated lock is what let a third writer in alongside a live one.
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
 * is taken again, which is the point: a lock another process created while we
 * were looking must not be overwritten. If the restore cannot happen, the live
 * owner simply finds its lock missing when it releases - harmless, because
 * release is by token and it will not delete someone else's lock.
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
