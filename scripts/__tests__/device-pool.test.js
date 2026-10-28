/**
 * The warm device pool (X11): who may power a device off, and when.
 *
 * Every case here exists because a warm pool turns one bug into background load on a shared
 * machine:
 *
 *   - reaping a device a run is using, which shows up as a flake nobody can reproduce;
 *   - never reaping one whose task died, which is the load that moves the *next* task's numbers;
 *   - powering off something outside `devices.json`, which is how a script ends up shutting down
 *     the person's own device (`emulator-5560`);
 *   - a claim that outlives its process, which would wedge a device as "in use" forever.
 *
 * The clock, the load average and the device binaries are all injected, so these cases run the
 * same on a Mac, a Linux runner and a machine with no Android SDK - and, unlike a real boot, they
 * can say "41 minutes have passed" in one line.
 *
 * Numbers are deliberately not round (41 minutes against a 30-minute limit, a 7.5 load against a
 * 5 ceiling): a fixture that coincides with a boundary makes an off-by-one invisible.
 */

import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  IDLE_SHUTDOWN_DEFAULT_MINUTES,
  deviceIsBusy,
  loadSettleCeiling,
  normalizeDevices,
  pidIsAlive,
  poolReapDecision,
} from '../lease-core.mjs';
import {
  DevicePool,
  EXAMPLE_APP_ID,
  claimDevicesFromEnv,
  identifiersForPair,
  pairFromEnv,
  poolKeysForPair,
  poolStatePath,
  readPool,
} from '../device-pool.mjs';

const MINUTE = 60_000;
const NOW = 1_730_000_000_000;

const PAIR_A = {
  id: 'pair-a',
  ios: { udid: 'UDID-A' },
  android: { avd: 'nitro-ui-a', emulatorPort: 5574, adbPort: 5043 },
  metroPort: 8295,
};

const DEVICES = {
  pairs: [
    PAIR_A,
    {
      ...PAIR_A,
      id: 'pair-b',
      ios: { udid: 'UDID-B' },
      android: { ...PAIR_A.android, avd: 'nitro-ui-b' },
    },
  ],
  maxDeviceLeases: 2,
  idleShutdownMinutes: 30,
  reservedEmulatorPorts: [5560],
  reservedIdentifiers: [],
};

/** A live lease holding `pairId`, and an optional in-flight claim. */
function lease(id = 'X1-1', { task = 'X1', pairId = 'pair-a' } = {}) {
  return {
    id,
    task,
    platform: 'both',
    exclusive: false,
    holds: [pairId],
    acquiredAt: NOW,
    ttlMinutes: 240,
  };
}

/**
 * A pool record as the pool would have written it. `bootedAgo` defaults to `usedAgo` because a
 * device cannot have been booted *after* it was last used, and a record that says otherwise reads
 * as freshly started: idleness is measured from the later of the two. That is exactly how this
 * helper first hid a "41 minutes idle" device from the reaper - the fixture said `bootedAt: now`,
 * so the correct answer to the first case below was "keep", and the test was right to be red.
 */
function entryOf({
  key,
  leaseId = 'X1-1',
  bootedAgo = null,
  usedAgo = 0,
  claims = [],
  kind = null,
  id = null,
  idleShutdownMinutes = 30,
}) {
  const [derivedKind, derivedId] = key.split(':');
  return {
    key,
    kind: kind ?? derivedKind,
    id: id ?? derivedId,
    leaseId,
    bootedAtMs: NOW - (bootedAgo ?? usedAgo),
    lastUsedMs: NOW - usedAgo,
    idleShutdownMinutes,
    serial: key.startsWith('avd:') ? 'emulator-5574' : null,
    adbPort: 5043,
    udid: key.startsWith('ios:') ? derivedId : null,
    claims,
  };
}

