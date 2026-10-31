/**
 * Device leases have to be right in the ways a prose rule is not.
 *
 * The brief's ask is "unit tests for the lock and the limits", and both exist
 * because of what happened without them (docs/tasks/PROCESS-review-2026-10-26.md
 * §4 rank 7): two tasks on one simulator, and a Metro port collision. So the
 * cases are the two failure shapes:
 *
 *   - the lock: two acquires at the same instant, a lock left behind by a killed
 *     process, and a lock that never frees;
 *   - the limits: the third concurrent device task is refused, an exclusive
 *     lease waits for everyone else, and `emulator-5560` is never on offer.
 *
 * The lock cases inject a filesystem and a clock so the timing is exact; the
 * limit cases then run the real CLI in a real `NITRO_UI_HOME` so the answer does
 * not depend on the fake fs agreeing with `node:fs`.
 */

import { describe, expect, it, beforeEach } from '@jest/globals';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  utimesSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { FREE_LSOF } from './helpers/free-lsof-stub.js';

import {
  DEFAULT_MAX_DEVICE_LEASES,
  EXCLUSIVE_TTL_MINUTES,
  RESERVED_EMULATOR_PORTS,
  activeLeases,
  assertLeasable,
  checkEmulatorEnv,
  decideAcquire,
  emulatorSerial,
  identifiersFor,
  isReservedSerial,
  normalizeDevices,
  pruneExpired,
  renderEnvFile,
  statePaths,
  withLock,
} from '../lease-core.mjs';

// `__dirname`, not `import.meta.url`: jest transforms these files to CommonJS,
// where `import.meta` is a syntax error (the same reason `lease-core.mjs` has no
// `import.meta` in it).
const REPO_ROOT = join(__dirname, '..', '..');
const CLI = join(REPO_ROOT, 'scripts', 'lease.mjs');
const EXAMPLE_CONFIG = join(REPO_ROOT, 'scripts', 'devices.example.json');

/**
 * An in-memory `node:fs` subset for `withLock`, plus a clock the test advances.
 * `failOpenWith` is how a test says "someone else holds it".
 *
 * `contents` matters as much as `mtimeMs`: `withLock` records `pid now token`
 * inside the lock and re-reads it before stealing, so a fixture that wants a
 * corpse needs an old *timestamp in the file*, not just an old mtime.
 */
function fakeFs({ failOpenWith = null, mtimeMs = 0 } = {}) {
  const files = new Map();
  let now = mtimeMs;
  const fs = {
    openSync(file, flags) {
      if (flags === 'wx' && failOpenWith != null && files.has(file) === false) {
        // The caller sets this to keep handing out EEXIST, like a live holder.
        const error = new Error(`EEXIST: ${file}`);
        error.code = 'EEXIST';
        throw error;
      }
      if (flags === 'wx' && files.has(file)) {
        const error = new Error(`EEXIST: ${file}`);
        error.code = 'EEXIST';
        throw error;
      }
      files.set(file, { mtimeMs: now, contents: '' });
      return file;
    },
    writeSync: undefined,
    writeFileSync(file, contents) {
      const entry = files.get(file) ?? { mtimeMs: now };
      entry.contents = String(contents);
      files.set(file, entry);
    },
    readFileSync(file) {
      const entry = files.get(file);
      if (entry == null) {
        const error = new Error(`ENOENT: ${file}`);
        error.code = 'ENOENT';
        throw error;
      }
      return entry.contents;
    },
    closeSync() {},
    statSync(file) {
      const entry = files.get(file);
      if (entry == null) {
        const error = new Error(`ENOENT: ${file}`);
        error.code = 'ENOENT';
        throw error;
      }
      return { mtimeMs: entry.mtimeMs };
    },
    unlinkSync(file) {
      if (!files.delete(file)) {
        const error = new Error(`ENOENT: ${file}`);
        error.code = 'ENOENT';
        throw error;
      }
    },
    renameSync(from, to) {
      const entry = files.get(from);
      if (entry == null) {
        const error = new Error(`ENOENT: ${from}`);
        error.code = 'ENOENT';
        throw error;
      }
      files.delete(from);
      files.set(to, entry);
    },
    linkSync(from, to) {
      // Like the real thing: refuses when the destination path is taken.
      if (files.has(to)) {
        const error = new Error(`EEXIST: ${to}`);
        error.code = 'EEXIST';
        throw error;
      }
      const entry = files.get(from);
      if (entry == null) {
        const error = new Error(`ENOENT: ${from}`);
        error.code = 'ENOENT';
        throw error;
      }
      files.set(to, entry);
    },
  };
  return {
    fs,
    files,
    advance: (ms) => {
      now += ms;
      for (const entry of files.values()) entry.mtimeMs = now;
    },
    /** A lock held by somebody else, recorded at `created` with `token`. */
    hold: (file, { created = 123, token = 'other' } = {}) =>
      files.set(file, { mtimeMs: now, contents: `other ${created} ${token}` }),
  };
}

