import { describe, expect, it, beforeEach } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import {
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
import { childEnv } from './helpers/scrubbed-env.js';

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
// where `import.meta` is a syntax error.
const REPO_ROOT = join(__dirname, '..', '..');
const CLI = join(REPO_ROOT, 'scripts', 'lease.mjs');
const EXAMPLE_CONFIG = join(REPO_ROOT, 'scripts', 'devices.example.json');

// An in-memory `node:fs` subset for `withLock`, plus a clock the test advances.
// `withLock` records `pid now token` inside the lock and re-reads it before
// stealing, so a stale lock needs an old timestamp in the file, not just an old
// mtime.
function fakeFs({ failOpenWith = null, mtimeMs = 0 } = {}) {
  const files = new Map();
  let now = mtimeMs;
  const fs = {
    openSync(file, flags) {
      if (flags === 'wx' && failOpenWith != null && files.has(file) === false) {
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
    expect(files.size).toBe(0);
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
        // The other holder's lock is young, and is released after three retries.
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
    const { fs, files } = fakeFs();
    // `pid createdAt token`, with both timestamps older than `staleMs`.
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
        // A second process arrives while this one holds the lock.
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
            // The clock must move, or the waiting loop never reaches its deadline.
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
    expect(files.size).toBe(0);
  });

  it('puts back a lock that turned out not to be the stale one it saw', () => {
    const holder = '/tmp/x/leases.lock';
    const { fs, files } = fakeFs({ mtimeMs: -60_000 });
    // The mtime says "old enough to steal", but the timestamp written inside the
    // file is current: a live process took the lock after the stat.
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
        // A second per call: the loop reaches its deadline before `staleMs`.
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
    expect(decision.ok).toBe(true);
  });

  it('holds back a new lease while somebody waits for an exclusive one', () => {
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

    // The waiter itself is not held back by its own marker.
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
      // A bench run takes 8 to 14 hours.
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
    // Built by hand: `normalizeDevices` refuses such a pool before this point.
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
      // A scrubbed environment: a lease sourced in the calling shell must not
      // reach the CLI under test.
      env: childEnv({
        NITRO_UI_HOME: home,
        NITRO_UI_LEASE_POLL_MS: '50',
        // Reports every port as free, so an acquire does not ask the real machine.
        ...FREE_LSOF,
        ...env,
      }),
    });

  // `cli`, but concurrently. `onStderr` sees the accumulated stderr on every
  // chunk, so a test can wait for what the child says instead of sleeping.
  const spawnLease = (args, env = {}, onStderr) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [CLI, ...args], {
        env: childEnv({
          NITRO_UI_HOME: home,
          NITRO_UI_LEASE_POLL_MS: '50',
          ...FREE_LSOF,
          ...env,
        }),
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

  it('carries a note from acquire to list, changes it, and clears it', () => {
    const plan =
      'merge: check, harness:ios; then real-input:ios, quiet machine';
    expect(
      cli(['acquire', '--task', 'M1', '--note', plan, '--config', config])
        .status
    ).toBe(0);
    const id = readState().leases[0].id;
    expect(readState().leases[0].note).toBe(plan);
    const listedRow = () =>
      cli(['list'])
        .stdout.split('\n')
        .find((line) => line.startsWith(id));
    expect(listedRow()).toContain(plan);
    expect(JSON.parse(cli(['list', '--json']).stdout).leases[0].note).toBe(
      plan
    );

    const next = 'merge: real-input:ios now, needs a quiet machine';
    const changed = cli(['note', id, next]);
    expect(changed.status).toBe(0);
    expect(changed.stdout).toContain(next);
    expect(listedRow()).toContain(next);
    expect(listedRow()).not.toContain(plan);

    // By task name too, the way `release` takes one.
    expect(cli(['note', 'M1', '']).status).toBe(0);
    expect(readState().leases[0]).not.toHaveProperty('note');
    expect(listedRow()).not.toContain(' - ');

    // A re-acquire with --note sets it on the lease the task already holds.
    expect(
      cli(['acquire', '--task', 'M1', '--note', 'again', '--config', config])
        .status
    ).toBe(0);
    expect(readState().leases).toHaveLength(1);
    expect(readState().leases[0].note).toBe('again');
    // ... and one without --note leaves it alone.
    cli(['acquire', '--task', 'M1', '--config', config]);
    expect(readState().leases[0].note).toBe('again');
  });

  it('refuses a note of two lines, one over 200 characters, or for no lease', () => {
    cli(['acquire', '--task', 'M2', '--config', config]);
    const twoLines = cli(['note', 'M2', 'one\ntwo']);
    expect(twoLines.status).toBe(2);
    expect(twoLines.stderr).toContain('one line');
    expect(cli(['note', 'M2', 'x'.repeat(200)]).status).toBe(0);
    const long = cli(['note', 'M2', 'x'.repeat(201)]);
    expect(long.status).toBe(2);
    expect(long.stderr).toContain('at most 200 characters');
    expect(readState().leases[0].note).toBe('x'.repeat(200));
    const nobody = cli(['note', 'Z9', 'hello']);
    expect(nobody.status).toBe(1);
    expect(nobody.stderr).toContain('no lease matched Z9');
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
    expect(attempts.slice(0, 2).every((a) => a.status === 0)).toBe(true);
    expect(attempts[2].status).toBe(1);
    expect(attempts[2].stderr).toMatch(/limit is 2/);
    expect(attempts[2].stderr).toMatch(/lease: refused/);
    expect(readState().leases).toHaveLength(2);
  });

  it('settles a real race with exactly two winners', async () => {
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
    // `--wait-minutes 0` answers now: an exclusive acquire waits an hour by default.
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
    // Wait on state: the child has parked its exclusive request.
    await waitFor(() => (readState().pendingExclusive ?? []).length > 0);
    expect(cli(['release', 'G6']).status).toBe(0);

    const finished = await waiter;
    expect(finished.stderr).toMatch(/lease: waiting/);
    expect(finished.code).toBe(0);
    expect(finished.stdout).toContain('export METRO_PORT=');
    expect(readState().leases.map((entry) => entry.task)).toEqual(['B1']);
  }, 30_000);

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
        env: childEnv({
          NITRO_UI_HOME: join(home, 'missing'),
          ...FREE_LSOF,
        }),
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

    // Polled against the expiry rule, not slept for: a sleep can return early on
    // a loaded machine with `SHORT` still live.
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
    expect(tasks).toEqual(['LONG', 'PROBE']);
    expect(
      readState().leases.find((entry) => entry.task === 'LONG').ttlMinutes
    ).toBe(900);

    expect(cli(['list']).stdout).toMatch(/LONG[\s\S]*900m ttl left/);
    // Above the poll's own 10 s, so a slow run fails in `waitFor`, not in Jest.
  }, 30_000);

  it('gives an exclusive lease a ttl that outlasts a bench run (review M1)', () => {
    expect(
      cli(['acquire', '--task', 'BENCH', '--exclusive', '--config', config])
        .status
    ).toBe(0);
    const bench = readState().leases.find((entry) => entry.task === 'BENCH');
    expect(bench.exclusive).toBe(true);
    expect(bench.ttlMinutes).toBe(EXCLUSIVE_TTL_MINUTES);
    // 14 hours, in the minutes the lease stores.
    expect(bench.ttlMinutes).toBeGreaterThanOrEqual(14 * 60);
  });

  it('still lists leases when there is no device pool at all', () => {
    unlinkSync(config);
    const listed = cli(['list']);
    expect(listed.status).toBe(0);
    expect(listed.stdout).toContain('no leases in');
  });

  it('holds new leases back for a waiting exclusive request (review S4)', async () => {
    expect(cli(['acquire', '--task', 'G6', '--config', config]).status).toBe(0);

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
    // Wait on state: it has written its marker and started waiting.
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
    expect(readState().leases.map((entry) => entry.task)).toEqual(['G6']);

    expect(cli(['release', 'G6']).status).toBe(0);
    const won = await waiting;
    expect(won.code).toBe(0);
    expect(won.stdout).toContain('exclusive)');
    expect(readState().pendingExclusive).toBeUndefined();
    expect(readState().leases[0].task).toBe('B1');
  }, 30_000);

  it('keeps a lock-timeout from ending a wait (review S4)', async () => {
    // The lock times out in 200 ms and the caller waits a minute, so exit 0 means
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

    // Wait until the child says it hit the lock twice: a fixed sleep could remove
    // the lock before the acquire ever reached it. The lock is removed before the
    // release, which would otherwise queue behind it.
    await waitFor(() => (progress.match(/lock busy/g) ?? []).length >= 2);
    unlinkSync(lockFile);
    expect(cli(['release', 'G6']).status).toBe(0);

    const result = await waiting;
    expect(result.stderr).toContain('lock busy');
    expect(result.code).toBe(0);
    expect(readState().leases.map((entry) => entry.task)).toEqual(['G7']);
    // Above `waitFor`'s own 20 s, so a slow run fails there, not in Jest.
  }, 30_000);

  it('hands one stale lock to one stealer, and no pair to both', async () => {
    const lockFile = statePaths(home).lock;
    writeFileSync(lockFile, '999998 1 dead-token\n');
    // A Date, not a number: `utimesSync` reads a number as seconds, so a
    // millisecond figure would land in the far future and the lock would look
    // young.
    const dead = new Date(Date.now() - 120_000);
    utimesSync(lockFile, dead, dead);

    const results = await Promise.all([
      spawnLease(['acquire', '--task', 'G6', '--config', config]),
      spawnLease(['acquire', '--task', 'G7', '--config', config]),
    ]);
    // A failed acquire shows its exit code and why, not just a code.
    expect(
      results.map((entry, index) => ({
        acquire: index,
        code: entry.code,
        ...(entry.code === 0 ? {} : { stderr: entry.stderr }),
      }))
    ).toEqual([
      { acquire: 0, code: 0 },
      { acquire: 1, code: 0 },
    ]);

    const pairs = readState()
      .leases.map((entry) => entry.holds[0])
      .sort();
    expect(pairs).toEqual(['pair-a', 'pair-b']);
    expect(existsSync(lockFile)).toBe(false);
    expect(readdirSync(home).filter((f) => f.includes('.stale-'))).toEqual([]);
  });
});

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
    expect(() => checkEmulatorEnv({ ANDROID_SERIAL: 'emulator-5560' })).toThrow(
      /reserved serial/
    );
    expect(() => checkEmulatorEnv({ EMULATOR_PORT: '5560' })).toThrow(
      /reserved/
    );
    // A network adb address is not a console serial.
    expect(isReservedSerial('10.0.0.5:5555')).toBe(false);
  });

  it('refuses a port the emulator could not take, or a serial that disagrees', () => {
    // 5575 is the adb port of console 5574; `-port` wants the even one.
    expect(() => checkEmulatorEnv({ EMULATOR_PORT: '5575' })).toThrow(
      /console port/
    );
    expect(() => checkEmulatorEnv({ EMULATOR_PORT: 'eleven' })).toThrow(
      /not a port number/
    );
    expect(() =>
      checkEmulatorEnv({
        EMULATOR_PORT: '5574',
        ANDROID_SERIAL: 'emulator-5554',
      })
    ).toThrow(/disagree/);
    // A run with no lease at all, such as a CI job, is legal.
    expect(checkEmulatorEnv({})).toEqual({ port: null, serial: null });
  });

  it('makes the harness boot the AVD on the leased port', () => {
    // The behaviour lives in a dependency patch, so this asks the installed module
    // what it would run.
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
    expect(withoutPort.stdout).not.toContain('-port');
  });
});
