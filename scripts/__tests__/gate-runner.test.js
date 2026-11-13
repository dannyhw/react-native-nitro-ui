/**
 * The supervisor a gate runs its command under, and the two claims that make it work (X34 item 2).
 *
 * The incident (X32, seen again by X33): a `gate.mjs <gate> --background` was killed by pid
 * mid-run, nothing else noticed, and the run's bundle server went on serving the lease's Metro
 * port with no ledger line. The next task on that lease read a busy port and had no way to learn
 * that its predecessor had died. `gate.mjs` cannot catch that to itself — a killed process runs no
 * handlers — so the job belongs to a process that stays alive and can ask whether its gate still
 * exists. Two things have to be true for that to be worth anything:
 *
 *   1. **the command lives in the supervisor's group.** `gate.mjs` spawns the supervisor
 *      `detached`, so the group's id is the pid of the child it started — the same number
 *      `ownMetroPids` already attributes a leftover server by, and the same number the signal
 *      handlers aim `process.kill(-child.pid, …)` at. A command started in a group of its own
 *      would leave a server reporting a group no gate can name: the leak, back again, quietly.
 *      Proven below by a command that asks the kernel which group it is in, and by the exit code
 *      of a real run whose group had to be swept.
 *   2. **the death check notices a gate that died, and only that.** A bare pid is not a fact that
 *      stays true over a 50-minute run — the kernel reuses pids, and a supervisor watching a reused
 *      pid would run on past its own gate's death and leave the Metro up: the failure arriving as
 *      its opposite. A *group* is not the answer either, which is what the first version of this
 *      file got wrong: a gate started by `nohup zsh -c '…'` or by anything that is not a job leader
 *      sits in a group that outlives it, so `kill(-pgid, 0)` answers "alive" about a dead gate for
 *      the whole life of the shell. So the check is the pair — the pid must exist *and* still be in
 *      the group it reported (`gateProcessIsAlive`) — with a stdin pipe over the top, whose EOF the
 *      kernel guarantees when the gate dies however it dies.
 *      Proven below by a killed gate that is not its group's leader (which the group question
 *      answers "alive" to), by a recycled pid that `gateProcessIsAlive` refuses to believe, and by
 *      `pgidIsAlive`'s refusal to ask about group 0 (`kill(-0, 0)` is a broadcast to this process's
 *      own group, and answers yes to a question nobody asked).
 *
 * And the sweep is aimed at one group: the one this supervisor was started in. Nothing here
 * signals a process it did not start, a name, or a pattern.
 *
 * @file Real processes, all of them started and recorded here: no device, no lease, no Metro port.
 */

import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  mkdtempSync as makeTemp,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { deadGateBehindPort } from '../gate-core.mjs';
import {
  GATE_DEATH_EXIT,
  GATE_NAME_ENV,
  GATE_PGID_ENV,
  GATE_PID_ENV,
  POLL_MS_ENV,
  RUNNER_LOG_ENV,
  RUNNER_RECORD_SUFFIX,
  gatePollIntervalMs,
  gateProcessIsAlive,
  gateStdinDeath,
  pgidIsAlive,
  pidIsAlive,
  tolerateBrokenStdio,
  markRunnerRecordStopped,
  stopGroup,
  superviseGateRunner,
  writeRunnerRecord,
} from '../gate-runner.mjs';
import { childEnv } from './helpers/scrubbed-env.js';

const GATE_RUNNER = join(__dirname, '..', 'gate-runner.mjs');

/** Pids this file started, so cleanup signals nothing it did not create. */
const started = [];
const tempDirs = [];

afterAll(() => {
  for (const pid of started.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone, which is the wanted answer */
    }
  }
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* a fixture that is already gone is not a failure */
    }
  }
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll a condition with a deadline — a ceiling on the wait, never an ingredient of the answer. */
async function until(predicate, waitedFor, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return;
    if (Date.now() > deadline)
      throw new Error(
        `timed out after ${String(timeoutMs)} ms waiting for ${waitedFor}`
      );
    await sleep(50);
  }
}

const workDir = () => {
  const dir = makeTemp(join(tmpdir(), 'x34-runner-'));
  tempDirs.push(dir);
  return dir;
};

/** The group of a live process, asked with the same `ps` call the production code uses. */
function groupId(pid) {
  const result = spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], {
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  const group = Number(String(result.stdout).trim());
  return Number.isInteger(group) && group > 0 ? group : null;
}

/** A `start` for a command that has not finished yet, and a way to finish it. */
const pendingCommand = (group = 4242) => {
  let settle;
  return {
    pid: 4300,
    group,
    exit: new Promise((resolve) => {
      settle = resolve;
    }),
    finish: (code) => settle({ code, signal: null }),
  };
};

/* --------------------- the rule, with the kernel injected --------------------- */