describe('the reap decision', () => {
  it('powers off a device idle past the limit, lease or no lease', () => {
    const leases = [lease()];
    expect(
      poolReapDecision(
        entryOf({ key: 'avd:nitro-ui-a', usedAgo: 41 * MINUTE }),
        {
          nowMs: NOW,
          leases,
        }
      )
    ).toMatchObject({ action: 'reap', reason: 'idle' });
    expect(
      poolReapDecision(
        entryOf({ key: 'avd:nitro-ui-a', leaseId: null, usedAgo: 41 * MINUTE }),
        {
          nowMs: NOW,
          leases,
        }
      )
    ).toMatchObject({ action: 'reap', reason: 'lease-gone' });
  });

  it('gives a live lease the grace it was promised, and an unowned device the same clock', () => {
    expect(
      poolReapDecision(
        entryOf({ key: 'avd:nitro-ui-a', usedAgo: 12 * MINUTE }),
        {
          nowMs: NOW,
          leases: [lease()],
        }
      )
    ).toMatchObject({ action: 'keep', reason: 'idle-grace', protected: true });
    expect(
      poolReapDecision(
        entryOf({ key: 'avd:nitro-ui-a', leaseId: null, usedAgo: 12 * MINUTE }),
        { nowMs: NOW, leases: [] }
      )
    ).toMatchObject({ action: 'keep', reason: 'unowned-grace' });
  });

  it('never reaps a device whose claim is live, however idle the clock says it is', () => {
    // The pid check is the whole protocol: a 50-minute run whose last write was at the start is
    // "idle" to a timestamp and very much in use to the process holding it.
    const busy = entryOf({
      key: 'avd:nitro-ui-a',
      usedAgo: 90 * MINUTE,
      claims: [
        { pid: 4242, id: 'a', gate: 'harness:android', at: NOW - 90 * MINUTE },
      ],
    });
    expect(
      poolReapDecision(busy, {
        nowMs: NOW,
        leases: [lease()],
        isPidAlive: () => true,
      })
    ).toMatchObject({ action: 'keep', reason: 'busy', protected: true });
  });

  it('treats a claim from a dead pid as no claim at all', () => {
    const stale = entryOf({
      key: 'avd:nitro-ui-a',
      usedAgo: 41 * MINUTE,
      claims: [
        { pid: 4242, id: 'a', gate: 'harness:android', at: NOW - 41 * MINUTE },
      ],
    });
    expect(
      poolReapDecision(stale, {
        nowMs: NOW,
        leases: [lease()],
        isPidAlive: () => false,
      })
    ).toMatchObject({ action: 'reap', reason: 'idle' });
    expect(deviceIsBusy({ claims: [{ pid: 1 }] }, NOW, () => false)).toBe(
      false
    );
  });

  it('counts idleness from the last release, not from boot', () => {
    // A run that booted the device 80 minutes ago and released 2 minutes ago is not due for
    // shutdown: measured from boot it would be reaped the moment it finished.
    expect(
      poolReapDecision(
        entryOf({
          key: 'avd:nitro-ui-a',
          bootedAgo: 80 * MINUTE,
          usedAgo: 2 * MINUTE,
        }),
        { nowMs: NOW, leases: [lease()] }
      )
    ).toMatchObject({ action: 'keep', reason: 'idle-grace' });
  });

  it('is honest about the process table it reads', () => {
    expect(pidIsAlive(process.pid)).toBe(true);
    expect(pidIsAlive(-1)).toBe(false);
    expect(pidIsAlive(undefined)).toBe(false);
    expect(pidIsAlive(2_147_483_646)).toBe(false);
  });

  it('takes its limit from devices.json, including a limit of zero', () => {
    const parsed = normalizeDevices({
      pairs: [
        {
          id: 'pair-a',
          ios: { udid: 'U' },
          android: { avd: 'A', emulatorPort: 5574 },
          metroPort: 8295,
        },
      ],
      idleShutdownMinutes: 0,
    });
    expect(parsed.idleShutdownMinutes).toBe(0);
    // `0` has to mean "as soon as a run lets go", so the check cannot be truthiness.
    expect(
      poolReapDecision(
        // `null`, not `undefined`: a record the pool wrote from a config with no limit stores
        // null, and the decision has to fall through to the caller's default (here: zero).
        entryOf({ key: 'avd:A', usedAgo: MINUTE, idleShutdownMinutes: null }),
        {
          nowMs: NOW,
          leases: [lease()],
          defaultIdleMinutes: parsed.idleShutdownMinutes,
        }
      )
    ).toMatchObject({ action: 'reap' });
    expect(
      normalizeDevices({
        pairs: [
          {
            id: 'p',
            metroPort: 8295,
            android: { avd: 'A', emulatorPort: 5574 },
          },
        ],
      }).idleShutdownMinutes
    ).toBe(IDLE_SHUTDOWN_DEFAULT_MINUTES);
  });
});

describe('the settle ceiling', () => {
  it('is the bench ceiling, not a made-up number', () => {
    expect(loadSettleCeiling(10)).toBe(5);
    // Never below 1: a 2-core runner would otherwise wait for a load no busy machine ever reaches.
    expect(loadSettleCeiling(1)).toBe(1);
    expect(loadSettleCeiling(16)).toBe(8);
  });
});

