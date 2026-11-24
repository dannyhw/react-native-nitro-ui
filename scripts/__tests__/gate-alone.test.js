import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  ALONE_WAIT_ENV,
  DEFAULT_ALONE_WAIT_MINUTES,
  aloneWaitCeilingMs,
  gatesMayShareMachine,
  runsBlocking,
  waitForMachine,
} from '../gate-core.mjs';
import { withoutLeaseEnv } from './helpers/scrubbed-env.js';
import { FREE_LSOF } from './helpers/free-lsof-stub.js';
import {
  DEFAULT_PAIR,
  leaseRecord,
  leasedEnv,
  writeLeaseStore,
} from './helpers/lease-store.js';

/* --------------------- the queue, with stand-in live runs -------------------- */

/**
 * An in-memory live store and a clock that moves only when the waiting gate
 * sleeps. `onSleep` runs before each sleep, so a test can end a run mid-wait.
 */
function standIn({ markers = [], alive = new Set(), onSleep = () => {} } = {}) {
  const store = new Map(markers.map((marker) => [marker.pid, { ...marker }]));
  const lines = [];
  let clock = 1_800_000_000_000;
  let sleeps = 0;
  return {
    store,
    lines,
    alive,
    get sleeps() {
      return sleeps;
    },
    options: {
      io: {
        list: () => [...store.values()].map((marker) => ({ ...marker })),
        write: (marker) => store.set(marker.pid, { ...marker }),
        remove: (marker) => store.delete(marker.pid),
      },
      isAlive: (pid) => alive.has(pid),
      now: () => clock,
      sleep: async (ms) => {
        sleeps += 1;
        onSleep({ store, alive, sleeps });
        clock += ms;
      },
      say: (line) => lines.push(line),
      ceilingMs: 60 * 60_000,
    },
  };
}

const run = (pid, gate, ticket, extra = {}) => ({
  pid,
  gate,
  ticket,
  choosing: false,
  queuedAt: 1_799_999_000_000,
  branch: `task/${String(pid)}`,
  ...extra,
});

describe('which device gates may share the machine', () => {
  it('keeps real-input:ios, filtered or not, apart from every device gate', () => {
    for (const other of [
      'harness:ios',
      'harness:android',
      'real-input:android',
      'real-input:ios',
      'bench',
      'smoke:expo',
    ]) {
      expect({
        other,
        share: gatesMayShareMachine('real-input:ios', other),
      }).toEqual({ other, share: false });
      expect(
        gatesMayShareMachine(other, 'real-input:ios:--control:switch')
      ).toBe(false);
    }
  });

  it('lets the other device gates run side by side', () => {
    expect(gatesMayShareMachine('harness:ios', 'harness:android')).toBe(true);
    expect(gatesMayShareMachine('real-input:android', 'harness:ios')).toBe(
      true
    );
    expect(gatesMayShareMachine('bench', 'harness:android')).toBe(true);
  });

  it('states a ceiling, and takes one from the environment', () => {
    expect(aloneWaitCeilingMs({})).toBe(DEFAULT_ALONE_WAIT_MINUTES * 60_000);
    expect(aloneWaitCeilingMs({ [ALONE_WAIT_ENV]: '2' })).toBe(120_000);
    expect(aloneWaitCeilingMs({ [ALONE_WAIT_ENV]: 'soon' })).toBe(
      DEFAULT_ALONE_WAIT_MINUTES * 60_000
    );
  });
});