describe('withLock', () => {
  it('runs the mutation once and releases the lock', () => {
    const { fs, files } = fakeFs();
    const opened = [];
    const sleep = () => {
      throw new Error('must not wait when the lock is free');
    };
    let runs = 0;
    const result = withLock({
      lockFile: '/tmp/x/leases.lock',
      fsImpl: {
        ...fs,
        openSync: (file, flags) => {
          opened.push(flags);
          return fs.openSync(file, flags);
        },
      },
      sleep,
      mutate: () => {
        runs += 1;
        return 'state';
      },
    });
    expect(result).toBe('state');
    expect(runs).toBe(1);
    expect(opened).toEqual(['wx']);
    expect(files.size).toBe(0); // released
  });

  it('waits out a holder that releases', () => {
    const holder = '/tmp/x/leases.lock';
    const { fs, files } = fakeFs();
    let waits = 0;
    files.set(holder, { mtimeMs: 0, contents: 'other 1' });
    const result = withLock({
      lockFile: holder,
      fsImpl: {
        ...fs,
        // The other process is alive (its lock is young) and releases after
        // three retries - which is what "wait, do not steal" has to get right.
        openSync: (file, flags) => {
          if (waits < 3) {
            waits += 1;
            if (waits === 3) files.delete(holder);
            const error = new Error('EEXIST');
            error.code = 'EEXIST';
            throw error;
          }
          return fs.openSync(file, flags);
        },
      },
      sleep: () => {},
      now: (() => {
        let clock = 0;
        return () => {
          const value = clock;
          clock += 20;
          return value;
        };
      })(),
      staleMs: 30_000,
      timeoutMs: 10_000,
      mutate: () => 'mine',
    });
    expect(result).toBe('mine');
    expect(waits).toBe(3);
    expect(files.size).toBe(0);
  });

  it('steals a lock left by a dead process', () => {
    const holder = '/tmp/x/leases.lock';
    // The clock does not move in this case; the lock is simply older than
    // `staleMs`, which is what a killed task leaves behind. Without the steal
    // the machine is wedged until someone notices a `leases.lock` by hand.
    const { fs, files } = fakeFs();
    // A corpse as the real one reads: `pid createdAt token`, both timestamps old.
    files.set(holder, { mtimeMs: -60_000, contents: 'dead -60000 dead-token' });
    const result = withLock({
      lockFile: holder,
      fsImpl: fs,
      sleep: () => {
        throw new Error('a stale lock is stolen, not waited for');
      },
      now: () => 0,
      staleMs: 30_000,
      timeoutMs: 10_000,
      mutate: () => 'stole it',
    });
    expect(result).toBe('stole it');
    expect(files.size).toBe(0);
  });

  it('does not unlink a live lock just because a second stealer arrived', () => {
    const holder = '/tmp/x/leases.lock';
    const { fs, files } = fakeFs();
    files.set(holder, { mtimeMs: -60_000, contents: 'dead -60000 dead-token' });

    let sawLiveLockInsideTheGuard = false;
    const result = withLock({
      lockFile: holder,
      fsImpl: fs,
      token: () => 'AAA',
      sleep: () => {},
      now: () => 0,
      staleMs: 30_000,
      timeoutMs: 200,
      mutate: () => {
        // A second process arrives while this one holds the lock and finds a
        // file whose *timestamp* says it is young. Stealing that is review S3:
        // the release of the first process then deletes a lock it no longer owns.
        let bWaits = 0;
        let bClock = 0;
        expect(() =>
          withLock({
            lockFile: holder,
            fsImpl: fs,
            token: () => 'BBB',
            sleep: () => {
              bWaits += 1;
            },
            // A waiting loop needs a clock that moves, which is what a real
            // sleep does. Frozen, the deadline never arrives.
            now: () => bClock++,
            staleMs: 30_000,
            timeoutMs: 100,
            mutate: () => 'B must never get here',
          })
        ).toThrow(/could not take/);
        expect(bWaits).toBeGreaterThan(0);
        sawLiveLockInsideTheGuard = (
          files.get(holder)?.contents ?? ''
        ).includes('AAA');
        return 'A finished';
      },
    });

    expect(sawLiveLockInsideTheGuard).toBe(true);
    expect(result).toBe('A finished');
    // A released its own lock; nothing was left behind for the next task.
    expect(files.size).toBe(0);
  });

  it('puts back a lock that turned out not to be the stale one it saw', () => {
    const holder = '/tmp/x/leases.lock';
    const { fs, files } = fakeFs({ mtimeMs: -60_000 });
    // The mtime says "old enough to steal", but the timestamp written inside the
    // file is current: a live process took this path after our stat. The steal
    // has to notice and hand it back.
    files.set(holder, { mtimeMs: -60_000, contents: 'live 0 live-token' });
    let waits = 0;
    let clock = 0;
    expect(() =>
      withLock({
        lockFile: holder,
        fsImpl: fs,
        token: () => 'thief',
        sleep: () => {
          waits += 1;
        },
        now: () => clock++,
        staleMs: 30_000,
        timeoutMs: 2_000,
        mutate: () => 'never',
      })
    ).toThrow(/could not take/);
    expect(waits).toBeGreaterThan(0);
    expect(files.get(holder)?.contents).toBe('live 0 live-token');
    // And not sitting next to it under a `.stale-` name either.
    expect([...files.keys()].filter((f) => f.includes('.stale-'))).toEqual([]);
  });

  it('does not steal a lock that is still young', () => {
    const holder = '/tmp/x/leases.lock';
    const { fs, files } = fakeFs();
    files.set(holder, { mtimeMs: 0, contents: 'live 42' });
    let waits = 0;
    expect(() =>
      withLock({
        lockFile: holder,
        fsImpl: fs,
        sleep: () => {
          waits += 1;
        },
        // Advances by a second per wait, so the loop ends at the deadline
        // instead of spinning - and never reaches the stale threshold of a
        // minute at a time.
        now: (() => {
          let clock = 0;
          return () => {
            const value = clock;
            clock += 1_000;
            return value;
          };
        })(),
        staleMs: 30_000,
        timeoutMs: 5_000,
        mutate: () => 'never',
      })
    ).toThrow(/could not take/);
    expect(waits).toBeGreaterThan(0);
    // The holder's lock is untouched, not stolen.
    expect(files.get(holder)?.contents).toBe('live 42');
  });

  it('gives up with a readable error rather than hanging', () => {
    const holder = '/tmp/x/leases.lock';
    const { fs } = fakeFs();
    let clock = 0;
    expect(() =>
      withLock({
        lockFile: holder,
        // Always says the file exists, and is never old enough to steal.
        fsImpl: {
          ...fs,
          openSync: () => {
            const error = new Error('EEXIST');
            error.code = 'EEXIST';
            throw error;
          },
          statSync: () => ({ mtimeMs: 0 }),
          unlinkSync: () => {
            throw new Error('ENOENT');
          },
        },
        sleep: () => {
          clock += 20;
        },
        now: () => clock,
        timeoutMs: 500,
        staleMs: 30_000,
        mutate: () => 'never',
      })
    ).toThrow(/could not take .*leases.lock within 500 ms/);
  });

  it('releases even when the mutation throws', () => {
    const { fs, files } = fakeFs();
    expect(() =>
      withLock({
        lockFile: '/tmp/x/leases.lock',
        fsImpl: fs,
        sleep: () => {},
        mutate: () => {
          throw new Error('boom');
        },
      })
    ).toThrow('boom');
    expect(files.size).toBe(0);
  });
});

/** Two pairs, one with no iOS device, to cover the platform filter. */
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

const lease = (task, holds, extra = {}) => ({
  id: `${task}-1`,
  task,
  holds,
  exclusive: false,
  acquiredAt: Date.now(),
  ...extra,
});