describe('pool keys', () => {
  it('names each device of a pair, and only the platform being run', () => {
    expect(poolKeysForPair(PAIR_A)).toEqual(['avd:nitro-ui-a', 'ios:UDID-A']);
    expect(identifiersForPair(PAIR_A, 'android')).toEqual(['avd:nitro-ui-a']);
    expect(identifiersForPair(PAIR_A, 'ios')).toEqual(['ios:UDID-A']);
  });

  it('carries the adb server with the device, from the lease env', () => {
    const pair = pairFromEnv({
      ANDROID_AVD: 'nitro-ui-a',
      EMULATOR_PORT: '5574',
      ANDROID_ADB_SERVER_PORT: '5043',
      IOS_SIM_UDID: 'UDID-A',
    });
    // The serial comes with it (from the port when the env does not name one), because a claim
    // that records no serial is a device the pool cannot power off.
    expect(pair.android).toEqual({
      avd: 'nitro-ui-a',
      emulatorPort: 5574,
      adbPort: 5043,
      serial: 'emulator-5574',
    });
    // An env with no lease in it names nothing, so a claim from a unit test is a no-op.
    expect(poolKeysForPair(pairFromEnv({}))).toEqual([]);
  });
});

/**
 * A pool with its device operations and clock replaced: `state` is what `adb devices` /
 * `simctl list` report, and every call is recorded so a test can say "nothing was shut down"
 * instead of inferring it from a file.
 *
 * **The injected `sleep` advances the injected clock**, because a real one does. A fixed clock
 * with a no-op sleep makes every wait loop unbounded - which is how this helper first presented:
 * as an out-of-memory crash, from a loop appending to the call log tens of millions of times.
 * Advancing the clock per sleep is what lets "the device never came up" finish in 210 iterations
 * and be asserted, instead of being a hang a reviewer has to find by hand.
 */
function fakePool({
  home,
  state = {},
  devices = DEVICES,
  load = () => 0.5,
  cores = 10,
  isPidAlive = () => false,
  start = NOW,
  env = {},
} = {}) {
  const deviceState = {
    serials: [],
    simulators: new Map(),
    bootComplete: true,
    emulatorBoots: true,
    simulatorBoots: true,
    appDataCleared: true,
    shutdownWorks: true,
    ...state,
  };
  const calls = [];
  const clock = { at: start };
  const ops = {
    attachedSerials: (port) => {
      calls.push(['attachedSerials', port ?? null]);
      return deviceState.serials;
    },
    bootComplete: (serial, port) => {
      calls.push(['bootComplete', serial, port ?? null]);
      return !!deviceState.bootComplete && deviceState.serials.includes(serial);
    },
    clearAppData: (serial, appId, port) => {
      calls.push(['pm', 'clear', serial, appId, port ?? null]);
      // `pm clear` answers `Success` or `Failed`, and the second one is the interesting
      // fixture: a reset that reports itself done on a device it never cleared is how a
      // task starts on the previous task's stored state.
      return deviceState.appDataCleared;
    },
    shutdownAndroid: (serial, port) => {
      calls.push(['emu-kill', serial, port ?? null]);
      return deviceState.shutdownWorks;
    },
    bootEmulator: (spec) => {
      calls.push(['boot-emulator', spec]);
      return deviceState.emulatorBoots;
    },
    bootedSimulators: () => {
      calls.push(['booted-sims']);
      return [...deviceState.simulators.entries()]
        .filter(([, s]) => s === 'Booted')
        .map(([udid]) => udid);
    },
    simulators: () => deviceState.simulators,
    bootSimulator: (udid) => {
      calls.push(['boot-sim', udid]);
      return deviceState.simulatorBoots;
    },
    shutdownSimulator: (udid) => {
      calls.push(['shutdown-sim', udid]);
      return deviceState.shutdownWorks;
    },
  };
  const logs = [];
  const pool = new DevicePool({
    home,
    env,
    devices,
    ops,
    log: (m) => logs.push(String(m)),
    now: () => clock.at,
    readLoad: load,
    cores,
    sleep: (ms) => {
      clock.at += ms;
    },
    isPidAlive,
  });
  return { pool, calls, logs, ops, clock, state: deviceState };
}