describe('waitForMachine', () => {
  it('holds a harness gate while a real-input:ios run is live, says so, and starts when it ends', async () => {
    const fake = standIn({
      markers: [run(501, 'real-input:ios', 3)],
      alive: new Set([501]),
      onSleep: ({ alive, sleeps }) => {
        if (sleeps === 5) alive.delete(501);
      },
    });
    const answer = await waitForMachine({
      gate: 'harness:android',
      pid: 900,
      ...fake.options,
    });
    expect(answer.ok).toBe(true);
    expect(fake.sleeps).toBe(5);
    expect(fake.lines[0]).toContain(
      'harness:android is waiting for real-input:ios (pid 501, task/501'
    );
    expect(fake.lines[0]).toContain(
      'real-input:ios runs with no other device gate'
    );
    expect(fake.lines.at(-1)).toContain('the machine is free');
    // Its marker stays for the length of its run; the ended run's is cleared.
    expect([...fake.store.keys()]).toEqual([900]);
    expect(fake.store.get(900)).toMatchObject({
      gate: 'harness:android',
      ticket: 4,
      choosing: false,
    });
  });

  it('holds real-input:ios until every other device gate has ended, naming each', async () => {
    const fake = standIn({
      markers: [run(601, 'harness:ios', 1), run(602, 'harness:android', 2)],
      alive: new Set([601, 602]),
      onSleep: ({ alive, sleeps }) => {
        if (sleeps === 2) alive.delete(601);
        if (sleeps === 4) alive.delete(602);
      },
    });
    const answer = await waitForMachine({
      gate: 'real-input:ios',
      pid: 900,
      ...fake.options,
    });
    expect(answer.ok).toBe(true);
    expect(fake.sleeps).toBe(4);
    expect(fake.lines[0]).toContain('harness:ios (pid 601');
    expect(fake.lines[0]).toContain('harness:android (pid 602');
    expect(fake.lines[0]).toContain(
      'real-input:ios runs with no other device gate beside it'
    );
    // Once the iOS run ended it says the new, shorter list.
    expect(fake.lines[1]).not.toContain('pid 601');
    expect(fake.lines[1]).toContain('harness:android (pid 602');
  });

  it('counts a run whose process is gone as ended', async () => {
    const fake = standIn({
      markers: [run(701, 'real-input:ios', 9)],
      alive: new Set(),
    });
    const answer = await waitForMachine({
      gate: 'harness:ios',
      pid: 900,
      ...fake.options,
    });
    expect(answer.ok).toBe(true);
    expect(fake.sleeps).toBe(0);
    expect(fake.lines).toEqual([]);
    expect(fake.store.has(701)).toBe(false);
  });

  it('fails at the ceiling, naming the run still live, and leaves no marker', async () => {
    const fake = standIn({
      markers: [run(801, 'real-input:ios', 2)],
      alive: new Set([801]),
    });
    const answer = await waitForMachine({
      gate: 'harness:android',
      pid: 900,
      ...fake.options,
      ceilingMs: 10 * 60_000,
    });
    expect(answer.ok).toBe(false);
    expect(answer.message).toContain('waited 10 min, the ceiling');
    expect(answer.message).toContain('real-input:ios (pid 801, task/801');
    expect(answer.message).toContain('Start harness:android again');
    expect([...fake.store.keys()]).toEqual([801]);
  });

  it('does not hold gates that may share the machine', async () => {
    const fake = standIn({
      markers: [run(511, 'harness:ios', 1), run(512, 'real-input:android', 2)],
      alive: new Set([511, 512]),
    });
    const answer = await waitForMachine({
      gate: 'harness:android',
      pid: 900,
      ...fake.options,
    });
    expect(answer.ok).toBe(true);
    expect(fake.sleeps).toBe(0);
  });

  it('queues a later gate behind a real-input:ios that is itself still waiting', async () => {
    // harness:ios runs (ticket 1), real-input:ios waits for it (ticket 2): a
    // harness:android asked for now must not slip in beside either.
    const fake = standIn({
      markers: [run(521, 'harness:ios', 1), run(522, 'real-input:ios', 2)],
      alive: new Set([521, 522]),
      onSleep: ({ alive, sleeps }) => {
        if (sleeps === 3) alive.delete(521);
        if (sleeps === 6) alive.delete(522);
      },
    });
    const answer = await waitForMachine({
      gate: 'harness:android',
      pid: 900,
      ...fake.options,
    });
    expect(answer.ok).toBe(true);
    expect(fake.sleeps).toBe(6);
    expect(fake.lines[0]).toContain('real-input:ios (pid 522');
    expect(fake.lines[0]).not.toContain('pid 521');
  });

  it('waits for a run still choosing its ticket, and breaks a tie by pid', () => {
    const me = { pid: 900, gate: 'harness:ios', ticket: 4 };
    expect(
      runsBlocking({
        me,
        others: [{ pid: 950, gate: 'real-input:ios', choosing: true }],
      }).map((r) => r.pid)
    ).toEqual([950]);
    expect(
      runsBlocking({
        me,
        others: [
          run(899, 'real-input:ios', 4),
          run(901, 'real-input:ios', 4),
          run(902, 'real-input:ios', 5),
        ],
      }).map((r) => r.pid)
    ).toEqual([899]);
  });
});

