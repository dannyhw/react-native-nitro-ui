/**
 * A machine-wide slot for native builds: a build takes a slot before it compiles
 * and releases it after, so at most `maxConcurrentBuilds` run at once.
 *
 * State lives in the lease home directory:
 *
 *   devices.json  `maxConcurrentBuilds`, with the other machine limits
 *   builds.json   who is building now
 *   builds.lock   the lock around builds.json, separate from `leases.lock` so a
 *                 polling build waiter never holds the lock a lease acquire needs
 */

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import {
  readJson,
  stateHome,
  statePaths,
  withLock,
  writeJsonAtomic,
} from './lease-core.mjs';

export const DEFAULT_MAX_CONCURRENT_BUILDS = 1;

/**
 * How long a slot whose holder cannot be inspected (another host, or no readable
 * pid) stays in the file. Never a deadline for a live build: expiring a slow
 * build's slot would admit a second build beside it.
 */
export const BUILD_SLOT_TTL_MINUTES = 45;

export const BUILD_SLOT_POLL_MS = 5_000;

/** How long a build waits for a slot before giving up. */
export const DEFAULT_BUILD_WAIT_MINUTES = 60;

/**
 * How long `doctor --prime` may spend on one platform's build: the whole queue
 * wait plus one ttl of build time, so its timer cannot kill a build that is
 * still queued.
 */
export const PRIME_BUILD_TIMEOUT_MINUTES =
  BUILD_SLOT_TTL_MINUTES + DEFAULT_BUILD_WAIT_MINUTES;

/**
 * The prime budget for one build, honouring `NITRO_UI_PRIME_TIMEOUT_MINUTES`.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {number} minutes
 */
export function primeBuildTimeoutMinutes(env = {}) {
  const raw = env.NITRO_UI_PRIME_TIMEOUT_MINUTES;
  if (raw == null || raw === '') return PRIME_BUILD_TIMEOUT_MINUTES;
  const minutes = Number(raw);
  return Number.isFinite(minutes) && minutes > 0
    ? minutes
    : PRIME_BUILD_TIMEOUT_MINUTES;
}

/** @param {string} home the same home `lease-core.mjs`'s `stateHome()` returns */
export function buildSlotPaths(home) {
  return {
    home,
    builds: join(home, 'builds.json'),
    lock: join(home, 'builds.lock'),
  };
}

/**
 * The `maxConcurrentBuilds` a `devices.json` asks for. A missing or unusable
 * value is the default, never "unlimited".
 *
 * @param {unknown} config parsed `devices.json`
 * @returns {number}
 */
export function maxConcurrentBuildsFrom(config) {
  const value = config?.maxConcurrentBuilds;
  return Number.isInteger(value) && value > 0
    ? value
    : DEFAULT_MAX_CONCURRENT_BUILDS;
}

/**
 * The limit, and a note when the key is present but unusable. An absent key is
 * the default and gets no note.
 *
 * @param {unknown} config parsed `devices.json`, or null when there is none
 * @param {string} devicesFile where it was read from, for the message
 * @returns {{max: number, note: string | null}}
 */
export function buildLimitFrom(config, devicesFile) {
  const max = maxConcurrentBuildsFrom(config);
  const object = typeof config === 'object' && config !== null;
  const present = object && 'maxConcurrentBuilds' in config;
  const value = object ? config.maxConcurrentBuilds : undefined;
  if (!present || (Number.isInteger(value) && value > 0)) {
    return { max, note: null };
  }
  return {
    max,
    note: `${devicesFile} sets maxConcurrentBuilds to ${JSON.stringify(
      value
    )}, which is not a positive integer - using the default (${String(max)})`,
  };
}

/**
 * Where this machine keeps its build-slot state, and what the limit is.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{builds: string, lock: string, home: string, max: number, devicesFile: string, note: string | null}}
 */