describe('superviseGateRunner (what the supervisor decides)', () => {
  it('leaves with the command’s own exit code while its gate is alive', async () => {
    const command = pendingCommand();
    const swept = [];
    const run = superviseGateRunner({
      argv: ['bun', 'run', 'check'],
      gatePid: 100,
      gatePgid: 100,
      start: async () => command,
      isAlive: () => true,
      members: async () => [4300, 4301],
      stop: async (group) => {
        swept.push(group);
        return [];
      },
      wait: async () => {},
      log: () => {},
    });
    command.finish(0);
    expect(await run).toEqual({ code: 0, reason: 'command exited' });
    expect(swept).toEqual([]);
  });

  it('sweeps the run’s group and reports a code of its own when the gate is gone', async () => {
    const command = pendingCommand(4242);
    const swept = [];
    const lines = [];
    let looks = 0;
    const result = await superviseGateRunner({
      argv: ['bun', 'run', 'check'],
      gatePid: 100,
      gatePgid: 100,
      start: async () => command,
      // There for the first look, gone for the second: one tick of the watchdog.
      isAlive: () => (looks += 1) <= 1,
      // The command and its server, and no trace of the gate: the group is safe to signal.
      members: async () => [4300, 4301],
      stop: async (group) => {
        swept.push(group);
        return [];
      },
      wait: async () => {},
      log: (message) => lines.push(message),
    });
    expect(swept).toEqual([4242]);
    // Not `1`: a run stopped for loss of its gate did not fail its tests, and the reader of the
    // ledger has to be able to tell the two apart.
    expect(result.code).toBe(GATE_DEATH_EXIT);
    expect(result.reason).toContain('gate died');
    expect(lines.join('')).toContain('died without a ledger line');
    expect(lines.join('')).toContain('4242');
    command.finish(1);
  });

  it('reports the survivors of a sweep instead of claiming the group came down', async () => {
    const command = pendingCommand(4242);
    const lines = [];
    let looks = 0;
    const result = await superviseGateRunner({
      argv: ['true'],
      gatePid: 100,
      gatePgid: 100,
      start: async () => command,
      isAlive: () => (looks += 1) <= 1,
      members: async () => [4300, 9001],
      stop: async () => [9001],
      wait: async () => {},
      log: (message) => lines.push(message),
    });
    expect(result.left).toEqual([9001]);
    // The fact a later pre-flight has to answer for, said out loud rather than swallowed.
    expect(lines.join('')).toContain('still alive in group 4242');
    expect(lines.join('')).toContain('9001');
    command.finish(1);
  });

  it('refuses to sweep a group that contains the gate itself', async () => {
    // The supervisor is started `detached`, so its group holds the run and nobody else. A caller
    // that started it inside the gate's own group would turn "signal this run's group" into
    // "SIGKILL the gate, or the test runner that is running the suite" — a supervisor that kills
    // the thing it watches, on a timer. The kernel is asked who is in the group first.
    const command = pendingCommand(4242);
    const swept = [];
    const lines = [];
    let looks = 0;
    const result = await superviseGateRunner({
      argv: ['true'],
      gatePid: 100,
      gatePgid: 100,
      start: async () => command,
      isAlive: () => (looks += 1) <= 1,
      members: async () => [100, 4300],
      stop: async (group) => {
        swept.push(group);
        return [];
      },
      wait: async () => {},
      log: (message) => lines.push(message),
    });
    expect(swept).toEqual([]);
    expect(result.code).toBe(GATE_DEATH_EXIT);
    expect(result.reason).toContain('nothing was swept');
    expect(lines.join('')).toContain('refusing to sweep');
    command.finish(1);
  });

  it('asks about the gate as a pid *and* the group it reported', async () => {
    // The pid-reuse defence, as a question about behaviour: what does the watchdog get asked about?
    // A gate's pid can be handed to another process while a long run is going, so a probe that got
    // only the number cannot tell the gate from a stranger — and a supervisor that believed the
    // stranger would keep a run alive after its gate died, the leak this file exists to prevent
    // arriving as a run that never ends. The group is what tells them apart, and it travels with the
    // pid or the probe is a guess (`gateProcessIsAlive`).
    const command = pendingCommand();
    const asked = [];
    const run = superviseGateRunner({
      argv: ['true'],
      gatePid: 100,
      gatePgid: 101,
      start: async () => command,
      isAlive: (pid, pgid) => {
        asked.push([pid, pgid]);
        return false;
      },
      members: async () => [4300],
      stop: async () => [],
      wait: async () => {},
      log: () => {},
    });
    await run;
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.filter((pair) => pair[0] !== 100 || pair[1] !== 101)).toEqual(
      []
    );
    command.finish(0);
  });

  it('runs the command with no watchdog when nothing names a gate', async () => {
    const command = pendingCommand();
    const swept = [];
    const run = superviseGateRunner({
      argv: ['true'],
      gatePid: null,
      gatePgid: null,
      start: async () => command,
      members: async () => [4300],
      stop: async (group) => {
        swept.push(group);
        return [];
      },
      wait: async () => {},
      log: () => {},
    });
    command.finish(3);
    expect(await run).toEqual({ code: 3, reason: 'command exited' });
    expect(swept).toEqual([]);
  });
});

describe('pidIsAlive / pgidIsAlive (the questions the watchdog may ask)', () => {
  it('refuses 0, where `kill(0)` and `kill(-0)` are questions about nobody', () => {
    // `kill(2)` reads 0 as "every process in my group" and -0 likewise: both succeed, so a naive
    // watchdog would answer "the gate is alive" forever *and* signal its own group every second.
    expect(pidIsAlive(0)).toBe(false);
    expect(pgidIsAlive(0)).toBe(false);
    expect(pgidIsAlive(-7)).toBe(false);
    expect(pidIsAlive('42')).toBe(false);
    expect(pgidIsAlive(Number.NaN)).toBe(false);
  });

  it('says this process and its group are here, and a group nobody leads is not', () => {
    expect(pidIsAlive(process.pid)).toBe(true);
    const group = groupId(process.pid);
    expect(group).not.toBeNull();
    expect(pgidIsAlive(group)).toBe(true);
    // The answer the watchdog needs when its gate has been killed and its group drained: `ESRCH`.
    expect(pgidIsAlive(0x7ffe)).toBe(false);
  });
});