/* --------------------------- the real CLI, end to end -------------------------- */

const CLI = path.join(process.cwd(), 'scripts', 'gate.mjs');
const cleanup = [];
const blockers = [];

afterAll(() => {
  for (const child of blockers) {
    if (child.exitCode == null) child.kill('SIGTERM');
  }
  for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
});

function gitIn(dir, args) {
  const result = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  }
}

function makeCheckout() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-alone-'));
  // The marker file that makes a directory a nitro-ui checkout.
  fs.mkdirSync(path.join(dir, 'nitrogen/generated/ios'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'nitrogen/generated/ios/NitroUiAutolinking.swift'),
    '// marker\n'
  );
  fs.mkdirSync(path.join(dir, 'example'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'example/package.json'), '{"name":"x"}\n');
  fs.writeFileSync(
    path.join(dir, '.gitignore'),
    '.gates/\nfake-bin/\nstate/\n'
  );
  gitIn(dir, ['init', '-q', '-b', 'main']);
  gitIn(dir, ['add', '-A']);
  gitIn(dir, ['commit', '-qm', 'base']);
  gitIn(dir, ['checkout', '-qb', 'task/alone-fixture']);
  cleanup.push(dir);
  const bin = path.join(dir, 'fake-bin');
  fs.mkdirSync(bin, { recursive: true });
  const script =
    '#!/bin/sh\n' +
    'echo "fake runner: $*"\n' +
    '[ -n "$FAKE_RAN_FILE" ] && echo "$*" > "$FAKE_RAN_FILE"\n' +
    'echo "Tests: 1 passed, 1 total"\n' +
    'exit 0\n';
  for (const name of ['node', 'bun', 'bash']) {
    fs.writeFileSync(path.join(bin, name), script);
    fs.chmodSync(path.join(bin, name), 0o755);
  }
  const home = path.join(dir, 'state');
  const lease = leaseRecord();
  writeLeaseStore(home, { leases: [lease] });
  const env = {
    ...withoutLeaseEnv(process.env),
    ...FREE_LSOF,
    ...leasedEnv({ pair: DEFAULT_PAIR, lease }),
    NITRO_UI_HOME: home,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    FAKE_RAN_FILE: path.join(dir, 'runner-ran.txt'),
  };
  return { dir, env, ranFile: env.FAKE_RAN_FILE };
}

function liveDir(dir) {
  return path.join(dir, '.git', 'nitro-ui-gate-live');
}

function putMarker(dir, marker) {
  fs.mkdirSync(liveDir(dir), { recursive: true });
  fs.writeFileSync(
    path.join(liveDir(dir), `${String(marker.pid)}.json`),
    JSON.stringify({ choosing: false, queuedAt: Date.now(), ...marker })
  );
}

/** A process that stands in for a live run until the test ends it. */
function liveBlocker() {
  const child = spawn(
    process.execPath,
    ['-e', 'setTimeout(() => {}, 600000)'],
    {
      stdio: 'ignore',
    }
  );
  blockers.push(child);
  return child;
}

function deadPid() {
  const result = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  return result.pid;
}

function runCli(fixture, args, extraEnv = {}) {
  fs.rmSync(fixture.ranFile, { force: true });
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: fixture.dir,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...fixture.env, ...extraEnv },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ran: fs.existsSync(fixture.ranFile),
  };
}