export function buildSlotState(env = {}) {
  const home = stateHome(env);
  const paths = buildSlotPaths(home);
  const devicesFile = env.NITRO_UI_DEVICES ?? statePaths(home).devices;
  let limit = { max: DEFAULT_MAX_CONCURRENT_BUILDS, note: null };
  try {
    limit = buildLimitFrom(readJson(devicesFile, null), devicesFile);
  } catch {
    // Unreadable pool file: the default still applies.
  }
  return { ...paths, max: limit.max, devicesFile, note: limit.note };
}

/**
 * Is this slot's ttl still unexpired? Judged by the slot's own ttl, never the
 * asker's. Only the answer for a slot whose holder cannot be inspected: use
 * `slotShouldBeRetained` to decide whether a slot stays.
 *
 * @param {{acquiredAt: number, ttlMinutes?: number}} slot
 * @param {number} now
 */
export function slotIsLive(slot, now) {
  const ttlMinutes = Number(slot?.ttlMinutes) || BUILD_SLOT_TTL_MINUTES;
  return now - slot.acquiredAt < ttlMinutes * 60_000;
}

function slotHostIsThisOne(slot, host) {
  return typeof slot?.host === 'string' && slot.host === host;
}

function slotPidIsReadable(slot) {
  const pid = Number(slot?.pid);
  return Number.isInteger(pid) && pid > 0;
}

/**
 * Whether a slot stays in `builds.json`: while its holder can be shown to be
 * running, however long that takes. The ttl decides only when the holder cannot
 * be inspected (another host, or no readable pid). A wedged but live build
 * therefore blocks the queue until it is stopped.
 *
 * @param {object} slot
 * @param {{now: number, isAlive: (pid: number) => boolean, host: string}} options
 * @returns {boolean}
 */
export function slotShouldBeRetained(slot, { now, isAlive, host }) {
  if (slotHolderIsDead(slot, { isAlive, host })) return false;
  if (slotHostIsThisOne(slot, host) && slotPidIsReadable(slot)) return true;
  return slotIsLive(slot, now);
}

/**
 * Whether a slot's owner process is gone. A slot from another host is never
 * judged by pid: pids only mean something on the machine that wrote them.
 *
 * @param {object} slot
 * @param {object} options
 * @param {(pid: number) => boolean} options.isAlive
 * @param {string} options.host this machine's hostname
 * @returns {boolean}
 */
export function slotHolderIsDead(slot, { isAlive, host }) {
  if (typeof slot?.host === 'string' && slot.host !== host) return false;
  const pid = Number(slot?.pid);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  return !isAlive(pid);
}

/**
 * Resolves a number or a clock function into a number. Throws on anything that
 * is not finite: a `NaN` would read every slot as expired and empty the queue.
 *
 * @param {number | (() => number) | null} now
 * @returns {number}
 */
function resolveNow(now) {
  const value = typeof now === 'function' ? now() : now;
  const number = Number(value ?? Date.now());
  if (!Number.isFinite(number)) {
    throw new TypeError(
      `build slot: "now" must be a number or a function returning one (got ${String(value)})`
    );
  }
  return number;
}

/**
 * Drop what is no longer held - expired by its own ttl, or left by a dead
 * process - and return the state to write back.
 *
 * @param {unknown} state
 * @param {object} options
 * @param {number | (() => number)} options.now
 * @param {(pid: number) => boolean} options.isAlive
 * @param {string} options.host
 * @returns {{builds: object[]}}
 */
export function pruneBuildSlots(state, { now, isAlive, host }) {
  const moment = resolveNow(now);
  const builds = (Array.isArray(state?.builds) ? state.builds : []).filter(
    (slot) => slotShouldBeRetained(slot, { now: moment, isAlive, host })
  );
  return { ...state, builds };
}

/**
 * One holder, as the waiting build prints it: the task, the platform, the pid
 * and how long it has been building.
 *
 * @param {object} slot
 * @param {number} now
 * @returns {string}
 */
export function formatSlotHolder(slot, now) {
  const minutes = Math.max(0, Math.round((now - slot.acquiredAt) / 60_000));
  return `${slot.task ?? 'unknown'} (${String(
    slot.platform ?? '?'
  )}, pid ${String(slot.pid ?? '?')}, ${String(minutes)}m in)`;
}