describe('stopGroup (what the sweep may touch)', () => {
  it('signals nothing when it was not given a group number', async () => {
    // 0 in particular: `kill(-0, …)` is a broadcast to this process's own group. And `'4242'`, one
    // line below, *is* a group number — these ids arrive as strings from `ps` and from the
    // environment, and a sweep that refused one would silently leave a Metro up.
    const refused = [];
    for (const group of [0, -1, Number.NaN, undefined, null, 'not-a-group']) {
      await stopGroup(group, {
        log: () => {},
        signal: (target, signal) => {
          refused.push([target, signal]);
          return true;
        },
        kill: (target, signal) => {
          refused.push([target, signal]);
          return true;
        },
        members: async () => [],
      });
    }
    expect(refused).toEqual([]);

    const signals = [];
    for (const group of [4242, '4242']) {
      await stopGroup(group, {
        log: () => {},
        signal: (target, signal) => {
          signals.push([target, signal]);
          return true;
        },
        kill: (target, signal) => {
          signals.push([target, signal]);
          return true;
        },
        members: async () => [],
      });
    }
    expect(signals).toEqual([
      [4242, 'SIGTERM'],
      [4242, 'SIGTERM'],
    ]);
  });

  it('terms the group, then kills the survivors by pid - never the group again', async () => {
    // The order of targets is the safety of the sweep. The term goes to the group because that is
    // the whole tree in one call; the kill goes to the named survivors because the group still
    // contains the supervisor, and a supervisor SIGKILLed by its own cleanup reports nothing,
    // writes no sidecar, and leaves the gate reading a bare signal exit.
    const signals = [];
    let members = [71, 72];
    const left = await stopGroup(4242, {
      log: () => {},
      signal: (group, signal) => {
        signals.push(['group', group, signal]);
        return true;
      },
      kill: (pid, signal) => {
        signals.push(['pid', pid, signal]);
        members = [];
        return true;
      },
      members: async () => [...members],
      wait: async () => {},
      termGraceMs: 0,
      killGraceMs: 0,
    });
    expect(signals).toEqual([
      ['group', 4242, 'SIGTERM'],
      ['pid', 71, 'SIGKILL'],
      ['pid', 72, 'SIGKILL'],
    ]);
    expect(left).toEqual([]);
  });

  it('reports a survivor it could not kill instead of claiming the group came down', async () => {
    const lines = [];
    const left = await stopGroup(4242, {
      log: (message) => lines.push(message),
      signal: () => true,
      kill: () => true,
      members: async () => [77],
      wait: async () => {},
      termGraceMs: 0,
      killGraceMs: 0,
    });
    expect(left).toEqual([77]);
    expect(lines.join('')).toContain('ignored SIGTERM');
  });
});

describe('writeRunnerRecord (the sidecar a later run attributes a port by)', () => {
  it('writes nothing when it has no log to hang from', () => {
    expect(
      writeRunnerRecord({ group: 4242, gatePid: 7, logPath: null })
    ).toBeNull();
    expect(
      writeRunnerRecord({ group: 4242, gatePid: 7, logPath: '   ' })
    ).toBeNull();
  });

  it('names the run, and keeps its start time across the sweep’s update', () => {
    const dir = workDir();
    const logPath = join(dir, 'run.log');
    const file = writeRunnerRecord({
      group: 4242,
      gatePid: 7,
      gatePgid: 7,
      logPath,
      gate: 'check',
      lease: 'X34-1',
    });
    expect(file).toBe(`${logPath}${RUNNER_RECORD_SUFFIX}`);
    const first = JSON.parse(readFileSync(file, 'utf8'));
    expect(first).toMatchObject({
      version: 1,
      group: 4242,
      gatePid: 7,
      gate: 'check',
      lease: 'X34-1',
      logPath,
    });
    expect(first.startedAt).toEqual(expect.any(Number));

    // The sweep's note is a merge: the fields that make attribution possible are the first write's,
    // and an update that rewrote them from memory could contradict the run it describes.
    appendFileSync(logPath, 'note\n');
    expect(
      markRunnerRecordStopped(file, { reason: 'gate died', left: [] })
    ).toBe(file);
    const after = JSON.parse(readFileSync(file, 'utf8'));
    expect(after.startedAt).toBe(first.startedAt);
    expect(after.gatePid).toBe(7);
    expect(after.group).toBe(4242);
  });
});

