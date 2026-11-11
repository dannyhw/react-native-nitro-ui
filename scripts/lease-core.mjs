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
import { spawnSync } from 'node:child_process';
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

/**
 * How long a waiting acquire's **queue ticket** stays alive without a refresh (X26).
 *
 * Every waiter - exclusive or not - records one with the time it *started* waiting
 * and stamps `refreshedAt` on every poll, so a killed waiter drops out of the queue
 * in about a minute instead of reserving a pair for a task that no longer exists.
 * The same gap as the exclusive marker, deliberately: both only have to outlive one
 * poll (`POLL_MS`, 10 s by default), and two different numbers here would be two
 * different answers to "how long may a waiter disappear".
 */
export const WAITER_TICKET_TTL_MS = PENDING_EXCLUSIVE_TTL_MS;

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

/**
 * How long a pool device may sit idle before `lease.mjs reap` powers it off (X11), overridable
 * per machine through devices.json's `idleShutdownMinutes`. Thirty minutes covers the gap between
 * two runs by one task and a task that acquired and then went to lunch, and a machine that idles
 * longer than that has no reason to be paying for a booted emulator - which is also what makes an
 * iOS simulator boot the most expensive thing a task can do by accident: X11 timed four cold boots
 * of the pool's simulator and saw `load1` peak at 58.5, 64.6, 72.2 and 74.3 on a 10-core machine,
 * still 16-21 after 150 seconds. `lease.mjs acquire --boot` prints how long each boot wait took,
 * so the current cost on a given machine is a measurement rather than a number copied from here.
 */
export const IDLE_SHUTDOWN_DEFAULT_MINUTES = 30;

/**
 * How long the pool waits between two looks at `adb devices` / `simctl list` while a device comes
 * up. Two seconds is calm enough for a boot that takes a minute and cheap enough that a warm
 * device costs one poll.
 */
export const DEVICE_POLL_MS = 2_000;

/** The shape of `~/.nitro-ui/pool.json`, so a future format change is one constant. */
export const POOL_STATE_VERSION = 1;

/**
 * A boot is *settled* once the machine's 1-minute load average drops below this
 * multiple of the core count. `scripts/bench/lib.mjs` uses the same ceiling for
 * benches ("the machine is still draining a previous run"); the harness waits for
 * it too, because a suite started while the boot drains measures - or at least
 * runs - at the machine's worst moment.
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
 * One pool record per physical device: when it was booted, last handed to a run, and which runs
 * are holding it right now.
 */
export function newPoolEntry({
  key,
  kind,
  id,
  leaseId,
  idleShutdownMinutes,
  nowMs,
  bootedMs = nowMs,
}) {
  return {
    key,
    kind,
    id,
    leaseId,
    bootedAtMs: bootedMs,
    lastUsedMs: nowMs,
    idleShutdownMinutes: idleShutdownMinutes ?? IDLE_SHUTDOWN_DEFAULT_MINUTES,
    serial: null,
    udid: null,
    claims: [],
  };
}

/**
 * Is a device in use? A gate claims the devices of the lease it runs under for the duration of
 * the run (`scripts/device-pool.mjs`), so "busy" means a claim whose pid is still alive - or a
 * boot that has not finished. A claim left by a killed process is dead on arrival: pid liveness
 * is the whole protocol, which is why a reaper never has to trust a clean exit.
 */
export function deviceIsBusy(entry, nowMs, isPidAlive = pidIsAlive) {
  if (!entry) return false;
  // A boot in flight is a claim on the device (X11 review M3), but only for as long as a boot can
  // legitimately take: a task that died halfway through one would otherwise leave its device
  // un-reapable for the rest of the day, which is the same leak the pool exists to clean up. And a
  // record that says "booting" without a timestamp is not evidence of anything, so it protects
  // nothing.
  if (entry.phase === 'booting') {
    const since = Number(entry.phaseAtMs);
    return Number.isFinite(since) && nowMs - since < BOOTING_PROTECTION_MS;
  }
  return (entry.claims ?? []).some((claim) => isPidAlive(claim?.pid));
}

