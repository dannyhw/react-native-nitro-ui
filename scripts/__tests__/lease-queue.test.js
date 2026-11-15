import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FREE_LSOF } from './helpers/free-lsof-stub.js';
import { childEnv } from './helpers/scrubbed-env.js';
import {
  DEFAULT_MAX_DEVICE_LEASES,
  decideAcquire,
  normalizeDevices,
  pairSatisfiesWaiter,
  pruneExpired,
  statePaths,
  waitQueue,
} from '../lease-core.mjs';

const REPO_ROOT = join(__dirname, '..', '..');
const CLI = join(REPO_ROOT, 'scripts', 'lease.mjs');
const EXAMPLE_CONFIG = join(REPO_ROOT, 'scripts', 'devices.example.json');

const T0 = 1_700_000_000_000;
const MINUTE = 60_000;

/** Two pairs: one with both platforms, one Android-only. */
const DEVICES = normalizeDevices({
  maxDeviceLeases: DEFAULT_MAX_DEVICE_LEASES,
  pairs: [
    {
      id: 'pair-a',
      ios: { udid: 'AAAA', name: 'iPhone 17' },
      android: { avd: 'avd_a', emulatorPort: 5574, adbPort: 5043 },
      metroPort: 8295,
    },
    {
      id: 'pair-b',
      android: { avd: 'avd_b', emulatorPort: 5576, adbPort: 5044 },
      metroPort: 8296,
    },
  ],
});

const PAIR_IOS_ONLY = {
  id: 'pair-c',
  ios: { udid: 'CCCC', name: 'iPhone 17 C' },
  metroPort: 8298,
};

/** A live ticket, in the shape `lease.mjs` writes. */
const ticket = (task, waitedMs, extra = {}) => ({
  task,
  id: `${task}-1`,
  platform: 'both',
  exclusive: false,
  requestedAt: T0 - waitedMs,
  refreshedAt: T0,
  ...extra,
});

const lease = (task, holds, extra = {}) => ({
  id: `${task}-1`,
  task,
  holds,
  platform: 'both',
  exclusive: false,
  acquiredAt: T0,
  ttlMinutes: 240,
  ...extra,
});

/** Ask the question `acquire` asks, with the queue in front of it. */
const ask = (task, { waiters = [], waitedSince = null, ...rest } = {}) =>
  decideAcquire({
    active: [],
    pairs: DEVICES.pairs,
    maxDeviceLeases: DEFAULT_MAX_DEVICE_LEASES,
    exclusive: false,
    platform: 'both',
    task,
    waiters,
    waitedSince,
    now: T0,
    ...rest,
  });

