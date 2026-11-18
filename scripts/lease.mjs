#!/usr/bin/env node
/**
 * One machine's device and port leases: `acquire`, `release`, `reap`, `list`.
 *
 *   node scripts/lease.mjs acquire --task <id>                   # env file on stdout
 *   node scripts/lease.mjs acquire --task <id> --exclusive --out /tmp/lease.env
 *   node scripts/lease.mjs acquire --task <id> --note "merge: check, harness:ios; then real-input:ios, quiet machine"
 *   node scripts/lease.mjs note <id> "<text>"                    # change the note, "" clears it
 *   node scripts/lease.mjs list
 *   node scripts/lease.mjs release <id>                          # by task or lease id
 *   node scripts/lease.mjs reap                                  # power idle devices off
 *
 * `acquire` prints an env file to source; the gates read its variables:
 *
 *   set -a; source <(node scripts/lease.mjs acquire --task "$TASK"); set +a
 *
 * The pool comes from `~/.nitro-ui/devices.json`, one file per machine (see
 * `scripts/devices.example.json`). At most `maxDeviceLeases` (default 2) device
 * tasks hold a lease at a time, `--exclusive` waits until every other lease has
 * ended, and `emulator-5560` can never be leased.
 *
 * Exit codes: 0 done, 1 lease refused or timed out, 2 usage error.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  DEFAULT_TTL_MINUTES,
  IDLE_SHUTDOWN_DEFAULT_MINUTES,
  EXCLUSIVE_TTL_MINUTES,
  assertLeasable,
  formatWaited,
  leaseAcquiredAtMs,
  normalizeNote,
  withNote,
  metroPortReason,
  metroPortsOf,
  portListeners,
  pruneExpired,
  decideAcquire,
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

const USAGE =
  'usage: node scripts/lease.mjs acquire --task <id> [--platform ios|android|both]\n' +
  '                                          [--exclusive] [--wait-minutes N]\n' +
  '                                          [--ttl-minutes N] [--out <file>] [--config <file>]\n' +
  '                                          [--boot] [--no-boot] [--boot-timeout-minutes N]\n' +
  '                                          [--note <text>]\n' +
  '         (--exclusive --boot needs --platform ios|android|both: an exclusive lease boots only\n' +
  '          the half it names, and never for NITRO_UI_LEASE_BOOT alone)\n' +
  '       node scripts/lease.mjs note <lease-id> <text>   (what the lease runs next; "" clears it)\n' +
  '       node scripts/lease.mjs release <lease-id> | --task <id>\n' +
  '       node scripts/lease.mjs reap [--idle-minutes N] [--config <file>]   (the only reaper)\n' +
  '       node scripts/lease.mjs list [--json]   (leases, who is queued and warm devices)';

/** How often a waiting acquire re-reads the lease file. */
const POLL_MS = Number(process.env.NITRO_UI_LEASE_POLL_MS ?? 10_000);

/** How long one lock attempt may take before the wait loop tries again. */
const LOCK_TIMEOUT_MS = Number(
  process.env.NITRO_UI_LEASE_LOCK_TIMEOUT_MS ?? 10_000
);