/**
 * May this build start? Slots the asking owner already holds do not count
 * against the limit, so a process that builds both platforms does not wait for
 * itself. The owner is per process, not per task name.
 *
 * @param {object} options
 * @param {object[]} active the live slots
 * @param {number} max `maxConcurrentBuilds`
 * @param {string} owner who is asking, from `buildOwnerFor`
 * @returns {{ok: true} | {ok: false, reason: string, waiting: object[]}}
 */
export function decideBuildSlot({ active, max, owner }) {
  const held = (Array.isArray(active) ? active : []).filter(
    (slot) => slot.owner !== owner
  );
  if (held.length >= max) {
    return {
      ok: false,
      reason: `${String(held.length)} native build(s) are already running (the limit is maxConcurrentBuilds = ${String(max)})`,
      waiting: held,
    };
  }
  return { ok: true };
}

/**
 * The identity of one build process's ownership of a slot: the task name plus
 * the pid, so two processes of the same task never share a slot.
 *
 * @param {string} task the readable name (`NITRO_UI_LEASE_TASK`, else the pid)
 * @param {number} pid
 * @returns {string}
 */
export function buildOwnerFor(task, pid = process.pid) {
  return `${task}/${String(pid)}`;
}

/**
 * The readable name for this process's build: the lease's task when there is
 * one, and the pid otherwise.
 *
 * @param {Record<string, string | undefined>} [env]
 * @param {number} [pid]
 * @returns {string}
 */
export function buildTaskName(env = process.env, pid = process.pid) {
  const named = env.NITRO_UI_LEASE_TASK ?? env.NITRO_UI_TASK ?? null;
  if (named != null && String(named).trim() !== '') return String(named).trim();
  return `pid-${String(pid)}`;
}

/**
 * A slot record for a build that is about to start.
 *
 * @param {object} options
 * @param {string} options.task
 * @param {'ios'|'android'} options.platform
 * @param {number} options.pid
 * @param {string} options.host
 * @param {number} options.now
 * @param {number} [options.ttlMinutes]
 * @param {() => string} [options.token]
 * @returns {object}
 */
export function newBuildSlot({
  task,
  platform,
  pid,
  host,
  now,
  ttlMinutes = BUILD_SLOT_TTL_MINUTES,
  token = () => randomBytes(4).toString('hex'),
}) {
  const id = `${task}-${token()}`;
  return {
    id,
    task,
    owner: buildOwnerFor(task, pid),
    platform,
    pid,
    host,
    acquiredAt: now,
    ttlMinutes,
  };
}

/**
 * Takes one slot out of `builds.json` by its id, not by task name: two processes
 * of the same task each hold their own slot.
 *
 * @param {object} options
 * @param {string} options.buildsFile
 * @param {string} options.lockFile
 * @param {string} options.slotId
 * @param {number | (() => number)} options.now
 * @param {(pid: number) => boolean} options.isAlive
 * @param {string} options.host
 * @param {object} [options.fsImpl]
 * @returns {object[]} what was released (empty when the slot was already gone)
 */
export function releaseBuildSlot({
  buildsFile,
  lockFile,
  slotId,
  now,
  isAlive,
  host,
  fsImpl,
}) {
  return withLock({
    lockFile,
    ...(fsImpl == null ? {} : { fsImpl }),
    mutate: () => {
      const state = readJson(buildsFile, { builds: [] });
      const keep = [];
      const gone = [];
      for (const slot of state.builds ?? []) {
        if (slot.id === slotId) gone.push(slot);
        else keep.push(slot);
      }
      if (gone.length === 0) return gone;
      writeJsonAtomic(
        buildsFile,
        pruneBuildSlots({ ...state, builds: keep }, { now, isAlive, host })
      );
      return gone;
    },
  });
}

/**
 * The slots a machine is building in right now, pruned.
 *
 * @param {object} options
 * @returns {object[]}
 */
export function currentBuildSlots({ buildsFile, now, isAlive, host }) {
  return pruneBuildSlots(readJson(buildsFile, { builds: [] }), {
    now,
    isAlive,
    host,
  }).builds;
}

