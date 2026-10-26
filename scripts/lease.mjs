#!/usr/bin/env node
/**
 * One machine's device and port leases: `acquire`, `renew`, `release`, `list`.
 *
 *   node scripts/lease.mjs acquire --task G6                        # env file on stdout
 *   node scripts/lease.mjs acquire --task B1 --exclusive --out /tmp/b1.env
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
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  DEFAULT_TTL_MINUTES,
  EXCLUSIVE_TTL_MINUTES,
  assertLeasable,
  pruneExpired,
  decideAcquire,
  newLeaseId,
  normalizeDevices,
  readJson,
  renderEnvFile,
  sleepMs,
  stateHome,
  statePaths,
  withLock,
  writeJsonAtomic,
} from './lease-core.mjs';

const USAGE =
  'usage: node scripts/lease.mjs acquire --task <id> [--platform ios|android|both]\n' +
  '                                          [--exclusive] [--wait-minutes N]\n' +
  '                                          [--ttl-minutes N] [--out <file>] [--config <file>] [--json]\n' +
  '       node scripts/lease.mjs renew <lease-id> | --task <id>\n' +
  '       node scripts/lease.mjs release <lease-id> | --task <id>\n' +
  '       node scripts/lease.mjs list [--json]';

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

function parseArgs(argv) {
  const options = {
    task: null,
    platform: 'both',
    exclusive: false,
    waitMinutes: null,
    // null means "the default for this kind of lease", which differs between an
    // ordinary device lease and an exclusive one; see `acquire`.
    ttlMinutes: null,
    out: null,
    config: null,
    json: false,
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
      case '--json':
        options.json = true;
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
  return options;
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
 */
function acquire({ devices, paths, options, log }) {
  const waitMinutes = options.waitMinutes ?? (options.exclusive ? 60 : 0);
  const deadline = Date.now() + waitMinutes * 60_000;
  // An exclusive lease is a bench or a baseline mint: 8 to 14 hours of quiet
  // (PROCESS review §4), so it must not inherit the 4-hour device default.
  const ttlMinutes =
    options.ttlMinutes ??
    (options.exclusive ? EXCLUSIVE_TTL_MINUTES : DEFAULT_TTL_MINUTES);
  // Stable across polls, so a retried acquire reports one id.
  const leaseId = newLeaseId(options.task, Date.now());

  for (;;) {
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
          const sameTask = state.leases.find(
            (lease) => lease.task === options.task
          );
          if (sameTask != null) {
            // Idempotent: a task that asks twice keeps what it already has, so a
            // retried command cannot consume a second pair.
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
          });
          if (!decision.ok) {
            if (options.exclusive) {
              // Refresh our marker on every poll: it is what holds back new
              // device leases, and a killed waiter stops refreshing it.
              writeJsonAtomic(paths.leases, {
                ...state,
                pendingExclusive: [
                  ...others,
                  { task: options.task, id: leaseId, requestedAt: now },
                ],
              });
            }
            return { kind: 'wait', decision };
          }

          const reserved = assertLeasable(
            decision.pair,
            devices,
            options.platform
          );
          if (reserved != null) return { kind: 'refuse', reason: reserved };

          const lease = {
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
          };
          const next = { ...state, leases: [...state.leases, lease] };
          if (others.length > 0) next.pendingExclusive = others;
          else delete next.pendingExclusive;
          writeJsonAtomic(paths.leases, next);
          return { kind: 'acquired', lease, pair: decision.pair };
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
  const minutes = Math.round((now - lease.acquiredAt) / 60_000);
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
    if (options.json) {
      process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
      return 0;
    }
    if (state.leases.length === 0 && state.pendingExclusive == null) {
      process.stdout.write(`no leases in ${paths.leases}\n`);
      return 0;
    }
    for (const lease of state.leases) {
      const row = [
        lease.id.padEnd(24),
        lease.task.padEnd(12),
        lease.platform.padEnd(8),
        (lease.exclusive ? 'exclusive' : '').padEnd(10),
        lease.holds.join(',').padEnd(24),
        formatAge(lease, Date.now()),
      ];
      process.stdout.write(`${row.join(' ')}\n`);
    }
    // Waiting exclusive requests are visible too: they are the reason a new
    // acquire is being held back, and `list` is where a task looks to find out.
    for (const entry of state.pendingExclusive ?? []) {
      process.stdout.write(
        `${String(entry.id ?? '').padEnd(24)}${entry.task.padEnd(12)}` +
          `${'both'.padEnd(8)}${'waiting'.padEnd(10)}${''.padEnd(24)}` +
          `wants an exclusive lease, ${Math.round((Date.now() - entry.requestedAt) / 1000)}s waiting\n`
      );
    }
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
        writeJsonAtomic(paths.leases, next);
        return gone;
      },
    });
    if (released.length === 0)
      process.stdout.write(`no lease matched ${options.task}\n`);
    for (const lease of released) {
      process.stdout.write(`released ${lease.id} (${lease.task})\n`);
    }
    return 0;
  }

  if (command !== 'acquire') {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  if (options.task == null)
    throw new Error(`acquire needs --task <id>\n${USAGE}`);

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

  const envFile = renderEnvFile(result.lease, result.pair);
  if (options.out != null) {
    writeFileSync(options.out, envFile);
    log(`lease: ${result.lease.id} for ${result.lease.task} -> ${options.out}`);
  } else {
    process.stdout.write(envFile);
  }
  return 0;
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