/**
 * Booting devices is opt-in: `--boot`, or `NITRO_UI_LEASE_BOOT=1` for a whole shell.
 * `NITRO_UI_LEASE_BOOT=0` forces all device lifecycle off, reaping included. Only
 * `reap` and an `--exclusive` acquire ever power a device off.
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
    // Whether `--platform` was typed: an exclusive `--boot` refuses the defaulted `both`.
    platformGiven: false,
    exclusive: false,
    waitMinutes: null,
    // null means the default for this kind of lease; see `acquire`.
    ttlMinutes: null,
    out: null,
    config: null,
    json: false,
    // `--boot` / `--no-boot` win over the env default; the env can only force it off.
    boot: BOOT_FORCED_OFF ? false : BOOT_DEFAULT,
    // Whether `--boot` was typed: an exclusive lease boots only for a typed flag.
    bootFlag: false,
    reap: !BOOT_FORCED_OFF,
    bootTimeoutMinutes: null,
    idleMinutes: null,
    // `undefined` until `--note` is typed: an acquire without it leaves a held lease's note alone.
    note: undefined,
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
        options.boot = true;
        options.bootFlag = true;
        break;
      case '--no-boot':
        // Also beats `NITRO_UI_LEASE_BOOT=1`.
        options.boot = false;
        options.bootFlag = false;
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
      case '--note':
        options.note = normalizeNote(take('--note', argv[++index]));
        break;
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

/** The machine's pool, or null: `list` must work without a `devices.json`. */
function loadDevicesOrNull(options, paths) {
  try {
    return loadDevices(options, paths).devices;
  } catch {
    return null;
  }
}