function ledgerGates(dir) {
  const file = path.join(dir, '.gates', 'task', 'alone-fixture.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((raw) => raw.trim() !== '')
    .map((raw) => JSON.parse(raw).gate);
}

describe('gate.mjs keeps real-input:ios alone', () => {
  it('holds harness:android behind a live real-input:ios from another worktree, then refuses at the ceiling', () => {
    const fixture = makeCheckout();
    const blocker = liveBlocker();
    putMarker(fixture.dir, {
      pid: blocker.pid,
      gate: 'real-input:ios',
      ticket: 1,
      branch: 'task/other',
      worktree: '/elsewhere',
    });
    const result = runCli(fixture, ['harness:android'], {
      [ALONE_WAIT_ENV]: '0.03',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `harness:android is waiting for real-input:ios (pid ${String(blocker.pid)}, task/other`
    );
    expect(result.stderr).toContain('gate: refused before the run - waited');
    expect(result.ran).toBe(false);
    expect(ledgerGates(fixture.dir)).toEqual([]);
    expect(fs.readdirSync(liveDir(fixture.dir))).toEqual([
      `${String(blocker.pid)}.json`,
    ]);
  });

  it('holds real-input:ios behind a live harness run, and runs once that run is gone', () => {
    const fixture = makeCheckout();
    const blocker = liveBlocker();
    putMarker(fixture.dir, {
      pid: blocker.pid,
      gate: 'harness:android',
      ticket: 1,
    });
    const held = runCli(fixture, ['real-input:ios'], {
      [ALONE_WAIT_ENV]: '0.03',
    });
    expect(held.status).toBe(1);
    expect(held.stderr).toContain(
      `real-input:ios is waiting for harness:android (pid ${String(blocker.pid)}`
    );
    expect(held.ran).toBe(false);

    // A marker whose process is gone is a run that ended. (The blocker itself
    // would linger as an unreaped zombie while this test blocks on spawnSync.)
    fs.rmSync(path.join(liveDir(fixture.dir), `${String(blocker.pid)}.json`));
    const gone = deadPid();
    putMarker(fixture.dir, { pid: gone, gate: 'harness:android', ticket: 1 });
    const ran = runCli(fixture, ['real-input:ios'], {
      [ALONE_WAIT_ENV]: '0.03',
    });
    expect(ran.stderr).not.toContain('is waiting for');
    expect(ran.ran).toBe(true);
    expect(ledgerGates(fixture.dir)).toEqual(['real-input:ios']);
    // Its own marker went with it, and so did the dead run's.
    expect(fs.readdirSync(liveDir(fixture.dir))).toEqual([]);
  });

  it('lets harness gates run beside each other', () => {
    const fixture = makeCheckout();
    const blocker = liveBlocker();
    putMarker(fixture.dir, {
      pid: blocker.pid,
      gate: 'harness:ios',
      ticket: 1,
    });
    const result = runCli(fixture, ['harness:android'], {
      [ALONE_WAIT_ENV]: '0.03',
    });
    expect(result.stderr).not.toContain('is waiting for');
    expect(result.status).toBe(0);
    expect(result.ran).toBe(true);
  });

  it('keeps --background and wait working: a held run waits, starts, and wait returns its code', async () => {
    const fixture = makeCheckout();
    const blocker = liveBlocker();
    putMarker(fixture.dir, {
      pid: blocker.pid,
      gate: 'real-input:ios',
      ticket: 1,
    });
    const started = runCli(fixture, ['harness:android', '--background']);
    expect(started.status).toBe(0);
    expect(started.stdout).toContain('started in the background');
    setTimeout(() => blocker.kill('SIGTERM'), 3_000);
    const waited = await new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [CLI, 'wait', '--gate', 'harness:android', '--timeout-minutes', '1'],
        { cwd: fixture.dir, env: fixture.env }
      );
      let err = '';
      child.stderr.on('data', (chunk) => {
        err += String(chunk);
      });
      child.on('exit', (code) => resolve({ code, err }));
    });
    expect(waited.err).toContain('is waiting for real-input:ios');
    expect(waited.code).toBe(0);
    expect(ledgerGates(fixture.dir)).toEqual(['harness:android']);
  }, 90_000);

  it('marks a backgrounded run that reached the ceiling done, so wait returns 1', () => {
    const fixture = makeCheckout();
    const blocker = liveBlocker();
    putMarker(fixture.dir, {
      pid: blocker.pid,
      gate: 'real-input:ios',
      ticket: 1,
    });
    const started = runCli(fixture, ['harness:android', '--background'], {
      [ALONE_WAIT_ENV]: '0.03',
    });
    expect(started.status).toBe(0);
    const waited = spawnSync(
      process.execPath,
      [CLI, 'wait', '--gate', 'harness:android', '--timeout-minutes', '1'],
      { cwd: fixture.dir, env: fixture.env, encoding: 'utf8' }
    );
    expect(waited.status).toBe(1);
    expect(waited.stderr).toContain('harness:android failed with exit 1');
    expect(ledgerGates(fixture.dir)).toEqual([]);
  }, 90_000);
});
