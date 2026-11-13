#!/usr/bin/env node
/**
 * The supervisor a gate's runner starts under (X34 item 2).
 *
 * `gate.mjs` starts a gate's command through this file so that the command, its Metro and its
 * harness stop when the gate stops — including when the gate is the process somebody killed. The
 * incident (X32, seen again by X33): a `gate.mjs <gate> --background` whose `gate.mjs` died left
 * its runner serving the lease's Metro port with no ledger line, and the next gate on that lease
 * read a busy port instead of the death. `gate.mjs`'s own signal handlers cannot cover that,
 * because a killed process runs no handlers; only a process that is *still alive* can notice its
 * gate is gone. That process is this one.
 *
 * The shape:
 *
 *   - `gate.mjs` spawns this file `detached`, so the runner leads a session whose id is its own
 *     pid, and the command is spawned *into that same group* (`detached: false`). One group for
 *     the whole run, which is what makes both directions of the fix work: the gate's
 *     `process.kill(-child.pid, signal)` reaches the command exactly as it reached the command
 *     before the supervisor existed, and `ownMetroPids` still finds a leftover server in
 *     `child.pid`'s group — by a number the gate knows from the spawn, not a `ps` query about a
 *     runner that may be dead by then. A command in a group of its own would break that second
 *     half: the Metro is a grandchild, so it would report a group the gate never learned.
 *   - the command keeps the three stdios it is handed, so a run's transcript is the same stream it
 *     was before the supervisor existed. This process's own notes go to stderr *and* appended to
 *     the run's log (`NITRO_UI_GATE_RUNNER_LOG`), because when the parent-death path fires the
 *     pipe into the gate's log has died with the gate, and the reason a run stopped belongs in the
 *     evidence.
 *   - the run's own stdin is `ignore`, never this process's: the supervisor's stdin may be the pipe
 *     it watches its gate through, and a Metro that read that pipe would both lose the signal and
 *     eat the EOF.
 *   - while the command runs, this process watches its gate two ways. The primary one is the pipe:
 *     `gate.mjs` opens a stdin pipe for this process and nothing ever writes it, so when the gate
 *     dies the kernel closes its end and the read reaches EOF — the parent-death check, exact for a
 *     `SIGKILL`, a segfault and a closed terminal alike, and needing no pid to be believed. The
 *     backstop is a poll of the gate's (pid, group) pair, in case something inherited the write end.
 *     Either one ending means: signal the group, wait, escalate to SIGKILL, report, and leave with
 *     `GATE_DEATH_EXIT` so the run cannot be read as a pass.
 *
 * Why the death check needs both halves of the gate's identity, and a pipe on top: pid 41 000 is not
 * a fact that stays true. The kernel hands out pids in sequence, so a long-running gate (a harness
 * run is ~50 min) can be followed by a short-lived process that reuses its pid — and a runner
 * watching the bare pid would watch a stranger, decide the gate was alive, and leave the Metro up:
 * the exact failure this file exists to prevent, arriving as its opposite. The group on its own is
 * not the answer either, and the first version of this file thought it was: a gate started by
 * `zsh -c '…'` or `nohup` is *not* its group's leader, so its group outlives it by the length of the
 * shell's own life, and `kill(-pgid, 0)` answers "alive" from a shell that has no idea its child
 * died. (Reading the pgid as a *pid* — `kill(pgid, 0)` — is the same question asked worse.) Both
 * halves together are the identity check: the pid must exist *and* still sit in the group it
 * reported at spawn. The pipe is what makes the common case need no guessing at all.
 *
 * Killing is bounded and aimed at one group — the one this supervisor was started in — so it can
 * never reach a device, another task's Metro, or the maintainer's emulator. No `pkill`, no
 * pattern, no process this file did not start.
 *
 * @see `gate.mjs` (`startBackgroundGate`, `runGateUnclaimed`), `gate-core.mjs` (`ownMetroPids`)
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
 * Set by `gate.mjs` to its own process group id: the second half of the gate's *identity*, not the
 * thing the watchdog watches. The pid alone is reused during a long run and the recycled pid sits in
 * another group; the group alone is worse than useless, because a gate started by `zsh -c` is not
 * its leader and its group outlives it. Together they answer "is the process that started me still
 * that process" (`gateProcessIsAlive`). A caller that could not ask the kernel for a group leaves
 * this unset and gets the pid-only fallback.
 */
