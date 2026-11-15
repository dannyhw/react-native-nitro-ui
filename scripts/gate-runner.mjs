#!/usr/bin/env node
/**
 * The supervisor a gate's command runs under: it ends the command and everything in its process
 * group when the gate that started it dies, and exits with `GATE_DEATH_EXIT`.
 *
 * `gate.mjs` spawns this file detached, so it leads a process group, and the command is spawned
 * into that same group: one group id covers the command and the Metro it starts. The gate's
 * death is noticed by EOF on the stdin pipe the gate holds open, with a poll of the gate's
 * (pid, group) pair as a backstop. Only that one group is ever signalled.
 */

import {
  appendFileSync,
  existsSync,
  fstatSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

/** Set by `gate.mjs` to its own pid: the fallback for a supervisor with no group to watch. */
export const GATE_PID_ENV = 'NITRO_UI_GATE_RUNNER_OF';
/**
 * Set by `gate.mjs` to its own process group id. The pid alone can be reused
 * during a long run, and a gate started by `zsh -c` is not its group's leader,
 * so the group alone outlives it: the pair is the gate's identity
 * (`gateProcessIsAlive`). Unset means the pid-only fallback.
 */
export const GATE_PGID_ENV = 'NITRO_UI_GATE_RUNNER_GROUP_OF';
/** Set by `gate.mjs` to the run's log file, so a note survives a dead gate. */
export const RUNNER_LOG_ENV = 'NITRO_UI_GATE_RUNNER_LOG';
/**
 * Set by `gate.mjs` to the same log's path relative to the clone's log store,
 * which is how the ledger spells it, so the sidecar and the ledger line name
 * the run the same way. Optional.
 */
export const RUNNER_LOG_RELATIVE_ENV = 'NITRO_UI_GATE_RUNNER_LOG_RELATIVE';
/** Set by `gate.mjs` to the gate's own name, so a sidecar says which run it describes. */
export const GATE_NAME_ENV = 'NITRO_UI_GATE_RUNNER_GATE';
/**
 * Optional: how often the backstop poll asks, in milliseconds. For tests, which
 * need to show each of the two death signals working alone. Clamped to
 * `MIN_POLL_MS`.
 */
export const POLL_MS_ENV = 'NITRO_UI_GATE_RUNNER_POLL_MS';
/**
 * The suffix of the sidecar a supervisor writes about itself, beside the run's
 * log.
 */
export const RUNNER_RECORD_SUFFIX = '.runner.json';

/** How often the supervisor looks for its gate. One second: the cost is one syscall. */
export const WATCH_INTERVAL_MS = 1_000;
/**
 * How often the cheap liveness tick also re-verifies the gate's identity (a `ps` fork, unlike the
 * `kill(pid, 0)` it sits between). See `createGateLivenessProbe`.
 */
export const IDENTITY_CHECK_MS = 5_000;
/** The floor for `POLL_MS_ENV`: below this the poll is a busy loop, not a backstop. */
export const MIN_POLL_MS = 200;

/**
 * The backstop interval to run with, from `POLL_MS_ENV`.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number}
 */
export function gatePollIntervalMs(env = process.env) {
  const raw = Number(String(env[POLL_MS_ENV ?? ''] ?? '').trim());
  if (!Number.isFinite(raw) || raw <= 0) return WATCH_INTERVAL_MS;
  return Math.min(Math.max(raw, MIN_POLL_MS), 120_000);
}
/** Grace the group gets after the term, before it is killed. */
export const TERM_GRACE_MS = 10_000;
/** How long the escalated kill gets to land. */
export const KILL_GRACE_MS = 5_000;
/**
 * How long a signalled supervisor keeps its command alive before escalating. A
 * terminal Ctrl-C is aimed at the group, so the command has already received
 * it: hold, then escalate only if the command is still up.
 */
export const SIGNAL_HOLD_MS = 10_000;
/**
 * The run's exit code when the gate died. Distinct from `1`: a run stopped for
 * loss of its gate is not a run that failed its tests.
 */
export const GATE_DEATH_EXIT = 17;

/** The signals that mean "this supervisor is going down with its command". */
export const FORWARD_SIGNALS = ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGQUIT'];

/**
 * How long the supervisor waits for its own output to flush before it stops waiting to be *allowed*
 * to leave. See `leaveWhenRunIsOver`.
 */
export const LEAVE_GRACE_MS = 250;

const logFile = () => {
  const file = String(process.env[RUNNER_LOG_ENV] ?? '').trim();
  return file === '' ? null : file;
};

/**
 * Survives writing to a pipe whose reader has died. This process's stdout and
 * stderr are the gate's pipes, and the gate's death closes them: the next write
 * gets `EPIPE`, which node reports as an `error` event, and an unhandled one
 * would kill the supervisor mid-sweep.
 */
export function tolerateBrokenStdio(
  streams = [process.stdout, process.stderr]
) {
  for (const stream of streams) {
    if (stream == null || typeof stream.on !== 'function') continue;
    stream.on('error', () => {});
  }
}

/** One line of the supervisor's own news: on stderr, and in the run's log if there is one. */
function note(message) {
  try {
    process.stderr.write(message);
  } catch {
    // A stderr that throws synchronously (a closed pipe on a platform where the write is sync) is
    // still not a reason to stop sweeping the group: the log file below is the copy that survives.
  }
  const file = logFile();
  if (file == null) return;
  try {
    appendFileSync(file, message);
  } catch {
    // A log that cannot be written is not a reason to stop sweeping the group.
  }
}

/**
 * Does the process `pid` still exist? `ESRCH` is "no such process"; `EPERM`
 * means it exists and belongs to somebody else, which is not a death.
 */
export function pidIsAlive(pid) {
  const value = Number(pid);
  // 0 means "every process in my own group" to `kill(2)`, so a pid that is not
  // a positive integer is not alive.
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

/**
 * Is the process group `pgid` still alive? Same `EPERM` rule as `pidIsAlive`,
 * and the same refusal to ask about 0.
 */
export function pgidIsAlive(pgid) {
  const value = Number(pgid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    process.kill(-value, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

/**
 * Is the process `gate.mjs` gave us still that process? The pid must exist and still sit in the
 * group it reported at spawn: a long run is long enough for the kernel to reuse a pid, and a
 * recycled pid belongs to another group. Whether the group is alive is not the question: a gate
 * started by `zsh -c` or `nohup` is not its group's leader, and the group outlives it.
 *
 * An unreadable group means "alive": guessing dead stops a healthy run, guessing alive costs
 * one more poll.
 *
 * @param {number | null} gatePid
 * @param {number | null} gatePgid the group the gate reported at spawn
 * @param {{pidAlive?: (pid: number) => boolean, groupOf?: (pid: number) => number | null}} [injected]
 */
export function gateProcessIsAlive(
  gatePid,
  gatePgid,
  { pidAlive = pidIsAlive, groupOf = currentProcessGroupId } = {}
) {
  if (gatePid == null) return false;
  if (!pidAlive(gatePid)) return false;
  if (gatePgid == null) return true;
  const group = groupOf(gatePid);
  if (group == null) return true;
  return group === gatePgid;
}

/**
 * The liveness probe the real supervisor uses: `gateProcessIsAlive`, asked at two rates.
 * `kill(pid, 0)` is a syscall and runs every tick; the group lookup is a `ps` fork and runs
 * every `identityMs`. A gate whose pid is reused at once, with no pipe to watch, is therefore
 * noticed up to `identityMs` late.
 *
 * @param {{gatePid: number | null, gatePgid: number | null, identityMs?: number, nowMs?: () => number, pidAlive?: (pid: number) => boolean, groupOf?: (pid: number) => number | null}} options
 * @returns {(pid: number | null, pgid: number | null) => boolean}
 */
export function createGateLivenessProbe({
  gatePid,
  gatePgid,
  identityMs = IDENTITY_CHECK_MS,
  nowMs = () => Date.now(),
  pidAlive = pidIsAlive,
  groupOf = currentProcessGroupId,
}) {
  let verifiedAt = nowMs() - identityMs;
  return (pid, pgid) => {
    if (pid == null || pgid == null) {
      // No pair to identify by: the single question is all there is.
      return gateProcessIsAlive(pid, pgid, { pidAlive, groupOf });
    }
    const now = nowMs();
    if (now - verifiedAt < identityMs) return pidAlive(pid);
    // The identity question first, then the clock restarts: a `ps` fork pays for the whole window.
    const alive = gateProcessIsAlive(pid, pgid, { pidAlive, groupOf });
    verifiedAt = now;
    return alive;
  };
}

/**
 * The gate's death, as a promise: resolved when the pipe `gate.mjs` opened for this supervisor
 * reaches EOF. The kernel closes the write end when the process holding it dies, however it
 * died, so this needs no polling and no pid. The poll stays as a backstop, because a descendant
 * that inherited the write end could hold it open.
 *
 * Returns `null` when there is no pipe to watch (a TTY or `/dev/null`).
 *
 * @param {{fd: number, resume: () => void, once: (event: string, cb: () => void) => void, on: (event: string, cb: (chunk?: unknown) => void) => void}} [stdin]
 * @returns {Promise<string> | null}
 */
export function gateStdinDeath(stdin = process.stdin) {
  let stat = null;
  try {
    stat = fstatSync(stdin.fd);
  } catch {
    return null;
  }
  // A socket or a FIFO is held open by somebody at the other end.
  // `spawn({stdio: 'pipe'})` makes a `socketpair`, so the read end reports
  // `isSocket()`, never `isFIFO()`. `/dev/null` and a TTY are character
  // devices, and reading either to EOF would report a healthy gate as gone.
  if (stat == null || !(stat.isSocket() || stat.isFIFO())) return null;
  return new Promise((resolve) => {
    let settled = false;
    const gone = () => {
      if (settled) return;
      settled = true;
      resolve('stdin');
    };
    // A `data` listener drives the stream to EOF without anyone having to read
    // it.
    stdin.on('data', () => {});
    stdin.on('error', gone);
    stdin.once('end', gone);
    stdin.once('close', gone);
    stdin.resume();
  });
}

/**
 * This process's own process group id, asked of the kernel rather than inferred from how the
 * process was started.
 *
 * @param {number} [pid] defaults to this process
 * @returns {number | null}
 */
export function currentProcessGroupId(pid = process.pid) {
  try {
    const result = spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 5_000,
    });
    if (result.status !== 0) return null;
    const group = Number(String(result.stdout ?? '').trim());
    return Number.isInteger(group) && group > 0 ? group : null;
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Signal a process group (a negative pid), tolerating a group that is already gone — the normal
 * answer once its last member has exited.
 */
function signalGroup(group, signal) {
  const value = Number(group);
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    process.kill(-value, signal);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

/**
 * May the gate sweep the process group its supervisor was started in? Two conditions:
 *
 *   - the supervisor's pid must be free. The gate watched that process exit, so a live process
 *     with the same number is a different one, and `kill(-pid, …)` would reach its tree.
 *   - the supervisor must not have said it was done. Its sidecar carries a `stopped` note once
 *     a sweep has finished; one without it is a supervisor killed before its cleanup ran.
 *
 * @param {object} options
 * @param {number | null} options.runnerPid the group id: the pid of the supervisor the gate started
 * @param {string | null} [options.recordFile] that supervisor's sidecar for this run
 * @param {(file: string) => object | null} [options.readRecord] how to read it
 * @param {(pid: number) => boolean} [options.pidAlive] is that pid there now
 * @returns {{sweep: boolean, why: string}}
 */
export function maySweepRunnerGroup({
  runnerPid,
  recordFile = null,
  readRecord = readRunnerRecordFile,
  pidAlive = pidIsAlive,
}) {
  const pid = Number(runnerPid);
  if (!Number.isInteger(pid) || pid <= 0) {
    return { sweep: false, why: 'no supervisor pid to name the group by' };
  }
  if (pidAlive(pid)) {
    return {
      sweep: false,
      why:
        `pid ${String(pid)} is alive again after this run watched it exit, so the number is ` +
        'another process’s now, and the group it leads is not this run’s',
    };
  }
  const record = recordFile == null ? null : readRecord(recordFile);
  if (record != null && record.stopped != null) {
    const survivors = Number(record.stopped.left?.length ?? 0);
    return {
      sweep: false,
      why:
        `its supervisor reported the sweep already, with ${String(survivors)} ` +
        'process(es) surviving it',
    };
  }
  return {
    sweep: true,
    why:
      record == null
        ? 'there is no sidecar to read, and a supervisor taken by a signal may never have reached its cleanup'
        : 'its sidecar has no `stopped` record, so no sweep was ever reported',
  };
}

/** One sidecar as an object, or null when it cannot be read or parsed. */
function readRunnerRecordFile(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Writes the sidecar naming this run's process group, as the run starts. A later run uses it to
 * tell a dead gate's leftover bundle server from another task's live one, so it has to exist
 * before the supervisor can be killed. A failure to write it returns null and the command runs
 * anyway.
 *
 * `ledgerLogPath`, when given, is the `logPath` written down, so the sidecar and the ledger line
 * name the run with one string.
 *
 * @param {{group: number, gatePid: number | null, gatePgid: number | null, gate: string | null, logPath: string | null, ledgerLogPath?: string | null, lease?: string | null}} fields
 * @returns {string | null} the file written, or null
 */
export function writeRunnerRecord(fields) {
  const logPath = String(fields?.logPath ?? '').trim();
  if (logPath === '') return null;
  const recorded = String(fields?.ledgerLogPath ?? '').trim() || logPath;
  const file = `${logPath}${RUNNER_RECORD_SUFFIX}`;
  let previous = {};
  try {
    if (existsSync(file)) previous = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // A sidecar that cannot be parsed is replaced rather than trusted.
  }
  try {
    writeFileSync(
      file,
      `${JSON.stringify(
        {
          version: 1,
          ...previous,
          pid: process.pid,
          group: Number(fields.group) > 0 ? Number(fields.group) : null,
          gatePid: fields.gatePid,
          gatePgid: fields.gatePgid,
          gate: fields.gate ?? null,
          lease: fields.lease ?? null,
          logPath: recorded,
          startedAt: previous.startedAt ?? Date.now(),
        },
        null,
        2
      )}\n`
    );
    return file;
  } catch {
    return null;
  }
}

/**
 * Notes in the sidecar that the gate died and what the sweep left behind, merged over the file
 * written at the start.
 *
 * @param {string | null} file the sidecar path, from `writeRunnerRecord`
 * @param {object} stopped what the sweep found
 * @returns {string | null}
 */
export function markRunnerRecordStopped(file, stopped) {
  if (file == null) return null;
  try {
    const previous = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(
      file,
      `${JSON.stringify(
        { ...previous, stopped: { at: Date.now(), ...stopped } },
        null,
        2
      )}\n`
    );
    return file;
  } catch {
    return null;
  }
}

/**
 * The run's processes in `group` that are still alive, this process excluded:
 * `ps -g` answers with the whole session, which includes the supervisor.
 */
export function groupMembers(group) {
  const value = Number(group);
  if (!Number.isInteger(value) || value <= 0) return Promise.resolve([]);
  return new Promise((resolve) => {
    let ps;
    try {
      ps = spawn('ps', ['-o', 'pid=', '-g', String(value)], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      resolve([]);
      return;
    }
    let out = '';
    ps.stdout.on('data', (chunk) => {
      out += String(chunk);
    });
    ps.on('error', () => resolve([]));
    ps.on('close', () =>
      resolve(
        out
          .split('\n')
          .map((line) => Number(line.trim()))
          .filter(
            (pid) =>
              Number.isInteger(pid) &&
              pid > 1 &&
              pid !== process.pid &&
              pidIsAlive(pid)
          )
      )
    );
  });
}

/**
 * Stops the group a run lives in: SIGTERM to the group, then SIGKILL to the survivors by pid.
 * The group still contains this process, so `kill(-group, SIGKILL)` would take the supervisor
 * down mid-sweep.
 *
 * Returns the pids still alive at the end, which the caller reports.
 *
 * @param {number} group
 * @param {{log?: (message: string) => void, signal?: (group: number, signal: NodeJS.Signals) => boolean, kill?: (pid: number, signal: NodeJS.Signals) => boolean, members?: (group: number) => Promise<number[]>, wait?: (ms: number) => Promise<void>, termGraceMs?: number, killGraceMs?: number}} [options]
 * @returns {Promise<number[]>}
 */
export async function stopGroup(
  group,
  {
    log = note,
    signal = signalGroup,
    kill = signalPid,
    members = groupMembers,
    wait = sleep,
    termGraceMs = TERM_GRACE_MS,
    killGraceMs = KILL_GRACE_MS,
  } = {}
) {
  const value = Number(group);
  if (!Number.isInteger(value) || value <= 0) return [];
  signal(value, 'SIGTERM');
  let left = await members(value);
  const termDeadline = Date.now() + termGraceMs;
  while (left.length > 0 && Date.now() < termDeadline) {
    await wait(250);
    left = await members(value);
  }
  if (left.length === 0) return [];
  log(
    `gate-runner: ${String(left.length)} process(es) ignored SIGTERM; killing ${left.join(', ')}\n`
  );
  for (const pid of left) kill(pid, 'SIGKILL');
  const killDeadline = Date.now() + killGraceMs;
  left = await members(value);
  while (left.length > 0 && Date.now() < killDeadline) {
    await wait(250);
    left = await members(value);
  }
  return left;
}

/** Signal one process, tolerating one that has already exited. */
function signalPid(pid, signal) {
  try {
    process.kill(Number(pid), signal);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

/**
 * The supervisor's whole job, with the process calls injected so the rule is testable without
 * starting a real command.
 *
 * @param {object} options
 * @param {string[]} options.argv the command to run, already split
 * @param {number | null} options.gatePid the gate's pid: the process whose death ends this run
 * @param {number | null} options.gatePgid the group that pid reported at spawn: what tells a
 *   recycled pid from the gate (see `gateProcessIsAlive`)
 * @param {(argv: string[]) => Promise<{pid: number, group: number, exit: Promise<{code: number, signal: string | null}>}>} options.start
 * @param {(pid: number | null, pgid: number | null) => boolean} [options.isAlive] the backstop poll
 * @param {Promise<string> | null} [options.gateGone] the pipe-EOF signal, from `gateStdinDeath`
 * @param {(group: number) => Promise<number[]>} [options.stop]
 * @param {(group: number) => Promise<number[]>} [options.members] who is in a group, for the check
 *   below that the group is safe to signal
 * @param {(group: number) => void} [options.beforeSweep] called immediately before the group is
 *   signalled, so the real supervisor can stop reacting to the signal it is about to send itself
 * @param {number} [options.ownPid] this process's own pid. A supervisor may only signal a group it
 *   leads, and the kernel marks that group by giving it the leader's pid (see `sweep`).
 * @param {(ms: number) => Promise<void>} [options.wait]
 * @param {(message: string) => void} [options.log]
 * @param {number} [options.intervalMs] how often the backstop poll asks
 * @returns {Promise<{code: number, reason: string, left?: number[]}>}
 */
export async function superviseGateRunner({
  argv,
  gatePid = null,
  gatePgid = null,
  start,
  // The gate is identified by the (pid, group) pair it reported: see
  // `gateProcessIsAlive`.
  isAlive = (pid, pgid) => gateProcessIsAlive(pid, pgid),
  gateGone = null,
  stop = stopGroup,
  members = groupMembers,
  beforeSweep = () => {},
  wait = sleep,
  log = note,
  ownPid = process.pid,
  intervalMs = WATCH_INTERVAL_MS,
}) {
  const started = await start(argv);
  const group = started.group;
  const exited = started.exit;
  // The gate's pid, and its group only for a caller that never had a pid to be given. Nothing when
  // the caller asked for no watchdog at all (a fixture, a command run by hand through this file).
  const watch = gatePid ?? gatePgid;
  const watching = watch != null || gateGone != null;

  if (!watching) {
    const exit = await exited;
    return { code: exit.code, reason: 'command exited' };
  }

  // The pipe is raced, not polled: when `gate.mjs` dies the kernel closes its
  // end and this resolves. A `null` (no pipe to watch) becomes a promise that
  // never settles.
  const gateDied =
    gateGone == null
      ? new Promise(() => {})
      : Promise.resolve(gateGone).then(
          () => 'it closed this supervisor\u2019s stdin pipe'
        );

  for (;;) {
    const outcome = await Promise.race([
      exited.then((exit) => ({ from: 'command', exit })),
      gateDied.then((why) => ({ from: 'gate', why })),
      watch == null
        ? new Promise(() => {})
        : wait(intervalMs).then(() => ({ from: 'timer' })),
    ]);
    if (outcome.from === 'command') {
      return { code: outcome.exit.code, reason: 'command exited' };
    }
    if (outcome.from === 'timer') {
      if (isAlive(watch, gatePgid)) continue;
      return await sweep('its pid is no longer the gate');
    }
    // Reached by the pipe: the gate died and the kernel closed its end.
    return await sweep(outcome.why);
  }

  /**
   * The gate is gone: stop the run, unless the group is unsafe to signal.
   *
   * @param {string} why which of the two signals noticed
   */
  async function sweep(why) {
    // The group this process leads is the only thing it may signal, and a group
    // id that is not its own pid belongs to somebody else: a supervisor not
    // started detached sits in a group that holds a test runner's or a shell's
    // processes. Then nothing is swept and no `stopped` record is written; the
    // gate sweeps the group itself.
    if (group !== ownPid) {
      log(
        `gate-runner: gate ${String(watch)} died (${why}), but group ${String(
          group
        )} is not this supervisor's own (its pid is ${String(
          ownPid
        )}) - refusing to signal a group it does not lead\n`
      );
      return {
        code: GATE_DEATH_EXIT,
        reason:
          'gate died; this supervisor does not lead the group, so nothing was swept',
      };
    }
    // Refuse to sweep a group that contains the gate itself. The kernel is
    // asked who is in the group before anything is signalled.
    const inGroup = await members(group);
    if (gatePid != null && inGroup.includes(gatePid)) {
      log(
        `gate-runner: gate ${String(watch)} died (${why}), but its pid is inside the group this supervisor leads (${String(group)}) - refusing to sweep a group that contains the gate itself\n`
      );
      return {
        code: GATE_DEATH_EXIT,
        reason: 'gate died; its group contains it, so nothing was swept',
        left: inGroup,
      };
    }
    // Written before anything is signalled, and into the log file as well as
    // the pipe: the pipe belongs to a gate that is already gone.
    log(
      `gate-runner: gate ${String(watch)} died without a ledger line (${why}); stopping this run's group ${String(group)}\n`
    );
    beforeSweep(group);
    const left = await stop(group);
    if (left.length > 0) {
      log(
        `gate-runner: ${String(left.length)} process(es) still alive in group ${String(group)}: ${left.join(', ')}\n`
      );
    } else {
      log('gate-runner: the run is gone with it\n');
    }
    return {
      code: GATE_DEATH_EXIT,
      reason: 'gate died; the runner left with it',
      left,
    };
  }
}

/**
 * The real `start`: the command runs in this process's group (`detached:
 * false`), so one negative pid covers the harness and the Metro it spawns.
 */
function startCommand(argv, group) {
  return new Promise((resolve, reject) => {
    const [command, ...args] = argv;
    let child;
    try {
      // `ignore` for stdin, not `inherit`: the supervisor's own stdin may be
      // the pipe it watches its gate through, and the command must not read it
      // or drive it to EOF.
      child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    } catch (error) {
      reject(error);
      return;
    }
    let started = false;
    child.once('error', (error) => {
      if (!started) reject(error);
    });
    child.once('spawn', () => {
      started = true;
      resolve({
        pid: child.pid,
        group,
        exit: new Promise((resolveExit) => {
          child.once('exit', (code, signal) =>
            resolveExit({ code: code ?? 1, signal: signal ?? null })
          );
        }),
      });
    });
  });
}

/**
 * Survives a signal that was meant for the run, and ends the run properly. A Ctrl-C on a
 * foreground gate is aimed at the group, so the command is already shutting down: forwarding
 * would add a second signal. The handler blocks the default action, holds for `SIGNAL_HOLD_MS`,
 * and ends the group only if the command is still up by then.
 *
 * @param {number} group the run's group, this process included
 * @param {() => boolean} commandIsAlive
 * @param {(group: number, options?: {termGraceMs?: number, killGraceMs?: number}) => Promise<number[]>} [stop]
 * @param {(message: string) => void} [log]
 * @param {number} [ownPid] this process's own pid; the group it may end is the one that carries it
 */
export function holdOnSignal(
  group,
  commandIsAlive,
  {
    log = note,
    ownPid = process.pid,
    stop = (target, options) => stopGroup(target, { log, ...options }),
    holdMs = SIGNAL_HOLD_MS,
    signals = FORWARD_SIGNALS,
  } = {}
) {
  // The sweep's rule again: holding is only safe for the group's leader,
  // because the hold can end in a signal to the group.
  if (group !== ownPid) {
    log(
      `gate-runner: not holding signals for group ${String(
        group
      )}: this process is pid ${String(ownPid)}, so that group is not its to end\n`
    );
    return { get: () => null, pause: () => {}, dispose: () => {} };
  }
  let held = null;
  // Set once the supervisor is sweeping on its own account: the group's SIGTERM
  // arrives at this process too, and reacting to it would start a second sweep
  // and exit with a signal code.
  let paused = false;
  /** Stop reacting to signals; this process is about to be the one sending them. */
  function pause() {
    paused = true;
  }
  const handlers = new Map();
  for (const signal of signals) {
    const handler = () => {
      if (paused) return;
      if (held != null) {
        // Second signal: end the run now. The survivors are killed by pid, not
        // by the group, which contains this process, and the note goes out
        // first.
        log(`gate-runner: second ${signal}; ending the run now\n`);
        void stop(group, { termGraceMs: 0, killGraceMs: 2_000 }).then(() =>
          process.exit(128 + signum(signal))
        );
        return;
      }
      held = signal;
      setTimeout(() => {
        if (!commandIsAlive()) return;
        log(
          `gate-runner: ${signal} was ignored by the run; stopping group ${String(group)}\n`
        );
        // This sweep signals the group this process leads, so it signals
        // itself. Pausing first keeps that SIGTERM from being read as a second
        // signal, which would kill the group with no grace.
        pause();
        void stop(group).then(() => process.exit(128 + signum(signal)));
      }, holdMs).unref?.();
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  return {
    /** The signal this process was asked to die by, if any — the exit code it should leave with. */
    get() {
      return held;
    },
    /** Stop reacting to signals: the supervisor is about to be the one sending them. */
    pause,
    /**
     * Takes the handlers back off, for a test suite: a handler left installed
     * would signal a finished fixture's group.
     */
    dispose() {
      for (const [signal, handler] of handlers) {
        process.removeListener(signal, handler);
      }
      handlers.clear();
    },
  };
}

const SIGNUMS = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGTERM: 15 };
const signum = (signal) => SIGNUMS[String(signal)] ?? 15;

/**
 * The CLI. A function rather than top-level statements: a test suite imports
 * this file, and a top-level `await` in a module jest transforms to CommonJS is
 * a syntax error.
 */
async function main() {
  // Before anything can be written: the pipes may already be dead by the time this process starts.
  tolerateBrokenStdio();
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    process.stderr.write(
      'usage: node scripts/gate-runner.mjs <command> [args\u2026]\n' +
        '  Runs <command> in this process\u2019s group and stops that group when the gate that\n' +
        `  started this supervisor (${GATE_PGID_ENV}, or ${GATE_PID_ENV}) is gone.\n`
    );
    process.exit(2);
    return;
  }
  const readId = (name) => {
    const raw = String(process.env[name] ?? '').trim();
    return /^\d+$/u.test(raw) && Number(raw) > 0 ? Number(raw) : null;
  };
  const gatePgid = readId(GATE_PGID_ENV);
  const gatePid = readId(GATE_PID_ENV);
  // This process's own group, asked once: the sweep is aimed at it.
  const group = currentProcessGroupId() ?? process.pid;
  const logPath = logFile();
  const runnerRecord = writeRunnerRecord({
    group,
    gatePid,
    gatePgid,
    gate: String(process.env[GATE_NAME_ENV] ?? '').trim() || null,
    logPath,
    ledgerLogPath:
      String(process.env[RUNNER_LOG_RELATIVE_ENV] ?? '').trim() || null,
    lease: String(process.env.NITRO_UI_LEASE_ID ?? '').trim() || null,
  });
  let heldSignal = { get: () => null, pause: () => {} };
  let commandPid = null;
  try {
    const result = await superviseGateRunner({
      argv,
      gatePid,
      gatePgid,
      // The primary death signal, when `gate.mjs` gave us a pipe to watch it on.
      gateGone: gateStdinDeath(process.stdin),
      intervalMs: gatePollIntervalMs(process.env),
      isAlive: createGateLivenessProbe({ gatePid, gatePgid }),
      start: async (commandArgv) => {
        const started = await startCommand(commandArgv, group);
        commandPid = started.pid;
        heldSignal = holdOnSignal(group, () => commandIsAlive(commandPid));
        return started;
      },
      // The sweep is about to signal the group this process leads.
      beforeSweep: () => heldSignal.pause(),
    });
    // A signal the supervisor rode out is reported the way a shell reports one,
    // never as zero. A gate death outranks it: the term a signalled supervisor
    // receives is often the group signal of its own sweep.
    const held = heldSignal.get();
    process.exitCode =
      held == null || result.code === GATE_DEATH_EXIT
        ? result.code
        : 128 + signum(held);
    if (result.left != null) {
      markRunnerRecordStopped(runnerRecord, {
        reason: result.reason,
        exitCode: process.exitCode,
        left: result.left,
      });
    }
    leaveWhenRunIsOver(process.exitCode ?? 0);
  } catch (error) {
    note(
      `gate-runner: could not start ${argv.join(' ')}: ${String(error?.message ?? error)}\n`
    );
    process.exitCode = 1;
    leaveWhenRunIsOver(1);
  }
}

/** Is the command still there? Kept separate so a start failure cannot crash the watchdog. */
function commandIsAlive(pid) {
  return pid == null ? false : pidIsAlive(pid);
}

/**
 * Puts the watchdog's handles down once the run is over. The stdin socket and the poll timer
 * both keep the event loop alive, and `gate.mjs` waits for this process to exit before it writes
 * the ledger line, so a supervisor still watching a healthy gate would deadlock it.
 *
 * The pipe is released only when it really is a pipe: a TTY or `/dev/null` belongs to whoever
 * started this file. What is left gets `LEAVE_GRACE_MS` to drain.
 *
 * @param {number} code the exit code this run leaves with
 * @param {any} [stdin] the handle the gate is watched through
 */
export function leaveWhenRunIsOver(code, stdin = process.stdin) {
  try {
    const stat = stdin?.fd == null ? null : fstatSync(stdin.fd);
    if (
      stat != null &&
      (stat.isSocket() || stat.isFIFO()) &&
      !stdin.destroyed
    ) {
      stdin.destroy();
    }
  } catch {
    // A descriptor that cannot be asked about at the end of a run is not a reason to stay in it.
  }
  const grace = setTimeout(() => process.exit(code), LEAVE_GRACE_MS);
  // Unref'd, so a clean run leaves with its own code as soon as the loop
  // drains; the timer fires only while something still holds the loop open.
  grace.unref?.();
}

// "Run as a command, or imported?" cannot be asked with `import.meta.url` here:
// the test suite transforms modules to CommonJS, which cannot parse
// `import.meta`. So the comparison is on the resolved path of the script the
// shell named.
const isEntry =
  process.argv[1] != null &&
  path.resolve(process.argv[1]).endsWith(`${path.sep}gate-runner.mjs`);

if (isEntry) {
  void main();
}