describe('deadGateBehindPort (whose leftover server is this?)', () => {
  const listener = [{ pid: 900, command: 'node' }];
  const groupOf = () => 4242;

  it('names a run whose gate is gone and whose ledger line never arrived', () => {
    const record = {
      group: 4242,
      gatePid: 77,
      logPath: 'branch/check-1.log',
      gate: 'check',
      startedAt: 1,
    };
    const hit = deadGateBehindPort({
      records: [record],
      listeners: listener,
      pidAlive: () => false,
      groupOf,
      ledgerLogPaths: [],
    });
    expect(hit).toEqual({ record, listener: listener[0], group: 4242 });
  });

  it('says nothing while that gate is still running', () => {
    // The ordinary busy port: somebody's run is happening, and the honest answer is "wait for it".
    expect(
      deadGateBehindPort({
        records: [{ group: 4242, gatePid: 77, logPath: 'branch/check-1.log' }],
        listeners: listener,
        pidAlive: () => true,
        groupOf,
      })
    ).toBeNull();
  });

  it('says nothing about a run that recorded a result and merely left a server up', () => {
    // Calling a finished run a death would be a false claim in the evidence, and it is a different
    // problem (`stopOwnMetro` was meant to take that server down).
    expect(
      deadGateBehindPort({
        records: [{ group: 4242, gatePid: 77, logPath: 'branch/check-1.log' }],
        listeners: listener,
        pidAlive: () => false,
        groupOf,
        ledgerLogPaths: ['branch/check-1.log'],
      })
    ).toBeNull();
  });

  it('says nothing about a server in a group no recorded run led', () => {
    // Somebody else's Metro: the pre-flight's plain refusal is the right answer, and naming a
    // stranger's run as dead would be both wrong and an accusation.
    expect(
      deadGateBehindPort({
        records: [{ group: 9999, gatePid: 77, logPath: 'branch/check-1.log' }],
        listeners: listener,
        pidAlive: () => false,
        groupOf,
      })
    ).toBeNull();
  });

  it('asks about the group, not the listener pid, and refuses when it cannot', () => {
    // A `ps` that will not answer (a pid that vanished between `lsof` and here) must produce the
    // silent answer: the sweep and the hint both act on a group, and a guessed one is a signal
    // aimed at somebody else's run.
    expect(
      deadGateBehindPort({
        records: [{ group: 900, gatePid: 77, logPath: 'x' }],
        listeners: listener,
        pidAlive: () => false,
        groupOf: () => null,
      })
    ).toBeNull();
    expect(
      deadGateBehindPort({
        // A sidecar with no usable group is not evidence about anything.
        records: [{ gatePid: 77, logPath: 'x' }],
        listeners: listener,
        pidAlive: () => false,
        groupOf: () => 900,
      })
    ).toBeNull();
  });
});

/* ------------------- the death check, with the kernel injected ------------------- */

describe('gateProcessIsAlive (is that pid still that gate?)', () => {
  it('says no for a pid the kernel does not know', () => {
    expect(
      gateProcessIsAlive(41_001, 41_001, {
        pidAlive: () => false,
        groupOf: () => 41_001,
      })
    ).toBe(false);
  });

  it('says no for a pid that has been REUSED - the number lives, in another group', () => {
    // The case a bare `kill(pid, 0)` cannot see: `real-input:ios` runs ~50 min, long enough for the
    // kernel to hand this gate's pid to somebody else. The stranger answers a liveness probe with
    // "alive", and a supervisor that believed it would outlive its gate with a Metro in tow — the
    // X32 leak, arriving as the check that was supposed to stop it.
    expect(
      gateProcessIsAlive(41_001, 41_001, {
        pidAlive: () => true,
        groupOf: () => 9_999,
      })
    ).toBe(false);
  });

  it('says yes for the pid, in the group it reported', () => {
    expect(
      gateProcessIsAlive(41_001, 41_001, {
        pidAlive: () => true,
        groupOf: () => 41_001,
      })
    ).toBe(true);
  });

  it('says yes when `ps` cannot answer, because guessing dead stops a healthy run', () => {
    // The bias is the point: a false "dead" ends a 40-minute device run and frees a leased device
    // mid-harness. A transient `ps` failure costs one more poll.
    expect(
      gateProcessIsAlive(41_001, 41_001, {
        pidAlive: () => true,
        groupOf: () => null,
      })
    ).toBe(true);
  });

  it('falls back to the pid alone when the gate never reported a group', () => {
    // A caller that could not ask the kernel for its group must not be answered "dead" for that.
    expect(gateProcessIsAlive(41_001, null, { pidAlive: () => true })).toBe(
      true
    );
    expect(gateProcessIsAlive(null, null, { pidAlive: () => true })).toBe(
      false
    );
  });
});

describe('the supervisor\u2019s gate-death signal', () => {
  it('sweeps on the pipe alone, while its gate is still alive', async () => {
    // The gate is *this* jest worker: unambiguously alive, so nothing in the pid check can be what
    // ends this run. Only the pipe can. That is the asymmetry worth pinning — EOF is the kernel's
    // own report that the process which opened this pipe is gone, whatever it died of.
    let resolveGone = null;
    const gateGone = new Promise((resolve) => {
      resolveGone = resolve;
    });
    const command = pendingCommand();
    const swept = [];
    const lines = [];
    const run = superviseGateRunner({
      argv: ['bun', 'run', 'harness:ios'],
      gatePid: process.pid,
      gatePgid: null,
      gateGone,
      start: async () => command,
      // A live pid that must not be asked about: the poll is refused so this case can only pass on
      // the pipe.
      isAlive: () => {
        throw new Error('the pid poll should not decide this case');
      },
      members: async () => [],
      stop: async (group) => {
        swept.push(group);
        return [];
      },
      wait: async () => new Promise(() => {}),
      log: (message) => lines.push(message),
    });
    await sleep(30);
    expect(swept).toEqual([]);
    resolveGone('stdin');
    const result = await run;
    command.finish(0);
    expect(swept).toEqual([4242]);
    expect(result.code).toBe(GATE_DEATH_EXIT);
    // The sentence says which signal fired, because "the gate died" and "the gate closed my stdin"
    // are two different claims and only one of them was checked here.
    expect(lines.join('')).toContain('stdin');
  });

  it('leaves a healthy command alone when there is no pipe to watch', async () => {
    // The false-positive direction of the same seam: `stdio: 'ignore'` is `/dev/null`, which reports
    // EOF the instant it is read. A supervisor that treated that as a death would sweep every run it
    // was ever started for, and take a leased device with it.
    const command = pendingCommand();
    const swept = [];
    const run = superviseGateRunner({
      argv: ['bun', 'run', 'harness:ios'],
      gatePid: null,
      gatePgid: null,
      gateGone: gateStdinDeath({ fd: -1 }),
      start: async () => command,
      members: async () => [],
      stop: async (group) => {
        swept.push(group);
        return [];
      },
      wait: async () => new Promise(() => {}),
      log: () => {},
    });
    await sleep(30);
    expect(swept).toEqual([]);
    command.finish(0);
    expect(await run).toEqual({ code: 0, reason: 'command exited' });
  });
});