describe('the queue (X26: first come, first served)', () => {
  it('gives a freed pair to the oldest waiter, not to the one that asks first', () => {
    const line = [ticket('X24', 300 * MINUTE), ticket('X25', 270 * MINUTE)];

    const younger = ask('X25', {
      waiters: line,
      waitedSince: T0 - 270 * MINUTE,
    });
    expect(younger.ok).toBe(false);
    if (!younger.ok) {
      expect(younger.reason).toContain('X24');
      expect(younger.reason).toMatch(/first come, first served/);
      expect(younger.queueAhead).toEqual([
        {
          task: 'X24',
          id: 'X24-1',
          platform: 'both',
          position: 1,
          waitedMs: 300 * MINUTE,
        },
      ]);
      expect(younger.waiting).toContain('X24 (waiting 5h, queue position 1)');
    }

    const older = ask('X24', {
      waiters: line,
      waitedSince: T0 - 300 * MINUTE,
    });
    expect(older.ok).toBe(true);
    if (older.ok) expect(older.pair.id).toBe('pair-a');
  });

  it('will not let the task that just released a pair jump back in front', () => {
    // A release removes the task's ticket, so asking again right away is the back of
    // the queue.
    const line = [ticket('X25', 240 * MINUTE)];
    const justReleased = ask('X24', { waiters: line, waitedSince: T0 });
    expect(justReleased.ok).toBe(false);
    if (!justReleased.ok) expect(justReleased.reason).toContain('X25');

    const served = ask('X25', {
      waiters: line,
      waitedSince: T0 - 240 * MINUTE,
    });
    expect(served.ok).toBe(true);
  });

  it('drops a ticket that stopped refreshing, so a killed waiter frees the line', () => {
    const live = ticket('X24', 10 * MINUTE);
    // A waiter killed between two polls: nobody stamps `refreshedAt` again.
    const corpse = ticket('X25', 20 * MINUTE, { refreshedAt: T0 - 90_000 });
    const state = { leases: [], waiters: [corpse, live] };

    expect(waitQueue(state, T0).map((waiter) => waiter.task)).toEqual(['X24']);
    expect(waitQueue(state, T0)[0]).toMatchObject({
      position: 1,
      waitedMs: 10 * MINUTE,
    });
    const pruned = pruneExpired(state, T0);
    expect(pruned.waiters).toEqual([live]);

    const queue = waitQueue(pruned, T0);
    expect(ask('X26', { waiters: queue, waitedSince: T0 }).ok).toBe(false);
    expect(
      ask('X24', { waiters: queue, waitedSince: T0 - 10 * MINUTE }).ok
    ).toBe(true);
  });

  it('keeps a waiting exclusive request in the queue and still drains the machine for it', () => {
    // `requestedAt` is when a waiter joined the queue, so an exclusive request that
    // keeps refreshing stays first in line and holds new leases back while it waits.
    const marker = {
      task: 'B1',
      id: 'B1-1',
      requestedAt: T0 - 5 * MINUTE,
      refreshedAt: T0,
    };
    const state = {
      leases: [lease('G6', ['pair-a'])],
      pendingExclusive: [marker],
      waiters: [ticket('G6', 60_000)],
    };

    expect(waitQueue(state, T0).map((waiter) => waiter.task)).toEqual([
      'B1',
      'G6',
    ]);
    expect(waitQueue(state, T0)[0]).toMatchObject({ exclusive: true });
    // The marker stays alive on its refresh alone.
    expect(pruneExpired(state, T0).pendingExclusive).toHaveLength(1);

    // A pending exclusive request holds every ordinary request back.
    const ordinary = ask('G6', {
      active: [lease('G6', ['pair-a'])],
      waiters: waitQueue(state, T0),
      waitedSince: T0 - 60_000,
      pending: [marker],
    });
    expect(ordinary.ok).toBe(false);
    if (!ordinary.ok) expect(ordinary.reason).toMatch(/exclusive/);

    // One free pair does not satisfy an exclusive request, so the exclusive request
    // is not queued behind the waiters it is holding back.
    const bench = ask('B1', {
      active: [],
      exclusive: true,
      waiters: [ticket('G6', 30 * MINUTE)],
      waitedSince: T0 - 30 * MINUTE,
    });
    expect(bench.ok).toBe(true);
  });

  it('claims only the pairs a waiter can use, so the rest still go out', () => {
    // G7 waits for iOS only, so it cannot reserve `pair-b`, which has no iOS half.
    const three = [...DEVICES.pairs, PAIR_IOS_ONLY];
    const spare = ask('G8', {
      pairs: three,
      waiters: [ticket('G7', 30 * MINUTE, { platform: 'ios' })],
      waitedSince: T0,
    });
    expect(spare.ok).toBe(true);
    if (spare.ok) expect(spare.pair.id).toBe('pair-b');

    // A `both` waiter reserves every pair it could use, so a request without a ticket
    // is refused even with pairs free, until that waiter's next poll takes one.
    const waiting = ask('G8', {
      pairs: three,
      waiters: [ticket('G7', 30 * MINUTE)],
      waitedSince: T0,
    });
    expect(waiting.ok).toBe(false);
    if (!waiting.ok) expect(waiting.reason).toMatch(/first come, first served/);

    // The one free pair the waiter can use is reserved for it.
    const taken = ask('G8', {
      platform: 'android',
      active: [lease('G6', ['pair-b'], { platform: 'android' })],
      waiters: [ticket('G7', 30 * MINUTE, { platform: 'android' })],
      waitedSince: T0,
    });
    expect(taken.ok).toBe(false);
    if (!taken.ok) expect(taken.reason).toMatch(/first come, first served/);
  });

  it('applies the documented pair/waiter rule', () => {
    const [pairA, pairB] = DEVICES.pairs;
    expect(pairSatisfiesWaiter(pairA, { platform: 'ios' })).toBe(true);
    expect(pairSatisfiesWaiter(pairB, { platform: 'ios' })).toBe(false);
    expect(pairSatisfiesWaiter(pairB, { platform: 'android' })).toBe(true);
    // A `both` lease is satisfied by a pair with either half.
    expect(pairSatisfiesWaiter(pairB, { platform: 'both' })).toBe(true);
    expect(
      pairSatisfiesWaiter(pairB, { platform: 'both', exclusive: true })
    ).toBe(true);
    expect(pairSatisfiesWaiter(null, { platform: 'both' })).toBe(false);
  });

  it('counts a ticket written in the same millisecond exactly once', () => {
    // Without a tie-break, two tickets written in the same millisecond would each see
    // the other as "not older" and both claim the one free pair.
    const same = (task) => ticket(task, MINUTE);
    const line = [same('X25'), same('X24')];
    const active = [lease('G6', ['pair-b'])];
    const first = ask('X24', {
      active,
      waiters: line,
      waitedSince: T0 - MINUTE,
    });
    const second = ask('X25', {
      active,
      waiters: line,
      waitedSince: T0 - MINUTE,
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toContain('X24');
  });

  it('changes nothing when nobody is waiting', () => {
    expect(ask('G6', { waiters: [], waitedSince: T0 })).toMatchObject({
      ok: true,
      pair: { id: 'pair-a' },
    });
    // A caller that passes no `waiters` at all is served the same way.
    expect(
      decideAcquire({
        active: [],
        pairs: DEVICES.pairs,
        maxDeviceLeases: 2,
        exclusive: false,
        platform: 'both',
        task: 'G6',
      }).ok
    ).toBe(true);
  });
});

describe('the CLI keeps a queue in the lease file', () => {
  let home;
  let config;
  /**
   * Every child this file started, killed in `afterEach`: a waiting `acquire` left
   * behind holds its pipe open and jest waits for it.
   */
  const children = [];

  /** These cases start real `lease.mjs` processes, so they get a longer timeout. */
  const itSpawns = (name, fn) => it(name, fn, 30_000);

  const cli = (args, env = {}) =>
    spawnSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      // `childEnv` drops the calling shell's lease variables, which `lease.mjs` would
      // otherwise read.
      env: childEnv({
        NITRO_UI_HOME: home,
        NITRO_UI_LEASE_POLL_MS: '50',
        // No device is booted, and `FREE_LSOF` reports every port free.
        NITRO_UI_LEASE_BOOT: '0',
        ...FREE_LSOF,
        ...env,
      }),
    });

  /** A waiting `acquire` whose process the test can also stop. */
  const spawnWaitingAcquire = (args) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: childEnv({
        NITRO_UI_HOME: home,
        NITRO_UI_LEASE_POLL_MS: '50',
        NITRO_UI_LEASE_BOOT: '0',
        ...FREE_LSOF,
      }),
    });
    children.push(child);
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    return {
      child,
      stderr: () => stderr,
      done: new Promise((resolve) =>
        child.on('close', (code) => resolve({ code, stderr }))
      ),
    };
  };

  /** A ceiling on how long a spawned `lease.mjs` gets to reach a state the test waits for. */
  const POLL_EVIDENCE_TIMEOUT_MS = 20_000;

  const stateFile = () => statePaths(home).leases;
  const readState = () => JSON.parse(readFileSync(stateFile(), 'utf8'));
  const writeState = (state) =>
    writeFileSync(stateFile(), `${JSON.stringify(state, null, 2)}\n`);
  const waitFor = async (predicate, timeoutMs = 20000, waitedFor = 'state') => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        if (predicate()) return;
      } catch {
        // state file mid-write, or not written yet
      }
      if (Date.now() > deadline)
        throw new Error(
          `waitFor: timed out after ${String(timeoutMs)} ms waiting for ${waitedFor}`
        );
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };

  /** A waiter that joined the line `waitedMs` ago, as the file would hold it. */
  const seedWaiter = (task, waitedMs) => {
    const now = Date.now();
    writeState({
      ...readState(),
      waiters: [
        {
          task,
          id: `${task}-seeded`,
          platform: 'both',
          exclusive: false,
          requestedAt: now - waitedMs,
          refreshedAt: now,
        },
      ],
    });
  };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'nitro-ui-queue-'));
    config = join(home, 'devices.json');
    copyFileSync(EXAMPLE_CONFIG, config);
  });

  afterEach(() => {
    for (const child of children.splice(0)) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }
  });

  itSpawns(
    'hands a freed pair to the older ticket and shows the queue in `list`',
    async () => {
      // G6 holds one of the two pairs; X24 has a ticket for the other and is not running.
      expect(
        cli(['acquire', '--task', 'G6', '--config', config, '--no-boot']).status
      ).toBe(0);
      seedWaiter('X24', 400_000);

      const waiter = spawnWaitingAcquire([
        'acquire',
        '--task',
        'X25',
        '--config',
        config,
        '--no-boot',
        '--wait-minutes',
        '2',
      ]);
      await waitFor(() =>
        (readState().waiters ?? []).some((entry) => entry.task === 'X25')
      );

      const listed = cli(['list', '--config', config]);
      expect(listed.stdout).toMatch(/queue\s+1\. X24/);
      expect(listed.stdout).toMatch(/queue\s+2\. X25/);
      expect(
        JSON.parse(
          cli(['list', '--config', config, '--json']).stdout
        ).queue.map((waiter2) => waiter2.task)
      ).toEqual(['X24', 'X25']);

      // G6 releases. The pair must not go to X25, which is polling right now.
      expect(cli(['release', 'G6']).stdout).toContain('released');
      // Wait on state, not time: a poll stamps the waiter's own ticket (`refreshedAt`),
      // so a stamp later than the release shows X25 has looked at the freed pair.
      const freedAt = Date.now();
      await waitFor(
        () => {
          const state = readState();
          // A wrong grant also ends the wait; the assertion below reports it.
          if ((state.leases ?? []).some((entry) => entry.task === 'X25'))
            return true;
          const ticket = (state.waiters ?? []).find(
            (entry) => entry.task === 'X25'
          );
          return ticket != null && Number(ticket.refreshedAt) > freedAt;
        },
        POLL_EVIDENCE_TIMEOUT_MS,
        'the waiting X25 to look at the freed pair (its ticket refreshed, or wrongly granted)'
      );
      expect(readState().leases.map((entry) => entry.task)).toEqual([]);
      expect(
        (readState().waiters ?? []).some((entry) => entry.task === 'X25')
      ).toBe(true);
      expect(waiter.stderr()).toMatch(/X24.*first come, first served/s);

      expect(
        cli([
          'acquire',
          '--task',
          'X24',
          '--config',
          config,
          '--no-boot',
          '--wait-minutes',
          '0',
        ]).status
      ).toBe(0);
      // Once X24 is served, X25 heads the queue with a pair free and polls every 50 ms,
      // so it may already hold that pair.
      expect([['X24'], ['X24', 'X25']]).toContainEqual(
        readState().leases.map((entry) => entry.task)
      );
      expect(
        (readState().waiters ?? []).some((entry) => entry.task === 'X24')
      ).toBe(false);

      expect(cli(['release', 'X24']).stdout).toContain('released');
      const won = await waiter.done;
      expect(won.code).toBe(0);
      expect(readState().leases.map((entry) => entry.task)).toEqual(['X25']);
    }
  );

  itSpawns(
    'records a ticket for a waiting acquire, and forgets one that dies',
    async () => {
      expect(
        cli(['acquire', '--task', 'G6', '--config', config, '--no-boot']).status
      ).toBe(0);
      expect(
        cli(['acquire', '--task', 'G7', '--config', config, '--no-boot']).status
      ).toBe(0);

      const waiter = spawnWaitingAcquire([
        'acquire',
        '--task',
        'X24',
        '--config',
        config,
        '--no-boot',
        '--platform',
        'ios',
        '--wait-minutes',
        '5',
      ]);
      await waitFor(() =>
        (readState().waiters ?? []).some((entry) => entry.task === 'X24')
      );
      const recorded = readState().waiters.find(
        (entry) => entry.task === 'X24'
      );
      expect(recorded).toMatchObject({
        platform: 'ios',
        exclusive: false,
        id: expect.stringMatching(/^X24-/),
      });
      expect(recorded.requestedAt).toBeLessThanOrEqual(Date.now());
      expect(recorded.refreshedAt).toBeGreaterThanOrEqual(recorded.requestedAt);

      waiter.child.kill('SIGKILL');
      await waiter.done;
      expect(readState().leases.map((entry) => entry.task)).toEqual([
        'G6',
        'G7',
      ]);

      // `release` also removes the dead waiter's ticket.
      expect(cli(['release', 'X24']).stdout).toContain('no lease matched');
      expect(readState().waiters ?? []).toEqual([]);

      // A ticket nobody refreshes expires by itself.
      const now = Date.now();
      writeState({
        ...readState(),
        waiters: [
          {
            task: 'X28',
            id: 'X28-1',
            platform: 'both',
            exclusive: false,
            requestedAt: now - 10 * MINUTE,
            refreshedAt: now - 120_000,
          },
        ],
      });
      expect(
        JSON.parse(cli(['list', '--config', config, '--json']).stdout).queue
      ).toEqual([]);
    }
  );

  itSpawns(
    'refuses a no-wait acquire that is not next in line - without queueing it',
    () => {
      expect(
        cli(['acquire', '--task', 'G6', '--config', config, '--no-boot']).status
      ).toBe(0);
      seedWaiter('X24', 400_000);

      const refused = cli([
        'acquire',
        '--task',
        'X25',
        '--config',
        config,
        '--no-boot',
        '--wait-minutes',
        '0',
      ]);
      expect(refused.status).toBe(1);
      expect(refused.stderr).toMatch(/X24/);
      expect(refused.stderr).toMatch(/first come, first served/);
      expect(
        (readState().waiters ?? []).some((entry) => entry.task === 'X25')
      ).toBe(false);

      expect(
        cli([
          'acquire',
          '--task',
          'X24',
          '--config',
          config,
          '--no-boot',
          '--wait-minutes',
          '0',
        ]).status
      ).toBe(0);
    }
  );
});