describe('the limits', () => {
  it('hands out a pair while under the cap', () => {
    const decision = decideAcquire({
      active: [],
      pairs: DEVICES.pairs,
      maxDeviceLeases: 2,
      exclusive: false,
      platform: 'both',
      task: 'G6',
    });
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.pair.id).toBe('pair-a');
  });

  it('refuses the third concurrent device task', () => {
    const decision = decideAcquire({
      active: [lease('G6', ['pair-a']), lease('T15', ['pair-b'])],
      pairs: DEVICES.pairs,
      maxDeviceLeases: 2,
      exclusive: false,
      platform: 'both',
      task: 'B1',
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toContain('limit is 2');
      expect(decision.waiting).toEqual(['G6 (G6-1)', 'T15 (T15-1)']);
    }
  });

  it('does not count the asking task against its own limit', () => {
    // A retry must land back on what the task already has rather than consume a
    // second pair, so its own lease is neither a competitor nor taken.
    const decision = decideAcquire({
      active: [lease('G6', ['pair-a'])],
      pairs: DEVICES.pairs,
      maxDeviceLeases: 2,
      exclusive: false,
      platform: 'both',
      task: 'G6',
    });
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.pair.id).toBe('pair-a');
  });

  it('never gives a pair to two holders', () => {
    const decision = decideAcquire({
      active: [lease('G6', ['pair-a'])],
      pairs: DEVICES.pairs,
      maxDeviceLeases: 2,
      exclusive: false,
      platform: 'both',
      task: 'T15',
    });
    if (!decision.ok) throw new Error('expected a free pair');
    expect(decision.pair.id).not.toBe('pair-a');
  });

  it('waits for everything when the lease is exclusive', () => {
    const decision = decideAcquire({
      active: [lease('G6', ['pair-a'])],
      pairs: DEVICES.pairs,
      maxDeviceLeases: 2,
      exclusive: true,
      platform: 'both',
      task: 'B1',
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toContain('waits for every other lease');
      expect(decision.waiting).toEqual(['G6 (G6-1)']);
    }
  });

  it('lets an exclusive lease hold every pair', () => {
    const decision = decideAcquire({
      active: [lease('B1', ['pair-a', 'pair-b'], { exclusive: true })],
      pairs: DEVICES.pairs,
      maxDeviceLeases: 2,
      exclusive: false,
      platform: 'both',
      task: 'G6',
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toContain('already leased');
  });

  it('counts an expired lease as nobody', () => {
    const now = Date.now();
    const active = activeLeases(
      { leases: [lease('G6', ['pair-a'], { acquiredAt: now - 500 * 60_000 })] },
      now
    );
    expect(active).toEqual([]);
    const decision = decideAcquire({
      active,
      pairs: DEVICES.pairs,
      maxDeviceLeases: 2,
      exclusive: true,
      platform: 'both',
      task: 'B1',
    });
    // A task killed mid-build must not wedge the machine for the next one.
    expect(decision.ok).toBe(true);
  });

  it('holds back a new lease while somebody waits for an exclusive one', () => {
    // The starvation fix (review S4): a waiting exclusive request is recorded,
    // so the machine drains instead of being refilled by the next task.
    const decision = decideAcquire({
      active: [lease('G6', ['pair-a'])],
      pairs: DEVICES.pairs,
      maxDeviceLeases: 2,
      exclusive: false,
      platform: 'both',
      task: 'G7',
      pending: [{ task: 'B1', id: 'B1-1', requestedAt: Date.now() }],
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toContain('waiting for an exclusive lease');
      expect(decision.waiting).toContain('B1 (waiting, exclusive)');
    }

    // The waiter itself is not held back by its own marker, and an ordinary
    // lease with nobody waiting is unaffected.
    const forTheWaiter = decideAcquire({
      active: [],
      pairs: DEVICES.pairs,
      maxDeviceLeases: 2,
      exclusive: true,
      platform: 'both',
      task: 'B1',
      pending: [{ task: 'B1', id: 'B1-1', requestedAt: Date.now() }],
    });
    expect(forTheWaiter.ok).toBe(true);
  });

  describe('ttl (review M1)', () => {
    const now = 1_700_000_000_000;
    const heldFor = (minutes, ttlMinutes) => ({
      id: `x-${ttlMinutes}`,
      task: `T${ttlMinutes}`,
      holds: ['pair-a'],
      acquiredAt: now - minutes * 60_000,
      ttlMinutes,
    });

    it("judges each lease by its own ttl, never by the caller's", () => {
      // The reproduced failure: a bench holds a 900-minute exclusive lease, and
      // a 1-minute probe asks a minute later. The old prune judged both by the
      // probe's ttl and persisted the result, which evicted the bench.
      const state = {
        leases: [heldFor(5, 900), heldFor(5, 1)],
      };
      const kept = pruneExpired(state, now).leases;
      expect(kept.map((entry) => entry.ttlMinutes)).toEqual([900]);
      expect(activeLeases(state, now).map((e) => e.task)).toEqual(['T900']);
    });

    it('drops a waiting exclusive marker that stopped refreshing', () => {
      const fresh = {
        leases: [],
        pendingExclusive: [{ task: 'B1', requestedAt: now - 5_000 }],
      };
      expect(pruneExpired(fresh, now).pendingExclusive).toHaveLength(1);
      const stale = {
        leases: [],
        pendingExclusive: [{ task: 'B1', requestedAt: now - 120_000 }],
      };
      expect(pruneExpired(stale, now).pendingExclusive).toBeUndefined();
    });

    it('defaults an exclusive lease to longer than a bench run', () => {
      // 8 to 14 hours (PROCESS review §4), so the quiet window cannot expire
      // mid-measurement the way the 4-hour device default would.
      expect(EXCLUSIVE_TTL_MINUTES).toBeGreaterThanOrEqual(14 * 60);
    });
  });

  it('says so when no pair has the platform that was asked for', () => {
    const decision = decideAcquire({
      active: [],
      pairs: [DEVICES.pairs[1]],
      maxDeviceLeases: 2,
      exclusive: false,
      platform: 'ios',
      task: 'G6',
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok)
      expect(decision.reason).toContain('no configured pair has a ios device');
  });
});

describe('the reserved serial', () => {
  it('refuses a pool that contains port 5560 at all', () => {
    expect(RESERVED_EMULATOR_PORTS).toContain(5560);
    expect(() =>
      normalizeDevices({
        pairs: [
          {
            id: 'mine',
            ios: { udid: 'AAAA' },
            android: { avd: 'avd_x', emulatorPort: 5560 },
            metroPort: 8081,
          },
        ],
      })
    ).toThrow(/emulator port 5560 is reserved[\s\S]*emulator-5560/);
  });

  it('cannot be dodged by asking for the port instead of the serial', () => {
    expect(emulatorSerial(5560)).toBe('emulator-5560');
    // Checked against the serial the port produces, so naming a port instead of
    // a device does not slip past it. Built by hand here because
    // `normalizeDevices` refuses such a pool before this point - the case above.
    const pair = {
      id: 'mine',
      android: { avd: 'avd_mine', emulatorPort: 5560 },
      metroPort: 8081,
    };
    const devices = {
      reservedEmulatorPorts: [5560],
      reservedIdentifiers: [],
    };
    expect(assertLeasable(pair, devices, 'android')).toMatch(
      /emulator port 5560 \(serial emulator-5560\), which is reserved/
    );
    // An iOS-only ask from the same pair is not the reserved thing.
    expect(
      assertLeasable({ ...pair, ios: { udid: 'AAAA' } }, devices, 'ios')
    ).toBeNull();
  });

  it('refuses a reserved identifier by name', () => {
    const devices = normalizeDevices({
      pairs: [
        {
          id: 'pair-a',
          ios: { udid: 'SECRET-AIR-UDID' },
          metroPort: 8295,
        },
      ],
      reservedIdentifiers: ['SECRET-AIR-UDID'],
    });
    expect(assertLeasable(devices.pairs[0], devices, 'ios')).toMatch(
      /reserved identifier "SECRET-AIR-UDID"/
    );
    expect(identifiersFor(devices.pairs[0], 'ios')).toEqual([
      'SECRET-AIR-UDID',
    ]);
  });

  it('refuses a console port the emulator cannot take, where the mistake is made', () => {
    // X11 review N2. `Number.isInteger` accepted any integer, so an odd or out-of-range
    // `emulatorPort` reached the pool boot, where `-port` used to be dropped and the emulator came
    // up on whatever console was free: the AVD existed, the serial the lease exported did not. The
    // boot refuses now, and so does the config, at the line someone actually edited.
    for (const port of [5575, 5000, 6000, 5553]) {
      expect(() =>
        normalizeDevices({
          pairs: [
            {
              id: 'mine',
              ios: { udid: 'AAAA' },
              android: { avd: 'avd_x', emulatorPort: port },
              metroPort: 8081,
            },
          ],
        })
      ).toThrow(/is not a console port the emulator can take/);
    }
    // The legal range, both ends, and the odd console that belongs to a legal one.
    for (const port of [5554, 5574, 5682]) {
      expect(() =>
        normalizeDevices({
          pairs: [
            {
              id: 'mine',
              ios: { udid: 'AAAA' },
              android: { avd: 'avd_x', emulatorPort: port },
              metroPort: 8081,
            },
          ],
        })
      ).not.toThrow();
    }
    expect(() =>
      normalizeDevices({
        pairs: [
          {
            id: 'mine',
            ios: { udid: 'AAAA' },
            android: { avd: 'avd_x', emulatorPort: 5555 },
            metroPort: 8081,
          },
        ],
      })
    ).toThrow(/emulatorPort 5555/);
  });

  it('rejects a half-usable pool with every problem listed', () => {
    expect(() =>
      normalizeDevices({
        pairs: [
          { id: 'pair-a', ios: {}, android: { avd: 'x' }, metroPort: 'nope' },
          { id: 'pair-a', metroPort: 8296 },
        ],
      })
    ).toThrow(/needs a udid[\s\S]*integer metroPort[\s\S]*"pair-a" twice/);
    expect(() => normalizeDevices({ pairs: [] })).toThrow(/at least one/);
  });
});

describe('the env file a lease prints', () => {
  const pair = normalizeDevices(
    JSON.parse(readFileSync(EXAMPLE_CONFIG, 'utf8'))
  ).pairs[0];

  it('names the variables the gates already read', () => {
    const env = renderEnvFile(
      { task: 'G6', platform: 'both', exclusive: false },
      pair
    );
    expect(env).toContain(
      "export IOS_SIM_UDID='00000000-0000-4000-8000-00000000000A'"
    );
    expect(env).toContain("export ANDROID_AVD='nitro-ui-a'");
    expect(env).toContain("export EMULATOR_PORT='5574'");
    expect(env).toContain("export ANDROID_SERIAL='emulator-5574'");
    expect(env).toContain("export ANDROID_ADB_SERVER_PORT='5043'");
    expect(env).toContain("export METRO_PORT='8295'");
  });

  it('quotes what contains a space or a quote, so `source` survives it', () => {
    const env = renderEnvFile(
      { task: 'G6', platform: 'both', exclusive: false },
      { ...pair, ios: { ...pair.ios, name: "Dan's iPhone 17" } }
    );
    expect(env).toMatch(/export IOS_SIM='.+iPhone 17'/);
    // A `'` inside a single-quoted POSIX string has to be closed and escaped.
    expect(env).toContain(`'\\''`);
    // Only comments and single-line exports: `source` must not see anything else.
    expect(
      env
        .split('\n')
        .every(
          (line) =>
            line === '' || line.startsWith('# ') || line.startsWith('export ')
        )
    ).toBe(true);
    expect(env.match(/^export /gm).length).toBeGreaterThanOrEqual(9);
  });

  it('leaves out the platform that was not asked for', () => {
    expect(
      renderEnvFile({ task: 'G6', platform: 'ios', exclusive: false }, pair)
    ).not.toContain('ANDROID_AVD');
    expect(
      renderEnvFile({ task: 'G6', platform: 'android', exclusive: false }, pair)
    ).not.toContain('IOS_SIM_UDID');
  });
});

describe('the CLI, in a real state directory', () => {
  let home;
  let config;

  const cli = (args, env = {}) =>
    spawnSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        NITRO_UI_HOME: home,
        NITRO_UI_LEASE_POLL_MS: '50',
        // Nothing is listening on any port (helper): otherwise an acquire in this file
        // asks the real machine, and a second worktree's harness on pair-a's Metro makes
        // every case here refuse for a port the file never mentions.
        ...FREE_LSOF,
        ...env,
      },
    });

  /**
   * `cli`, but concurrently: a promise of `{code, stdout, stderr}`. The race
   * and the wait-then-succeed cases need children that actually run at the same
   * time, which `spawnSync` in a loop does not give them.
   *
   * `onStderr` sees the accumulated stderr on every chunk, so a test can wait
   * for the child to *say* it reached the state it is about to perturb, instead
   * of sleeping for a guess at when it got there.
   */
  const spawnLease = (args, env = {}, onStderr) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [CLI, ...args], {
        env: {
          ...process.env,
          NITRO_UI_HOME: home,
          NITRO_UI_LEASE_POLL_MS: '50',
          ...FREE_LSOF,
          ...env,
        },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
        onStderr?.(stderr);
      });
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'nitro-ui-leases-'));
    config = join(home, 'devices.json');
    copyFileSync(EXAMPLE_CONFIG, config);
  });

  const stateFile = () => statePaths(home).leases;
  const readState = () => JSON.parse(readFileSync(stateFile(), 'utf8'));
  /** Poll until `predicate` holds (fixed sleeps flake on a loaded CI runner). */
  const waitFor = async (predicate, timeoutMs = 20000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        if (predicate()) return;
      } catch {
        // state file mid-write or not there yet
      }
      if (Date.now() > deadline) throw new Error('waitFor: timed out');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };

  it('prints an env file and remembers the lease', () => {
    const result = cli(['acquire', '--task', 'G6', '--config', config]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('export METRO_PORT=');
    expect(readState().leases).toHaveLength(1);
    expect(readState().leases[0].holds).toEqual(['pair-a']);

    const listed = cli(['list', '--json']);
    expect(listed.status).toBe(0);
    expect(JSON.parse(listed.stdout).leases[0].task).toBe('G6');

    expect(cli(['release', 'G6']).stdout).toContain('released');
    expect(readState().leases).toEqual([]);
  });

  it('is idempotent per task, so a retry does not eat a second pair', () => {
    const first = cli(['acquire', '--task', 'G6', '--config', config]);
    const second = cli(['acquire', '--task', 'G6', '--config', config]);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain(first.stdout.trim().split('\n')[0]);
    expect(readState().leases).toHaveLength(1);
  });

  it('refuses the third concurrent task, and only the third', () => {
    const attempts = [1, 2, 3].map((index) =>
      cli(['acquire', '--task', `T${index}`, '--config', config])
    );
    // Sequential here: the concurrency test below is the one that races; this one
    // checks which of three ordered asks survives and what the refusal says.
    expect(attempts.slice(0, 2).every((a) => a.status === 0)).toBe(true);
    expect(attempts[2].status).toBe(1);
    expect(attempts[2].stderr).toMatch(/limit is 2/);
    expect(attempts[2].stderr).toMatch(/lease: refused/);
    expect(readState().leases).toHaveLength(2);
  });

  it('settles a real race with exactly two winners', async () => {
    // Eight processes asking in the same instant, one lock file, one lease file:
    // the point of `withLock`. A lock-free implementation shows up here as three
    // winners, or as a torn `leases.json` that no longer parses.
    const attempts = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        spawnLease(['acquire', '--task', `race${index}`, '--config', config])
      )
    );
    const winners = attempts.filter((attempt) => attempt.code === 0);
    expect(winners).toHaveLength(DEFAULT_MAX_DEVICE_LEASES);
    expect(
      attempts.every((attempt) => attempt.code === 0 || attempt.code === 1)
    ).toBe(true);

    const state = readState();
    expect(state.leases).toHaveLength(DEFAULT_MAX_DEVICE_LEASES);
    const pairs = state.leases.flatMap((entry) => entry.holds);
    expect(new Set(pairs).size).toBe(DEFAULT_MAX_DEVICE_LEASES);
  });

  it('waits for every other lease, then takes an exclusive one', () => {
    expect(cli(['acquire', '--task', 'G6', '--config', config]).status).toBe(0);
    // `--wait-minutes 0` says "answer now": the default for an exclusive acquire
    // is to wait an hour, which is right for a bench run and wrong for a test.
    const waiting = cli([
      'acquire',
      '--task',
      'B1',
      '--exclusive',
      '--wait-minutes',
      '0',
      '--config',
      config,
    ]);
    expect(waiting.status).toBe(1);
    expect(waiting.stderr).toMatch(/waits for every other lease/);
    expect(cli(['release', 'G6']).status).toBe(0);

    const retried = cli([
      'acquire',
      '--task',
      'B1',
      '--exclusive',
      '--config',
      config,
    ]);
    expect(retried.status).toBe(0);
    expect(readState().leases[0].holds).toEqual(['pair-a', 'pair-b']);
    // An exclusive holder leaves nothing for anyone else.
    expect(cli(['acquire', '--task', 'G6', '--config', config]).status).toBe(1);
  });

  it('waits in the process rather than refusing, when told to wait', async () => {
    expect(cli(['acquire', '--task', 'G6', '--config', config]).status).toBe(0);
    const waiter = spawnLease([
      'acquire',
      '--task',
      'B1',
      '--exclusive',
      '--wait-minutes',
      '2',
      '--config',
      config,
    ]);
    // Until the child has seen G6 and parked its exclusive request, then hand the
    // machine over: the point is that it waits and then wins.
    await waitFor(() => (readState().pendingExclusive ?? []).length > 0);
    expect(cli(['release', 'G6']).status).toBe(0);

    const finished = await waiter;
    expect(finished.stderr).toMatch(/lease: waiting/);
    expect(finished.code).toBe(0);
    expect(finished.stdout).toContain('export METRO_PORT=');
    expect(readState().leases.map((entry) => entry.task)).toEqual(['B1']);
  });

  it('refuses to hand out a reserved serial', () => {
    writeFileSync(
      config,
      JSON.stringify({
        pairs: [
          {
            id: 'mine',
            ios: { udid: 'AAAA' },
            android: { avd: 'avd_mine', emulatorPort: 5560, adbPort: 5037 },
            metroPort: 8081,
          },
        ],
      })
    );
    const result = cli(['acquire', '--task', 'G6', '--config', config]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/emulator port 5560 is reserved/);
    expect(result.stderr).toMatch(/devices\.json is not usable/);
  });

  it('says what to do when there is no pool at all', () => {
    const result = spawnSync(
      process.execPath,
      [CLI, 'acquire', '--task', 'G6'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          NITRO_UI_HOME: join(home, 'missing'),
          ...FREE_LSOF,
        },
      }
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/no device pool at/);
    expect(result.stderr).toMatch(/devices\.example\.json/);
  });

  it('keeps an env file writable for `source`', () => {
    const out = join(home, 'g6.env');
    const result = cli([
      'acquire',
      '--task',
      'G6',
      '--platform',
      'ios',
      '--out',
      out,
      '--config',
      config,
    ]);
    expect(result.status).toBe(0);
    const env = readFileSync(out, 'utf8');
    expect(env).toContain('IOS_SIM_UDID');
    expect(env).not.toContain('ANDROID_AVD');
    expect(result.stderr).toContain(out);
  });

  it('lets a short ttl and a long one coexist (review M1)', async () => {
    // The exact scenario from the review: a long lease is in the file, a short
    // acquire happens afterwards, and the short one's ttl must not be used to
    // judge the long one. One ttl for every lease is what deleted a bench run's
    // lease a minute into the run.
    expect(
      cli([
        'acquire',
        '--task',
        'LONG',
        '--ttl-minutes',
        '900',
        '--config',
        config,
      ]).status
    ).toBe(0);
    expect(
      cli([
        'acquire',
        '--task',
        'SHORT',
        '--ttl-minutes',
        '0.02',
        '--config',
        config,
      ]).status
    ).toBe(0);
    expect(
      readState()
        .leases.map((entry) => entry.task)
        .sort()
    ).toEqual(['LONG', 'SHORT']);

    // Past the short lease's own ttl, and still nowhere near the long one's.
    // Polled against the shipped expiry rule rather than sleeping for it:
    // `Atomics.wait` is allowed to return before its timeout, and on a loaded
    // runner that woke here with `SHORT` still live, so `list` showed two rows
    // and this test failed on its own timing rather than on the rule.
    const short = readState().leases.find((entry) => entry.task === 'SHORT');
    await waitFor(() => {
      const live = pruneExpired(readState(), Date.now()).leases;
      return !live.some((entry) => entry.id === short.id);
    }, 10_000);
    const midList = cli(['list']).stdout;
    expect(midList).not.toContain('SHORT');
    expect(midList).toMatch(/LONG[\s\S]*900m ttl left/);

    const probe = cli([
      'acquire',
      '--task',
      'PROBE',
      '--ttl-minutes',
      '1',
      '--config',
      config,
    ]);
    expect(probe.status).toBe(0);
    const tasks = readState()
      .leases.map((entry) => entry.task)
      .sort();
    // Only the lease whose own ttl ran out is gone.
    expect(tasks).toEqual(['LONG', 'PROBE']);
    expect(
      readState().leases.find((entry) => entry.task === 'LONG').ttlMinutes
    ).toBe(900);

    // And the long lease still shows its own ttl in `list`, not the probe's.
    expect(cli(['list']).stdout).toMatch(/LONG[\s\S]*900m ttl left/);
    // The 30_000 below is above the poll's own 10 s: what this test waits for
    // is a ttl, so a loaded runner must not run out of Jest's default first and
    // report a timeout that says nothing about which wait failed.
  }, 30_000);

  it('gives an exclusive lease a ttl that outlasts a bench run (review M1)', () => {
    // Nothing passed `--ttl-minutes` here: the default is what protects a 14 h
    // bench from losing its devices halfway through, which the old 240-minute
    // default did not.
    expect(
      cli(['acquire', '--task', 'BENCH', '--exclusive', '--config', config])
        .status
    ).toBe(0);
    const bench = readState().leases.find((entry) => entry.task === 'BENCH');
    expect(bench.exclusive).toBe(true);
    expect(bench.ttlMinutes).toBe(EXCLUSIVE_TTL_MINUTES);
    // The *point* of the default, asserted in the unit the CLI can break: 14 h
    // in the same minutes the lease stores. Comparing `ttlMinutes * 60` against
    // `14` compared seconds with hours and could not fail (X1 re-review F5).
    expect(bench.ttlMinutes).toBeGreaterThanOrEqual(14 * 60);
  });

  it('renews a lease by its own ttl, and says so when it is gone', () => {
    expect(
      cli([
        'acquire',
        '--task',
        'G6',
        '--ttl-minutes',
        '30',
        '--config',
        config,
      ]).status
    ).toBe(0);
    const renewed = cli(['renew', 'G6']);
    expect(renewed.status).toBe(0);
    expect(renewed.stdout).toContain('renewed');
    expect(readState().leases[0].ttlMinutes).toBe(30);

    // An expired lease is not resurrected: its devices may already be handed to
    // someone else, so a heartbeat has to fail loudly.
    cli(['release', 'G6']);
    const missing = cli(['renew', 'G6']);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('no live lease');
  });

  it('holds new leases back for a waiting exclusive request (review S4)', async () => {
    expect(cli(['acquire', '--task', 'G6', '--config', config]).status).toBe(0);

    // A bench asking for the whole machine, parked in the wait loop.
    const waiting = spawnLease([
      'acquire',
      '--task',
      'B1',
      '--exclusive',
      '--wait-minutes',
      '2',
      '--config',
      config,
    ]);
    // Until it has written its marker and started waiting.
    await waitFor(() => (readState().pendingExclusive ?? []).length > 0);

    const third = cli([
      'acquire',
      '--task',
      'G7',
      '--platform',
      'ios',
      '--config',
      config,
    ]);
    expect(third.status).toBe(1);
    expect(third.stderr).toContain('waiting for an exclusive lease');
    // It stayed free: the refusal is the drain, not a quiet take of pair-b.
    expect(readState().leases.map((entry) => entry.task)).toEqual(['G6']);

    expect(cli(['release', 'G6']).status).toBe(0);
    const won = await waiting;
    expect(won.code).toBe(0);
    expect(won.stdout).toContain('exclusive)');
    // The marker goes away with the wait.
    expect(readState().pendingExclusive).toBeUndefined();
    expect(readState().leases[0].task).toBe('B1');
  });

  it('keeps a lock-timeout from ending a wait (review S4)', async () => {
    // The state lock is held by a live pid, so an acquire cannot take it. The
    // reviewer's bug: one lock timeout ended the whole wait, so a task that
    // asked for `--wait-minutes 5` gave up in a third of a second. The lock
    // gives up in 200 ms here and the caller waits a minute, so exit 0 proves
    // the timeout turned into a retry.
    expect(cli(['acquire', '--task', 'G6', '--config', config]).status).toBe(0);
    const lockFile = statePaths(home).lock;
    writeFileSync(lockFile, `999999 ${Date.now()} busy\n`);

    let progress = '';
    const waiting = spawnLease(
      ['acquire', '--task', 'G7', '--wait-minutes', '1', '--config', config],
      { NITRO_UI_LEASE_LOCK_TIMEOUT_MS: '200' },
      (stderr) => {
        progress = stderr;
      }
    );

    // Until it has *said* it burned a couple of lock timeouts. The fixed sleep
    // this replaces guessed at that from the clock, so on a loaded runner the
    // lock could go away before the acquire ever reached it: the child then
    // acquired on its first try and the test passed without testing the retry.
    // Then clear the way: the lock goes away first, because a release that has
    // to queue behind the lock it is testing would block for its own ten-second
    // timeout.
    await waitFor(() => (progress.match(/lock busy/g) ?? []).length >= 2);
    unlinkSync(lockFile);
    expect(cli(['release', 'G6']).status).toBe(0);

    const result = await waiting;
    expect(result.stderr).toContain('lock busy');
    expect(result.code).toBe(0);
    expect(readState().leases.map((entry) => entry.task)).toEqual(['G7']);
    // The wait above has a 20 s budget of its own, and Jest's default for the
    // test is 5 s, so without this a slow machine reports a bare Jest timeout
    // instead of the `waitFor` message that says which wait gave up. Same reason
    // the ttl test above carries 30_000 (F1 N6).
  }, 30_000);

  it('hands one stale lock to one stealer, and no pair to both', async () => {
    // A corpse from a task that died mid-write, plus two tasks asking at the
    // same instant (review S3). The old unlink-the-world steal let the second
    // delete the first's live lock, so both read an empty lease file and both
    // took pair-a. Whatever happens here, two pairs must go to two tasks.
    const lockFile = statePaths(home).lock;
    writeFileSync(lockFile, '999998 1 dead-token\n');
    // A Date, not a number: utimesSync reads a number as *seconds*, and a
    // millisecond figure lands in the far future - the lock then looks young
    // and nobody steals it, which silently tests nothing.
    const dead = new Date(Date.now() - 120_000);
    utimesSync(lockFile, dead, dead);

    const results = await Promise.all([
      spawnLease(['acquire', '--task', 'G6', '--config', config]),
      spawnLease(['acquire', '--task', 'G7', '--config', config]),
    ]);
    expect(results.map((entry) => entry.code)).toEqual([0, 0]);

    const pairs = readState()
      .leases.map((entry) => entry.holds[0])
      .sort();
    expect(pairs).toEqual(['pair-a', 'pair-b']);
    // The corpse and any `.stale-` copies are gone; nobody is locked out.
    expect(existsSync(lockFile)).toBe(false);
    expect(readdirSync(home).filter((f) => f.includes('.stale-'))).toEqual([]);
  });
});