export const GATE_PGID_ENV = 'NITRO_UI_GATE_RUNNER_GROUP_OF';
/** Set by `gate.mjs` to the run's log file, so a note survives a dead gate. */
export const RUNNER_LOG_ENV = 'NITRO_UI_GATE_RUNNER_LOG';
/**
 * Set by `gate.mjs` to the *ledger's* spelling of that same log: the path relative to the clone's log
 * store. `RUNNER_LOG_ENV` must be absolute to be openable from a fresh process, but a sidecar that
 * wrote the absolute spelling down would name the run one way and the ledger line another - and
 * joining a dead gate's leftovers to its run is the one thing this record exists for. Optional: a
 * supervisor started outside `gate.mjs` has no ledger line to agree with, and keeps the path it was given.
 */
export const RUNNER_LOG_RELATIVE_ENV = 'NITRO_UI_GATE_RUNNER_LOG_RELATIVE';
/** Set by `gate.mjs` to the gate's own name, so a sidecar says which run it describes. */
export const GATE_NAME_ENV = 'NITRO_UI_GATE_RUNNER_GATE';
/**
 * Optional: how often the backstop poll asks, in milliseconds.
 *
 * A seam rather than a tuning knob — 1 s is the right interval for a real gate, and nothing about a
 * run should depend on it. It exists because the two death signals have to be provable **one at a
 * time**: a test that wants to show the stdin pipe alone ends a run has to be able to take the poll
 * out of the race, and a test that wants to show the poll alone has to be able to do it on a timer
 * rather than by waiting on the pipe. Clamped, because a supervisor that polls once a century is a
 * supervisor that only has one signal.
 */
export const POLL_MS_ENV = 'NITRO_UI_GATE_RUNNER_POLL_MS';
/**
 * The sidecar a supervisor writes about itself, named from the run's log the way `check`'s
 * `<log>.steps.json` is: one run, one namer, and it lands in the clone's log store beside the log
 * and outlives `git worktree remove` with it.
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
 * How long a signalled supervisor keeps its command alive before escalating.
 *
 * A terminal Ctrl-C is aimed at the *group*, so the command receives it too, straight away; the
 * supervisor's job is then to make sure the run actually ends, not to hit it a second time. Hence
 * hold, then escalate if the command is still up. A second signal means the hold was wrong.
 */
export const SIGNAL_HOLD_MS = 10_000;
/**
 * The run's exit code when the gate died. Distinct from `1` because a run that was stopped for
 * loss of its gate is not a run that failed its tests, and the difference is the first thing the
 * next person reading the log needs. `1` would also be a lie in the other direction for a gate
 * that never got to run anything.
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
 * Survive writing to a pipe whose reader has died.
 *
 * This process's stdout and stderr are the gate's pipes, and the event this file exists to notice —
 * the gate's death — is the event that closes them. The next write after that gets `EPIPE`, which
 * node reports as an `error` *event* on the stream: an unhandled one is an uncaught exception, and
 * the supervisor dies of the very news it was reporting, mid-sweep, with the harness and its Metro
 * still up. Measured: with the gate holding the read ends (as `gate.mjs` does) and killed by signal,
 * the supervisor noticed the death, wrote the log line, and was gone inside a second — the X32 leak
 * back again through a door the fixture that read the pipes from the test suite could not see.
 *
 * So the streams are tolerated, and the log file remains the copy that matters.
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
 * Does the process `pid` still exist? `ESRCH` is the kernel's "no such process"; `EPERM` means it
 * exists and belongs to somebody else, which is not a death. A supervisor reading `EPERM` as gone
 * would stop a healthy run because a process of another user shares the pid.
 *
 * Not the answer the watchdog wants on its own (see `pgidIsAlive`), but it is the answer to "is
 * this pid there", which is what the group sweep needs before it reports a survivor.
 */