/** The machine's pool, with the reason it is missing spelled out. */
function loadDevices(options, paths) {
  // `--config` for one command, `NITRO_UI_DEVICES` for a whole shell.
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
 * A refused request that is willing to wait records itself, so a freed pair goes
 * to whoever has waited longest, not to whoever polls first. A waiting exclusive
 * request also holds new device leases back, so the machine can go quiet.
 */
function acquire({ devices, paths, options, log }) {
  const waitMinutes = options.waitMinutes ?? (options.exclusive ? 60 : 0);
  const startedWaitingAt = Date.now();
  const deadline = startedWaitingAt + waitMinutes * 60_000;
  // A `--wait-minutes 0` acquire never joins the queue: a ticket written on the
  // way out would reserve a pair for a task that has already given up.
  const queuesItself = waitMinutes > 0;
  const ttlMinutes =
    options.ttlMinutes ??
    (options.exclusive ? EXCLUSIVE_TTL_MINUTES : DEFAULT_TTL_MINUTES);
  // Stable across polls, so a retried acquire reports one id.
  const leaseId = newLeaseId(options.task, Date.now());

  for (;;) {
    // A free entry in `leases.json` is not a free Metro port. The ports are read
    // before taking the lock: the check spawns a subprocess, and the lease lock
    // must not be held while waiting for one.
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
          // My own records from an earlier poll: their `requestedAt` is my place
          // in the queue, which a later poll must not move.
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
          // The last poll before the deadline must not leave a record behind: it
          // would reserve a pair for a task that has given up.
          const keepWaiting = now + POLL_MS < deadline;
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
          if (sameTask != null) {
            // Idempotent: a task that asks twice keeps what it already has. No Metro
            // check either: a server on this pair's port is this task's own run.
            dropMyTicket();
            if (options.note !== undefined) {
              const noted = withNote(sameTask, options.note);
              const latest = readJson(paths.leases, { leases: [] });
              writeJsonAtomic(paths.leases, {
                ...latest,
                leases: (latest.leases ?? []).map((lease) =>
                  lease.id === sameTask.id ? noted : lease
                ),
              });
              return {
                kind: 'acquired',
                lease: noted,
                pair: devices.pairs.find((pair) => pair.id === noted.holds[0]),
                already: true,
              };
            }
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
            waiters: waitQueue(state, now).filter(
              (waiter) => waiter.task !== options.task
            ),
            // My place in the line: the ticket I hold, the queue I am about to join,
            // or, with no record at all, the back.
            waitedSince:
              queuesItself || myTicket != null || myMarker != null
                ? waitedSince
                : now,
            now,
          });
          if (!decision.ok) {
            // A waiting exclusive request records a drain marker, which also holds
            // new leases back; any other waiter records a ticket. One waiter is one
            // record: `waitQueue` reads a marker as a place in the queue.
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

          const lease = withNote(
            {
              id: leaseId,
              task: options.task,
              platform: options.platform,
              exclusive: options.exclusive,
              // An exclusive lease holds every pair: it needs a quiet machine, not a
              // free simulator.
              holds: options.exclusive
                ? devices.pairs.map((pair) => pair.id)
                : [decision.pair.id],
              acquiredAt: now,
              ttlMinutes,
            },
            options.note ?? null
          );
          const next = { ...state, leases: [...state.leases, lease] };
          if (others.length > 0) next.pendingExclusive = others;
          else delete next.pendingExclusive;
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
      // A busy lock is a reason to keep waiting: retry until the caller's deadline.
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
  // `note` takes a text that may look like anything, so it is not parsed as flags.
  if (command === 'note') return noteCommand(argv.slice(1), paths);
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
    const listedDevices = loadDevicesOrNull(options, paths);
    const queue = waitQueue(state, Date.now());
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({ ...state, queue, pool: poolSummary(listedDevices, paths) }, null, 2)}\n`
      );
      return 0;
    }
    if (state.leases.length === 0 && queue.length === 0) {
      process.stdout.write(`no leases in ${paths.leases}\n`);
      // The pool rows still print: a device can be booted with nothing leased.
      for (const row of poolRows(listedDevices, paths))
        process.stdout.write(row);
      return 0;
    }
    for (const lease of state.leases) {
      const row = [
        lease.id.padEnd(24),
        lease.task.padEnd(12),
        String(lease.platform).padEnd(8),
        (lease.exclusive ? 'exclusive' : '').padEnd(10),
        lease.holds.join(',').padEnd(24),
        formatAge(lease, Date.now()),
      ];
      if (lease.note != null) row.push(`- ${lease.note}`);
      process.stdout.write(`${row.join(' ')}\n`);
    }
    for (const waiter of queue) {
      const since = waiterRequestedAtMs(waiter);
      process.stdout.write(
        `queue${String(waiter.position).padStart(4)}. ${String(waiter.task).padEnd(12)}` +
          `${String(waiter.platform ?? 'both').padEnd(10)}` +
          `${(waiter.exclusive ? 'exclusive' : 'waiting').padEnd(10)}` +
          `${String(waiter.id ?? '').padEnd(18)}` +
          `${waiter.exclusive ? 'wants an exclusive lease' : 'waiting for a pair'}, ` +
          `waited ${formatWaited(waiter.waitedMs)} ` +
          `(since ${since == null ? 'unknown' : `${new Date(since).toISOString().slice(11, 16)}Z`})\n`
      );
    }
    for (const row of poolRows(listedDevices, paths)) process.stdout.write(row);
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
        // ... and so does its place in the queue.
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
    // The devices stay booted, so the next task inherits a warm one.
    return 0;
  }

  if (command === 'reap') {
    const { devices } = loadDevices(options, paths);
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
  // Checked before the lease exists, so a refusal cannot have powered the pool off first.
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
  // An exclusive acquire does not wait for a busy Metro port, but says it is busy.
  if (result.note != null) log(`lease: ${result.note}`);
  const pool = poolFor({ devices, paths, options, log });
  if (lease.exclusive && pool != null) {
    // An exclusive lease promises a quiet machine, so it powers the pool off whether or
    // not `--boot` was passed. `exceptLeaseId` lifts this lease's own protection of the
    // pairs it holds, which is all of them. A device this lease is about to boot is
    // spared when it is already up: leaving its key out lets the pool keep it.
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
    // The pool reports a spared key under `kept`, because this lease holds it. Filtered
    // out, so `kept` counts only devices another lease holds.
    const reaped = {
      ...swept,
      kept: (swept.kept ?? []).filter((entry) => !spare.includes(entry.key)),
    };
    reportReap(reaped, log);
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
 * `note <lease-id> <text>`: sets the note of the lease with that id, or of the task with
 * that name. An empty text clears it.
 */
function noteCommand(args, paths) {
  if (args.length !== 2) {
    throw new Error(`note needs a lease id and a text ("" clears it)\n${USAGE}`);
  }
  const [who, text] = args;
  const note = normalizeNote(text);
  const noted = withLock({
    lockFile: paths.lock,
    timeoutMs: LOCK_TIMEOUT_MS,
    mutate: () => {
      const state = readJson(paths.leases, { leases: [] });
      const changed = [];
      const leases = (state.leases ?? []).map((lease) => {
        if (lease.id !== who && lease.task !== who) return lease;
        const next = withNote(lease, note);
        changed.push(next);
        return next;
      });
      if (changed.length > 0) writeJsonAtomic(paths.leases, { ...state, leases });
      return changed;
    },
  });
  if (noted.length === 0) {
    process.stderr.write(`lease: no lease matched ${who}\n`);
    return 1;
  }
  for (const lease of noted) {
    process.stdout.write(
      lease.note == null
        ? `cleared the note of ${lease.id} (${lease.task})\n`
        : `noted ${lease.id} (${lease.task}): ${lease.note}\n`
    );
  }
  return 0;
}

/**
 * Which configured pairs have a Metro port a live process still serves, and why.
 * A port the machine cannot ask about (`lsof` missing or refused) counts as free.
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
    const reasons = [];
    for (const port of new Set(Object.values(metroPortsOf(pair)))) {
      const answer = portListeners({ port });
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
      reasons.push(
        metroPortReason({ id: pair.id, metroPort: port }, answer.listeners)
      );
    }
    if (reasons.length > 0)
      blockers.push({ id: pair.id, reason: reasons.join('; ') });
  }
  return blockers;
}

/**
 * The device work an `acquire` does once the lease exists: boot the pair it names.
 * An exclusive lease's power-off has already run by now, so a device about to be
 * reused is never powered off underneath its new lease.
 */
function poolHandoff({ pool, result, options, log }) {
  const { lease, pair } = result;

  // On a re-acquire the command's platform can differ from the lease's. The lease's
  // wins: a task that leased iOS and re-runs `acquire --boot` without `--platform`
  // is not booted the emulator it never leased.
  const platform = handoffPlatform(lease.platform, options.platform);
  const booted = pool.ensureBooted(pair, lease, {
    platform,
    timeoutMs: (options.bootTimeoutMinutes ?? 7) * 60_000,
  });
  for (const key of booted.booted) log(`lease: booted ${key}`);
  if (booted.booted.length > 0) {
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
}

/**
 * The platform a hand-off acts on: the lease's, or the command's when the lease
 * holds `both`.
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
 * Whether this `acquire` should boot devices, and a note when the answer may surprise.
 *
 * An exclusive lease boots only for a typed `--boot`, never for `NITRO_UI_LEASE_BOOT=1`:
 * it is taken for a benchmark, where a cold boot is load the measurement must not share,
 * so the boot has to be asked for explicitly.
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
 * `--platform` defaults to `both`, which would cold-boot both devices under a bench
 * that measures one, so an exclusive lease that boots must name its platform.
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
 * Never throws: a device that will not power off is no reason to fail a lease command.
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
      skipped:
        devices?.pairs == null ? 'no devices.json' : 'NITRO_UI_LEASE_BOOT=0',
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

/** Warm devices, for `list`. */
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
    // The serial or UDID as well as the pool key: the key names an AVD, not the device
    // to address.
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

/** Why `reap` left a device up, in words, by reason code. */
const KEEP_REASONS = {
  'busy': 'a run is using it',
  'booting': 'a boot is in progress',
  'idle-grace': `idle, under the limit`,
  'lease-held': 'a live lease holds it',
  'unowned-grace': 'no live lease holds it, under the idle limit',
};

function reportReap(reaped, log, { reportKeeps = false } = {}) {
  if (reaped?.skipped != null) {
    // Said aloud: a reap that silently did nothing would read as a clean pool.
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
 * Every pool key devices.json declares: what an exclusive lease asks to power off.
 * Read from devices.json and not `pool.json`, because a device booted outside the
 * pool has no record there and would be left running.
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
