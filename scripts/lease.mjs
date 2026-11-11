#!/usr/bin/env node
/**
 * One machine's device and port leases: `acquire`, `renew`, `release`, `list`.
 *
 *   node scripts/lease.mjs acquire --task G6                        # env file on stdout
 *   node scripts/lease.mjs acquire --task B1 --exclusive --out /tmp/b1.env
 *   node scripts/lease.mjs acquire --task G20 --ios-runtime 26.5 --boot  # an older iOS, for a look
 *   node scripts/lease.mjs renew B1                                 # longer than the ttl
 *   node scripts/lease.mjs list
 *   node scripts/lease.mjs release G6                               # by task or id
 *
 * `acquire` prints an env file (source it), and the variable names are the ones
 * the gates already read, so a brief stops hand-naming devices and starts with:
 *
 *   set -a; source <(node scripts/lease.mjs acquire --task "$TASK"); set +a
 *   node scripts/build-app.mjs --platform ios     # see that script for app.stamp
 *
 * The pool comes from `~/.nitro-ui/devices.json` - one file per machine, because
 * UDIDs and ports do not travel between the machines this project runs on. See
 * `scripts/devices.example.json` and CONTRIBUTING.md for its shape.
 *
 * Three rules are enforced here rather than in prose: at most `maxDeviceLeases`
 * (default 2) device tasks at a time; `--exclusive` (a bench or baseline mint,
 * which needs a quiet machine) waits until every other lease has ended; and
 * `emulator-5560` can never be leased, whoever is asking.
 *
 * `--ios-runtime <v>` (X20 item 3) leases one simulator from `devices.json` `iosRuntimes`, on an
 * iOS runtime the pairs do not run, for a screenshot or a probe: iOS only, never exclusive, never
 * handed to an ordinary acquire, and refused by every device gate (`gate.mjs`). It is otherwise a
 * device lease like any other - the limit, the boot, the reset, and `reap` as the only power-off.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  DEFAULT_TTL_MINUTES,
  IDLE_SHUTDOWN_DEFAULT_MINUTES,
  EXCLUSIVE_TTL_MINUTES,
  assertLeasable,
  formatWaited,
  leaseAcquiredAtMs,
  metroPortReason,
  portListeners,
  pruneExpired,
  decideAcquire,
  iosRuntimeKey,
  newLeaseId,
  normalizeDevices,
  readJson,
  renderEnvFile,
  sleepMs,
  stateHome,
  statePaths,
  waitQueue,
  waiterRequestedAtMs,
  withLock,
  writeJsonAtomic,
} from './lease-core.mjs';
import { DevicePool } from './device-pool.mjs';
import {
  emulatorsFromAdbDevices,
  simulatorsByUdidWithState,
  unownedBootedDevices,
  unownedCheckProblem,
} from './doctor-core.mjs';

const USAGE =
  'usage: node scripts/lease.mjs acquire --task <id> [--platform ios|android|both]\n' +
  '                                          [--exclusive] [--wait-minutes N]\n' +
  '                                          [--ttl-minutes N] [--out <file>] [--config <file>] [--json]\n' +
  '                                          [--boot] [--no-boot] [--no-reset] [--boot-timeout-minutes N]\n' +
  '                                          [--ios-runtime <major.minor>]\n' +
  '         (--ios-runtime hands out one simulator on that older iOS runtime, for a look check:\n' +
  '          iOS only, never --exclusive, and gate.mjs refuses a device gate on it)\n' +
  '         (--exclusive --boot needs --platform ios|android|both: an exclusive lease boots only\n' +
  '          the half it names, and never for NITRO_UI_LEASE_BOOT alone)\n' +
  '       node scripts/lease.mjs renew <lease-id> | --task <id>\n' +
  '       node scripts/lease.mjs release <lease-id> | --task <id>\n' +
  '       node scripts/lease.mjs reap [--idle-minutes N] [--config <file>]   (the only reaper)\n' +
  '       node scripts/lease.mjs list [--json]   (leases, who is queued and warm devices)';

/**
 * How often a waiting `--exclusive` acquire re-reads the lease file. Ten seconds
 * is polite to a file another process is writing; `scripts/__tests__/lease.test.js`
 * shortens it through `NITRO_UI_LEASE_POLL_MS` so the wait-then-succeed case is
 * a test rather than a coffee break.
 */
const POLL_MS = Number(process.env.NITRO_UI_LEASE_POLL_MS ?? 10_000);

/**
 * How long one lock attempt may take before the wait loop treats it as "somebody
 * else is writing" and tries again. Testable for the same reason as `POLL_MS`.
 */
const LOCK_TIMEOUT_MS = Number(
  process.env.NITRO_UI_LEASE_LOCK_TIMEOUT_MS ?? 10_000
);

/**
 * Device lifecycle is **opt-in**, and `NITRO_UI_LEASE_BOOT=0` forces it off.
 *
 * Why opt-in: a lease is a naming agreement, and the four commands that read the lease file
 * (`acquire`, `release`, `list`, `renew`) are run by tests, by CI and by scripts that have no
 * interest in a simulator appearing. Booting a device is seconds-to-minutes of work, it moves the
 * machine's load, and it is a side effect nobody asked for when they wanted a port number. So
 * `acquire --boot` is the command that warms the pair, and `lease.mjs reap` is the one that powers
 * devices off — plus the power-off an `--exclusive` acquire owes its bench. Nothing else kills:
 * X11's re-review found that a `list` which reaps is a reaper in every shell on the machine, and
 * `list` is the command every task runs most.
 *
 * `NITRO_UI_LEASE_BOOT=1` turns `--boot` on for a whole shell, which is what CONTRIBUTING tells an
 * agent to do, because an agent's lease is always a device lease.
 */
const BOOT_DEFAULT = /^(1|true|yes)$/i.test(
  process.env.NITRO_UI_LEASE_BOOT ?? ''
);
const BOOT_FORCED_OFF = /^(0|false|no)$/i.test(
  process.env.NITRO_UI_LEASE_BOOT ?? ''
);

