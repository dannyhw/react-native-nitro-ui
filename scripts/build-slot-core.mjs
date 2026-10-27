/**
 * One machine-wide slot for heavy native builds, apart from the CLI.
 *
 * Why (X9, the 2026-10-27 run on the second machine): on a 10-core machine, two
 * app builds plus `check` pushed the load average to 13. The lease pool already
 * limits *device* tasks (`maxDeviceLeases`, two on a 14-core machine), but a
 * build needs no device, so nothing stopped an iOS build and an Android build
 * from running at the same second - and a build that slow makes the load guard
 * of every other task on the machine fire (R4, D9).
 *
 * The rule: a build takes a *slot* before it compiles and releases it after, so
 * at most `maxConcurrentBuilds` native builds run at once (default 1). Waiting is
 * the expected case, not the failure: the waiter prints one line naming who holds
 * the slot and for how long.
 *
 * The state lives beside the leases - `~/.nitro-ui/` (`stateHome`, X1) - because
 * the limit is a property of the machine, exactly like the device pool:
 *
 *   devices.json  `maxConcurrentBuilds` lives here, with the other machine limits
 *   builds.json   who is building now
 *   builds.lock   the lock around builds.json (`withLock`, from `lease-core.mjs`)
 *
 * A separate lock file from `leases.lock`, deliberately: `withLock` is held only
 * for one read-modify-write, but a build waiter polls every few seconds and must
 * not be able to sit on the lock a `lease.mjs acquire` needs.
 *
 * No `import.meta` here, so `scripts/__tests__/build-slot.test.js` can import it
 * (the same reason `lease-core.mjs` and `gate-core.mjs` exist). Everything the
 * decision depends on - the clock, who is alive, the filesystem - arrives as an
 * argument, so the interesting cases (a dead holder, an expired ttl, a full pool)
 * are tests rather than a race.
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

/** One build at a time: a native build already uses most of a machine. */
export const DEFAULT_MAX_CONCURRENT_BUILDS = 1;

/**
 * How long a build slot may sit without its owner finishing.
 *
 * THE RULE, stated once (N3, N4): a build that is still running holds its slot for
 * as long as it runs; the ttl is the answer to "is this slot's holder still around?"
 * only when that question cannot be asked - a slot written by another host, or one
 * whose pid cannot be read. It is never a deadline for a live build, because a build
 * that takes longer than the ttl would admit a second build beside it, which is the
 * exact load spike this module exists to prevent.
 *
 * So the number is not "the longest build we have seen" (a 9.5-minute cold iOS build
 * against a 45-minute ttl is not a near miss, and a `--clean` rebuild can beat it
 * anyway); it is how long a slot whose owner is unreachable - another machine, or a
 * pid that has been recycled by something we cannot tell from the dead one - stays
 * in the file before it is dropped. The trade it buys: a wedged-but-alive build
 * blocks the queue until somebody stops it, and the waiter's message names the holder
 * and the state file so that somebody has something to act on. `--prime`'s budget is
 * derived from this number rather than guessed (`primeBuildTimeoutMinutes`), because
 * a timer shorter than a queue is how a queued build gets SIGTERM'd mid-compile.
 */
export const BUILD_SLOT_TTL_MINUTES = 45;

/** How often a waiting build re-reads `builds.json`. */
export const BUILD_SLOT_POLL_MS = 5_000;

/**
 * How long a build waits before giving up. Longer than any build measured so
 * far, so timing out means somebody else's build is wedged - which is worth
 * failing loudly for rather than adding a third build to the queue.
 */
export const DEFAULT_BUILD_WAIT_MINUTES = 60;