/* ------------------- the pipe, with real file descriptors ------------------- */

describe('tolerateBrokenStdio (the write that kills the reporter)', () => {
  it('leaves a dead pipe answered, not fatal', async () => {
    // The shape of the incident at the level of one stream: an `error` event with no listener is an
    // uncaught exception, and a supervisor that dies of the news it is reporting leaves the harness
    // and its Metro up. The real version of that is proved below, with a killed gate holding the
    // read ends; this is the same rule at the speed of a unit test.
    const { PassThrough } = await import('node:stream');
    const dead = new PassThrough();
    let seen = null;
    dead.on('error', (error) => {
      seen = error;
    });
    tolerateBrokenStdio([dead]);
    dead.emit('error', Object.assign(new Error('EPIPE'), { code: 'EPIPE' }));
    await sleep(10);
    expect(seen?.code).toBe('EPIPE');
    // And the stream stays usable: tolerating the error is not closing the report.
    expect(() => dead.write('still reporting\n')).not.toThrow();
  });
});

describe('gateStdinDeath (the pipe, with a real file descriptor)', () => {
  /** A child that answers once about its own stdin, and then keeps answering until told to stop. */
  const WATCHER = `
    const { pathToFileURL } = require('node:url');
    (async () => {
      const runner = await import(pathToFileURL(${JSON.stringify(
        GATE_RUNNER
      )}).href);
      const gone = runner.gateStdinDeath(process.stdin);
      if (gone == null) {
        process.stdout.write('NO_PIPE\\n');
        process.exit(0);
      }
      let dead = false;
      gone.then(() => {
        dead = true;
        process.stdout.write('DEAD\\n');
        process.exit(0);
      });
      setTimeout(() => {
        process.stdout.write(dead ? 'DEAD\\n' : 'ALIVE\\n');
        process.exit(0);
      }, Number(process.env.X34_WATCH_MS || 4000));
    })();
  `;

  function startWatcher(stdin) {
    const child = spawn(process.execPath, ['-e', WATCHER], {
      stdio: [stdin, 'pipe', 'pipe'],
      env: childEnv({ X34_WATCH_MS: '4000' }),
    });
    started.push(child.pid);
    const output = { text: '' };
    child.stdout.on('data', (chunk) => {
      output.text += String(chunk);
    });
    return { child, output };
  }

  it('reports nothing about a stdin that is not a pipe', async () => {
    // `stdio: 'ignore'` is `/dev/null`, and reading it reaches EOF at once. A supervisor that read
    // that as its gate's death would sweep every run it was started for.
    const { child, output } = startWatcher('ignore');
    await until(
      () => output.text.includes('NO_PIPE'),
      'the watcher to report no pipe',
      15_000
    );
    expect(output.text).toContain('NO_PIPE');
  });

  it('reports the death when the last writer closes the pipe', async () => {
    const { child, output } = startWatcher('pipe');
    await sleep(200);
    expect(output.text).toBe('');
    child.stdin.end();
    await until(
      () => output.text.includes('DEAD'),
      'the watcher to notice the closed pipe',
      15_000
    );
    expect(child.pid).toBeTruthy();
  }, 30_000);

  it('stays quiet while the pipe is held open', async () => {
    // The false-positive direction, on real fds: an open pipe with no data is a gate that is
    // thinking, not a gate that has died.
    const { child, output } = startWatcher('pipe');
    child.stdin.write('');
    await until(
      () => output.text.includes('ALIVE'),
      'the watcher to time out alive',
      20_000
    );
    expect(output.text).toContain('ALIVE');
    expect(output.text).not.toContain('DEAD');
    // The watcher's own window, not a wait this case needs: it prints at 4 s.
  }, 30_000);
});

/* ---------------------- the incident, with real processes ---------------------- */

/**
 * A command that reports where it lives and starts a helper.
 *
 * The command is the harness; its child is the bundle server. The helper matters because the leak
 * was never about the process `gate.mjs` started directly — it was about the server one level down,
 * which is why the unit of cleanup is a group and not a pid.
 */
