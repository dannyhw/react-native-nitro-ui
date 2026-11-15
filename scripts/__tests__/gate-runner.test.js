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
  holdOnSignal,
  pgidIsAlive,
  pidIsAlive,
  tolerateBrokenStdio,
  markRunnerRecordStopped,
  maySweepRunnerGroup,
  stopGroup,
  superviseGateRunner,
  writeRunnerRecord,
} from '../gate-runner.mjs';
import { childEnv } from './helpers/scrubbed-env.js';

const GATE_RUNNER = join(__dirname, '..', 'gate-runner.mjs');

/**
 * The processes this file started, so cleanup signals nothing it did not create: a `ChildProcess`
 * where there is one, and `{ pid, group }` for a process it only learned of from output, because
 * the kernel can hand a bare pid to another process once the first one exits.
 */
const started = [];
const tempDirs = [];

afterAll(() => {
  for (const target of started.splice(0)) {
    try {
      if (typeof target === 'number') {
        process.kill(target, 'SIGKILL');
        continue;
      }
      if (target.pid != null) {
        // Killable only while it is still in the group this file's own spawn leads: a recycled
        // pid is in another group.
        if (groupId(target.pid) === target.group) {
          process.kill(target.pid, 'SIGKILL');
        }
        continue;
      }
      if (target.exitCode == null && target.signalCode == null) {
        target.kill('SIGKILL');
      }
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
      ownPid: 4242,
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
      members: async () => [4300, 4301],
      // The supervisor's pid equals the group id: it may sweep only a group it leads.
      ownPid: 4242,
      stop: async (group) => {
        swept.push(group);
        return [];
      },
      wait: async () => {},
      log: (message) => lines.push(message),
    });
    expect(swept).toEqual([4242]);
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
      ownPid: 4242,
      stop: async () => [9001],
      wait: async () => {},
      log: (message) => lines.push(message),
    });
    expect(result.left).toEqual([9001]);
    expect(lines.join('')).toContain('still alive in group 4242');
    expect(lines.join('')).toContain('9001');
    command.finish(1);
  });

  it('refuses to sweep a group that contains the gate itself', async () => {
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
      // The gate's own pid (100) is a member of the group.
      members: async () => [100, 4300],
      ownPid: 4242,
      stop: async (group) => {
        swept.push(group);
        return [];
      },
      wait: async () => {},
      log: (message) => lines.push(message),
    });
    expect(swept).toEqual([]);
    expect(result.code).toBe(GATE_DEATH_EXIT);
    expect(result.reason).toContain('its group contains it');
    expect(lines.join('')).toContain('refusing to sweep');
    command.finish(1);
  });

  it('refuses to sweep a group it does not lead at all', async () => {
    // A supervisor started without `detached` sits in a group that holds other processes (a
    // shell's, a test runner's). Its own pid is then not the group's id.
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
      // A group holding nothing but the run: the membership check could not object to this one.
      members: async () => [4300, 4301],
      ownPid: 4300,
      stop: async (group) => {
        swept.push(group);
        return [];
      },
      wait: async () => {},
      log: (message) => lines.push(message),
    });
    expect(swept).toEqual([]);
    expect(result.code).toBe(GATE_DEATH_EXIT);
    expect(result.reason).toContain('does not lead the group');
    expect(lines.join('')).toContain(
      'refusing to signal a group it does not lead'
    );
    expect(result.left).toBeUndefined();
    command.finish(1);
  });

  it('asks about the gate as a pid *and* the group it reported', async () => {
    // The kernel can reuse a gate's pid during a long run, and only the group tells the gate
    // from the process that got its number.
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

describe('holdOnSignal (the signal a supervisor rides out)', () => {
  // An invented signal name, delivered with `process.emit`: a real signal would reach the jest
  // worker running this file.
  const SIGNAL = 'SIGSWEEPDONE';

  it('lets its own sweep have the grace it asked for', async () => {
    const group = 4242;
    const lines = [];
    const stops = [];
    const hold = holdOnSignal(group, () => true, {
      ownPid: group,
      log: (message) => lines.push(message),
      holdMs: 5,
      signals: [SIGNAL],
      stop: (target, options) => {
        stops.push({ target, options: options ?? {} });
        // The real sweep signals the group, and the supervisor is a member of it, so its own
        // term comes straight back to its handler. A second call would be the escalation,
        // which kills by pid and signals no group.
        if (stops.length === 1) process.emit(SIGNAL);
        // Never settles, which keeps this fixture away from the `process.exit` at the end of
        // the real path.
        return new Promise(() => {});
      },
    });
    try {
      process.emit(SIGNAL);
      await until(
        () => stops.length > 0,
        'the hold to expire and the sweep to begin',
        5_000
      );
      // The default grace: no zero-grace options on this call.
      expect(stops[0]).toEqual({ target: group, options: {} });
      // The term the supervisor sent itself was not taken for a second signal.
      expect(stops.length).toBe(1);
      expect(lines.join('')).not.toContain('second');
      expect(hold.get()).toBe(SIGNAL);
    } finally {
      hold.dispose();
    }
    expect(process.listenerCount(SIGNAL)).toBe(0);
  });

  it('refuses to hold signals for a group it does not lead', () => {
    const lines = [];
    expect(process.listenerCount(SIGNAL)).toBe(0);
    const hold = holdOnSignal(4242, () => true, {
      ownPid: 4300,
      log: (message) => lines.push(message),
      signals: [SIGNAL],
      stop: () => {
        throw new Error(
          'a supervisor that does not lead the group must never signal it'
        );
      },
    });
    try {
      expect(lines.join('')).toContain('not its to end');
      expect(process.listenerCount(SIGNAL)).toBe(0);
      expect(hold.get()).toBeNull();
      expect(() => hold.pause()).not.toThrow();
    } finally {
      hold.dispose();
    }
  });
});

describe('pidIsAlive / pgidIsAlive (the questions the watchdog may ask)', () => {
  it('refuses 0, where `kill(0)` and `kill(-0)` are questions about nobody', () => {
    // `kill(2)` reads 0 as "every process in my group", and that call succeeds.
    expect(pidIsAlive(0)).toBe(false);
    expect(pgidIsAlive(0)).toBe(false);
    expect(pgidIsAlive(-7)).toBe(false);
    // A numeric string is a pid (ids come back from the environment as text), so the
    // strings here are ones that are not whole numbers.
    expect(pidIsAlive('4.2')).toBe(false);
    expect(pidIsAlive('not-a-pid')).toBe(false);
    expect(pgidIsAlive(Number.NaN)).toBe(false);
  });

  it('says this process and its group are here, and a group nobody leads is not', () => {
    expect(pidIsAlive(process.pid)).toBe(true);
    expect(pidIsAlive(String(process.pid))).toBe(true);
    const group = groupId(process.pid);
    expect(group).not.toBeNull();
    expect(pgidIsAlive(group)).toBe(true);
    expect(pgidIsAlive(0x7ffe)).toBe(false);
  });
});

describe('stopGroup (what the sweep may touch)', () => {
  it('signals nothing when it was not given a group number', async () => {
    // 0 in particular: `kill(-0, …)` signals this process's own group. A numeric string is a
    // group number, because ids arrive as text from `ps` and from the environment.
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
    // The kill goes to the survivors by pid because the group still contains the supervisor,
    // which must survive its own cleanup to report it.
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

  it("sends the real term to the GROUP, so a run's command goes down without the escalation", async () => {
    // `process.kill(-group, …)` signals every process in the group; `process.kill(group, …)`
    // signals only its leader. Only the kernel shows which one a term was, so this is the real
    // call on a real group, with the by-pid escalation wired to a spy that kills nothing.
    const leader = spawn('sh', ['-c', 'sleep 300 & echo $!; wait'], {
      detached: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    leader.unref();
    started.push(leader);
    let out = '';
    leader.stdout.on('data', (chunk) => {
      out += String(chunk);
    });
    await until(
      () => /^\d+/m.test(out),
      'the grandchild to report its pid',
      15_000
    );
    const grandchild = Number(/^\d+/m.exec(out)[0]);
    started.push({ pid: grandchild, group: leader.pid });

    // `detached` makes the leader lead its own group, so the group id is its pid.
    expect(groupId(leader.pid)).toBe(leader.pid);
    expect(pidIsAlive(grandchild)).toBe(true);

    const escalated = [];
    const left = await stopGroup(leader.pid, {
      log: () => {},
      kill: (pid, signal) => {
        escalated.push([pid, signal]);
        return true;
      },
    });

    expect(escalated).toEqual([]);
    expect(left).toEqual([]);
    expect(pidIsAlive(grandchild)).toBe(false);
  }, 90_000);
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

describe('maySweepRunnerGroup (may the gate sweep its supervisor’s group?)', () => {
  const sidecar = ({ stopped = false } = {}) => {
    const dir = workDir();
    const logPath = join(dir, 'run.log');
    writeFileSync(logPath, '');
    const file = writeRunnerRecord({
      group: 4242,
      gatePid: 7,
      gatePgid: 7,
      logPath,
      gate: 'check',
    });
    if (stopped)
      markRunnerRecordStopped(file, { reason: 'gate died', left: [] });
    return file;
  };

  it('owes the sweep while the sidecar has no `stopped` record', () => {
    const owed = maySweepRunnerGroup({
      runnerPid: 4242,
      recordFile: sidecar(),
      pidAlive: () => false,
    });
    expect(owed.sweep).toBe(true);
    expect(owed.why).toContain('no `stopped` record');
  });

  it('stands down once the supervisor has reported its sweep', () => {
    const decided = maySweepRunnerGroup({
      runnerPid: 4242,
      recordFile: sidecar({ stopped: true }),
      pidAlive: () => false,
    });
    expect(decided.sweep).toBe(false);
    expect(decided.why).toContain('reported the sweep already');
  });

  it('stands down when the pid has been reused', () => {
    // The gate watched its supervisor exit, so a live process with that pid is another process.
    const decided = maySweepRunnerGroup({
      runnerPid: 4242,
      recordFile: sidecar(),
      pidAlive: () => true,
    });
    expect(decided.sweep).toBe(false);
    expect(decided.why).toContain('alive again');
  });

  it('asks the live-pid question first, when both facts are true at once', () => {
    const decided = maySweepRunnerGroup({
      runnerPid: 4242,
      recordFile: sidecar({ stopped: true }),
      pidAlive: () => true,
    });
    expect(decided.sweep).toBe(false);
    expect(decided.why).toContain('alive again');
  });

  it('owes the sweep with no sidecar to read, and refuses without a pid', () => {
    const missing = maySweepRunnerGroup({
      runnerPid: 4242,
      pidAlive: () => false,
    });
    expect(missing.sweep).toBe(true);
    expect(missing.why).toContain('no sidecar');
    expect(maySweepRunnerGroup({ runnerPid: null }).sweep).toBe(false);
    expect(maySweepRunnerGroup({ runnerPid: 0 }).sweep).toBe(false);
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
    // `ps` gives no group for a pid that vanished between `lsof` and here.
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
        records: [{ gatePid: 77, logPath: 'x' }],
        listeners: listener,
        pidAlive: () => false,
        groupOf: () => 900,
      })
    ).toBeNull();
  });
});

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
    expect(
      gateProcessIsAlive(41_001, 41_001, {
        pidAlive: () => true,
        groupOf: () => null,
      })
    ).toBe(true);
  });

  it('falls back to the pid alone when the gate never reported a group', () => {
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
    // The gate is this jest worker, which is alive, so only the pipe can end this run.
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
      isAlive: () => {
        throw new Error('the pid poll should not decide this case');
      },
      members: async () => [],
      ownPid: 4242,
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
    expect(lines.join('')).toContain('stdin');
  });

  it('leaves a healthy command alone when there is no pipe to watch', async () => {
    // `stdio: 'ignore'` is `/dev/null`, which reports EOF the instant it is read. That EOF is
    // not a death.
    const command = pendingCommand();
    const swept = [];
    const run = superviseGateRunner({
      argv: ['bun', 'run', 'harness:ios'],
      gatePid: null,
      gatePgid: null,
      gateGone: gateStdinDeath({ fd: -1 }),
      start: async () => command,
      members: async () => [],
      ownPid: 4242,
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

describe('tolerateBrokenStdio (the write that kills the reporter)', () => {
  it('leaves a dead pipe answered, not fatal', async () => {
    // A stream `error` event with no listener is an uncaught exception.
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
    expect(() => dead.write('still reporting\n')).not.toThrow();
  });
});

describe('gateStdinDeath (the pipe, with a real file descriptor)', () => {
  // A child that prints NO_PIPE, DEAD or ALIVE about its own stdin.
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
    started.push(child);
    const output = { text: '' };
    child.stdout.on('data', (chunk) => {
      output.text += String(chunk);
    });
    return { child, output };
  }

  it('reports nothing about a stdin that is not a pipe', async () => {
    // `stdio: 'ignore'` is `/dev/null`, and reading it reaches EOF at once.
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
    const { child, output } = startWatcher('pipe');
    child.stdin.write('');
    await until(
      () => output.text.includes('ALIVE'),
      'the watcher to time out alive',
      20_000
    );
    expect(output.text).toContain('ALIVE');
    expect(output.text).not.toContain('DEAD');
  }, 30_000);
});

/**
 * A command that writes its pid and group to `command.json` and starts a helper. It stands for
 * the harness, and the helper for the bundle server one level below it.
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

function startSupervisor({
  gatePid,
  gatePgid,
  logFile,
  dir,
  stdin = 'ignore',
  command = [process.execPath, '-e', COMMAND_SCRIPT, dir],
}) {
  const child = spawn(process.execPath, [GATE_RUNNER, ...command], {
    // `detached`, as `gate.mjs` starts it: the supervisor must lead a group of its own, not
    // sit in this suite's.
    detached: true,
    // `'pipe'` is what `gate.mjs` hands a supervisor: a stdin nobody writes, whose EOF is the
    // gate's death. `'ignore'` leaves only the (pid, group) poll.
    stdio: [stdin, 'pipe', 'pipe'],
    env: childEnv({
      ...(gatePid == null ? {} : { [GATE_PID_ENV]: String(gatePid) }),
      ...(gatePgid == null ? {} : { [GATE_PGID_ENV]: String(gatePgid) }),
      ...(logFile == null ? {} : { [RUNNER_LOG_ENV]: logFile }),
      [GATE_NAME_ENV]: 'harness:ios',
    }),
  });
  started.push(child);
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

/** A stand-in gate that leads a group of its own, as a `--background` gate does. */
function startGate() {
  const gate = spawn(
    process.execPath,
    ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 500);'],
    { stdio: 'ignore', detached: true }
  );
  gate.unref();
  started.push(gate);
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
    started.push({ pid: command.pid, group: supervisor.pid });
    started.push({ pid: command.helper, group: supervisor.pid });
    expect(command.gatePid).toBe(String(gate.pid));
    expect(command.gatePgid).toBe(String(gatePgid));
    expect(command.gate).toBe('harness:ios');

    // The command, and so the server it spawns, is in the supervisor's group.
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

    // SIGKILL, so the gate runs no handlers.
    gate.kill('SIGKILL');
    await until(
      () => !pidIsAlive(gate.pid),
      'the killed gate to be gone',
      5_000
    );

    const exit = await supervisor.exited;
    expect(exit.code).toBe(GATE_DEATH_EXIT);
    // The command traps SIGTERM, so it and its helper go only when the escalation fires.
    await until(
      () => !pidIsAlive(command.pid) && !pidIsAlive(command.helper),
      'the run and its server to leave with the gate'
    );
    expect(pgidIsAlive(supervisor.pid)).toBe(false);

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
   * A gate that does not lead its own group (one started as a plain child, e.g. by
   * `nohup zsh -c '…' &`), and the supervisor it starts: its group outlives it, so asking whether
   * the group is alive says nothing about the gate.
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
        // Not detached: this gate inherits this suite's group, which stays alive after the gate
        // is killed.
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
      // One notice at a time: the pipe case puts the poll a minute away, and the poll case has
      // no pipe to watch. Otherwise the two would race.
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
      started.push(
        { pid: command.pid, group: gateInfo.supervisor },
        { pid: command.helper, group: gateInfo.supervisor }
      );

      // This gate is not the leader of the group it is in.
      expect(gateInfo.pgid).not.toBe(gate.pid);
      expect(gateInfo.pgid).toBe(groupId(process.pid));
      expect(gateInfo.supervisor).toBeGreaterThan(0);

      gate.kill('SIGKILL');
      await until(
        () => !pidIsAlive(gate.pid),
        'the killed gate to be gone',
        10_000
      );
      // The gate's group outlives it.
      expect(pgidIsAlive(gateInfo.pgid)).toBe(true);

      try {
        await until(
          () => !pidIsAlive(command.pid) && !pidIsAlive(command.helper),
          `the run and its server to leave with the gate on ${notice}`,
          40_000
        );
      } catch (error) {
        throw new Error(
          `${String(error?.message ?? error)}\n` +
            `  run.log: ${JSON.stringify(readFileSync(logFile, 'utf8'))}\n` +
            `  gate stderr: ${JSON.stringify(gate.stderr().slice(-600))}\n` +
            `  supervisor ${String(gateInfo.supervisor)} alive: ${pidIsAlive(gateInfo.supervisor)}, ` +
            `gate ${String(gate.pid)} alive: ${pidIsAlive(gate.pid)}, pollMs: ${String(pollMs)}`
        );
      }
      // The pids go before the supervisor writes its last line: it asks the kernel who is left
      // in the group first. Wait for that line (either outcome), not for time.
      await until(
        () =>
          /the run is gone with it|still alive in group/.test(
            readFileSync(logFile, 'utf8')
          ),
        'the supervisor to write how its sweep ended',
        20_000
      );
      const log = readFileSync(logFile, 'utf8');
      expect(log).toContain('died without a ledger line');
      expect(log).toContain(stdin === 'pipe' ? 'stdin' : 'pid');
      // Read from the log file: the gate that forwarded the supervisor's stderr is the process
      // that was killed.
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
    started.push(
      { pid: command.pid, group: supervisor.pid },
      { pid: command.helper, group: supervisor.pid }
    );
    expect(pidIsAlive(command.pid)).toBe(true);
    expect(pidIsAlive(command.helper)).toBe(true);
    expect(supervisor.stderr()).not.toContain('died without a ledger line');

    command.pid != null && process.kill(command.pid, 'SIGKILL');
    const exit = await supervisor.exited;
    expect(exit.code).not.toBe(GATE_DEATH_EXIT);
    expect(supervisor.stderr()).not.toContain('died without a ledger line');
    gate.kill('SIGKILL');
  }, 60_000);

  it('leaves when the run finishes, even while its gate holds the stdin pipe', async () => {
    const dir = workDir();
    const gate = startGate();
    const supervisor = startSupervisor({
      gatePid: gate.pid,
      gatePgid: groupId(gate.pid),
      logFile: null,
      dir,
      // The writer on the other end stays alive, so this pipe never reaches EOF and could
      // keep the supervisor's event loop alive.
      stdin: 'pipe',
      command: [
        process.execPath,
        '-e',
        'process.exit(Number(process.argv[1]))',
        '3',
      ],
    });

    await until(
      () => !pidIsAlive(supervisor.pid),
      'the supervisor to leave when its command finishes, with its gate still holding the pipe',
      20_000
    );
    expect(await supervisor.exited).toEqual({ code: 3, signal: null });
    expect(supervisor.stderr()).not.toContain('died without a ledger line');
    expect(pidIsAlive(gate.pid)).toBe(true);
    gate.kill('SIGKILL');
  }, 60_000);

  it('sweeps on the pid fallback too, when no group was handed over', async () => {
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
    started.push(
      { pid: command.pid, group: supervisor.pid },
      { pid: command.helper, group: supervisor.pid }
    );
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