/**
 * Waits for a build slot, takes it, and hands back the release. A busy lock is
 * retried until the deadline like any other refused round.
 *
 * @param {object} options
 * @param {string} options.task
 * @param {'ios'|'android'} options.platform
 * @param {string} options.buildsFile
 * @param {string} options.lockFile
 * @param {number} options.max `maxConcurrentBuilds`
 * @param {string} options.host
 * @param {(message: string) => void} [options.log]
 * @param {((ms: number) => void)} [options.sleep]
 * @param {(() => number)} [options.now]
 * @param {(pid: number) => boolean} [options.isAlive]
 * @param {number} [options.waitMinutes]
 * @param {number} [options.pollMs]
 * @param {number} [options.pid]
 * @param {object} [options.fsImpl] a filesystem to run against, as `withLock` takes
 * @returns {{slot: object, release: () => void, waitedMs: number}}
 */
export function takeBuildSlot({
  task,
  platform,
  buildsFile,
  lockFile,
  max,
  host,
  log = () => {},
  sleep = (ms) =>
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
  now = () => Date.now(),
  isAlive = processPidIsAlive,
  waitMinutes = DEFAULT_BUILD_WAIT_MINUTES,
  pollMs = BUILD_SLOT_POLL_MS,
  pid = process.pid,
  fsImpl,
}) {
  const startedAt = now();
  const deadline = startedAt + waitMinutes * 60_000;
  let lastAnnounced = null;

  for (;;) {
    let decision;
    try {
      decision = withLock({
        lockFile,
        ...(fsImpl == null ? {} : { fsImpl }),
        mutate: () => {
          const moment = now();
          const state = pruneBuildSlots(readJson(buildsFile, { builds: [] }), {
            now: moment,
            isAlive,
            host,
          });
          const verdict = decideBuildSlot({
            active: state.builds,
            max,
            owner: buildOwnerFor(task, pid),
          });
          if (!verdict.ok)
            return { ...verdict, moment, holders: verdict.waiting };
          const slot = newBuildSlot({ task, platform, pid, host, now: moment });
          writeJsonAtomic(buildsFile, {
            ...state,
            builds: [...state.builds, slot],
          });
          return { ok: true, slot, moment };
        },
      });
    } catch (error) {
      if (now() >= deadline) throw error;
      log(`waiting for a build slot (state busy: ${String(error.message)})`);
      sleep(pollMs);
      continue;
    }

    if (decision.ok) {
      return {
        slot: decision.slot,
        waitedMs: now() - startedAt,
        release: () => {
          try {
            releaseBuildSlot({
              buildsFile,
              lockFile,
              slotId: decision.slot.id,
              now: now(),
              isAlive,
              host,
              fsImpl,
            });
          } catch {
            // Never fail a finished build over its cleanup: the next build
            // reclaims a slot whose pid is dead.
          }
        },
      };
    }

    const moment = decision.moment;
    const holders = decision.holders.map((slot) =>
      formatSlotHolder(slot, moment)
    );
    // Announced once per set of holders. Keyed on identity, not on the printed
    // line, which carries elapsed minutes and would reprint every minute.
    const key = decision.holders
      .map((slot) => `${slot.task}:${slot.platform}:${slot.pid}`)
      .join(',');
    if (key !== lastAnnounced) {
      lastAnnounced = key;
      log(
        `waiting for a build slot - ${holders.join(', ')} is building` +
          ` (limit ${String(max)}, state ${buildsFile}; a holder whose` +
          ' process died is reclaimed on the next poll)'
      );
    }
    if (now() >= deadline) {
      throw new Error(
        `no build slot free within ${String(waitMinutes)} minutes - ` +
          `${holders.join(', ')} still holds one. Limit ${String(max)}; state: ${buildsFile}`
      );
    }
    sleep(pollMs);
  }
}

/**
 * Is this pid still there? EPERM counts as alive: a process owned by somebody
 * else is running.
 *
 * @param {number} pid
 * @returns {boolean}
 */
export function processPidIsAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return /** @type {{code?: string}} */ (error).code === 'EPERM';
  }
}