function parseArgs(argv) {
  const options = {
    task: null,
    platform: 'both',
    // Whether `--platform` was actually typed. `both` is the default *and* a real answer, and the
    // two are not the same instruction: an exclusive `--boot` that never named a half would boot
    // both of them under a bench that measures one (X16 item 2), so a defaulted `both` is refused
    // where a typed one is obeyed.
    platformGiven: false,
    exclusive: false,
    waitMinutes: null,
    // null means "the default for this kind of lease", which differs between an
    // ordinary device lease and an exclusive one; see `acquire`.
    ttlMinutes: null,
    out: null,
    config: null,
    json: false,
    // `--boot` / `--no-boot` win over the env default; the env can only force it off.
    boot: BOOT_FORCED_OFF ? false : BOOT_DEFAULT,
    // Whether `--boot` was typed rather than inherited from `NITRO_UI_LEASE_BOOT`. An exclusive
    // lease boots only for a typed flag (X16 item 2); see `bootForLease`.
    bootFlag: false,
    // Reaping is not a background service (X11 fix round 2, the orchestrator's scope decision):
    // `list`, `acquire` and `release` never power anything off. It happens when somebody types
    // `lease.mjs reap`, and when an `--exclusive` acquire promises a quiet machine. This flag only
    // opts the *explicit* reap out (`--no-reap`), for a machine whose devices are managed elsewhere;
    // it cannot switch passive killing back on, because there is none left to switch on.
    // `NITRO_UI_LEASE_BOOT=0` still forces the whole device lifecycle off, reap included.
    reap: !BOOT_FORCED_OFF,
    bootTimeoutMinutes: null,
    reset: true,
    idleMinutes: null,
    // `--ios-runtime 26.5`: one simulator on that runtime from `devices.json` `iosRuntimes`, for a
    // look check (X20 item 3). Normalized to `major.minor`; null is a default pair.
    iosRuntime: null,
  };
  const take = (name, value) => {
    if (value == null) throw new Error(`${name} needs a value\n${USAGE}`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case '--task':
        options.task = take('--task', argv[++index]);
        break;
      case '--platform':
        options.platform = take('--platform', argv[++index]);
        options.platformGiven = true;
        break;
      case '--exclusive':
        options.exclusive = true;
        break;
      case '--wait-minutes':
        options.waitMinutes = Number(take('--wait-minutes', argv[++index]));
        break;
      case '--ttl-minutes':
        options.ttlMinutes = Number(take('--ttl-minutes', argv[++index]));
        break;
      case '--out':
        options.out = take('--out', argv[++index]);
        break;
      case '--config':
        options.config = take('--config', argv[++index]);
        break;
      case '--boot':
        // Boot the pair, reset its app data, and reap idle devices. Without it a lease only
        // reserves names, which is what a test, a CI runner or a bench host wants.
        options.boot = true;
        options.bootFlag = true;
        break;
      case '--no-boot':
        // The explicit "no", which also beats `NITRO_UI_LEASE_BOOT=1` - a bench host that has
        // the variable set in its profile can still ask for a naming-only lease.
        options.boot = false;
        options.bootFlag = false;
        break;
      case '--no-reap':
        // For a machine whose devices are managed elsewhere (a CI runner that boots its own
        // ephemeral emulator): touch nothing, report nothing.
        options.reap = false;
        break;
      case '--no-reset':
        options.reset = false;
        break;
      case '--boot-timeout-minutes':
        options.bootTimeoutMinutes = Number(
          take('--boot-timeout-minutes', argv[++index])
        );
        break;
      case '--idle-minutes':
        options.idleMinutes = Number(take('--idle-minutes', argv[++index]));
        break;
      case '--json':
        options.json = true;
        break;
      case '--ios-runtime': {
        const value = take('--ios-runtime', argv[++index]);
        options.iosRuntime = iosRuntimeKey(value);
        if (options.iosRuntime == null) {
          throw new Error(
            `--ios-runtime needs an iOS version such as 26.5 (got ${value})\n${USAGE}`
          );
        }
        break;
      }
      default: {
        if (argument.startsWith('-')) {
          throw new Error(`unknown flag ${argument}\n${USAGE}`);
        }
        if (options.task != null) {
          throw new Error(`unexpected argument ${argument}\n${USAGE}`);
        }
        // A bare word names a lease (`release abc-123`); `--task` names a task.
        options.task = argument;
      }
    }
  }
  if (!['ios', 'android', 'both'].includes(options.platform)) {
    throw new Error(`--platform must be ios, android or both\n${USAGE}`);
  }
  if (options.iosRuntime != null) {
    // A look-check simulator is one iOS device: there is no Android half to lease with it, and a
    // bench or baseline never measures on an older runtime, so neither flag means anything here.
    if (options.platformGiven && options.platform !== 'ios') {
      throw new Error(
        `--ios-runtime leases an iOS simulator only; drop --platform ${options.platform}\n${USAGE}`
      );
    }
    if (options.exclusive) {
      throw new Error(
        '--ios-runtime is for a short look check, and --exclusive is for a bench on the default ' +
          `pairs: the two do not go together\n${USAGE}`
      );
    }
    options.platform = 'ios';
  }
  if (Number.isNaN(options.waitMinutes) || Number.isNaN(options.ttlMinutes)) {
    throw new Error(`--wait-minutes and --ttl-minutes need numbers\n${USAGE}`);
  }
  if (
    Number.isNaN(options.bootTimeoutMinutes) ||
    Number.isNaN(options.idleMinutes)
  ) {
    throw new Error(
      `--boot-timeout-minutes and --idle-minutes need numbers\n${USAGE}`
    );
  }
  return options;
}

/**
 * The machine's pool, or null when there is none.
 *
 * Only for read-only reporting: `list` works without a `devices.json` (the lease
 * file is the interesting one), so a missing or broken pool must not turn a
 * report into an error. `acquire` keeps using `loadDevices`, which does fail.
 */
function loadDevicesOrNull(options, paths) {
  try {
    return loadDevices(options, paths).devices;
  } catch {
    return null;
  }
}

/**
 * Pool devices that are running with no lease (X9 item 6), as warnings.
 *
 * A read-only `simctl list` and `adb devices`: no boot, no `emu avd name`
 * round-trip, because the AVD behind a serial comes from the pool's own port
 * assignment. Either tool may be missing, and `unownedCheckProblem` then says so
 * rather than leaving a clean bill of health where a check did not run.
 *
 * `NITRO_UI_SIMCTL_BIN` / `NITRO_UI_ADB_BIN` name the programs to run. Tests use
 * them to point at a canned-output script instead of the real tools (so the check
 * is not machine-dependent, and a missing tool is testable too); production never
 * sets them.
 *
 * @param {ReturnType<typeof normalizeDevices> | null} devices
 * @param {object[]} leases live leases
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
function scanUnownedDevices(devices, leases, env = process.env) {
  if (devices == null) return [];
  const listing = runJson(
    env.NITRO_UI_SIMCTL_BIN ?? 'xcrun',
    ['simctl', 'list', 'devices', '-j'],
    env
  );
  const attached = runText(adbPath(env), ['devices'], env);
  const problem = unownedCheckProblem({
    xcrunOk: listing != null,
    adbOk: attached != null,
  });
  const warnings =
    listing == null && attached == null
      ? []
      : unownedBootedDevices({
          pool: devices,
          simulators: simulatorsByUdidWithState(listing ?? {}),
          emulators: emulatorsFromAdbDevices(attached ?? '', devices.pairs),
          leases,
          reservedPorts: devices.reservedEmulatorPorts,
        });
  return problem == null ? warnings : [problem, ...warnings];
}

/** Where `adb` lives, or the bare name when no SDK root is set. */
function adbPath(env) {
  if (env.NITRO_UI_ADB_BIN != null) return env.NITRO_UI_ADB_BIN;
  const sdk = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
  return sdk != null && existsSync(join(sdk, 'platform-tools/adb'))
    ? join(sdk, 'platform-tools/adb')
    : 'adb';
}