/** `process.kill(pid, 0)`, kept out of the pool module so the decision above stays pure. */
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
 * Reaping decision for one pool record.
 *
 * Two rules, and only two: a device with a run in flight is never touched, and a device a *live*
 * lease holds is never touched on a timer. Everything else — the boot a task released, the boot
 * whose task walked away and let its lease expire — is fair game once `idleShutdownMinutes` has
 * passed.
 *
 * The lease rule is the whole point of the second clause (X11 review M3). A warm pool protects a
 * device it is *not* looking at by reading `pool.json`, and a live lease with no in-flight claim is
 * the ordinary state of a working task: `build-app.mjs`, Metro, a direct real-input run, `bun run
 * harness:*` under its own runner, or ten minutes of reading a stack trace between two commands.
 * None of those write a claim, so a timestamp alone would power the device off underneath them —
 * and a 31-minute debug session is past any configured idle limit.
 *
 * So `--idle-minutes` (the operator's "power the pool off now") only reaches devices no live lease
 * holds; an agent that wants someone else's boot off releases their lease first. `reason` says
 * which case the caller is looking at, because `list` has to distinguish an unused hand-off from an
 * abandoned boot.
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
  // Any live lease holds the device: off-limits on a timer, whatever the clock says, including the
  // live lease of the task running the reap (X11 re-review M3). The `exceptLeaseId` that used to
  // live in this signature is gone, and with it the self-exemption that let a task's own `list` or
  // `reap` power off its own claim-less run; the exclusive power-off's exemption now lives in
  // `DevicePool.reap`, where it applies only to devices the caller explicitly named.
  const leaseIsLiveNow = lease != null && leaseIsLive(lease, nowMs);
  const held = leaseIsLiveNow;
  // An explicit override (the CLI's `--idle-minutes`) outranks what the record carries, because
  // the record's value came from devices.json in the first place and the flag exists to say
  // "not that number, this one, right now". `0` is a real override, so this is a null check.
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
    // Past the limit the reason is `lease-held` rather than `idle-grace`: the same answer, but the
    // honest one — this device is not "still in its grace period", it is somebody's, and the only
    // thing that changes that is their `release`.
    return {
      action: 'keep',
      reason: idleMs >= idleMinutes * 60_000 ? 'lease-held' : 'idle-grace',
      idleMs,
      protected: true,
      leaseId: lease.id,
    };
  }
  if (idleMs >= idleMinutes * 60_000) {
    // `idle` for a boot a live lease still owns (the task is done with it), `lease-gone` for one
    // nobody owns any more, because `list` has to tell an unused hand-off from an abandoned boot.
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
 * Validate a `devices.json` and fill the defaults, throwing one readable message
 * listing every problem: a half-usable pool is worse than none, because a task
 * would discover the gap after booting a device.
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
        // Same rule the boot enforces (X11 review N2), caught where the mistake is actually made.
        // A port the emulator cannot take used to pass here and be dropped at boot, so the AVD came
        // up on any free console and the serial the lease exported did not exist.
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

  // Simulators on the machine's *other* iOS runtimes (X20 item 3, D42 item 1): one simulator each,
  // for a short iOS-only look check - a screenshot, a probe - on an iOS the default pairs do not
  // run. They join `pairs` here, as iOS-only entries carrying `iosRuntime`, so everything that
  // already walks the pool (the reaper, an exclusive lease's power-off and its holds, `list`, the
  // Metro and unowned-device checks) covers them without a second list to forget. What keeps them
  // out of an ordinary acquire is `decideAcquire`: a pair with `iosRuntime` is handed out only to
  // `--ios-runtime`, and only a pair with it is. `doctor.mjs --setup` creates them.
  const runtimeSims = config?.iosRuntimes;
  if (runtimeSims != null && !Array.isArray(runtimeSims)) {
    problems.push('iosRuntimes must be a list of { id, ios, metroPort }');
  }
  for (const [index, entry] of (Array.isArray(runtimeSims)
    ? runtimeSims
    : []
  ).entries()) {
    const id =
      typeof entry?.id === 'string' && entry.id !== '' ? entry.id : null;
    if (id == null) {
      problems.push(`iosRuntimes[${index}] needs a string id`);
      continue;
    }
    if (seen.has(id)) problems.push(`pairs/iosRuntimes have "${id}" twice`);
    seen.add(id);
    const ios = entry.ios;
    if (ios == null || typeof ios.udid !== 'string' || ios.udid === '') {
      problems.push(`iosRuntimes ${id}: ios needs a udid`);
    }
    const system = iosRuntimeKey(ios?.system);
    if (system == null) {
      problems.push(
        `iosRuntimes ${id}: ios.system must be the runtime's version, e.g. "26.5"`
      );
    }
    if (entry.android != null) {
      problems.push(
        `iosRuntimes ${id}: an iOS-runtime simulator has no android half (it is for iOS look checks only)`
      );
    }
    if (!Number.isInteger(entry.metroPort)) {
      problems.push(`iosRuntimes ${id}: needs an integer metroPort`);
    }
    cleanPairs.push({
      id,
      ios: ios ?? null,
      android: null,
      metroPort: entry.metroPort,
      iosRuntime: system,
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

/**
 * An iOS version as the pool compares it: `major.minor`, so `26.5`, `26.5.1` and `"26.5"` are one
 * runtime and `26` is `26.0`. `null` for anything that is not a version.
 *
 * @param {unknown} version
 * @returns {string | null}
 */
export function iosRuntimeKey(version) {
  const match = /^(\d+)(?:\.(\d+))?(?:\.\d+)?$/.exec(
    String(version ?? '').trim()
  );
  if (match == null) return null;
  return `${Number(match[1])}.${Number(match[2] ?? 0)}`;
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
 * Can the emulator binary be told to take this console port? Even, in range. Kept next to the
 * bounds it reads so config validation and the boot cannot drift apart.
 */
export function isConsolePort(port) {
  return (
    Number.isInteger(port) &&
    port % 2 === 0 &&
    port >= EMULATOR_PORT_FLOOR &&
    port <= EMULATOR_PORT_CEILING
  );
}

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
 * Who is listening on one TCP port, as `lsof` answers it (X15 item 1).
 *
 * Why a lease asks: a lease is a naming agreement about a simulator, an emulator and a Metro
 * port, and the third name is the one that outlives its lease. The incident (FOLLOWUPS, X4
 * 2026-10-29): a task's harness kept running on pair-a after its lease there ended, the pool
 * handed pair-a to the next task, and two Metro servers on one port produced
 * `The app bridge was replaced by a newer app connection` - three device runs lost, and no
 * error message that mentioned a port. So `acquire` refuses a pair whose Metro port is served
 * by a live process, and a device gate pre-flights the port it is about to hand to its own
 * runner. Both ask this one question.
 *
 * `lsof -Fpc` is the machine-independent spelling: `p<pid>` and `c<command>` on their own lines,
 * so the answer is parsed rather than fitted to a column layout that changes between macOS
 * releases and user/localisations of the header. Empty output with exit 1 is the normal
 * "nothing is listening" answer, which is why a non-zero status is only an error when it says
 * something.
 *
 * `NITRO_UI_LSOF_BIN` names the program, for the same reason `NITRO_UI_ADB_BIN` and
 * `NITRO_UI_SIMCTL_BIN` do: the tests point it at a canned answer instead of asking the real
 * machine, so a check that depends on what some other task happens to be running is not a test.
 * Production never sets it.
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

/** How one listener reads in a refusal: a pid and the program the kernel says owns it. */
export function describeListener(listener) {
  return `pid ${String(listener.pid)}${
    listener.command === '' ? '' : ` (${listener.command})`
  }`;
}

/**
 * Is anything listening on `port`?
 *
 * Fail-open by design, with the reason printed: `lsof` can be missing (a CI runner, a container)
 * or refused by policy, and a machine that cannot ask the question must still be able to lease
 * devices. What it must not do is *silently* report the port free, so an unchecked answer carries
 * `error` and every caller says so on stderr.
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
 * The sentence that says a pair's Metro port is spoken for, or null when nothing is
 * listening on it. One home for the wording, because `lease.mjs` (refusing to hand the
 * pair out) and `gate.mjs` (refusing to start on it) must not describe the same
 * collision in two different ways.
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
 * A gate's pre-flight: is the Metro port this run was handed free?
 *
 * The second net after `lease.mjs`'s. The lease answers once, at acquire time; a run
 * that starts ten minutes later needs the same question asked again, because that is
 * how X4's incident worked - F7's harness kept serving Metro on pair-a after F7's lease
 * ended, and the pool had no way to know. Cost is one `lsof` (about 100 ms), which is
 * why this is worth doing before a four-minute build rather than during it.
 *
 * Only a run that was *given* a port has a port to check: `METRO_PORT` is printed by
 * `renderEnvFile`, so an unset one means no lease was sourced (CI, a plain `check`), and
 * the answer is "nothing to check". A machine that cannot ask (no `lsof`) is a warning,
 * not a refusal, for the same reason `lease.mjs` fails open.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {(command: string, args: string[]) => {ok: boolean, text: string} | null} [run]
 * @returns {{ checked: boolean, port: number | null, reason: string | null, warning: string | null }}
 */
export function metroPreflightFromEnv(env = process.env, run) {
  const raw = env.METRO_PORT == null ? '' : String(env.METRO_PORT);
  if (raw === '')
    return { checked: false, port: null, reason: null, warning: null };
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0) {
    return {
      checked: false,
      port: null,
      reason: `METRO_PORT="${raw}" is not a port number`,
      warning: null,
    };
  }
  const answer = portListeners({ port, env, run });
  if (!answer.checked) {
    return {
      checked: false,
      port,
      reason: null,
      // Not a refusal, but the reason it could not be checked has to travel with the
      // answer, so the caller says it out loud rather than reporting a clean port.
      warning: `could not check Metro port ${String(port)} (${String(answer.error)})`,
    };
  }
  const reason = metroPortReason(
    { id: env.NITRO_UI_LEASE_PAIR ?? 'leased', metroPort: port },
    answer.listeners
  );
  return { checked: true, port, reason, warning: null };
}

/**
 * When a lease was taken, as milliseconds, from whatever the state file holds.
 *
 * Our own writers use `Date.now()`, but this file is hand-editable and `~/.nitro-ui` is a person's
 * home directory: an ISO timestamp in there used to make `now - acquiredAt` NaN, and every
 * comparison against NaN is false — so a live lease read as *expired*, its devices as nobody's,
 * and the reaper powered off a device another task was mid-suite on. Reading the two formats the
 * file realistically holds costs nothing; getting it wrong is silent and destroys somebody's run.
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
 * Is this lease still alive? Every lease is judged by **its own** ttl, never by
 * the ttl of whoever happens to be asking (review M1): a `--ttl-minutes 1`
 * probe must not evict the 16-hour exclusive lease a bench is running under, and
 * a bench must not evict a short one.
 *
 * A lease whose date cannot be read counts as alive. Both directions have a failure mode and they
 * are not equal: expiring it powers off a device somebody is using, quietly; keeping it wedges
 * `maxDeviceLeases` until a person runs `lease.mjs list`, which shows the entry and names its task,
 * and `release` removes it. A loud block beats a silent kill.
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
 * Read one timestamp field from a state file, tolerating what a hand-edited file
 * realistically holds (a number, or an ISO string). `leaseAcquiredAtMs` explains why
 * guessing here is expensive; waiters have the same exposure - `~/.nitro-ui` is a
 * person's home directory - so they read the same two formats.
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
 * Is this waiting request still refreshing its record?
 *
 * Judged on the **refresh**, not on the start of the wait: X26 makes `requestedAt`
 * mean "when I joined the queue" for every waiter, and a waiter that is still
 * polling stamps `refreshedAt` each time. Writers before X26 refreshed
 * `requestedAt` itself, which is also readable here.
 *
 * An unreadable timestamp means *dead*, which is the opposite of `leaseIsLive` and
 * for the opposite reason: a lease that wrongly expires powers off a device somebody
 * is using, while a waiter record that wrongly stays alive reserves a pair nobody is
 * coming back for, and the next task is told to queue behind a ghost. A live waiter
 * rewrites its own record every poll, so this only costs a fresh queue position.
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
 * breaking an exact tie.
 *
 * The tie-break is not decoration. Two tickets written in the same millisecond would
 * otherwise each see the other as *not older*: both would reserve the same free pair,
 * and whichever polled second would find it gone and queue behind a task that never
 * got it. One millisecond apart, or alphabetically, exactly one of them is first.
 */
export function compareWaiters(a, b) {
  const byRequested =
    (waiterRequestedAtMs(a) ?? Number.POSITIVE_INFINITY) -
    (waiterRequestedAtMs(b) ?? Number.POSITIVE_INFINITY);
  if (byRequested !== 0) return byRequested;
  return String(a?.task ?? '').localeCompare(String(b?.task ?? ''));
}

/**
 * The queue (X26): every waiter still refreshing its record, oldest first, each
 * stamped with its `position` (1 = next in line) and `waitedMs`.
 *
 * Two arrays, one queue. `pendingExclusive` is the *drain* marker - it is what holds
 * new device leases back while a bench waits for a quiet machine - and it predates
 * the queue, so a waiting exclusive acquire keeps recording there and is folded in as
 * a ticket rather than written twice. An ordinary waiter records in `waiters`. Either
 * way there is one record per waiter, merged here, so a position is never read from
 * two places that can disagree.
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
    // An exclusive request needs the whole machine, so it is a `both` request for
    // the purposes of who may take which pair.
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
 * Would this pair satisfy this waiting request? The mirror of the filter
 * `decideAcquire` applies to the pairs it may offer, so "the pair the waiter would
 * have taken" is not a guess: same platform halves, same iOS-runtime rule, and an
 * exclusive waiter reserves every pair because that is what it takes.
 *
 * This is the whole platform half of the X26 rule: a waiter holds a claim on the pairs
 * that would satisfy *it*, and on no others. An iOS-only waiter therefore does not idle
 * an Android-only pair - that pair still goes out to whoever asks - while a `both`
 * waiter claims every pair the pool could hand it, because that is what it would take.
 */
export function pairSatisfiesWaiter(pair, waiter) {
  if (pair == null || waiter == null) return false;
  if (waiter.exclusive) return true;
  const runtime =
    waiter.iosRuntime == null ? null : iosRuntimeKey(waiter.iosRuntime);
  if ((pair.iosRuntime ?? null) !== runtime) return false;
  if (waiter.platform === 'ios' && pair.ios == null) return false;
  if (waiter.platform === 'android' && pair.android == null) return false;
  return pair.ios != null || pair.android != null;
}

/**
 * A wait long enough to refuse somebody for should read like one: `4m`, `2h 11m`.
 * Seconds are noise (a ticket only moves on a 10 s poll), and a bare `252m` hides
 * that the task in front of you has been waiting the morning away.
 */
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
  // X26: the queue expires by the same gap. A waiter that was killed - or a task
  // that was interrupted between two polls - stops refreshing and stops reserving a
  // pair about a minute later, which is what keeps a ghost from holding the line.
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
 * @param {Array<{id: string, reason?: string}>} [options.portBlocked] the pairs whose
 *   Metro port a live process still serves (X15 item 1). A pair on that list is skipped
 *   the way a leased pair is: a task that could take a *quiet* pair takes it, and one
 *   that could not waits for the port rather than being told "every pair is leased" —
 *   which would send it to `lease.mjs list`, where nothing looks wrong. An *exclusive*
 *   acquire is the exception: a bench bundles its JS into a Release build and never uses
 *   a Metro (X15 review), so it proceeds over a busy port with a `note` naming it rather
 *   than waiting an hour for a port it will not touch.
 * @param {string | null} [options.iosRuntime] `--ios-runtime`: hand out only a simulator on this
 *   iOS runtime (an `iosRuntimes` entry), and never a default pair. Without it, those simulators
 *   are never handed out (X20 item 3), so a default acquire cannot land a merge gate on them.
 * @param {object[]} [options.waiters] the live queue, as `waitQueue` returns it - other tasks'
 *   tickets included, this task's own ignored (X26). A pair is granted only when no *older* ticket
 *   can use it, so a freed pair goes to whoever has waited longest rather than to whoever polls
 *   first: read pair by pair, the oldest live ticket that pair would satisfy owns that pair.
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
  iosRuntime = null,
  waiters = [],
  waitedSince = null,
  now = Date.now(),
}) {
  const runtime = iosRuntime == null ? null : iosRuntimeKey(iosRuntime);
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
  // X15 item 1: a pair nobody holds is still not usable while a live process serves
  // its Metro port. Treat it the way a leased pair is treated, so a task that *can*
  // have a quiet pair takes it, and one that cannot waits on the port with a reason
  // that names the process rather than being told "every pair is leased" - which
  // would send it to `lease.mjs list`, where nothing about the collision is visible.
  //
  // A pair this task already holds is not blocked by its own Metro: re-running
  // `acquire` mid-suite to get the env file again is documented, and the server on
  // that port is that suite. `acquire` answers an idempotent re-acquire before it
  // asks, so this keeps the decision itself honest rather than load-bearing.
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
  // An exclusive lease is a bench or a baseline mint, and neither runs a Metro: a bench
  // builds a Release app with the bundle inside it (X15: `scripts/bench/devices.mjs:10`),
  // so it measures nothing on the port and waits for nothing on it (X15 review). Waiting
  // here was worse than useless: the wait is up to an hour, and the `pendingExclusive`
  // marker it refreshes on every poll holds back *every* non-exclusive acquire with a
  // message that never mentions the port or the process causing it. So an exclusive
  // acquire takes the machine over a stranger's Metro and says so.
  const usable = free
    .filter((pair) => exclusive || !blocked.has(pair.id))
    .filter((pair) => (pair.iosRuntime ?? null) === runtime)
    .filter((pair) => {
      if (platform === 'ios' && pair.ios == null) return false;
      if (platform === 'android' && pair.android == null) return false;
      return pair.ios != null || pair.android != null;
    });
  if (usable.length === 0) {
    if (portWait.length > 0) {
      return { ok: false, reason: portWait.join('; '), waiting };
    }
    if (runtime != null) {
      // Two different answers, because one is "wait" and the other is "go and run --setup".
      const configured = pairs.filter((pair) => pair.iosRuntime === runtime);
      return {
        ok: false,
        reason:
          configured.length === 0
            ? `no simulator on iOS ${runtime} is configured (devices.json iosRuntimes ` +
              `has ${
                [
                  ...new Set(
                    pairs.map((pair) => pair.iosRuntime).filter(Boolean)
                  ),
                ].join(', ') || 'none'
              }; node scripts/doctor.mjs --setup creates one per installed runtime)`
            : `every iOS ${runtime} simulator is already leased (${configured
                .map((pair) => pair.id)
                .join(', ')})`,
        waiting,
      };
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
  // X26: first come, first served. A freed pair goes to the oldest ticket that can use
  // it, not to whoever happens to poll first - which is what starved two tasks for five
  // hours on 2026-11-11: every task that released a pair asked again within seconds and
  // won, while the ones that had been waiting since morning lost it every time. The
  // task that just released a pair is the one most likely to ask again immediately, so
  // it queues behind everybody older too - that is the case this rule exists for, and it
  // is why "I hold no ticket" is read as *newest*, not as *first*.
  //
  // An exclusive acquire is not held to the queue: one free pair does not satisfy it (it
  // needs the machine, and every other lease gone), and the drain rule above already
  // holds the whole queue back for it. A bench that is first in line is precisely why the
  // queue is not being served.
  const served = new Set(held.map((lease) => lease.task));
  const myTurnAt = waitedSince ?? now;
  /** Is this ticket in front of this request? */
  const aheadOfMe = (ticket) => {
    // A ticket belonging to a task that already holds a lease is stale, not senior
    // (it expires on its own within a minute; it must not hold the line meanwhile).
    if (served.has(ticket?.task)) return false;
    const theirs = waiterRequestedAtMs(ticket);
    // An unreadable start time is given the benefit of the line: it holds a pair for
    // at most a minute, where guessing the other way lets a fresh acquire take a pair
    // from somebody who really has been waiting since morning.
    if (theirs == null) return true;
    // The same millisecond: `compareWaiters` decides, so exactly one of us is first.
    if (theirs === myTurnAt) return String(ticket.task).localeCompare(task) < 0;
    return theirs < myTurnAt;
  };
  // Positions come from `waitQueue`; a caller that hands over raw tickets gets them
  // numbered here, in the same order, rather than reading `undefined` in a refusal.
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
  // The rule, read pair by pair: **the oldest live ticket a pair would satisfy owns
  // that pair.** Not "one pair per waiter, chosen by whoever asks first" - that would
  // let an unticketed task take a second free pair from in front of a waiter who could
  // use it, which is the same jump dressed up as utilization. The cost is stated
  // plainly: with a waiter in the line, a pair it could use may sit idle until that
  // waiter's next poll (one `POLL_MS`, 10 s) or until an unrefreshed ticket expires
  // (60 s). A bench or a build does not notice 10 s; a task that waited five hours
  // notices everything else.
  //
  // Because it is per pair, a waiter only holds what it can actually use: an iOS-only
  // waiter cannot use an Android-only pair, so that pair still goes out to whoever asks
  // (the platform clause in the brief, in the direction the pool's own grant rule makes
  // real - a `both` request can take either half, so the asymmetry that matters is the
  // half a request *cannot* take).
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
  // The warning an exclusive acquire owes the human who is about to measure on a machine
  // somebody's Metro is still serving. `decideAcquire` is a pure decision, so it travels
  // as a note and `lease.mjs` prints it - a wait would be wrong (above), and silence
  // would be the failure mode the whole guard exists to end.
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
  if (lease.iosRuntime != null) {
    // What `gate.mjs` reads to refuse a device gate on this lease (X20 item 3): these simulators
    // are for look checks, and the merge gates run on the default pairs.
    lines.push(exportLine('NITRO_UI_LEASE_IOS_RUNTIME', lease.iosRuntime));
  }
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