/**
 * How long `doctor --prime` may spend on one platform's build (N4).
 *
 * A prime's budget has to outlast the thing it is waiting for, and a build's worst
 * case is *both* numbers: it may queue for the whole wait before it starts compiling,
 * and then compile. The old budget was 45 minutes - shorter than the 60-minute queue
 * alone - so `spawnSync`'s SIGTERM could land on a `build-app.mjs` that had not even
 * started, and a killed-by-signal build never runs its exit handler, which is how
 * `xcodebuild` or Gradle children get orphaned mid-compile.
 *
 * It is a sum of the two budgets rather than a guess: the wait, plus one TTL of build
 * time (the longest build this module claims to know about). A build that outlasts
 * that is still killed - N3 means a live holder keeps its slot for as long as it
 * runs, so no fixed number can be safe for every build - which is why it is
 * overridable with `NITRO_UI_PRIME_TIMEOUT_MINUTES` rather than fixed in prose.
 *
 * Exported, and read through `primeBuildTimeoutMinutes`, because the number is the
 * rule and `doctor.mjs` cannot be imported by jest: a timeout written inline there is
 * one no test can read.
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
 * The `maxConcurrentBuilds` a `devices.json` asks for, or the default.
 *
 * Read from the device pool file rather than a new file: it is the same question
 * ("what can this machine do at once?") as `maxDeviceLeases`, and a machine that
 * already has a `devices.json` should not need a second one to edit.
 *
 * A missing, unreadable or nonsensical value is the *default*, never "unlimited":
 * the safe direction on a machine that configured nothing is one build at a time,
 * because that is the thing this exists to guarantee.
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
 * The limit *and* the one sentence worth saying about it.
 *
 * A key that is absent is the documented default and gets no comment; a key that is
 * present and unusable is a typo, and a typo nobody mentions becomes "the machine
 * ignores what I write". This line prints once per build, so the difference between
 * those two cases is the difference between a useful warning and permanent noise.
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
 * Lives here rather than in `build-app.mjs` because this module is importable by
 * jest and that one is not: the first version of the limit note lived in the CLI,
 * so no unit test could reach it, and it crashed on the *first line* of the first
 * real build that ran it (`DEFAULT_MAX_CONCURRENT_BUILDS`, left unimported by a
 * refactor) while every test stayed green. A function that decides whether a build
 * may start gets to be one a test can call.
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
    // Unreadable pool file: the default (one build at a time) still applies, and
    // doctor is the place that explains a missing devices.json.
  }
  return { ...paths, max: limit.max, devicesFile, note: limit.note };
}

/**
 * Is this slot's ttl still unexpired? Judged by the slot's own ttl, never the
 * asker's (the rule `lease-core.mjs` learned in review M1).
 *
 * This is one half of the rule and not the whole decision: it is the answer for a
 * slot whose holder cannot be inspected (another host, or no readable pid). For a
 * slot on this host with a live pid, use `slotShouldBeRetained` - applying *this*
 * there is N3, and it admits a second build beside a slow one.
 *
 * @param {{acquiredAt: number, ttlMinutes?: number}} slot
 * @param {number} now
 */
export function slotIsLive(slot, now) {
  const ttlMinutes = Number(slot?.ttlMinutes) || BUILD_SLOT_TTL_MINUTES;
  return now - slot.acquiredAt < ttlMinutes * 60_000;
}

/** Does this slot claim to belong to the machine asking? */
function slotHostIsThisOne(slot, host) {
  return typeof slot?.host === 'string' && slot.host === host;
}

/** Is there a pid we could actually ask the OS about? */
function slotPidIsReadable(slot) {
  const pid = Number(slot?.pid);
  return Number.isInteger(pid) && pid > 0;
}

/**
 * THE RULE for whether a slot stays in `builds.json` (N3).
 *
 * Keep a slot while its holder can be shown to be running. The ttl decides only when
 * the holder *cannot* be shown - a slot from another host, or one with no readable
 * pid - because those are the only cases where "is it still building?" has no answer
 * except the clock.
 *
 * The old order (ttl AND not-dead, either one dropping the slot) meant the ttl could
 * usefully fire only on a holder that was still alive: a same-host dead pid was
 * already reclaimed, so the one thing a ttl could uniquely reach was a *slow* build -
 * and expiring it admitted a second build beside it, the load spike this module
 * exists to prevent. A `--clean` iOS rebuild from a cold cache can pass 45 minutes;
 * it now keeps its slot.
 *
 * The cost, deliberately: a wedged-but-alive build blocks the queue until somebody
 * stops it. That is the better failure - it is loud (the waiter names the holder, its
 * pid and the state file), it ends on its own when the waiter's own budget runs out
 * rather than hanging, and the named pid is exactly what to kill. Pid reuse is the
 * other cost: a recycled pid looks like a live holder, which needs ~100k processes to
 * turn over after a build skipped its cleanup, and again the waiter says so.
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
 * Whether a slot's owner process is gone.
 *
 * A build killed by Ctrl-C or a killed agent leaves its slot in the file, and
 * waiting 45 minutes for the ttl would be a machine that looks wedged. So the
 * holder's pid is the liveness check, and `isAlive` is injected because a test
 * cannot kill a real process to prove the reclaim works.
 *
 * A slot from *another host* is never reclaimed by pid: pids only mean something
 * on the machine that wrote them, and two machines pointed at one state dir by
 * `NITRO_UI_HOME` must fall back to the ttl rather than steal each other's slots.
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
 * Resolve whatever the caller handed us for "now" into a number.
 *
 * `takeBuildSlot` takes a `now()` clock (it polls, so it needs a moving clock)
 * while `pruneBuildSlots` is pure and takes a number. Accepting both at every
 * entry point, and *refusing* anything that is not a finite number, is the
 * difference between a caller working and a caller quietly computing
 * `undefined - 1234 = NaN` - which `slotIsLive` reads as "not live" and a full
 * queue empties out of the file with no error anywhere. That shape of bug is the
 * reason this function validates instead of coercing.
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
 * One holder, as the waiting build prints it: one line, naming the task, the
 * platform and how long it has been building. "who is holding the slot" is the
 * only question a waiter has, and it has to be answered without reading JSON.
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
 * May this build start?
 *
 * One limit and one exception. The limit is `maxConcurrentBuilds`; the exception
 * is the same *owner*: a process that already holds a slot may take another,
 * because a caller that builds both platforms in one process would otherwise wait
 * for itself, and a rule that deadlocks the tool meant to warm the machine is
 * worse than no rule.
 *
 * The identity is the owner, not the task name: two different processes that
 * happen to share a task name (two builds run by the same leased task, one after
 * another in the same shell) are two builds, and letting them both in is exactly
 * the concurrency this file exists to prevent. `buildOwnerFor` makes that identity
 * per process; `task` stays the readable name the waiting line prints.
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
 * The identity of one build process's ownership of a slot.
 *
 * A leased task's name plus its pid: readable enough to explain a wait ("G7 is
 * building"), unique enough that two processes never share a slot. The pid is
 * load-bearing - a bare task name would let the second of two concurrent builds
 * through on the theory that it is the same task that already holds one.
 *
 * @param {string} task the readable name (`NITRO_UI_LEASE_TASK`, else the pid)
 * @param {number} pid
 * @returns {string}
 */