describe('the pool state file', () => {
  let home;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'nitro-ui-pool-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('records a pair as warm, on the lease that took it', () => {
    const { pool } = fakePool({ home });
    pool.notePair(PAIR_A, lease(), { booted: ['avd:nitro-ui-a'] });
    const state = readPool(home);
    expect(state.devices.map((x) => x.key)).toEqual([
      'avd:nitro-ui-a',
      'ios:UDID-A',
    ]);
    expect(state.devices[0]).toMatchObject({
      leaseId: 'X1-1',
      serial: 'emulator-5574',
      adbPort: 5043,
      idleShutdownMinutes: 30,
    });
    // Only the device this call actually started gets a fresh clock: a warm hand-off must not
    // restart the idle timer of the device it merely reused.
    expect(state.devices.find((x) => x.kind === 'ios').bootedAtMs).toBe(NOW);
    expect(existsPoolFile(home)).toBe(true);
  });

  it('keeps the older clock for a device it did not boot', () => {
    fakePool({ home, start: NOW - 20 * MINUTE }).pool.notePair(
      PAIR_A,
      lease(),
      {
        booted: ['avd:nitro-ui-a'],
      }
    );
    fakePool({ home, start: NOW }).pool.notePair(PAIR_A, lease(), {
      booted: [],
    });
    const state = readPool(home);
    expect(
      state.devices.find((x) => x.key === 'avd:nitro-ui-a').bootedAtMs
    ).toBe(NOW - 20 * MINUTE);
    expect(state.devices.find((x) => x.key === 'ios:UDID-A').bootedAtMs).toBe(
      NOW - 20 * MINUTE
    );
  });

  it('refuses to manage a device on a reserved serial', () => {
    const { pool } = fakePool({ home });
    expect(() =>
      pool.notePair(
        {
          ...PAIR_A,
          android: { avd: 'human', emulatorPort: 5560, adbPort: 5037 },
        },
        lease()
      )
    ).toThrow(/reserved/);
  });

  it('survives a pool.json written by nobody at all, and keeps the evidence', () => {
    writeFileSync(join(home, 'pool.json'), 'not json');
    // Read into a variable: recovery moves the bad file aside, so a second read would see a
    // clean empty pool (the other half of the behaviour, asserted at the end).
    let read;
    expect(() => {
      read = readPool(home);
    }).not.toThrow();
    expect(read.devices).toEqual([]);
    // Moved aside, not overwritten or ignored: that file is the only record of what was booted
    // and by whom, and a pool that silently starts empty loses two warm devices without saying
    // so - which reads as "nothing to reap" and leaves them running for the rest of the day.
    expect(typeof read.recovered?.reason).toBe('string');
    const kept = readdirSync(home).filter((f) =>
      f.startsWith('pool.json.corrupt-')
    );
    expect(kept).toHaveLength(1);
    expect(readFileSync(join(home, kept[0]), 'utf8')).toBe('not json');
    // And the file is gone from the path the pool writes to, so the next command starts clean
    // instead of failing the same way all afternoon.
    expect(readPool(home).devices).toEqual([]);
  });
});