const COMMAND_SCRIPT = `
  const { spawn, spawnSync } = require('node:child_process');
  const { writeFileSync } = require('fs');
  const dir = process.argv[1];
  const pgid = String(
    spawnSync('ps', ['-o', 'pgid=', '-p', String(process.pid)], { encoding: 'utf8' })
      .stdout || ''
  ).trim();
  const helper = spawn(
    process.execPath,
    ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 500);'],
    { stdio: 'ignore' }
  );
  writeFileSync(
    dir + '/command.json',
    JSON.stringify({
      pid: process.pid,
      pgid: Number(pgid),
      helper: helper.pid,
      gatePid: process.env.${GATE_PID_ENV} ?? null,
      gatePgid: process.env.${GATE_PGID_ENV} ?? null,
      log: process.env.${RUNNER_LOG_ENV} ?? null,
      gate: process.env.${GATE_NAME_ENV} ?? null,
    })
  );
  // Traps the term on purpose: a bundle server that ignores a term is the reason the sweep has an
  // escalation, and a command that exited on the first term would prove nothing about it.
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 500);
`;

/** Starts the supervisor with a real command, as `gate.mjs` does. */
function startSupervisor({
  gatePid,
  gatePgid,
  logFile,
  dir,
  stdin = 'ignore',
  command = [process.execPath, '-e', COMMAND_SCRIPT, dir],
}) {
  const child = spawn(process.execPath, [GATE_RUNNER, ...command], {
    // `detached`, because that is how `gate.mjs` starts it and because a supervisor started
    // inside this suite's own group would sweep *that* group when its gate died — killing the
    // test runner, which is the hazard `superviseGateRunner` now refuses. The fixture has to
    // model the shape, not just the happy path.
    detached: true,
    // `'pipe'` models what `gate.mjs` really hands a supervisor (X34 item 2): a stdin the
    // supervisor watches and nobody writes, whose EOF *is* the gate's death. `'ignore'` models the
    // shape without it, which is how the identity poll gets tested on its own.
    stdio: [stdin, 'pipe', 'pipe'],
    env: childEnv({
      ...(gatePid == null ? {} : { [GATE_PID_ENV]: String(gatePid) }),
      ...(gatePgid == null ? {} : { [GATE_PGID_ENV]: String(gatePgid) }),
      ...(logFile == null ? {} : { [RUNNER_LOG_ENV]: logFile }),
      [GATE_NAME_ENV]: 'harness:ios',
    }),
  });
  started.push(child.pid);
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  return {
    pid: child.pid,
    stderr: () => stderr,
    exited: new Promise((resolve) =>
      child.on('exit', (code, signal) => resolve({ code, signal }))
    ),
  };
}

/**
 * A process leading a session of its own — the way `startBackgroundGate` starts a gate, which is
 * what makes "is that gate's group gone" a question with a yes-or-no answer.
 */
function startGate() {
  const gate = spawn(
    process.execPath,
    ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 500);'],
    { stdio: 'ignore', detached: true }
  );
  gate.unref();
  started.push(gate.pid);
  return gate;
}

const readJsonFile = (file) => JSON.parse(readFileSync(file, 'utf8'));

