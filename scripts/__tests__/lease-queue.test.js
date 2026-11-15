/**
 * X26: a freed device pair goes to whoever has waited longest.
 *
 * Why (docs/tasks/X26-lease-fifo.md): `lease.mjs acquire` polled, and a pair that
 * came free was won by whoever polled first. A task that released a pair asked again
 * within seconds, so it kept what it had; on 2026-11-11 two tasks waited four and a
 * half hours each and never got a pair while the pool turned over between their
 * polls. Only a waiting *exclusive* request recorded anything, so nothing ordered
 * the ordinary ones.
 *
 * Most of this is the pure decision (`decideAcquire`, `waitQueue`,
 * `pairSatisfiesWaiter`), because that is where the rule lives and a clock can be
 * handed to it. The CLI cases at the bottom run the real script in a temporary
 * `NITRO_UI_HOME` with a fake `lsof` and `--no-boot`, so tickets, their expiry and
 * `list` are proven in the file the next task reads - and never against a device.
 */

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

/** The machine as configured: two pairs, both halves, one of them iOS+Android. */
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

/** A third pair, iOS-only, for the cases about what a waiter may *not* reserve. */
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

    // The one that has waited less asks - and is refused, by name, with its place.
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

    // The one that has waited longest asks the same question and is served.
    const older = ask('X24', {
      waiters: line,
      waitedSince: T0 - 300 * MINUTE,
    });
    expect(older.ok).toBe(true);
    if (older.ok) expect(older.pair.id).toBe('pair-a');
  });

  it('will not let the task that just released a pair jump back in front', () => {
    // X24 released the machine a second ago; X25 has been waiting all morning. The
    // release removed X24's ticket, so its only claim is "I am asking now" - and
    // asking now is the *back* of the queue, not the front. This is the exact shape
    // of the starvation: release, re-ask within seconds, win, repeat.
    const line = [ticket('X25', 240 * MINUTE)];
    const justReleased = ask('X24', { waiters: line, waitedSince: T0 });
    expect(justReleased.ok).toBe(false);
    if (!justReleased.ok) expect(justReleased.reason).toContain('X25');

    // Nothing changed for the waiter that was here first.
    const served = ask('X25', {
      waiters: line,
      waitedSince: T0 - 240 * MINUTE,
    });
    expect(served.ok).toBe(true);
  });

  it('drops a ticket that stopped refreshing, so a killed waiter frees the line', () => {
    const live = ticket('X24', 10 * MINUTE);
    // Killed between two polls: nobody will stamp `refreshedAt` again.
    const corpse = ticket('X25', 20 * MINUTE, { refreshedAt: T0 - 90_000 });
    const state = { leases: [], waiters: [corpse, live] };

    expect(waitQueue(state, T0).map((waiter) => waiter.task)).toEqual(['X24']);
    expect(waitQueue(state, T0)[0]).toMatchObject({
      position: 1,
      waitedMs: 10 * MINUTE,
    });
    const pruned = pruneExpired(state, T0);
    expect(pruned.waiters).toEqual([live]);

    // The corpse no longer reserves anything, and the living waiter still does.
    const queue = waitQueue(pruned, T0);
    expect(ask('X26', { waiters: queue, waitedSince: T0 }).ok).toBe(false);
    expect(
      ask('X24', { waiters: queue, waitedSince: T0 - 10 * MINUTE }).ok
    ).toBe(true);
  });

  it('keeps a waiting exclusive request in the queue and still drains the machine for it', () => {
    // X26 makes `requestedAt` mean "when I joined the queue" for every waiter, so an
    // exclusive request that started five minutes ago and refreshed a moment ago is
    // still first in line - and still holds new leases back while it waits.
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
    // Alive on the refresh alone: a marker that expired here would let the machine
    // be refilled under the bench, which is the starvation it exists to end.
    expect(pruneExpired(state, T0).pendingExclusive).toHaveLength(1);

    // The drain rule outranks the queue for everybody else...
    const ordinary = ask('G6', {
      active: [lease('G6', ['pair-a'])],
      waiters: waitQueue(state, T0),
      waitedSince: T0 - 60_000,
      pending: [marker],
    });
    expect(ordinary.ok).toBe(false);
    if (!ordinary.ok) expect(ordinary.reason).toMatch(/exclusive/);

    // ...and one free pair does not satisfy an exclusive request, so it is not held
    // behind the queue it is itself holding back.
    const bench = ask('B1', {
      active: [],
      exclusive: true,
      waiters: [ticket('G6', 30 * MINUTE)],
      waitedSince: T0 - 30 * MINUTE,
    });
    expect(bench.ok).toBe(true);
  });

  it('claims only the pairs a waiter can use, so the rest still go out', () => {
    // G7 waits for iOS only. It may not idle `pair-b`, which has no iOS half at all,
    // so a later request takes that one and the iOS pair stays in the line for G7.
    const three = [...DEVICES.pairs, PAIR_IOS_ONLY];
    const spare = ask('G8', {
      pairs: three,
      waiters: [ticket('G7', 30 * MINUTE, { platform: 'ios' })],
      waitedSince: T0,
    });
    expect(spare.ok).toBe(true);
    if (spare.ok) expect(spare.pair.id).toBe('pair-b');

    // The cost of the rule, asserted rather than glossed: a `both` waiter claims every
    // pair the pool could hand it, so a request with no ticket is refused with two
    // pairs free. The pair may sit idle until that waiter's next poll - 10 s, or 60 s
    // if it is a corpse nobody is refreshing. The alternative is to let an unticketed
    // task take a pair from in front of somebody who has been waiting half an hour,
    // which is the bug, priced as utilization.
    const waiting = ask('G8', {
      pairs: three,
      waiters: [ticket('G7', 30 * MINUTE)],
      waitedSince: T0,
    });
    expect(waiting.ok).toBe(false);
    if (!waiting.ok) expect(waiting.reason).toMatch(/first come, first served/);

    // The one free pair the waiter *can* use is its reservation, and it holds.
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
    // A `both` lease takes either half - that is what `decideAcquire` already grants.
    expect(pairSatisfiesWaiter(pairB, { platform: 'both' })).toBe(true);
    expect(
      pairSatisfiesWaiter(pairB, { platform: 'both', exclusive: true })
    ).toBe(true);
    // A look-check simulator is its own resource: it reserves no other pair, and no
    // ordinary pair is reserved for it.
    expect(
      pairSatisfiesWaiter(pairA, { platform: 'ios', iosRuntime: '26.5' })
    ).toBe(false);
    expect(
      pairSatisfiesWaiter(
        { id: 'rt', ios: { udid: 'R' }, iosRuntime: '26.5', metroPort: 8299 },
        { platform: 'ios', iosRuntime: '26.5' }
      )
    ).toBe(true);
    expect(pairSatisfiesWaiter(null, { platform: 'both' })).toBe(false);
  });

  it('counts a ticket written in the same millisecond exactly once', () => {
    // The tie-break is load-bearing: one pair free and two tickets written in the
    // same millisecond. If each saw the other as "not older" both would claim the
    // pair, and the second would queue behind a grant that never happened.
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
    // A caller that has not heard of the queue (no `waiters` argument at all) gets
    // the answer it got before X26.
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
   * Every child this file started. A test that fails half way through must not
   * leave a waiting `acquire` behind: it holds the pipe open, jest waits for it,
   * and a unit test that never touches a device starts looking like one.
   */
  const children = [];

  /**
   * These cases start real `lease.mjs` processes, which is the point - and on a
   * machine running the rest of `check` next to them, the 5 s default is a coin
   * flip. The waits inside are all polled, so this is a ceiling and not a sleep.
   */
  const itSpawns = (name, fn) => it(name, fn, 30_000);

  const cli = (args, env = {}) =>
    spawnSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      // Never the calling shell's lease (X34 item 1): `lease.mjs` reads the device it may touch,
      // the boot switch and the Metro-port answer out of the environment, so an inherited lease is
      // a second answer to every question these cases ask. A case that wants one of those names
      // passes it in `env`, which lands last.
      env: childEnv({
        NITRO_UI_HOME: home,
        NITRO_UI_LEASE_POLL_MS: '50',
        // No device is booted by a test in this file, and nothing is listening on
        // any port: the queue is a file-and-decision question, not a device one.
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

  /**
   * How long a spawned `lease.mjs` gets to reach a state the test can read.
   *
   * A ceiling on the wait, never an ingredient of the answer: the cases below say *what* they are
   * waiting to become true, so an expiry names the missing fact instead of reporting that a
   * number of milliseconds passed.
   */
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
      // The thing that never happened, not the number of milliseconds that did: a reader of a red
      // run should learn which fact is missing, which is what makes a waited-for wait debuggable
      // when a slept-for one was only re-runnable.
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
      // G6 holds one of the two pairs, so the other is free: that pair is the whole
      // question, and X24 has been waiting for it since before this test started.
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

      // `list` answers the question a refusal sends a task here to ask: who is in
      // line, since when, and in what order they will be served.
      const listed = cli(['list', '--config', config]);
      expect(listed.stdout).toMatch(/queue\s+1\. X24/);
      expect(listed.stdout).toMatch(/queue\s+2\. X25/);
      expect(
        JSON.parse(
          cli(['list', '--config', config, '--json']).stdout
        ).queue.map((waiter2) => waiter2.task)
      ).toEqual(['X24', 'X25']);

      // G6 lets go. The pair must not go to X25, which is polling right now - it
      // belongs to X24, which is not even running.
      expect(cli(['release', 'G6']).stdout).toContain('released');
      // Waited for, not slept for (X34 item 3). The question is what the waiter did with a free
      // pair, and the answer is in the file: a poll touches its own ticket (`refreshedAt`), so a
      // ticket stamped *after* the release is a waiter that has looked at a free pool. The stamp
      // is read from after the release returned, so there is no window in which an earlier poll
      // counts as the one being waited for. What used to be here was `sleep(600)` - a bet about
      // how fast a process wakes from a 50 ms poll on a machine running the rest of `check` next
      // to it, which X33 lost once and won twice.
      const freedAt = Date.now();
      await waitFor(
        () => {
          const state = readState();
          // A wrong grant is evidence too: stop waiting and let the assertion below say what
          // happened, rather than timing out on a state that will never arrive.
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
      // Only now is "it did not take the pair" worth asserting: the waiter has been seen looking
      // at a free pool, so an empty grant list is a verdict and not a race won by a scheduler.
      expect(readState().leases.map((entry) => entry.task)).toEqual([]);
      expect(
        (readState().waiters ?? []).some((entry) => entry.task === 'X25')
      ).toBe(true);
      expect(waiter.stderr()).toMatch(/X24.*first come, first served/s);

      // X24 comes back for what the queue already promised it; then the waiter is next.
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
      expect(readState().leases.map((entry) => entry.task)).toEqual(['X24']);
      // Served: out of the queue, so it is not blocking the next grant either.
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

      // Stop the waiter without ever serving it: its ticket is a corpse now.
      waiter.child.kill('SIGKILL');
      await waiter.done;
      expect(readState().leases.map((entry) => entry.task)).toEqual([
        'G6',
        'G7',
      ]);

      // `release` is how a human cleans up after it: the ticket goes with the name.
      expect(cli(['release', 'X24']).stdout).toContain('no lease matched');
      expect(readState().waiters ?? []).toEqual([]);

      // And a ticket nobody refreshes is gone by itself, with no release at all -
      // which is what stops a killed task from holding the line forever.
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
      // Refused, not queued: nothing is left behind to hold a pair for a task that has
      // already given up.
      expect(
        (readState().waiters ?? []).some((entry) => entry.task === 'X25')
      ).toBe(false);

      // The ticket itself is still first, and gets the pair on the same question.
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
