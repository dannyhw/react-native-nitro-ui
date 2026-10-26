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
  copyFileSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_MAX_DEVICE_LEASES,
  RESERVED_EMULATOR_PORTS,
  activeLeases,
  assertLeasable,
  decideAcquire,
  emulatorSerial,
  identifiersFor,
  normalizeDevices,
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
  };
  return {
    fs,
    files,
    advance: (ms) => {
      now += ms;
      for (const entry of files.values()) entry.mtimeMs = now;
    },
    hold: (file) => files.set(file, { mtimeMs: now, contents: 'other 123' }),
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
    files.set(holder, { mtimeMs: -60_000, contents: 'dead 99' });
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
        ...env,
      },
    });

  /**
   * `cli`, but concurrently: a promise of `{code, stdout, stderr}`. The race
   * and the wait-then-succeed cases need children that actually run at the same
   * time, which `spawnSync` in a loop does not give them.
   */
  const spawnLease = (args, env = {}) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [CLI, ...args], {
        env: {
          ...process.env,
          NITRO_UI_HOME: home,
          NITRO_UI_LEASE_POLL_MS: '50',
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
    // Long enough for the child to see G6 and enter the poll loop (50 ms there),
    // then hand the machine over: the point is that it waits and then wins.
    await new Promise((resolve) => setTimeout(resolve, 400));
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
        env: { ...process.env, NITRO_UI_HOME: join(home, 'missing') },
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
});