describe('reaping', () => {
  let home;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'nitro-ui-reap-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const withDevice = (entry) => {
    writeFileSync(
      join(home, 'pool.json'),
      JSON.stringify({ version: 1, devices: [entry] }, null, 2)
    );
  };
  const withLeases = (leases) => {
    writeFileSync(
      join(home, 'leases.json'),
      JSON.stringify({ leases }, null, 2)
    );
  };

  it('powers off an idle device and stops tracking it', () => {
    withLeases([lease()]);
    withDevice(entryOf({ key: 'avd:nitro-ui-a', usedAgo: 41 * MINUTE }));
    const { pool, calls } = fakePool({
      home,
      state: { serials: ['emulator-5574'], simulators: new Map() },
    });
    const done = pool.reap();
    expect(done.reaped).toEqual([{ key: 'avd:nitro-ui-a', reason: 'idle' }]);
    // The private adb server is named on the way to the device: asking the default server would
    // be asking about an emulator it has never seen.
    expect(calls).toContainEqual(['emu-kill', 'emulator-5574', 5043]);
    expect(readPool(home).devices).toEqual([]);
  });

  it('leaves a device alone while a live claim holds it', () => {
    withLeases([lease()]);
    withDevice(
      entryOf({
        key: 'avd:nitro-ui-a',
        usedAgo: 300 * MINUTE,
        claims: [{ pid: 4242, id: 'a', gate: 'harness:android', at: NOW }],
      })
    );
    const { pool, calls } = fakePool({
      home,
      state: { serials: ['emulator-5574'], simulators: new Map() },
      isPidAlive: (pid) => pid === 4242,
    });
    expect(pool.reap().kept).toEqual([
      { key: 'avd:nitro-ui-a', reason: 'busy', idleMinutes: 300 },
    ]);
    expect(calls.filter((c) => c[0] === 'emu-kill')).toEqual([]);
    // Still listed, because it is still up and the next `list` should say so.
    expect(readPool(home).devices).toHaveLength(1);
  });

  it('never shuts down a device that is not in devices.json', () => {
    withLeases([]);
    withDevice(
      entryOf({
        key: 'avd:somebody-elses',
        usedAgo: 90 * MINUTE,
        id: 'somebody-elses',
      })
    );
    const { pool, calls } = fakePool({
      home,
      state: { serials: ['emulator-5574'], simulators: new Map() },
    });
    const done = pool.reap();
    expect(done.refused).toEqual([
      { key: 'avd:somebody-elses', why: 'not in devices.json' },
    ]);
    expect(calls.filter((c) => c[0] === 'emu-kill')).toEqual([]);
  });

  it('never shuts down the reserved serial, even if the state somehow names it', () => {
    withLeases([]);
    withDevice({
      ...entryOf({ key: 'avd:nitro-ui-a', usedAgo: 90 * MINUTE }),
      serial: 'emulator-5560',
    });
    const { pool, calls } = fakePool({
      home,
      state: { serials: ['emulator-5560'], simulators: new Map() },
    });
    const done = pool.reap();
    expect(done.refused[0]).toMatchObject({ serial: 'emulator-5560' });
    expect(calls.filter((c) => c[0] === 'emu-kill')).toEqual([]);
  });

  it('shuts down an idle simulator the same way', () => {
    withLeases([lease()]);
    withDevice(entryOf({ key: 'ios:UDID-A', usedAgo: 41 * MINUTE }));
    const { pool, calls } = fakePool({
      home,
      state: { serials: [], simulators: new Map([['UDID-A', 'Booted']]) },
    });
    expect(pool.reap().reaped).toEqual([{ key: 'ios:UDID-A', reason: 'idle' }]);
    expect(calls).toContainEqual(['shutdown-sim', 'UDID-A']);
  });

  it('forgets a device it finds already off, rather than retrying forever', () => {
    withLeases([]);
    withDevice(entryOf({ key: 'ios:UDID-A', usedAgo: 41 * MINUTE }));
    const { pool, calls } = fakePool({
      home,
      state: { serials: [], simulators: new Map([['UDID-A', 'Shutdown']]) },
    });
    expect(pool.reap().alreadyOff).toEqual([{ key: 'ios:UDID-A' }]);
    expect(calls.filter((c) => c[0] === 'shutdown-sim')).toEqual([]);
    expect(readPool(home).devices).toEqual([]);
  });

  it('powers off everything named for the hand-off, idle or not', () => {
    // `--exclusive` (a bench) needs a quiet machine *now*, and a device that is 4 minutes into a
    // 30-minute clock is still load it would be measuring next to.
    withLeases([]);
    withDevice(entryOf({ key: 'avd:nitro-ui-a', usedAgo: 4 * MINUTE }));
    const { pool, calls } = fakePool({
      home,
      state: { serials: ['emulator-5574'], simulators: new Map() },
    });
    expect(
      pool.reap({
        shutdownKeys: ['avd:nitro-ui-a'],
        reason: 'exclusive acquire',
      }).reaped
    ).toEqual([{ key: 'avd:nitro-ui-a', reason: 'unowned-grace' }]);
    expect(calls).toContainEqual(['emu-kill', 'emulator-5574', 5043]);
  });

  it('keeps a device it could not power off, and says it failed', () => {
    // An emulator that ignores `emu kill` is not hypothetical (a wedged guest keeps the process
    // up), and the honest answer is "still running, still mine, try again" - dropping the record
    // would leave a live device nobody tracks, off every idle clock, for the rest of the session.
    withLeases([lease()]);
    withDevice(entryOf({ key: 'avd:nitro-ui-a', usedAgo: 41 * MINUTE }));
    const { pool, calls } = fakePool({
      home,
      state: { serials: ['emulator-5574'], shutdownWorks: false },
    });
    const done = pool.reap();
    expect(done.failed).toEqual([{ key: 'avd:nitro-ui-a', reason: 'idle' }]);
    expect(done.reaped).toEqual([]);
    expect(calls.filter((c) => c[0] === 'emu-kill')).toHaveLength(1);
    expect(readPool(home).devices).toHaveLength(1);
  });

  it('refuses to reap anything when no devices.json was loaded', () => {
    withLeases([]);
    withDevice(entryOf({ key: 'avd:nitro-ui-a', usedAgo: 900 * MINUTE }));
    const { pool, calls } = fakePool({
      home,
      devices: null,
      state: { serials: ['emulator-5574'], simulators: new Map() },
    });
    expect(pool.reap().skipped).toMatch(/devices.json/);
    expect(calls.filter((c) => c[0] === 'emu-kill')).toEqual([]);
    expect(readPool(home).devices).toHaveLength(1);
  });
});