export function pidIsAlive(pid) {
  const value = Number(pid);
  // 0 means "every process in my own group" to `kill(2)`: a healthy yes from a question nobody
  // asked, and a signal aimed at the supervisor's whole group. A pid that is not one is not alive.
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

/**
 * Is the process *group* `pgid` still alive?
 *
 * Same `EPERM` rule as `pidIsAlive`, and the same refusal to ask about 0 — `kill(-0, 0)` is
 * "signal my own group", which would answer yes to a question about a stranger.
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
 * Is the process `gate.mjs` gave us still *that process*?
 *
 * Two questions, and the old code asked only the first:
 *
 *   1. does the pid exist (`kill(pid, 0)`), and
 *   2. is the thing at that pid still the gate?
 *
 * Question 2 is not a paranoia case: a 50-minute `real-input:ios` is exactly the window in which
 * macOS recycles a pid, and a runner that asks only question 1 watches a stranger, decides its gate
 * is alive, and outlives the run it was hired to end — the X32 incident, wearing a mask. The answer
 * is the gate's process *group*: `gate.mjs` hands over the pair (pid, pgid) it had at spawn, and a
 * recycled pid belongs to somebody else's group.
 *
 * It is not a check that the group is *alive*, which is the mistake this file's first version made —
 * that question is useless here, because a gate started by `zsh -c` or `nohup` is not its group's
 * leader and its group outlives it by the length of the shell's own life. A runner that asked only
 * that (or `kill(pgid, 0)`, the same question asked worse) keeps a Metro serving a dead task's port,
 * which is the bug this file exists to close.
 *
 * Bias is deliberate: an unreadable group means "alive". Guessing dead stops a healthy run and takes
 * a leased device with it; guessing alive costs one more poll.
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
 *
 * A `kill(pid, 0)` is a syscall; the group lookup is a `ps` fork. Asking the group question on every
 * tick of a 50-minute run is ~3 000 forks, on a machine whose load the gates are measured against —
 * and, measured in this file's own fixture, enough pid churn to make reuse a thing that actually
 * happens during a run. So the cheap question runs every tick and the identity question every
 * `identityMs`, with the stdin pipe (which needs neither) as the signal the common death is noticed
 * by. A gate that dies and has its pid reused *instantly*, with no pipe, is therefore noticed up to
 * `identityMs` late — noticed, not missed.
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
 * reaches EOF.
 *
 * This is the parent-death check, and it is the one signal that needs no polling, no pid and no
 * trust: the kernel closes the write end when the process holding it dies, however it died —
 * `SIGKILL`, a segfault, a terminal closed under it. `kill(2)` asks "is there a process with this
 * number"; EOF answers "is the process I was started by still holding my stdin open", which is the
 * question. The poll stays as a backstop (a descendant that inherited the write end could hold it
 * open past the gate's death), but it is the backstop, not the mechanism.
 *
 * Returns `null` when there is no pipe to watch — an interactive run, or a fixture that handed this
 * file a TTY or `/dev/null` — so the caller can tell "watched, and not yet" from "cannot watch".
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
  // A socket or a FIFO is something somebody is holding open at the other end. Note that a socket
  // is what this has to accept: `spawn({stdio: 'pipe'})` makes a `socketpair`, not a pipe, so the
  // read end `gate.mjs` hands this process reports `isSocket()` and never `isFIFO()` (measured — a
  // FIFO-only rule read the real setup as "no pipe to watch" and left the whole check to the poll).
  // `/dev/null` (`stdio: 'ignore'`) and a TTY are character devices, and reading either to EOF would
  // report a healthy gate as gone the moment the read started.
  if (stat == null || !(stat.isSocket() || stat.isFIFO())) return null;
  return new Promise((resolve) => {
    let settled = false;
    const gone = () => {
      if (settled) return;
      settled = true;
      resolve('stdin');
    };
    // Swallow everything: the run has its own stdin (the command is started with `ignore`, so this
    // pipe belongs to the supervisor alone), and a `data` listener is what drives the stream to EOF
    // without anyone having to read it.
    stdin.on('data', () => {});
    stdin.on('error', gone);
    stdin.once('end', gone);
    stdin.once('close', gone);
    stdin.resume();
  });
}

/**
 * This process's own process group id.
 *
 * `gate.mjs` spawns the runner `detached`, so the honest answer is "my own pid" — but the honest
 * answer to "which group am I allowed to signal" is the kernel's, not an inference from how I was
 * started: a fixture that runs this file without `detached`, or a platform where the flags mean
 * something else, gets the group it actually has. One `ps` per run, the same call `gate.mjs` uses
 * for the same question (`processGroupId`).
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
 * The sidecar naming this run's process group, written as the run starts.
 *
 * Why it has to exist before anything can go wrong: the fact it carries — "this group belongs to
 * gate pid N, log L" — is the only way a *later* run can tell a dead gate's leftover bundle server
 * from another task's live one. Written by the supervisor (one writer, no read-modify-write race
 * with the launcher's record) and written at the start rather than on the death path, because the
 * case that needs explaining is the one where the supervisor itself was killed and no death path
 * ran at all.
 *
 * A failure to write it is a lost diagnostic, never a reason to stop a run: it returns null and the
 * command runs anyway.
 *
 * The `logPath` that gets written down is `ledgerLogPath` when the caller knows it, so the sidecar
 * and the ledger line describe one run with one string; `logPath` itself stays the location, because
 * the sidecar is named from it and lives beside the log.
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
    // A sidecar that cannot be parsed is replaced rather than trusted — it describes a run whose
    // evidence is already unreadable, and keeping it would hide this one.
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
 * Note in the sidecar that the gate died and what the sweep left behind.
 *
 * A merge over the file the supervisor wrote at the start, which owns every other field — the
 * group, the gate pid, the log — so this one cannot contradict them by omitting them.
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
 * The run's processes in `group` that are still alive — this process excluded.
 *
 * `ps -g` answers with the whole session, which includes the supervisor. It is not one of the
 * run's processes and never a thing the sweep is reporting on: leaving it in would make every sweep
 * "find" a survivor (itself) that no one asked about, and the escalation below would be aiming a
 * SIGKILL at its own process.
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
 * Stop the group a run lives in: term the group, then kill the survivors by pid.
 *
 * Two different targets for the two signals, deliberately. SIGTERM goes to the group, because that
 * is the whole tree in one call and every tool in it knows how to shut down on a term. SIGKILL goes
 * to the named survivors, because the group still contains this process: escalating with
 * `kill(-group, SIGKILL)` would take the supervisor down mid-sweep, and a supervisor killed by its
 * own cleanup reports nothing, writes no sidecar, and leaves the gate reading a signal exit instead
 * of the death it was told about.
 *
 * Returns the pids still alive at the end. The caller reports them rather than hiding them: a
 * descendant that outlives both signals is the fact the next run's pre-flight has to answer for,
 * and a supervisor that said "cleaned up" about it would be the next mystery.
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
 * starting a real command (the same shape as `stopOwnMetro`).
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
  // The gate as a *process*, identified by the (pid, group) pair it reported: a bare pid is a
  // number that gets reused, and the group on its own is a question about a shell that outlives
  // the gate. Both halves, or neither — see `gateProcessIsAlive`.
  isAlive = (pid, pgid) => gateProcessIsAlive(pid, pgid),
  gateGone = null,
  stop = stopGroup,
  members = groupMembers,
  beforeSweep = () => {},
  wait = sleep,
  log = note,
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

  // The pipe is raced, not polled: when `gate.mjs` dies the kernel closes its end and this
  // resolves, which is why a run whose gate was `SIGKILL`ed ends in about a second rather than on
  // a timer. A `null` (no pipe to watch) becomes a promise that never settles.
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
    // Refuse to sweep a group that contains the gate itself.
    //
    // The supervisor is started `detached` by `gate.mjs`, so it leads a group of its own and the
    // sweep can be blunt. A caller that started it some other way puts this process in somebody
    // else's group — quite possibly the gate's, or a test runner's — and then "signal this run's
    // group" means "signal the thing that is watching me", which is the opposite of the fix: a
    // supervisor that SIGKILLs its own gate, or the suite running it, on a timer. The kernel is
    // asked who is in the group before anything is signalled, because this is the one place where
    // being wrong reaches a process this file was not given.
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
    // Written before anything is signalled, and into the log file as well as the pipe: the pipe
    // belongs to a gate that is already gone, and this line is the only explanation the next
    // person gets of a run that stopped in the middle.
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
 * The real `start`: the command runs in this process's group, with the stdios it is handed.
 *
 * `detached: false` is the whole design (see the header): the command inherits the runner's group,
 * so one negative pid covers the harness and the Metro it spawns, and the gate — which created
 * that group when it spawned this file — already knows its number.
 */
function startCommand(argv, group) {
  return new Promise((resolve, reject) => {
    const [command, ...args] = argv;
    let child;
    try {
      // `ignore` for stdin, not `inherit`: the supervisor's own stdin may be the pipe it watches
      // its gate through (see `gateStdinDeath`), and a run must not be able to read that pipe or
      // drive it to EOF. `ignore` is what the command had before (`/dev/null`), so this preserves
      // the behaviour and keeps the watchdog's file descriptor private to the supervisor.
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
 * Survive a signal that was really meant for the run, and end the run properly.
 *
 * A Ctrl-C on a foreground gate is aimed at the group, and the group holds the command: it is
 * already shutting down when this handler runs, so forwarding would add a second signal to a tool
 * in the middle of cleaning up, and the escalation below would add a SIGKILL to a shutdown that
 * was working. The supervisor's own exit is the thing at risk here — it is in the same group, and
 * the default action would take it out mid-sweep, which is the leak this file exists to close. So:
 * block, hold for `SIGNAL_HOLD_MS`, and if the command is still standing by then, end the group.
 *
 * @param {number} group the run's group, this process included
 * @param {() => boolean} commandIsAlive
 * @param {(group: number) => Promise<number[]>} [stop]
 * @param {(message: string) => void} [log]
 */
export function holdOnSignal(
  group,
  commandIsAlive,
  {
    stop = stopGroup,
    log = note,
    holdMs = SIGNAL_HOLD_MS,
    signals = FORWARD_SIGNALS,
  } = {}
) {
  let held = null;
  // Set once the supervisor is sweeping on its own account. The group's own SIGTERM arrives at this
  // process too — it leads the group it is signalling — and a hold that reacts to it would start a
  // second sweep and exit with a signal code, so a run ended by its gate's death would be reported
  // as a run ended by a Ctrl-C nobody sent.
  let paused = false;
  for (const signal of signals) {
    process.on(signal, () => {
      if (paused) return;
      if (held != null) {
        // Second signal: the hold was the wrong call, and the person typing it is right that
        // something is not coming down. The survivors are killed by pid rather than by the group,
        // which contains this process — and the note goes out first, because this is the path
        // where the supervisor may not get to speak again.
        log(`gate-runner: second ${signal}; ending the run now\n`);
        void stopGroup(group, {
          log,
          termGraceMs: 0,
          killGraceMs: 2_000,
        }).then(() => process.exit(128 + signum(signal)));
        return;
      }
      held = signal;
      setTimeout(() => {
        if (!commandIsAlive()) return;
        log(
          `gate-runner: ${signal} was ignored by the run; stopping group ${String(group)}\n`
        );
        void stop(group).then(() => process.exit(128 + signum(signal)));
      }, holdMs).unref?.();
    });
  }
  return {
    /** The signal this process was asked to die by, if any — the exit code it should leave with. */
    get() {
      return held;
    },
    /** Stop reacting to signals: the supervisor is about to be the one sending them. */
    pause() {
      paused = true;
    },
  };
}

const SIGNUMS = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGTERM: 15 };
const signum = (signal) => SIGNUMS[String(signal)] ?? 15;

/**
 * The CLI: read the supervisor's instructions, start the command, sweep the group if the gate dies.
 *
 * A function rather than top-level statements: `gate.mjs` runs this file directly, and a test suite
 * imports it — and a top-level `await` in a module jest transforms to CommonJS is a syntax error,
 * which would make the supervisor untestable for the shape of problem it exists for.
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
  // This process's own group, asked once: the sweep is aimed at it, and a group this file invented
  // from `process.pid` would be a guess about how it was started.
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
    // A signal the supervisor rode out is reported the way a shell reports one, so `wait` and the
    // ledger see a killed run rather than a passed one - and never a *zero*, which is what the
    // command's own exit code would have been for a tool that shuts down cleanly on a term. A gate
    // death outranks that: the term a signalled supervisor receives is often the group signal of
    // its own sweep, and the run's reason for leaving was the gate, which has its own code.
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
 * Put the watchdog's handles down: the run is over, one way or another.
 *
 * Two things keep this event loop alive while a run is going, and both are worth having for a
 * watchdog: the stdin socket whose other end a *healthy* gate is holding open — the death signal that
 * needs no pid to be believed — and the poll timer, ref'd on purpose because it is the only thing
 * keeping a supervisor with no pipe to watch alive at all. Neither may outlive the run.
 *
 * `gate.mjs` waits for this process to exit before it can write the ledger line. A supervisor that
 * stays alive because it is still watching a gate that never died therefore deadlocks its own gate:
 * the command finishes, nothing is recorded, the Metro goes on serving the lease's port, and the leak
 * this file exists to close arrives as a hang instead of a corpse. Measured, before this function
 * existed: every clean run under the supervisor did exactly that, and only a run whose *gate* died
 * ever left — because that path closes the pipe and so drains the loop by accident.
 *
 * The pipe is released only when it really is a pipe: a TTY or `/dev/null` belongs to whoever started
 * this file, and destroying that would take their terminal's input with it. What is left is then
 * given a chance to drain, on a grace that is itself `unref`'d — it speaks up only when a handle
 * refuses to go, which is the whole reason for its existence.
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
  // Unref'd so a clean run leaves with its own code the moment the loop drains on its own; the timer
  // only fires while something else is still holding that loop open.
  grace.unref?.();
}

// "Am I being run as a command, or imported?" — the question `lease.mjs` answers with
// `import.meta.url`. It cannot be answered that way here: this module is imported by its own test
// suite, and a suite that transforms modules to CommonJS cannot parse `import.meta` at all. A
// mistake in either direction is loud in only one of them, so the comparison is on the resolved
// path of the script the shell named.
const isEntry =
  process.argv[1] != null &&
  path.resolve(process.argv[1]).endsWith(`${path.sep}gate-runner.mjs`);

if (isEntry) {
  void main();
}