/**
 * A lease is a promise about a *serial*, and a serial only exists because the
 * emulator booted on that console port (review S5). `react-native-harness` used
 * to start the emulator with no `-port`, so the port was whatever the machine
 * had free: the leased AVD could come up as the one serial this repo never
 * touches, and the `ANDROID_SERIAL` everyone was told to use named nothing.
 */
describe('the console port a lease owns', () => {
  it('exports a port and a serial that agree, for every configured pair', () => {
    const devices = normalizeDevices(
      JSON.parse(readFileSync(EXAMPLE_CONFIG, 'utf8'))
    );
    for (const pair of devices.pairs) {
      if (pair.android == null) continue;
      const env = Object.fromEntries(
        renderEnvFile({ id: 'X1-x', task: 'X1', platform: 'android' }, pair)
          .split('\n')
          .filter((line) => line.startsWith('export '))
          .map((line) => {
            const [name, ...rest] = line.slice('export '.length).split('=');
            return [name, rest.join('=').replaceAll("'", '')];
          })
      );
      expect(checkEmulatorEnv(env)).toEqual({
        port: pair.android.emulatorPort,
        serial: emulatorSerial(pair.android.emulatorPort),
      });
    }
  });

  it('refuses the reserved serial whichever variable names it', () => {
    expect(isReservedSerial('emulator-5560')).toBe(true);
    // The same device seen from the other side: naming the port instead of the
    // serial is the same mistake.
    expect(() => checkEmulatorEnv({ ANDROID_SERIAL: 'emulator-5560' })).toThrow(
      /reserved serial/
    );
    expect(() => checkEmulatorEnv({ EMULATOR_PORT: '5560' })).toThrow(
      /reserved/
    );
    // Not every serial is a console: a network adb address has no port to
    // reserve, and must not be mistaken for one.
    expect(isReservedSerial('10.0.0.5:5555')).toBe(false);
  });

  it('refuses a port the emulator could not take, or a serial that disagrees', () => {
    // 5575 is the console *of* 5574; `-port` wants the even one. A run that got
    // this wrong would boot a second emulator nobody can reach.
    expect(() => checkEmulatorEnv({ EMULATOR_PORT: '5575' })).toThrow(
      /console port/
    );
    expect(() => checkEmulatorEnv({ EMULATOR_PORT: 'eleven' })).toThrow(
      /not a port number/
    );
    // Half a lease, sourced by hand: the two variables disagree, and guessing
    // which one is right is how a task ends up on someone else's device.
    expect(() =>
      checkEmulatorEnv({
        EMULATOR_PORT: '5574',
        ANDROID_SERIAL: 'emulator-5554',
      })
    ).toThrow(/disagree/);
    // A run with no lease at all (a CI job, which boots its own emulator) is
    // legal: the rule is about what is named, not about what is missing.
    expect(checkEmulatorEnv({})).toEqual({ port: null, serial: null });
  });

  it('makes the harness boot the AVD on the leased port', () => {
    // The behaviour lives in a dependency patch
    // (`patches/@react-native-harness%2Fplatform-android@1.6.0.patch`), so this
    // asks the installed module what it would actually run. It is the only test
    // here that reads node_modules: a patch that silently stops applying is
    // exactly the kind of thing that makes a device rule stop being true.
    const module = pathToFileURL(
      join(
        REPO_ROOT,
        'node_modules',
        '@react-native-harness',
        'platform-android',
        'dist',
        'emulator-startup.js'
      )
    ).href;
    const script =
      `import(${JSON.stringify(module)}).then((m) => {` +
      `process.stdout.write(m.getEmulatorStartupArgs('nitroui_t03', 'default-boot').join(' '));});`;
    const withPort = spawnSync(process.execPath, ['-e', script], {
      env: { ...process.env, EMULATOR_PORT: '5574' },
      encoding: 'utf8',
    });
    expect(withPort.status).toBe(0);
    expect(withPort.stdout).toContain('-port 5574');

    const withoutPort = spawnSync(process.execPath, ['-e', script], {
      env: Object.fromEntries(
        Object.entries(process.env).filter(([name]) => name !== 'EMULATOR_PORT')
      ),
      encoding: 'utf8',
    });
    expect(withoutPort.status).toBe(0);
    // No lease, no opinion: a CI runner boots its own emulator on the default
    // console port, exactly as it did before this patch.
    expect(withoutPort.stdout).not.toContain('-port');
  });
});