describe('claims', () => {
  let home;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'nitro-ui-claim-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('refuses a device another live pid holds, and names it', () => {
    const { pool } = fakePool({ home, isPidAlive: (pid) => pid === 4242 });
    pool.claim({
      pair: PAIR_A,
      platform: 'android',
      pid: 4242,
      gate: 'harness:android',
    });
    expect(() =>
      pool.claim({
        pair: PAIR_A,
        platform: 'android',
        pid: 99,
        gate: 'real-input:android',
      })
    ).toThrow(/pid 4242 \(harness:android\)/);
    // The refused claim leaves nothing behind: a half-taken claim would block the next attempt too.
    expect(
      readPool(home).devices.find((x) => x.key === 'avd:nitro-ui-a').claims
    ).toHaveLength(1);
  });

  it('takes a busy device anyway when forced, and says so', () => {
    const { pool, logs } = fakePool({
      home,
      isPidAlive: (pid) => pid === 4242,
    });
    pool.claim({
      pair: PAIR_A,
      platform: 'android',
      pid: 4242,
      gate: 'harness:android',
    });
    const taken = pool.claim({
      pair: PAIR_A,
      platform: 'android',
      pid: 99,
      gate: 'example:android',
      force: true,
    });
    expect(taken.conflicts).toHaveLength(1);
    expect(logs.join('\n')).toContain('--device-force');
  });

  it('ignores a claim whose process is gone', () => {
    const { pool } = fakePool({ home, isPidAlive: () => false });
    pool.claim({
      pair: PAIR_A,
      platform: 'android',
      pid: 4242,
      gate: 'harness:android',
    });
    expect(() =>
      pool.claim({
        pair: PAIR_A,
        platform: 'android',
        pid: 99,
        gate: 'harness:android',
      })
    ).not.toThrow();
    // Dead claims are dropped, not counted: the file must not accumulate a device held forever.
    expect(
      readPool(home).devices.find((x) => x.key === 'avd:nitro-ui-a').claims
    ).toHaveLength(1);
  });

  it('starts the idle clock when the last claim is released', () => {
    const { pool } = fakePool({ home, isPidAlive: () => true });
    const claim = pool.claim({ pair: PAIR_A, platform: 'android', pid: 4242 });
    const written = readPool(home).devices.find(
      (x) => x.key === 'avd:nitro-ui-a'
    ).lastUsedMs;
    expect(written).toBe(NOW);
    expect(claim.keys).toEqual(['avd:nitro-ui-a']);
    pool.releaseClaim(claim);
    expect(
      readPool(home).devices.find((x) => x.key === 'avd:nitro-ui-a').claims
    ).toEqual([]);
  });

  it('does nothing when the environment names no devices', () => {
    const { pool } = fakePool({ home });
    expect(pool.claim({ pair: pairFromEnv({}), platform: 'both' })).toBeNull();
  });
});

/**
 * The gate's side of the protocol: `gate.mjs` claims through this helper, so the platform it
 * passes - not just the lease - decides which device ends up marked in use.
 */