/** @returns {string | null} stdout, or null when the command could not run */
function runText(command, args, env = process.env) {
  try {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      timeout: 20_000,
      env,
    });
    if (result.status !== 0) return null;
    return result.stdout ?? '';
  } catch {
    return null;
  }
}

/** @returns {object | null} parsed JSON, or null when the command could not run */
function runJson(command, args, env = process.env) {
  return parseJsonOrNull(runText(command, args, env));
}

/** @param {string | null} text */
function parseJsonOrNull(text) {
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The machine's pool, with the reason it is missing spelled out. */
function loadDevices(options, paths) {
  // `--config` for one command, `NITRO_UI_DEVICES` for a whole shell - what
  // `scripts/devices.example.json` advertises, so a task can point at a pool
  // that lives somewhere else without copying it into `~/.nitro-ui`.
  const configPath =
    options.config ?? process.env.NITRO_UI_DEVICES ?? paths.devices;
  if (!existsSync(configPath)) {
    throw new Error(
      `no device pool at ${configPath}. Copy scripts/devices.example.json there` +
        " and edit it - it is one file per machine, holding this machine's" +
        ' simulator UDIDs, AVDs and ports. CONTRIBUTING.md documents the shape.'
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `${configPath} is not valid JSON: ${String(error.message)}`
    );
  }
  return { devices: normalizeDevices(parsed), configPath };
}

/**
 * Take a lease, or explain the refusal. The whole read-decide-write runs inside
 * the lock, so two tasks asking in the same second cannot both be told the same
 * simulator is free.
 *
 * Two things the waiting loop owes the machine (review S4): a waiting exclusive
 * request records itself, so new device leases are held back and it can actually
 * see the machine go quiet instead of being refilled forever; and a lock timeout
 * is retried rather than ending an hour-long wait.
 *
 * X26 adds the third thing it owes the *waiters*: every request that is willing to
 * wait records a ticket when it is refused, so a freed pair goes to whoever has
 * waited longest rather than to whoever polls first. Before that, a task that
 * released a pair and asked again within seconds took it back every time - two tasks
 * starved for four and a half hours that way on 2026-11-11 while the pool turned over
 * between their polls.
 */
function acquire({ devices, paths, options, log }) {
  const waitMinutes = options.waitMinutes ?? (options.exclusive ? 60 : 0);
  const startedWaitingAt = Date.now();
  const deadline = startedWaitingAt + waitMinutes * 60_000;
  // A `--wait-minutes 0` acquire does not join the queue at all: the rule is that it
  // either gets a pair now or is refused, and a ticket written on the way out would
  // reserve that pair for a task that has already given up.
  const queuesItself = waitMinutes > 0;
  // An exclusive lease is a bench or a baseline mint: 8 to 14 hours of quiet
  // (PROCESS review §4), so it must not inherit the 4-hour device default.
  const ttlMinutes =
    options.ttlMinutes ??
    (options.exclusive ? EXCLUSIVE_TTL_MINUTES : DEFAULT_TTL_MINUTES);
  // Stable across polls, so a retried acquire reports one id.
  const leaseId = newLeaseId(options.task, Date.now());

  for (;;) {
    // X15 item 1: a free entry in `leases.json` is not a free Metro port. Read the
    // ports *before* taking the lock - the question goes to a subprocess, and the
    // lease lock is not something to hold while waiting for one - and let the
    // decision below treat a busy pair the way it treats a leased one. The snapshot
    // can be a moment stale in either direction; that is the same window the lease
    // file itself has, and the gate's own pre-flight (`gate.mjs`) is the second net.
    const portBlocked = metroPortBlockers({ devices, log });
    let attempt;
    try {
      attempt = withLock({
        lockFile: paths.lock,
        timeoutMs: LOCK_TIMEOUT_MS,
        mutate: () => {
          const now = Date.now();
          const state = pruneExpired(
            readJson(paths.leases, { leases: [] }),
            now
          );
          const others = (state.pendingExclusive ?? []).filter(
            (entry) => entry.task !== options.task
          );
          // My own records, if a previous poll (or a previous run of the same
          // command) left them: their `requestedAt` is my place in the queue, and a
          // poll must refresh the *touch* time without moving that.
          const myMarker = (state.pendingExclusive ?? []).find(
            (entry) => entry?.task === options.task
          );
          const myTicket = (state.waiters ?? []).find(
            (waiter) => waiter?.task === options.task
          );
          const waitedSince =
            waiterRequestedAtMs(myMarker) ??
            waiterRequestedAtMs(myTicket) ??
            startedWaitingAt;
          const otherWaiters = (state.waiters ?? []).filter(
            (waiter) => waiter?.task !== options.task
          );
          // Am I still waiting after this poll? The last one before the caller's
          // deadline must not leave a record behind: the task is about to give up, and
          // a ticket that outlives it reserves a pair for nobody for up to a minute,
          // while a timed-out exclusive marker would hold every lease back that long.
          const keepWaiting = now + POLL_MS < deadline;
          /** Stop holding the line: this task has been served, or was refused outright. */
          const dropMyTicket = () => {
            if (myTicket == null && myMarker == null) return;
            const next = { ...state, pendingExclusive: others };
            if (others.length === 0) delete next.pendingExclusive;
            if (otherWaiters.length > 0) next.waiters = otherWaiters;
            else delete next.waiters;
            writeJsonAtomic(paths.leases, next);
          };
          const sameTask = state.leases.find(
            (lease) => lease.task === options.task
          );
          if (
            sameTask != null &&
            (sameTask.iosRuntime ?? null) !== options.iosRuntime
          ) {
            // Idempotent only for the same request. A task that holds a default pair and asks for
            // an iOS 26.5 simulator (or the other way round) would otherwise be handed back the
            // device it already has, under an env file that answers a question it did not ask.
            const held =
              sameTask.iosRuntime == null
                ? `a default pair (${sameTask.holds.join(', ')})`
                : `an iOS ${sameTask.iosRuntime} simulator (${sameTask.holds.join(', ')})`;
            dropMyTicket();
            return {
              kind: 'refuse',
              reason:
                `${options.task} already holds ${held} under ${sameTask.id}. Release it first ` +
                `(node scripts/lease.mjs release ${sameTask.id}), or lease the ` +
                `${options.iosRuntime == null ? 'pair' : `iOS ${options.iosRuntime} simulator`} ` +
                `under another --task name, e.g. --task ${options.task}-${options.iosRuntime ?? 'pair'}`,
            };
          }
          if (sameTask != null) {
            // Idempotent: a task that asks twice keeps what it already has, so a
            // retried command cannot consume a second pair. No Metro check either:
            // the server on this pair's port would be this task's own run, which is
            // precisely what re-sourcing an env file *during* a suite looks like.
            dropMyTicket();
            return {
              kind: 'acquired',
              lease: sameTask,
              pair: devices.pairs.find((pair) => pair.id === sameTask.holds[0]),
              already: true,
            };
          }
          const decision = decideAcquire({
            active: state.leases,
            pairs: devices.pairs,
            maxDeviceLeases: devices.maxDeviceLeases,
            exclusive: options.exclusive,
            platform: options.platform,
            task: options.task,
            pending: others,
            portBlocked,
            iosRuntime: options.iosRuntime,
            waiters: waitQueue(state, now).filter(
              (waiter) => waiter.task !== options.task
            ),
            // Where I stand in the line: the ticket I already hold (even a `--wait-minutes 0`
            // retry keeps the place it is refreshing), the queue I am about to join, or - for
            // a request with no record at all - right now, which is the back.
            waitedSince:
              queuesItself || myTicket != null || myMarker != null
                ? waitedSince
                : now,
            now,
          });
          if (!decision.ok) {
            // Every waiter records itself, not only the exclusive one (X26). The
            // exclusive request additionally keeps its drain marker, because that is
            // what holds *new* leases back while the machine goes quiet around it;
            // the ticket is what keeps its place in the queue, and `waitQueue` folds
            // the marker in when there is no ticket, so one waiter is one record.
            const next = { ...state };
            if (options.exclusive && keepWaiting) {
              next.pendingExclusive = [
                ...others,
                {
                  task: options.task,
                  id: leaseId,
                  platform: options.platform,
                  requestedAt: waitedSince,
                  refreshedAt: now,
                },
              ];
            } else if (others.length > 0) {
              next.pendingExclusive = others;
            } else {
              delete next.pendingExclusive;
            }
            if (queuesItself && !options.exclusive && keepWaiting) {
              next.waiters = [
                ...otherWaiters,
                {
                  task: options.task,
                  id: leaseId,
                  platform: options.platform,
                  exclusive: false,
                  ...(options.iosRuntime == null
                    ? {}
                    : { iosRuntime: options.iosRuntime }),
                  requestedAt: waitedSince,
                  refreshedAt: now,
                },
              ];
            } else if (otherWaiters.length > 0) {
              next.waiters = otherWaiters;
            } else {
              delete next.waiters;
            }
            writeJsonAtomic(paths.leases, next);
            return { kind: 'wait', decision };
          }

          const reserved = assertLeasable(
            decision.pair,
            devices,
            options.platform
          );
          if (reserved != null) {
            dropMyTicket();
            return { kind: 'refuse', reason: reserved };
          }

          const lease = {
            id: leaseId,
            task: options.task,
            platform: options.platform,
            exclusive: options.exclusive,
            // Only on a look-check lease, so every lease file written before X20 still reads as
            // what it was: a default pair.
            ...(options.iosRuntime == null
              ? {}
              : { iosRuntime: options.iosRuntime }),
            // An exclusive lease holds every pair: it needs a quiet machine, not a
            // free simulator.
            holds: options.exclusive
              ? devices.pairs.map((pair) => pair.id)
              : [decision.pair.id],
            acquiredAt: now,
            ttlMinutes,
          };
          const next = { ...state, leases: [...state.leases, lease] };
          if (others.length > 0) next.pendingExclusive = others;
          else delete next.pendingExclusive;
          // Served: my ticket goes with the grant, so the next in line is the one
          // still waiting and not a task that already has a device.
          if (otherWaiters.length > 0) next.waiters = otherWaiters;
          else delete next.waiters;
          writeJsonAtomic(paths.leases, next);
          return {
            kind: 'acquired',
            lease,
            pair: decision.pair,
            note: decision.note ?? null,
          };
        },
      });
    } catch (error) {
      // The lock is held by another lease command, or by a corpse being cleaned
      // up. That is a reason to keep waiting, not to end a wait the caller set an
      // hour for - so retry until the caller's own deadline (review S4).
      if (Date.now() >= deadline) throw error;
      log(`lease: waiting (lock busy: ${String(error.message)})`);
      sleepMs(POLL_MS);
      continue;
    }

    if (attempt.kind !== 'wait') return attempt;
    if (Date.now() >= deadline)
      return { kind: 'timeout', decision: attempt.decision };
    log(
      `lease: waiting (${attempt.decision.waiting.join(', ') || 'no lease yet'}) -` +
        ` ${attempt.decision.reason}`
    );
    sleepMs(POLL_MS);
  }
}

function refusalMessage(result, configPath) {
  const why = result.reason ?? result.decision?.reason ?? 'no lease available';
  const waiting = result.decision?.waiting ?? [];
  const holders =
    waiting.length > 0 ? `\n  held by: ${waiting.join(', ')}` : '';
  return (
    `lease: refused - ${why}${holders}\n` +
    `  pool: ${configPath}\n` +
    '  see: node scripts/lease.mjs list  -  release: node scripts/lease.mjs release <id>'
  );
}

function formatAge(lease, now) {
  const acquiredAt = leaseAcquiredAtMs(lease) ?? now;
  const minutes = Math.round((now - acquiredAt) / 60_000);
  const ttlMinutes = Number(lease.ttlMinutes) || DEFAULT_TTL_MINUTES;
  const left = ttlMinutes - minutes;
  return `${minutes}m held${left < 0 ? ' (ttl expired)' : `, ${left}m ttl left`}`;
}

function main(argv) {
  const paths = statePaths(stateHome(process.env));
  const command = argv[0];
  const options = parseArgs(argv.slice(1));
  const log = (message) => process.stderr.write(`${message}\n`);

  if (command == null) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }

  if (command === 'list') {
    const state = pruneExpired(
      readJson(paths.leases, { leases: [] }),
      Date.now()
    );
    // `list` reads and reports; it powers nothing off (X11 fix round 2). It used to reap on every
    // invocation, because it is the command that runs most often - which is exactly the problem: an
    // agent that runs `list` between two commands, in a shell whose own lease is live, was a
    // reaper. `lease.mjs reap` is the command that reaps, and it is typed on purpose.
    const listedDevices = loadDevicesOrNull(options, paths);
    // What is booted right now, which neither file says (X9 item 6). Written to
    // stderr in both output modes: `--json`'s stdout is the lease state, and an
    // agent reading it should not have a host-snapshot mixed into the record.
    const unowned = scanUnownedDevices(
      loadDevicesOrNull(options, paths),
      state.leases
    );
    // X26: the queue is part of what `list` answers. A refusal now says "somebody
    // older is waiting", and the one question that follows it is who, since when, and
    // whether it is the next grant - which is exactly what this list is.
    const queue = waitQueue(state, Date.now());
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({ ...state, queue, pool: poolSummary(listedDevices, paths) }, null, 2)}\n`
      );
      for (const warning of unowned) log(`lease: ${warning}`);
      return 0;
    }
    if (state.leases.length === 0 && queue.length === 0) {
      process.stdout.write(`no leases in ${paths.leases}\n`);
      // The pool rows still print: "nothing is leased, and here is what is nevertheless booted"
      // is the answer `list` exists to give, and the case where a warm device matters most.
      for (const row of poolRows(listedDevices, paths))
        process.stdout.write(row);
      for (const warning of unowned) log(`lease: ${warning}`);
      return 0;
    }
    for (const lease of state.leases) {
      const row = [
        lease.id.padEnd(24),
        lease.task.padEnd(12),
        (lease.iosRuntime == null
          ? lease.platform
          : `ios ${lease.iosRuntime}`
        ).padEnd(8),
        (lease.exclusive ? 'exclusive' : '').padEnd(10),
        lease.holds.join(',').padEnd(24),
        formatAge(lease, Date.now()),
      ];
      process.stdout.write(`${row.join(' ')}\n`);
    }
    // Waiting requests are visible too - including a waiting exclusive one, which is
    // the reason a new acquire is being held back and used to be the only kind shown.
    for (const waiter of queue) {
      const since = waiterRequestedAtMs(waiter);
      const platform =
        waiter.iosRuntime == null
          ? String(waiter.platform ?? 'both')
          : `ios ${waiter.iosRuntime}`;
      process.stdout.write(
        `queue${String(waiter.position).padStart(4)}. ${String(waiter.task).padEnd(12)}` +
          `${platform.padEnd(10)}` +
          `${(waiter.exclusive ? 'exclusive' : 'waiting').padEnd(10)}` +
          `${String(waiter.id ?? '').padEnd(18)}` +
          `${waiter.exclusive ? 'wants an exclusive lease' : 'waiting for a pair'}, ` +
          `waited ${formatWaited(waiter.waitedMs)} ` +
          `(since ${since == null ? 'unknown' : `${new Date(since).toISOString().slice(11, 16)}Z`})\n`
      );
    }
    for (const row of poolRows(listedDevices, paths)) process.stdout.write(row);
    for (const warning of unowned) log(`lease: ${warning}`);
    return 0;
  }

  if (command === 'renew') {
    if (options.task == null) {
      throw new Error(`renew needs a lease id or --task\n${USAGE}`);
    }
    const renewed = withLock({
      lockFile: paths.lock,
      timeoutMs: LOCK_TIMEOUT_MS,
      mutate: () => {
        const now = Date.now();
        const state = pruneExpired(readJson(paths.leases, { leases: [] }), now);
        const touched = [];
        const leases = (state.leases ?? []).map((lease) => {
          if (lease.id !== options.task && lease.task !== options.task)
            return lease;
          // Restarting `acquiredAt` extends the lease by its own ttl, which is
          // how a 14-hour bench outlives a 16-hour ttl without leaking one.
          touched.push({ ...lease, acquiredAt: now });
          return touched[touched.length - 1];
        });
        writeJsonAtomic(paths.leases, { ...state, leases });
        return touched;
      },
    });
    if (renewed.length === 0) {
      // Loud on purpose: a heartbeat that quietly did nothing would let the run
      // it was protecting lose its devices mid-measurement.
      log(
        `lease: renew found no live lease for ${options.task} - it expired (or` +
          ' was released); acquire a new one before continuing'
      );
      return 1;
    }
    for (const lease of renewed) {
      const ttl = Number(lease.ttlMinutes) || DEFAULT_TTL_MINUTES;
      process.stdout.write(
        `renewed ${lease.id} (${lease.task}) - ${ttl}m from now\n`
      );
    }
    return 0;
  }

  if (command === 'release') {
    if (options.task == null) {
      throw new Error(`release needs a lease id or --task\n${USAGE}`);
    }
    const released = withLock({
      lockFile: paths.lock,
      timeoutMs: LOCK_TIMEOUT_MS,
      mutate: () => {
        const state = readJson(paths.leases, { leases: [] });
        const keep = [];
        const gone = [];
        for (const lease of state.leases ?? []) {
          if (lease.id === options.task || lease.task === options.task)
            gone.push(lease);
          else keep.push(lease);
        }
        const next = { ...state, leases: keep };
        // A released task's waiting marker goes with it.
        const pending = (state.pendingExclusive ?? []).filter(
          (entry) => entry.task !== options.task && entry.id !== options.task
        );
        if (pending.length > 0) next.pendingExclusive = pending;
        else delete next.pendingExclusive;
        // ... and so does its place in the queue (X26): a task that has let go of the
        // machine stops reserving a pair, and the next round of `acquire` for it joins
        // the line at the back like anybody else's.
        const waiters = (state.waiters ?? []).filter(
          (waiter) =>
            waiter?.task !== options.task && waiter?.id !== options.task
        );
        if (waiters.length > 0) next.waiters = waiters;
        else delete next.waiters;
        writeJsonAtomic(paths.leases, next);
        return gone;
      },
    });
    if (released.length === 0)
      process.stdout.write(`no lease matched ${options.task}\n`);
    for (const lease of released) {
      process.stdout.write(`released ${lease.id} (${lease.task})\n`);
    }
    // The devices stay booted - that is the pool's whole point: the next task inherits a warm
    // device instead of paying for a boot. And `release` does not reap either (X11 fix round 2): the
    // devices it just let go are the warm ones, and whatever else is idle on the machine is the
    // business of the next explicit `lease.mjs reap`.
    return 0;
  }

  if (command === 'reap') {
    const { devices } = loadDevices(options, paths);
    // Asked directly, `reap` accounts for every device it looked at, including the ones it left
    // up: this is the one command with no reason to be quiet about what it touched, and "kept"
    // is the answer a caller needs when they were told the machine would be free.
    reportReap(reapPool({ devices, paths, options, log }), log, {
      reportKeeps: true,
    });
    return 0;
  }

  if (command !== 'acquire') {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  if (options.task == null)
    throw new Error(`acquire needs --task <id>\n${USAGE}`);
  // What this lease may actually do to a device, and whether it was asked for badly. Checked
  // before the lease exists, so a refusal cannot have powered the pool off first (item 2).
  const wantsBoot = bootForLease(options);
  const misuse = exclusiveBootMisuse({ options, boot: wantsBoot.boot });
  if (misuse != null) throw new Error(`${misuse}\n${USAGE}`);
  if (wantsBoot.note != null) log(`lease: ${wantsBoot.note}`);

  const { devices, configPath } = loadDevices(options, paths);
  const result = acquire({ devices, paths, options, log });

  if (
    result.kind === 'timeout' ||
    result.kind === 'wait' ||
    result.kind === 'refuse'
  ) {
    log(refusalMessage(result, configPath));
    return 1;
  }

  const { lease, pair } = result;
  // What an exclusive acquire decided over a busy Metro port (X15 review): it does not
  // wait for a port a bench never uses, but the human about to measure 8 hours of load
  // numbers has to know somebody's Metro is still on the machine.
  if (result.note != null) log(`lease: ${result.note}`);
  const pool = poolFor({ devices, paths, options, log });
  if (lease.exclusive && pool != null) {
    // The one reap an `acquire` runs (X11 fix round 2): an exclusive lease *promises* a quiet
    // machine, so powering the pool down is the transaction, not a side effect that happens to ride
    // along with somebody's `list`. It runs whether or not `--boot` was passed (X11 review M6):
    // CONTRIBUTING tells a bench host to take a lease *without* `--boot` (the bench boots its own
    // device, slowly, on purpose), and the promise that `--exclusive` powers the machine down is
    // unconditional. A bench that asked for a quiet machine and got one device left running is the
    // failure this fixes. The keys come from devices.json rather than `pool.json`, so a pool device
    // booted outside the pool is included, and this is the only caller allowed to exempt a live
    // lease from its own protection - its own, which holds every pair by definition.
    //
    // One thing it does not kill is the device it is about to hand over, when that device is already
    // up (X16 item 3). `exceptLeaseId` is what makes that possible and what made it a bug: removing
    // the lease's protection from its own pair means `--exclusive --boot --platform android` powers
    // off, and then cold-starts, the emulator the bench was just given - 54 s and a load spike for a
    // reboot of the one device about to be measured on. Sparing is done by *not naming* the key, so
    // the pool's own rules decide what happens next (an unnamed key is not forced, and a key a live
    // lease holds is kept) rather than this caller widening its licence. Only when a boot was asked
    // for, and only for that platform: with no boot the promise is a quiet machine, whole.
    const spare = wantsBoot.boot ? pool.upKeysFor(pair, options.platform) : [];
    const shutdownKeys = poolShutdownKeys(pool).filter(
      (key) => !spare.includes(key)
    );
    for (const key of spare)
      log(`lease: spared ${key} (already up, this lease's own)`);
    const swept = pool.reap({
      shutdownKeys,
      reason: 'exclusive acquire',
      exceptLeaseId: lease.id,
    });
    // A spared key comes back under `kept` - the pool kept it because a live lease holds it, and
    // that lease is this one - so counting `kept` as well would say "1 spared, 1 held by a lease"
    // for one device, and read as another task's lease keeping a device under the bench (X17
    // item 2). `kept` here means held by somebody else; the spare has its own count.
    const reaped = {
      ...swept,
      kept: (swept.kept ?? []).filter((entry) => !spare.includes(entry.key)),
    };
    reportReap(reaped, log);
    // The promise an exclusive lease makes, stated only when it was kept. A reap that was skipped
    // (an unreadable `pool.json`) or that could not power something off leaves devices running
    // under this bench, and a line saying "every device is off" would be the one thing a bench host
    // cannot afford to believe. `reportReap` has already said why; this line has to agree with it.
    log(
      reaped.skipped != null
        ? 'lease: exclusive - the pool was NOT powered off (see the line above)'
        : `lease: exclusive - ${
            reaped.failed.length > 0
              ? `${reaped.failed.length} device(s) are still up`
              : spare.length > 0
                ? `every device no other lease holds is off, except the ${
                    spare.length
                  } spared for this lease`
                : 'every device no other lease holds is off'
          } ` +
            `(${reaped.reaped.length} shut down, ${reaped.alreadyOff.length} already off` +
            (spare.length > 0 ? `, ${spare.length} spared` : '') +
            (reaped.kept.length > 0
              ? `, ${reaped.kept.length} held by a lease`
              : '') +
            `)`
    );
  }

  if (wantsBoot.boot && pool != null) {
    poolHandoff({ pool, result, options, log });
  } else {
    if (!wantsBoot.boot) {
      // The env is only suggested where it works. For an exclusive lease whose env-driven boot was
      // just dismissed, a second line saying "or NITRO_UI_LEASE_BOOT=1" would undo the note above
      // and send the reader back to a flag that does nothing here.
      log(
        options.exclusive
          ? 'lease: devices not booted - pass --boot with --platform to warm a ' +
              'device for this bench (an --exclusive lease ignores NITRO_UI_LEASE_BOOT)'
          : 'lease: devices not booted - pass --boot (or NITRO_UI_LEASE_BOOT=1) to warm the pair'
      );
    }
    if (wantsBoot.boot && pool == null) {
      log('lease: --boot needs a devices.json to boot from, and there is none');
    }
    // And no reap: a lease is a booking, and a booking that quietly powers devices off is the
    // thing this round took away. `lease.mjs reap` is the command for that.
  }

  const envFile = renderEnvFile(lease, pair);
  if (options.out != null) {
    writeFileSync(options.out, envFile);
    log(`lease: ${result.lease.id} for ${result.lease.task} -> ${options.out}`);
  } else {
    process.stdout.write(envFile);
  }
  return 0;
}

/**
 * Which configured pairs have a Metro port a live process still serves, and why.
 *
 * `lsof` is one subprocess per port, so the whole pool is answered in one pass rather
 * than per candidate pair, and the caller hands the result to `decideAcquire`, which is
 * where "usable pair" is decided.
 *
 * A port the machine cannot ask about (`lsof` missing, refused) counts as free and is
 * said out loud once, because a machine that cannot check must still be able to lease
 * devices - see `portListeners`' fail-open.
 *
 * @param {object} options
 * @param {ReturnType<typeof normalizeDevices>} options.devices
 * @param {(message: string) => void} [options.log]
 * @returns {Array<{id: string, reason: string}>}
 */
function metroPortBlockers({ devices, log = () => {} }) {
  const blockers = [];
  let warned = false;
  for (const pair of devices.pairs ?? []) {
    const answer = portListeners({ port: pair.metroPort });
    if (!answer.checked) {
      if (!warned) {
        warned = true;
        log(
          `lease: could not check the pool's Metro ports ` +
            `(${String(answer.error)}) - leasing on the lease file alone`
        );
      }
      continue;
    }
    if (answer.listeners.length === 0) continue;
    blockers.push({
      id: pair.id,
      reason: metroPortReason(pair, answer.listeners),
    });
  }
  return blockers;
}

/**
 * The device work an `acquire` does once the lease exists: boot the pair it names and clear the
 * last task's app data.
 *
 * Order matters twice over. For an exclusive lease the power-off happens *before* this function is
 * called, so a device about to be reused is never powered off underneath the new lease (and the new
 * lease's id is live by now, which is what protects it from any later reap). And the boot happens
 * before the reset: `pm clear` on a device that is still booting fails, and a failed reset is a
 * warning rather than a lost lease - the next run's harness reinstalls the app anyway.
 *
 * An exclusive lease used to be excluded from this function entirely (`if (!lease.exclusive)`), on
 * the reasoning that a bench host boots its own device slowly and on purpose. That made
 * `--exclusive --boot` silently ignore `--boot`: CONTRIBUTING's own baseline-mint one-liner is
 * `acquire --task <ID> --exclusive --boot`, and the simulators it names stayed powered off, so the
 * bench host booted its leased device by hand (X16 item 2, FOLLOWUPS 89). What the flag has to mean
 * here is "power the pool off, *then* bring up what you handed me", which is the same hand-off every
 * other `--boot` gets - including its reset, because the machine the bench inherits has just been
 * somebody else's.
 */
function poolHandoff({ pool, result, options, log }) {
  const { lease, pair } = result;

  // Boots happen here; reaping does not (X11 fix round 2). `--no-reap` therefore no longer has
  // anything on this path to suppress - the only reaps left are the explicit `lease.mjs reap` and an
  // exclusive acquire's power-off, and that one runs in `acquire`, before this function is reached.
  // Warm reuse: every lease wants its own two devices back if they are still up, and an exclusive
  // lease wants them warm too once the pool has been powered off underneath it.
  // The half this hand-off may touch: what the lease is for, narrowed by what this command asked
  // for. Equal on a new lease. On a re-acquire they can differ, and the lease's answer is the one
  // the env file prints, so a task that leased iOS and re-runs `acquire --boot` without
  // `--platform` (which defaults to `both`) is still not handed - or booted, or reset - the
  // emulator it never leased (X20 item 2).
  const platform = handoffPlatform(lease.platform, options.platform);
  const booted = pool.ensureBooted(pair, lease, {
    platform,
    timeoutMs: (options.bootTimeoutMinutes ?? 7) * 60_000,
  });
  for (const key of booted.booted) log(`lease: booted ${key}`);
  if (booted.booted.length > 0) {
    // Printed, because a boot cost is only ever a measurement (X11 review N4): the numbers in
    // AGENTS.md and CONTRIBUTING.md used to be folklore, copied from a machine nobody timed. This
    // is the pool's own wait - ask to "attached and booted, and the load settled or the wait gave
    // up" - so the next person times it here instead of repeating someone else's guess. Only on a
    // real boot: on a warm reuse there is no cost to report.
    log(
      `lease: the boot wait took ${(booted.waitedMs / 1000).toFixed(1)}s ` +
        '(device attached + load settle, or a timeout)' +
        (booted.degraded.length > 0
          ? ` - degraded: ${booted.degraded.join(', ')}`
          : '')
    );
  }
  for (const key of booted.degraded) {
    log(
      `lease: WARN ${key} did not come up - the harness will boot it, slowly`
    );
  }
  // The reset is what stops a task inheriting the *previous* task's storage. When this task already
  // held the lease and nothing had to be booted, there is no previous task: the storage on those
  // devices is this task's own, and wiping it is the bug (X11 re-review M2). Re-running
  // `acquire --boot` in a second shell to regenerate the env file is the documented way to get an
  // env file, and it used to `pm clear` and `simctl uninstall` under the task's own running suite.
  //
  // Deliberately narrower than "skip whenever `already`": a re-acquire that *did* have to boot the
  // pair is looking at devices that came up from a snapshot, which can be another task's data, and
  // skipping there would reintroduce the inheritance the reset exists to prevent. So the skip is
  // `already` *and* warm - exactly the case that made the probe's output. Anything that reaches the
  // device anyway is stopped by `resetPair`'s own claim check (below), which is the part that
  // protects a live run whatever the lease history.
  const warmReacquire = result.already === true && booted.booted.length === 0;
  if (options.reset && warmReacquire) {
    log(
      'lease: not resetting the pair - this task already held the lease and nothing was booted, ' +
        'so the storage there is its own'
    );
  } else if (options.reset) {
    // Only the half this lease is for (X20 item 2): an iOS-only lease used to `pm clear` the pair's
    // emulator too, which is a device it never asked for and another task may be using.
    for (const row of pool.resetPair(pair, { platform })) {
      // The device's own answer, and how many tries it took: a reset that failed after four
      // attempts is a different problem from one that failed once and settled, and the reader
      // cannot tell the two apart without it.
      const detail = row.skipped
        ? ` SKIPPED (${row.skipped})`
        : row.ok
          ? row.attempts > 1
            ? ` (${row.attempts} tries)`
            : ''
          : ` FAILED (${row.answer}) - the next run inherits its data`;
      log(`lease: reset ${row.key}: ${row.action}${detail}`);
    }
  }
}

/**
 * The platform a hand-off acts on: the lease's, narrowed by the command's. `both` narrows to the
 * other side; two different single platforms keep the lease's, because the lease is what the task
 * holds and what its env file names.
 *
 * @param {'ios'|'android'|'both'|undefined} leased
 * @param {'ios'|'android'|'both'} asked
 * @returns {'ios'|'android'|'both'}
 */
function handoffPlatform(leased, asked) {
  const held = leased ?? 'both';
  if (held === 'both') return asked;
  return held;
}

/* --------------------------- the warm device pool --------------------------- */

/**
 * Whether this `acquire` should do device work, and what to say when the answer surprised it.
 *
 * An **exclusive** lease boots only for a typed `--boot`; `NITRO_UI_LEASE_BOOT=1` does not count.
 * The variable exists because an agent's lease is always a device lease, and CONTRIBUTING's
 * `--no-boot` comment describes a bench host that sets it in its profile and still wants a
 * naming-only lease - which is the same host that types `--exclusive`. Before X16 the env booted
 * nothing under `--exclusive`, because the exclusive path skipped the hand-off entirely; making
 * that hand-off work (item 2) silently turned the variable into "cold-boot a simulator under my
 * baseline", on a host where a boot is a load spike of 50-150 and a simulator that then idles for
 * the rest of a 4-hour mint. A bench's machine is the one place where a boot must not be implicit.
 *
 * @param {ReturnType<typeof parseArgs>} options
 * @returns {{boot: boolean, note: string | null}}
 */
function bootForLease(options) {
  if (!options.exclusive) return { boot: options.boot, note: null };
  if (options.bootFlag) return { boot: true, note: null };
  return {
    boot: false,
    note: options.boot
      ? 'NITRO_UI_LEASE_BOOT does not boot an --exclusive lease: only a typed ' +
        '--boot does. Pass --boot (with --platform) to warm a device for this bench'
      : null,
  };
}

/**
 * What an exclusive `acquire` got wrong about its flags, or `null`.
 *
 * `--platform` defaults to `both`, and the hand-off hands that default to `ensureBooted`, so
 * `--exclusive --boot` alone brings up *both* devices of the pair it hands over. CONTRIBUTING's own
 * bench line is `acquire --exclusive --boot` followed by `bench/run.mjs --platform android`: one
 * half measured, both halves cold-booted, and every boot on this machine is minutes of load a
 * baseline is supposed to be free of. `both` is a legitimate answer, so the fix is not to forbid it
 * - it is to make somebody choose it. The default is refused with the flag named, before the lease
 * is written, so refusing costs nothing.
 *
 * Judged on the boot this lease will really do (`boot`), not on the flags: an exclusive lease whose
 * env-only boot was just dismissed has no boot to get wrong, and refusing it would be refusing a
 * command that powers nothing on.
 *
 * @param {{options: ReturnType<typeof parseArgs>, boot: boolean}} args
 * @returns {string | null}
 */
function exclusiveBootMisuse({ options, boot }) {
  if (!options.exclusive || !boot) return null;
  if (!options.platformGiven) {
    return (
      'an --exclusive --boot must name the half it warms: pass --platform ' +
      'android, --platform ios or --platform both. An exclusive lease brings a machine ' +
      'to a standstill for hours and a cold boot is the noise it exists to avoid, so ' +
      'the defaulted --platform both is not taken as a wish to boot both devices'
    );
  }
  return null;
}

/**
 * A pool bound to this machine's state, or null when the caller opted out of device lifecycle
 * (`NITRO_UI_LEASE_BOOT=0` / `--no-boot`) or there is no declared pool to manage.
 */
function poolFor({ devices, paths, options, log }) {
  if ((!options.boot && !options.reap) || devices?.pairs == null) return null;
  return new DevicePool({
    home: paths.home,
    env: process.env,
    devices,
    log,
  });
}

/**
 * Runs `reap` and returns its report, or `{ skipped }` when there is nothing to reap.
 *
 * A lease command must never fail because a cleanup did: `pruneExpired` and the lease file are
 * already consistent by the time this runs, and a device that will not power off is somebody
 * else's problem (usually a stuck `adb emu kill`), not a reason to lose a lease you already hold.
 */
function reapPool({
  devices,
  paths,
  options,
  log,
  shutdownKeys = [],
  reason = 'idle',
  exceptLeaseId = null,
}) {
  const pool = poolFor({ devices, paths, options, log });
  if (pool == null) {
    return {
      skipped: devices?.pairs == null ? 'no devices.json' : '--no-reap',
    };
  }
  try {
    return pool.reap({
      idleMinutes: options.idleMinutes ?? undefined,
      shutdownKeys,
      reason,
      ...(exceptLeaseId != null ? { exceptLeaseId } : {}),
    });
  } catch (error) {
    log(`lease: reap failed (${String(error?.message ?? error)})`);
    return { skipped: 'reap failed' };
  }
}

/** Warm devices, for `list` (the pool is what a task wants to know before it boots anything). */
function poolSummary(devices, paths) {
  if (devices?.pairs == null) return [];
  try {
    return new DevicePool({
      home: paths.home,
      devices,
      env: process.env,
      log: () => {},
    }).summary();
  } catch {
    return [];
  }
}

function poolRows(devices, paths) {
  return poolSummary(devices, paths).map((x) => {
    const who = x.leaseTask ? `lease ${x.leaseTask}` : 'no lease';
    const use = x.busy
      ? `in use (${x.claims.map((c) => c.gate ?? `pid ${c.pid}`).join(', ')})`
      : `idle ${x.idleMinutes}m of ${
          x.idleShutdownMinutes ?? IDLE_SHUTDOWN_DEFAULT_MINUTES
        }m`;
    // The serial/UDID as well as the pool key: `list` is what a task reads before it reaches for
    // an `adb -s`, and the key names an AVD, not the device to address.
    const where = x.serial ?? x.udid ?? '';
    return (
      [
        'pool'.padEnd(24),
        String(x.key).padEnd(28),
        where.padEnd(24),
        who.padEnd(20),
        use,
      ].join(' ') + '\n'
    );
  });
}

/** How a keep reads to whoever asked: the reason code, in the order it matters. */
const KEEP_REASONS = {
  'busy': 'a run is using it',
  // Every reason reads as itself, so `list`/`reap` never print a reason code the ledger or a
  // person has to look up. `unowned-grace` is the answer for a lease that has run out - the
  // phrasing is the honest one only when it is paired with the lease id, which `list` prints.
  'booting': 'a boot is in progress',
  'idle-grace': `idle, under the limit`,
  'lease-held': 'a live lease holds it',
  'unowned-grace': 'no live lease holds it, under the idle limit',
};

function reportReap(reaped, log, { reportKeeps = false } = {}) {
  if (reaped?.skipped != null) {
    // Loud, because every caller left is one somebody typed: `lease.mjs reap`, or an exclusive
    // acquire that promised a quiet machine and did not get one. A reap that quietly did nothing is
    // the failure mode this line exists to prevent - it reads as "the pool is clean".
    log(`lease: reap skipped (${reaped.skipped})`);
    return;
  }
  if (reportKeeps) {
    for (const x of reaped?.kept ?? []) {
      log(`lease: keeping ${x.key} up (${KEEP_REASONS[x.reason] ?? x.reason})`);
    }
  }
  for (const x of reaped?.refused ?? []) {
    log(`lease: not touching ${x.key} (${x.why})`);
  }
  for (const x of reaped?.failed ?? []) {
    log(`lease: could not shut down ${x.key} (${x.reason}) - it stays listed`);
  }
  for (const x of reaped?.reaped ?? []) {
    log(`lease: shut down ${x.key} (${x.reason})`);
  }
}

/**
 * Pool devices no live lease holds: what an exclusive lease powers off before it starts measuring,
 * because a boot it did not start is still load it has to share, and a bench cannot mint a baseline
 * next to somebody's emulator.
 *
 * "Held" is the lease id the pool record carries, matched against the live lease file - the same
 * association `reap` reads, so the two cannot disagree about who owns a device.
 */
/**
 * Every pool key devices.json declares: what an exclusive lease powers off before it starts
 * measuring, because a boot it did not start is still load it has to share, and a bench cannot mint
 * a baseline next to somebody's emulator (X11 review M6).
 *
 * Enumerated from devices.json rather than from `pool.json` on purpose: a pool device that was
 * booted outside the pool - by the harness's own boot path, or by hand - has no record, and a
 * reaper that only read records would call the machine quiet while an emulator hummed under it.
 * Who may actually be powered off out of this list is the pool's decision (`reap` refuses any pair
 * another live lease holds, and anything outside devices.json entirely).
 */
function poolShutdownKeys(pool) {
  try {
    return pool.keysForPool();
  } catch {
    return [];
  }
}

const isMain =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`lease: ${String(error.message)}\n`);
    process.exit(2);
  }
}