/**
 * `list` also says which pool devices are running with no lease (X9 item 6).
 *
 * The rule itself is tested in `doctor.test.js`; this is the wiring, which is where
 * the failure mode actually lived: `list` is what a task reads to find out who owns
 * what, and it said nothing about a simulator left booted by the last task - the
 * state that quietly moved harness numbers for a week. Two things are checked here:
 * the warning appears, and it goes to *stderr* so `list --json`'s stdout stays the
 * lease state a script can parse.
 *
 * The two tools are faked by env var (see `scanUnownedDevices`), so the case is the
 * same on a Mac, a Linux runner and a machine with no Android SDK.
 */
describe('`list` names devices nobody leased', () => {
  let home;
  let config;
  let bins;

  const cliWithTools = (args, extraEnv = {}) =>
    spawnSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        NITRO_UI_HOME: home,
        NITRO_UI_LEASE_POLL_MS: '50',
        NITRO_UI_SIMCTL_BIN: join(bins, 'simctl'),
        NITRO_UI_ADB_BIN: join(bins, 'adb'),
        ...FREE_LSOF,
        ...extraEnv,
      },
    });

  /** Writes the fake tools, with the listing and serials a test asks for. */
  const tools = ({ simState, adbLines }) => {
    const listing = {
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [
          {
            udid: '00000000-0000-4000-8000-00000000000A',
            name: 'iPhone 17',
            state: simState,
          },
        ],
      },
    };
    writeFileSync(
      join(bins, 'simctl'),
      [
        '#!/bin/sh',
        `printf '%s' ${JSON.stringify(JSON.stringify(listing))}`,
        '',
      ].join('\n')
    );
    // The format string, not `%s` arguments: `adb devices` separates a serial from
    // its state with a real tab, and `printf '%s'` hands back a literal `\t`, which
    // would make the fixture a device list nothing parses.
    const format = adbLines
      .join('\n')
      .replace(/\\/g, '\\\\')
      .replace(/\t/g, '\\t')
      .replace(/'/g, "'\\''");
    writeFileSync(
      join(bins, 'adb'),
      ['#!/bin/sh', `printf '${format}\\n'`, ''].join('\n')
    );
    for (const name of ['simctl', 'adb']) {
      chmodSync(join(bins, name), 0o755);
    }
  };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'nitro-ui-unowned-'));
    bins = mkdtempSync(join(tmpdir(), 'nitro-ui-unowned-bin-'));
    config = join(home, 'devices.json');
    copyFileSync(EXAMPLE_CONFIG, config);
  });

  it('warns about a booted pool simulator with no lease, on stderr', () => {
    tools({ simState: 'Booted', adbLines: ['List of devices attached', ''] });
    const listed = cliWithTools(['list']);
    expect(listed.status).toBe(0);
    expect(listed.stderr).toContain('pair-a');
    expect(listed.stderr).toContain('is Booted and no lease holds it');
    // stdout stays the human's lease table (empty here), with no host noise mixed in.
    expect(listed.stdout).toContain('no leases in');
  });

  it('keeps `--json` parseable with the warning on stderr', () => {
    tools({ simState: 'Booted', adbLines: ['List of devices attached', ''] });
    const listed = cliWithTools(['list', '--json']);
    expect(() => JSON.parse(listed.stdout)).not.toThrow();
    expect(JSON.parse(listed.stdout).leases).toEqual([]);
    expect(listed.stderr).toContain('no lease holds it');
  });

  it('goes quiet once the same device is leased', () => {
    tools({ simState: 'Booted', adbLines: ['List of devices attached', ''] });
    expect(
      cliWithTools([
        'acquire',
        '--task',
        'G6',
        '--platform',
        'ios',
        '--config',
        config,
      ]).status
    ).toBe(0);
    const listed = cliWithTools(['list', '--config', config]);
    expect(listed.stderr).not.toContain('no lease holds it');
    expect(listed.stdout).toContain('G6');
  });

  it('names a running pool emulator too, and leaves another task’s emulator alone', () => {
    tools({
      simState: 'Shutdown',
      adbLines: [
        'List of devices attached',
        'emulator-5574\tdevice',
        'emulator-5588\tdevice',
        '',
      ],
    });
    const listed = cliWithTools(['list']);
    expect(listed.stderr).toContain('emulator-5574');
    // Not a pool port: somebody else's device, and no verdict is the right answer.
    expect(listed.stderr).not.toContain('emulator-5588');
  });

  it('says the check could not run rather than reporting an idle machine', () => {
    // Both tools exit non-zero: "I could not tell" must not read as "all clear".
    writeFileSync(join(bins, 'simctl'), '#!/bin/sh\nexit 1\n');
    writeFileSync(join(bins, 'adb'), '#!/bin/sh\nexit 1\n');
    chmodSync(join(bins, 'simctl'), 0o755);
    chmodSync(join(bins, 'adb'), 0o755);
    const listed = cliWithTools(['list']);
    expect(listed.stderr).toContain('cannot check for unowned devices');
    expect(listed.stderr).toContain('xcrun simctl and adb');
  });

  it('still lists leases when there is no device pool at all', () => {
    // `list` used to work without a pool, and a device report must not break it.
    unlinkSync(config);
    const listed = cliWithTools(['list']);
    expect(listed.status).toBe(0);
    expect(listed.stdout).toContain('no leases in');
  });
});