describe('claiming from the lease environment', () => {
  let home;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'nitro-ui-envclaim-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const leaseEnv = {
    NITRO_UI_LEASE_ID: 'X11-1',
    NITRO_UI_LEASE_PLATFORM: 'both',
    IOS_SIM_UDID: 'UDID-A',
    ANDROID_AVD: 'nitro-ui-a',
    EMULATOR_PORT: '5574',
    ANDROID_ADB_SERVER_PORT: '5043',
  };

  const build = (over = {}) =>
    new DevicePool({
      home,
      env: {},
      devices: DEVICES,
      // The pool a claim goes through; ops are irrelevant here (a claim writes state, it never
      // touches a device), so an empty one keeps the case about the keys.
      ops: {},
      log: () => {},
      now: () => NOW,
      isPidAlive: () => false,
      ...over,
    });

  it('claims only the platform the gate is running', () => {
    const claim = claimDevicesFromEnv({
      pool: build(),
      env: leaseEnv,
      platform: 'ios',
      gate: 'harness:ios',
    });
    // An iOS harness run under a `both` lease must not mark the emulator busy: the next task's
    // Android run would be refused a device nobody is using.
    expect(claim.keys).toEqual(['ios:UDID-A']);
    expect(claim.pool).toBeDefined();
    expect(() => claim.pool.releaseClaim(claim)).not.toThrow();
    expect(
      readPool(home).devices.find((x) => x.key === 'ios:UDID-A').claims
    ).toEqual([]);
  });

  it('claims both when the gate runs both', () => {
    const claim = claimDevicesFromEnv({ pool: build(), env: leaseEnv });
    expect(claim.keys.sort()).toEqual(['avd:nitro-ui-a', 'ios:UDID-A']);
  });

  it('claims nothing when the environment names no lease', () => {
    // `bun run check`, a unit test, a CI runner: no lease in the environment, so the whole
    // claim/release path must be a no-op rather than a half-named pair.
    expect(claimDevicesFromEnv({ pool: build(), env: {} })).toBeNull();
  });

  it('refuses a device a live run already holds, and names the gate', () => {
    const pool = build({ isPidAlive: (pid) => pid === 4242 });
    claimDevicesFromEnv({
      pool,
      env: leaseEnv,
      platform: 'android',
      gate: 'harness:android',
      force: false,
      ...{},
    });
    pool.claim({
      pair: pairFromEnv(leaseEnv),
      platform: 'android',
      pid: 4242,
      gate: 'real-input:android',
    });
    expect(() =>
      claimDevicesFromEnv({
        pool,
        env: leaseEnv,
        platform: 'android',
        gate: 'harness:android',
      })
    ).toThrow(/real-input:android/);
  });
});

describe('booting a pair', () => {
  let home;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'nitro-ui-boot-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('reuses a device that is already up instead of paying for a boot', () => {
    const { pool, calls } = fakePool({
      home,
      state: {
        serials: ['emulator-5574'],
        simulators: new Map([['UDID-A', 'Booted']]),
      },
    });
    const result = pool.ensureBooted(PAIR_A, lease());
    expect(result.booted).toEqual([]);
    expect(result.already.sort()).toEqual(['avd:nitro-ui-a', 'ios:UDID-A']);
    expect(calls.filter((c) => c[0] === 'boot-emulator')).toEqual([]);
    expect(calls.filter((c) => c[0] === 'boot-sim')).toEqual([]);
  });

  it('boots what is down, waits for it, and waits for the machine to settle', () => {
    const loads = [12, 9, 3];
    const { pool, calls, logs, clock, state } = fakePool({
      home,
      load: () => (loads.length > 1 ? loads.shift() : loads[0]),
    });
    // Nothing is up to begin with, and the devices only *appear* in `adb devices` / `simctl list`
    // after the first wait: a pool that assumed a boot had finished the moment it asked would
    // hand back a "warm pair" that does not exist yet.
    const realSleep = pool.sleep;
    pool.sleep = (ms) => {
      realSleep(ms);
      state.serials = ['emulator-5574'];
      state.simulators = new Map([['UDID-A', 'Booted']]);
    };
    const result = pool.ensureBooted(PAIR_A, lease());
    expect(calls).toContainEqual([
      'boot-emulator',
      { avd: 'nitro-ui-a', port: 5574 },
    ]);
    expect(calls).toContainEqual(['boot-sim', 'UDID-A']);
    expect(result.booted.sort()).toEqual(['avd:nitro-ui-a', 'ios:UDID-A']);
    expect(result.degraded).toEqual([]);
    expect(result.loadSettled).toBe(true);
    expect(result.load).toBe(3);
    // The boot and the settle wait both happened, so time moved: 4 s polling for the devices,
    // then 2 s per load sample. A zero wait would mean the numbers above came from nowhere.
    expect(clock.at - NOW).toBeGreaterThan(4000);
    expect(logs.join('\n')).toContain('booting android device nitro-ui-a:5574');
  });

  it('reports a device that never comes up instead of hanging the lease', () => {
    const { pool, logs, clock } = fakePool({ home });
    const result = pool.ensureBooted(PAIR_A, lease(), { timeoutMs: 60_000 });
    expect(result.degraded.sort()).toEqual(['avd:nitro-ui-a', 'ios:UDID-A']);
    expect(logs.join('\n')).toContain('did not settle');
    expect(logs.join('\n')).toContain('booting ios device UDID-A');
    // Bounded, not endless: the lease caller gets an answer in about a minute of fake time.
    expect(clock.at - NOW).toBeLessThanOrEqual(200_000);
  });

  it('does not wait for a device the boot tool refused outright', () => {
    // A mistyped AVD name in devices.json, or no emulator on PATH: `emulator` exits at once and
    // polling `adb devices` for seven minutes for something that never started is how a lease
    // command looks hung.
    const { pool, logs, clock } = fakePool({
      home,
      state: { emulatorBoots: false, simulatorBoots: false },
    });
    const result = pool.ensureBooted(PAIR_A, lease(), { timeoutMs: 60_000 });
    expect(result.booted).toEqual([]);
    expect(result.degraded.sort()).toEqual(['avd:nitro-ui-a', 'ios:UDID-A']);
    expect(logs.join('\n')).toContain('refused');
    expect(clock.at - NOW).toBe(0);
  });

  it('goes on with a warning when the load will not settle', () => {
    const { pool, logs } = fakePool({
      home,
      state: {
        serials: ['emulator-5574'],
        simulators: new Map([['UDID-A', 'Booted']]),
      },
      load: () => 22,
      now: (
        (t) => () =>
          (t += 5_000)
      )(NOW),
    });
    const result = pool.ensureBooted(PAIR_A, lease());
    expect(result.loadSettled).toBe(false);
    expect(logs.join('\n')).toContain('still above the settle ceiling');
  });
});