describe('a real supervisor, and a real gate that gets killed', () => {
  it('takes the run and its server down with it', async () => {
    const dir = workDir();
    const logFile = join(dir, 'run.log');
    writeFileSync(logFile, '');
    const gate = startGate();
    const gatePgid = groupId(gate.pid);
    // The fixture would not be describing the incident if the gate did not lead a group of its
    // own: that is what `--background`'s `detached` means, and what makes the group an answer.
    expect(gatePgid).toBe(gate.pid);

    const supervisor = startSupervisor({
      gatePid: gate.pid,
      gatePgid,
      logFile,
      dir,
    });

    await until(
      () => existsSync(join(dir, 'command.json')),
      'the command to start'
    );
    const command = readJsonFile(join(dir, 'command.json'));
    started.push(command.pid, command.helper);
    expect(command.gatePid).toBe(String(gate.pid));
    expect(command.gatePgid).toBe(String(gatePgid));
    expect(command.gate).toBe('harness:ios');

    // THE structural claim, asked of the kernel rather than asserted: the command — and so the
    // server it spawns — is in the supervisor's group, which is the id `gate.mjs` learns from its
    // own spawn and the id `ownMetroPids` attributes a leftover by. Start this command `detached`
    // and this line is the one that goes red.
    expect(command.pgid).toBe(supervisor.pid);

    const sidecarFile = `${logFile}${RUNNER_RECORD_SUFFIX}`;
    await until(() => existsSync(sidecarFile), 'the sidecar to be written');
    expect(readJsonFile(sidecarFile)).toMatchObject({
      pid: supervisor.pid,
      group: supervisor.pid,
      gatePid: gate.pid,
      gatePgid,
      gate: 'harness:ios',
      logPath: logFile,
    });

    // The incident: killed hard enough to run no handlers.
    gate.kill('SIGKILL');
    await until(
      () => !pidIsAlive(gate.pid),
      'the killed gate to be gone',
      5_000
    );

    const exit = await supervisor.exited;
    expect(exit.code).toBe(GATE_DEATH_EXIT);
    // The command trapped the term, so getting here means the escalation fired — and the helper one
    // level down went with it, which no pid-targeted kill of the command could have done.
    await until(
      () => !pidIsAlive(command.pid) && !pidIsAlive(command.helper),
      'the run and its server to leave with the gate'
    );
    expect(pgidIsAlive(supervisor.pid)).toBe(false);

    // The evidence: the sentence in the run's log (whose pipe died with the gate), and the
    // sweep's account in the sidecar.
    expect(readFileSync(logFile, 'utf8')).toContain(
      'died without a ledger line'
    );
    expect(supervisor.stderr()).toContain('died without a ledger line');
    const stopped = readJsonFile(sidecarFile).stopped;
    expect(stopped).toBeTruthy();
    expect(stopped.left).toEqual([]);
    expect(stopped.exitCode).toBe(GATE_DEATH_EXIT);
  }, 90_000);

  /**
   * A gate that does **not** lead its own group, and the supervisor it started.
   *
   * `gate.mjs --background` detaches its run into a group of its own, and a gate started that way is
   * its group's leader — which is why a watchdog that asks about the group passes every fixture that
   * models only that shape. It is not the only shape: a gate started by `nohup zsh -c 'node
   * scripts/gate.mjs …' &`, by a launcher script, or by anything that runs a gate as a plain child
   * sits in a group that belongs to somebody else and outlives it. This fixture is that shape,
   * because the difference between the two is the whole difference between a run that ends and a
   * Metro that serves a dead task's port for a day.
   *
   * The gate itself starts the supervisor, so the stdin pipe between them is the real one. Built by
   * concatenation rather than a template: it interpolates another script, and nesting the two is how
   * a fixture starts out escaping its own placeholders.
   */
  function gateScript(dirVar) {
    return [
      'const { spawn, spawnSync } = require("node:child_process");',
      'const { writeFileSync } = require("node:fs");',
      `const dir = ${dirVar};`,
      'const stdinKind = process.argv[2] === "pipe" ? "pipe" : "ignore";',
      'const pgid = Number(String(spawnSync("ps", ["-o", "pgid=", "-p", String(process.pid)], { encoding: "utf8" }).stdout || "").trim());',
      'const supervisor = spawn(',
      '  process.execPath,',
      `  [${JSON.stringify(GATE_RUNNER)}, process.execPath, "-e", ${JSON.stringify(COMMAND_SCRIPT)}, dir],`,
      '  {',
      '    // The supervisor leads a group of its own, exactly as the gate starts it; the group it',
      '    // sits in belongs to somebody else, which is the point of the fixture.',
      '    detached: true,',
      '    stdio: [stdinKind, "pipe", "pipe"],',
      '    env: Object.assign({}, process.env, {',
      `      ${JSON.stringify(GATE_PID_ENV)}: String(process.pid),`,
      `      ${JSON.stringify(GATE_PGID_ENV)}: String(pgid),`,
      `      ${JSON.stringify(RUNNER_LOG_ENV)}: dir + "/run.log",`,
      `      ${JSON.stringify(GATE_NAME_ENV)}: "harness:ios",`,
      '    }),',
      '  }',
      ');',
      'writeFileSync(dir + "/gate.json", JSON.stringify({ pid: process.pid, pgid, supervisor: supervisor.pid, stdin: stdinKind }));',
      '// The notes travel on the stderr of the gate that started them, and into the log file of the',
      '// run as well — which is the only copy that survives when the gate is the process killed.',
      'supervisor.stdout.on("data", (chunk) => process.stderr.write(chunk));',
      'supervisor.stderr.on("data", (chunk) => process.stderr.write(chunk));',
      'setInterval(() => {}, 500);',
    ].join('\n');
  }

  function startGateInsideAnotherGroup({ dir, stdin, pollMs }) {
    const gate = spawn(
      process.execPath,
      ['-e', gateScript('process.argv[1]'), dir, stdin],
      {
        // Not detached: this gate inherits the group of the process that started it (this suite),
        // which is a group that is very much alive and will still be alive when the gate is killed.
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: childEnv(pollMs == null ? {} : { [POLL_MS_ENV]: String(pollMs) }),
      }
    );
    started.push(gate.pid);
    let stderr = '';
    gate.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    return {
      pid: gate.pid,
      stderr: () => stderr,
      // Recorded by pid, and killed one pid at a time: this is a process this file started.
      kill: (signal) => process.kill(gate.pid, signal),
    };
  }

  it.each([
    ['pipe', 'the stdin pipe closing', 60_000],
    ['ignore', 'the (pid, group) poll alone', 200],
  ])(
    'ends the run when its gate is killed and %s is the only notice',
    async (stdin, notice, pollMs) => {
      const dir = workDir();
      const logFile = join(dir, 'run.log');
      writeFileSync(logFile, '');
      // One signal at a time: the pipe case takes the poll out of the race (a minute away), and the
      // poll case is given no pipe to watch. Otherwise the two would race each other on every run
      // and neither would be proven.
      const gate = startGateInsideAnotherGroup({ dir, stdin, pollMs });

      await until(
        () => existsSync(join(dir, 'gate.json')),
        'the gate to start',
        20_000
      );
      const gateInfo = readJsonFile(join(dir, 'gate.json'));
      await until(
        () => existsSync(join(dir, 'command.json')),
        'the command to start',
        20_000
      );
      const command = readJsonFile(join(dir, 'command.json'));
      started.push(command.pid, command.helper);

      // THE shape, asserted rather than assumed: this gate is not the leader of the group it is in.
      // Every fixture that detaches its gate cannot say this, and every watchdog that asks about
      // the group answers "alive" here — for as long as the group's owner lives.
      expect(gateInfo.pgid).not.toBe(gate.pid);
      expect(gateInfo.pgid).toBe(groupId(process.pid));
      expect(gateInfo.supervisor).toBeGreaterThan(0);

      gate.kill('SIGKILL');
      await until(
        () => !pidIsAlive(gate.pid),
        'the killed gate to be gone',
        10_000
      );
      // The question the old check asked, answered out loud: the gate's group is still there, because
      // the group was never the gate's to begin with.
      expect(pgidIsAlive(gateInfo.pgid)).toBe(true);

      try {
        await until(
          () => !pidIsAlive(command.pid) && !pidIsAlive(command.helper),
          `the run and its server to leave with the gate on ${notice}`,
          40_000
        );
      } catch (error) {
        // The supervisor's own note is the difference between "the watchdog never looked" and "it
        // looked and refused", and neither is guessable from a pid that is still there.
        throw new Error(
          `${String(error?.message ?? error)}\n` +
            `  run.log: ${JSON.stringify(readFileSync(logFile, 'utf8'))}\n` +
            `  gate stderr: ${JSON.stringify(gate.stderr().slice(-600))}\n` +
            `  supervisor ${String(gateInfo.supervisor)} alive: ${pidIsAlive(gateInfo.supervisor)}, ` +
            `gate ${String(gate.pid)} alive: ${pidIsAlive(gate.pid)}, pollMs: ${String(pollMs)}`
        );
      }
      const log = readFileSync(logFile, 'utf8');
      expect(log).toContain('died without a ledger line');
      expect(log).toContain(stdin === 'pipe' ? 'stdin' : 'pid');
      // The sweep *finished*, in the file that outlives the gate. The gate's own stderr cannot be
      // read here by construction: the process forwarding it is the one that got killed — which is
      // why the supervisor writes to the log as well, and why it must not die of that write.
      expect(log).toContain('the run is gone with it');
    },
    90_000
  );

  it('stands aside while its gate lives, and leaves with the command’s code', async () => {
    const dir = workDir();
    const gate = startGate();
    const supervisor = startSupervisor({
      gatePid: gate.pid,
      gatePgid: groupId(gate.pid),
      logFile: null,
      dir,
    });
    await until(
      () => existsSync(join(dir, 'command.json')),
      'the command to start'
    );
    const command = readJsonFile(join(dir, 'command.json'));
    started.push(command.pid, command.helper);
    expect(pidIsAlive(command.pid)).toBe(true);
    expect(pidIsAlive(command.helper)).toBe(true);
    expect(supervisor.stderr()).not.toContain('died without a ledger line');

    // End the command the way a finished run does; the supervisor reports its code, not a sweep.
    command.pid != null && process.kill(command.pid, 'SIGKILL');
    const exit = await supervisor.exited;
    expect(exit.code).not.toBe(GATE_DEATH_EXIT);
    expect(supervisor.stderr()).not.toContain('died without a ledger line');
    gate.kill('SIGKILL');
  }, 60_000);

  /**
   * A run that **finishes**, with its gate still alive on the other end of the pipe.
   *
   * Every real gate ends this way: the harness exits with a code while `gate.mjs` sits there holding
   * the write end of the supervisor's stdin open, because that is how the supervisor is meant to
   * learn about a death. A supervisor that treats that pipe as a reason to keep its event loop alive
   * keeps the whole run with it, and `gate.mjs` is waiting for this process to leave before it can
   * write the ledger line. The run is then neither dead nor finished: no line, the Metro port still
   * served, the lease still held — the leak this file exists to close, arriving as a hang instead of
   * a corpse. The shape only exists with `stdin: 'pipe'`: a supervisor started with `'ignore'` has no
   * such handle and leaves on its own, which is why the fixture above never noticed.
   */
  it('leaves when the run finishes, even while its gate holds the stdin pipe', async () => {
    const dir = workDir();
    const gate = startGate();
    const supervisor = startSupervisor({
      gatePid: gate.pid,
      gatePgid: groupId(gate.pid),
      logFile: null,
      dir,
      // The handle at issue: the writer on the other end is alive, so this end never reaches EOF.
      stdin: 'pipe',
      command: [
        process.execPath,
        '-e',
        'process.exit(Number(process.argv[1]))',
        '3',
      ],
    });

    // Bounded on purpose: the failure this guards is a process that never leaves, so waiting forever
    // would be the bug rather than the proof of it.
    await until(
      () => !pidIsAlive(supervisor.pid),
      'the supervisor to leave when its command finishes, with its gate still holding the pipe',
      20_000
    );
    expect(await supervisor.exited).toEqual({ code: 3, signal: null });
    // The gate never died, so nothing was swept and the run's code is the command's own.
    expect(supervisor.stderr()).not.toContain('died without a ledger line');
    expect(pidIsAlive(gate.pid)).toBe(true);
    gate.kill('SIGKILL');
  }, 60_000);

  it('sweeps on the pid fallback too, when no group was handed over', async () => {
    // A caller that could not ask the kernel for its gate's group still gets a supervisor that
    // notices the death: the group is the better question, not the only one.
    const dir = workDir();
    const logFile = join(dir, 'run.log');
    writeFileSync(logFile, '');
    const gate = startGate();
    const supervisor = startSupervisor({
      gatePid: gate.pid,
      gatePgid: null,
      logFile,
      dir,
    });
    await until(
      () => existsSync(join(dir, 'command.json')),
      'the command to start'
    );
    const command = readJsonFile(join(dir, 'command.json'));
    started.push(command.pid, command.helper);
    expect(command.gatePgid).toBeNull();

    gate.kill('SIGKILL');
    const exit = await supervisor.exited;
    expect(exit.code).toBe(GATE_DEATH_EXIT);
    await until(
      () => !pidIsAlive(command.pid) && !pidIsAlive(command.helper),
      'the fallback path to end the run as well'
    );
  }, 90_000);
});