export function buildOwnerFor(task, pid = process.pid) {
  return `${task}/${String(pid)}`;
}

/**
 * The readable name for this process's build: the lease's task when there is one,
 * because "waiting for G7" is the sentence a human acts on, and the pid otherwise.
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
 * Write `slot` into `builds.json`, pruned, inside the lock.
 *
 * @param {object} options
 * @param {string} options.buildsFile
 * @param {string} options.lockFile
 * @param {object} options.slot
 * @param {number} options.now
 * @param {(pid: number) => boolean} options.isAlive
 * @param {string} options.host
 * @param {typeof import('node:fs')} [options.fsImpl]
 * @returns {object} what was written
 */
export function recordBuildSlot({
  buildsFile,
  lockFile,
  slot,
  now,
  isAlive,
  host,
  fsImpl,
}) {
  return withLock({
    lockFile,
    ...(fsImpl == null ? {} : { fsImpl }),
    mutate: () => {
      const state = pruneBuildSlots(readJson(buildsFile, { builds: [] }), {
        now,
        isAlive,
        host,
      });
      const next = { ...state, builds: [...state.builds, slot] };
      writeJsonAtomic(buildsFile, next);
      return slot;
    },
  });
}

/**
 * Take one slot out of `builds.json`, by the id `newBuildSlot` gave it.
 *
 * By **id**, deliberately, not by task name: two builds run by the same leased
 * task in two processes both record `task: 'G7'`, and a release that matched on
 * the name would have the first finisher free the slot the second is still
 * compiling in - putting two builds on the machine through the very function
 * meant to keep them apart. Releasing by id frees what this call acquired and
 * nothing else.
 *
 * Best effort by design: a build that has already failed has to report *its*
 * failure, not a problem with the cleanup. An unreleased slot is reclaimed by the
 * dead-pid check the next build runs, so a missed release costs one poll, not the
 * machine.
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
 * Wait for a build slot, take it, and hand back the release.
 *
 * The whole wait is one function with injected `now`, `sleep` and `isAlive` so
 * the three behaviours that matter are unit-testable without a compiler: a build
 * that waits and then proceeds, a holder whose process died, and a queue that
 * never empties.
 *
 * Every read-modify-write goes through `withLock`, and every refused round is
 * retried until the caller's deadline - the same rule `lease.mjs` learned in
 * review S4: a lock that happens to be busy is not a reason to give up on a wait
 * somebody chose to be an hour long.
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
 *   one; the tests hand it a temp directory rather than the machine's `~/.nitro-ui`
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
  // Printed once, on the first refusal: the brief asks for a one-line message,
  // and a waiter that polls for ten minutes must not print ten lines. It *is*
  // refreshed when the holder changes, because a new name is new information.
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
            // Never fail a finished build over its cleanup: whoever reads the
            // exit code cares about the compile, and the slot is reclaimed as
            // dead-pid stale by the next build anyway.
          }
        },
      };
    }

    const moment = decision.moment;
    const holders = decision.holders.map((slot) =>
      formatSlotHolder(slot, moment)
    );
    // Deduped on *identity*, not on the printed line: the line carries how long
    // the holder has been building, so keying on it reprints the "someone is
    // building" sentence once a minute for the same holder - which is the polling
    // noise the brief asks this message not to be. A new holder, or one going
    // away, is new information and does print.
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
 * Is this pid still there? `kill(pid, 0)` is the usual probe, and EPERM counts as
 * alive: a process owned by somebody else is definitely running, and stealing its
 * slot would put two builds on one machine - the exact thing this guards.
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