describe('the between-task reset', () => {
  let home;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'nitro-ui-reset-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('clears the example app on the emulator, on its own adb server', () => {
    const { pool, calls } = fakePool({ home });
    const results = pool.resetPair(PAIR_A);
    expect(calls).toContainEqual([
      'pm',
      'clear',
      'emulator-5574',
      EXAMPLE_APP_ID.android,
      5043,
    ]);
    expect(results.find((r) => r.key === 'avd:nitro-ui-a').ok).toBe(true);
  });

  it('says what iOS actually does rather than reporting a reset that never happened', () => {
    const { pool, calls } = fakePool({ home });
    const ios = pool.resetPair(PAIR_A).find((r) => r.key === 'ios:UDID-A');
    expect(ios.ok).toBe(true);
    expect(ios.action).toMatch(/install/);
    expect(calls.filter((c) => c[0] === 'pm')).toHaveLength(1);
  });

  it('reports a `pm clear` that failed as a failed reset', () => {
    const { pool, calls } = fakePool({
      home,
      state: { appDataCleared: false },
    });
    const results = pool.resetPair(PAIR_A);
    expect(results.find((r) => r.key === 'avd:nitro-ui-a').ok).toBe(false);
    // Asked, and refused: the difference between "no reset needed" and "the reset did not work"
    // is only visible if the attempt is recorded as well as its answer.
    expect(calls.filter((c) => c[0] === 'pm')).toHaveLength(1);
  });

  it('fails the reset rather than reporting one on a device with no serial', () => {
    const { pool } = fakePool({ home });
    const results = pool.resetPair({
      ...PAIR_A,
      android: { avd: 'nitro-ui-a' },
    });
    expect(results.find((r) => r.key === 'avd:nitro-ui-a').ok).toBe(false);
  });
});

describe('list', () => {
  let home;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'nitro-ui-list-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('says who holds each warm device and how long it has been idle', () => {
    writeFileSync(
      join(home, 'leases.json'),
      JSON.stringify({ leases: [lease('X1-1', { task: 'X11' })] })
    );
    fakePool({ home }).pool.notePair(PAIR_A, lease('X1-1', { task: 'X11' }));
    const rows = fakePool({ home, isPidAlive: () => false }).pool.summary();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      leaseTask: 'X11',
      busy: false,
      idleMinutes: 0,
    });
    expect(existsPoolFile(home)).toBe(true);
  });
});

function existsPoolFile(home) {
  try {
    return (
      JSON.parse(readFileSync(poolStatePath(home), 'utf8')).devices.length > 0
    );
  } catch {
    return false;
  }
}
