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
  BOOTING_PROTECTION_MS,
  IDLE_SHUTDOWN_DEFAULT_MINUTES,
  deviceIsBusy,
  loadSettleCeiling,
  normalizeDevices,
  pidIsAlive,
  poolReapDecision,
  withLock,
} from '../lease-core.mjs';
import {
  DevicePool,
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
      // Its own console port and adb server, not pair-a's: with a shared serial, a reaper that
      // kills the serial it read instead of the pair's own would be invisible.
      android: { avd: 'nitro-ui-b', emulatorPort: 5576, adbPort: 5045 },
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
 * A pool record as the pool would have written it. `bootedAgo` defaults to `usedAgo`: idleness
 * is measured from the later of the two, so a later boot would read as freshly started.
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
  serial,
  adbPort,
  phase,
}) {
  const [derivedKind, derivedId] = key.split(':');
  const pair = DEVICES.pairs.find((p) =>
    derivedKind === 'ios'
      ? p.ios?.udid === derivedId
      : p.android?.avd === derivedId
  );
  return {
    key,
    kind: kind ?? derivedKind,
    id: id ?? derivedId,
    leaseId,
    bootedAtMs: NOW - (bootedAgo ?? usedAgo),
    lastUsedMs: NOW - usedAgo,
    idleShutdownMinutes,
    serial:
      serial ??
      (derivedKind === 'ios'
        ? null
        : pair?.android?.emulatorPort != null
          ? `emulator-${pair.android.emulatorPort}`
          : 'emulator-5574'),
    adbPort: adbPort ?? pair?.android?.adbPort ?? 5043,
    udid: derivedKind === 'ios' ? derivedId : null,
    claims,
    ...(phase != null ? { phase, phaseAtMs: NOW - 30_000 } : {}),
  };
}

describe('the reap decision', () => {
  it('powers off an idle device that no lease holds', () => {
    const leases = [lease('X1-1', { pairId: 'pair-b' })];
    expect(
      poolReapDecision(
        entryOf({ key: 'avd:nitro-ui-a', leaseId: null, usedAgo: 41 * MINUTE }),
        {
          nowMs: NOW,
          leases,
        }
      )
    ).toMatchObject({ action: 'reap', reason: 'lease-gone' });
    // A record naming a lease that is no longer in the file is the same case.
    expect(
      poolReapDecision(
        entryOf({
          key: 'avd:nitro-ui-a',
          leaseId: 'gone',
          usedAgo: 41 * MINUTE,
        }),
        { nowMs: NOW, leases }
      )
    ).toMatchObject({ action: 'reap', reason: 'lease-gone' });
  });

  it('never powers off a device a live lease holds, however idle it is', () => {
    const held = entryOf({ key: 'avd:nitro-ui-a', usedAgo: 31 * MINUTE });
    expect(
      poolReapDecision(held, { nowMs: NOW, leases: [lease()] })
    ).toMatchObject({ action: 'keep', reason: 'lease-held', protected: true });
    // The operator's `--idle-minutes 0` does not reach it either.
    expect(
      poolReapDecision(held, {
        nowMs: NOW,
        leases: [lease()],
        overrideIdleMinutes: 0,
      })
    ).toMatchObject({ action: 'keep', reason: 'lease-held', protected: true });
  });

  it('reaps a leased device whose lease has expired', () => {
    const staleLease = { ...lease(), acquiredAt: NOW - 300 * MINUTE };
    expect(
      poolReapDecision(
        entryOf({ key: 'avd:nitro-ui-a', usedAgo: 41 * MINUTE }),
        {
          nowMs: NOW,
          leases: [staleLease],
        }
      )
    ).toMatchObject({ action: 'reap', reason: 'lease-gone' });
  });

  it('protects a device that is booting, before anyone has used it', () => {
    // A booting record still carries the previous holder's timestamps, which can already be
    // past the idle limit.
    expect(
      poolReapDecision(
        entryOf({
          key: 'avd:nitro-ui-a',
          leaseId: null,
          usedAgo: 300 * MINUTE,
          phase: 'booting',
        }),
        { nowMs: NOW, leases: [] }
      )
    ).toMatchObject({ action: 'keep', reason: 'booting', protected: true });
  });

  it('gives an unleased device the grace it was promised', () => {
    expect(
      poolReapDecision(
        entryOf({ key: 'avd:nitro-ui-a', leaseId: null, usedAgo: 12 * MINUTE }),
        { nowMs: NOW, leases: [] }
      )
    ).toMatchObject({ action: 'keep', reason: 'unowned-grace' });
  });

  it('never reaps a device whose claim is live, however idle the clock says it is', () => {
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
    // Unleased, because a live lease protects its device whatever the claims say.
    const stale = entryOf({
      key: 'avd:nitro-ui-a',
      leaseId: null,
      usedAgo: 41 * MINUTE,
      claims: [
        { pid: 4242, id: 'a', gate: 'harness:android', at: NOW - 41 * MINUTE },
      ],
    });
    expect(
      poolReapDecision(stale, {
        nowMs: NOW,
        leases: [],
        isPidAlive: () => false,
      })
    ).toMatchObject({ action: 'reap', reason: 'lease-gone' });
    expect(deviceIsBusy({ claims: [{ pid: 1 }] }, NOW, () => false)).toBe(
      false
    );
  });

  it('counts idleness from the last release, not from boot', () => {
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
        // `null`, not `undefined`: a record written from a config with no limit stores null.
        // Unleased, because a live lease would protect the device on the clock.
        entryOf({
          key: 'avd:A',
          leaseId: null,
          usedAgo: MINUTE,
          idleShutdownMinutes: null,
        }),
        {
          nowMs: NOW,
          leases: [],
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

  it('lets an explicit override outrank the record, including a zero', () => {
    // The record says 30. An override of 0 is the CLI's `--idle-minutes 0`.
    const entry = entryOf({ key: 'avd:A', usedAgo: MINUTE });
    expect(
      poolReapDecision(entry, {
        nowMs: NOW,
        leases: [],
        defaultIdleMinutes: 30,
        overrideIdleMinutes: 0,
      })
    ).toMatchObject({ action: 'reap', reason: 'lease-gone' });
    // Without the override, the same record at the same age is in its grace period.
    expect(
      poolReapDecision(entry, {
        nowMs: NOW,
        leases: [],
        defaultIdleMinutes: 30,
      })
    ).toMatchObject({ action: 'keep', reason: 'unowned-grace' });
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
 * `simctl list` report, and every call is recorded. The injected `sleep` advances the injected
 * clock, as a real one does; with a fixed clock every wait loop would be unbounded.
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
    /**
     * The same listing, with whether the server answered. `adbFails: true` is a wedged server:
     * killed at its timeout with no stdout, which looks like "no emulator attached".
     */
    attachedSerialsResult: (port) => {
      calls.push(['attachedSerials', port ?? null]);
      return deviceState.adbFails
        ? { ok: false, serials: [], answer: "ADB server didn't ACK" }
        : { ok: true, serials: deviceState.serials, answer: 'ok' };
    },
    bootComplete: (serial, port) => {
      calls.push(['bootComplete', serial, port ?? null]);
      return !!deviceState.bootComplete && deviceState.serials.includes(serial);
    },
    shutdownAndroid: (serial, port) => {
      calls.push(['emu-kill', serial, port ?? null]);
      return deviceState.shutdownWorks;
    },
    /**
     * What the emulator answers when asked which AVD it is, the identity check in front of every
     * kill. By default each pool serial names the AVD devices.json puts on that port; `avdNames`
     * overrides that per serial.
     */
    emulatorAvdName: (serial, port) => {
      calls.push(['avd-name', serial, port ?? null]);
      const bySerial = Object.fromEntries(
        (devices?.pairs ?? [])
          .filter((p) => p.android?.emulatorPort != null)
          .map((p) => [`emulator-${p.android.emulatorPort}`, p.android.avd])
      );
      const override = (deviceState.avdNames ?? {})[serial];
      if (override !== undefined) return override;
      return bySerial[serial];
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
    /** The same question, with whether simctl answered. */
    bootedSimulatorsOrNull: () => {
      calls.push(['booted-sims']);
      return deviceState.simctlFails
        ? null
        : [...deviceState.simulators.entries()]
            .filter(([, s]) => s === 'Booted')
            .map(([udid]) => udid);
    },
    simulators: () => deviceState.simulators,
    simulatorsResult: () =>
      deviceState.simctlFails
        ? { ok: false, byUdid: new Map(), answer: 'simctl failed' }
        : { ok: true, byUdid: deviceState.simulators, answer: 'ok' },
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
      // Recorded as well as advanced, so a test can count the waits between attempts.
      calls.push(['sleep', ms]);
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
    // Moved aside, not overwritten: that file is the only record of what was booted and by whom.
    expect(typeof read.recovered?.reason).toBe('string');
    const kept = readdirSync(home).filter((f) =>
      f.startsWith('pool.json.corrupt-')
    );
    expect(kept).toHaveLength(1);
    expect(readFileSync(join(home, kept[0]), 'utf8')).toBe('not json');
    // The path the pool writes to is clean for the next command.
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

  it('powers off an idle device that no lease holds, and stops tracking it', () => {
    withLeases([]);
    withDevice(
      entryOf({ key: 'avd:nitro-ui-a', leaseId: null, usedAgo: 41 * MINUTE })
    );
    const { pool, calls } = fakePool({
      home,
      state: { serials: ['emulator-5574'], simulators: new Map() },
    });
    const done = pool.reap();
    expect(done.reaped).toEqual([
      { key: 'avd:nitro-ui-a', reason: 'lease-gone' },
    ]);
    // The pair's private adb server is named: the default server has never seen this emulator.
    expect(calls).toContainEqual(['emu-kill', 'emulator-5574', 5043]);
    expect(readPool(home).devices).toEqual([]);
  });

  it('never powers off a device another task holds under a live lease', () => {
    withLeases([lease('B7-1', { task: 'B7', pairId: 'pair-a' })]);
    withDevice(
      entryOf({ key: 'avd:nitro-ui-a', leaseId: 'B7-1', usedAgo: 31 * MINUTE })
    );
    const { pool, calls } = fakePool({
      home,
      state: { serials: ['emulator-5574'], simulators: new Map() },
    });
    const done = pool.reap({ idleMinutes: 0 });
    expect(done.reaped).toEqual([]);
    expect(done.kept).toEqual([
      { key: 'avd:nitro-ui-a', reason: 'lease-held', idleMinutes: 31 },
    ]);
    expect(calls.filter((c) => c[0] === 'emu-kill')).toEqual([]);
    expect(readPool(home).devices).toHaveLength(1);
    // The exclusive hand-off's force list does not reach it either.
    const forced = pool.reap({
      shutdownKeys: ['avd:nitro-ui-a'],
      reason: 'exclusive acquire',
    });
    expect(forced.reaped).toEqual([]);
    expect(forced.kept[0]).toMatchObject({ reason: 'lease-held' });
    expect(calls.filter((c) => c[0] === 'emu-kill')).toEqual([]);
  });

  /**
   * Makes a second process appear in the middle of a reap: while the simulator shutdown runs,
   * the pool files are rewritten as an `acquire --boot` and a gate's claim would rewrite them.
   */
  const letTaskTake = (pool, { withClaim = true } = {}) => {
    const original = pool.ops.shutdownSimulator.bind(pool.ops);
    pool.ops.shutdownSimulator = (udid) => {
      const outcome = original(udid);
      writeFileSync(
        join(home, 'leases.json'),
        JSON.stringify(
          {
            leases: [
              {
                id: 'B7-1',
                task: 'B7',
                platform: 'both',
                exclusive: false,
                holds: ['pair-a'],
                acquiredAt: new Date(NOW).toISOString(),
                ttlMinutes: 240,
              },
            ],
          },
          null,
          2
        )
      );
      if (!withClaim) return outcome;
      const state = readPool(home);
      const entry = state.devices.find((x) => x.key === 'avd:nitro-ui-a');
      entry.claims = [
        { pid: 4242, id: 'gate-1', gate: 'harness:android', at: NOW },
      ];
      writeFileSync(join(home, 'pool.json'), JSON.stringify(state, null, 2));
      return outcome;
    };
  };

  const twoIdleDevices = () => {
    withLeases([]);
    writeFileSync(
      join(home, 'pool.json'),
      JSON.stringify(
        {
          version: 1,
          devices: [
            entryOf({
              key: 'ios:UDID-B',
              kind: 'ios',
              id: 'UDID-B',
              leaseId: null,
              usedAgo: 40 * MINUTE,
            }),
            entryOf({
              key: 'avd:nitro-ui-a',
              leaseId: null,
              usedAgo: 40 * MINUTE,
            }),
          ],
        },
        null,
        2
      )
    );
  };

  it('leaves a device a lease and a claim took during its own act pass, up', () => {
    // The act pass runs outside the lock and a shutdown can take minutes, so each kill has to
    // re-read the files immediately before it happens.
    twoIdleDevices();
    const { pool, calls } = fakePool({
      home,
      isPidAlive: () => true,
      state: {
        simulators: new Map([['UDID-B', 'Booted']]),
        serials: ['emulator-5574'],
      },
    });
    // "Task B" arrives while the reaper is powering off the *other* device.
    letTaskTake(pool);
    const done = pool.reap();
    expect(calls).toContainEqual(['shutdown-sim', 'UDID-B']);
    expect(calls.filter((c) => c[0] === 'emu-kill')).toEqual([]);
    expect(done.reaped).toEqual([{ key: 'ios:UDID-B', reason: 'lease-gone' }]);
    expect(done.kept).toEqual([
      {
        key: 'avd:nitro-ui-a',
        reason: 'in use by pid 4242 (harness:android)',
        idleMinutes: 40,
      },
    ]);
    // And the record is still there for the next `list`, because the device is still there.
    expect(readPool(home).devices.map((x) => x.key)).toEqual([
      'avd:nitro-ui-a',
    ]);
  });

  it('still kills both devices when nothing arrives in that window', () => {
    twoIdleDevices();
    const { pool, calls } = fakePool({
      home,
      isPidAlive: () => true,
      state: {
        simulators: new Map([['UDID-B', 'Booted']]),
        serials: ['emulator-5574'],
      },
    });
    const done = pool.reap();
    expect(calls).toContainEqual(['shutdown-sim', 'UDID-B']);
    expect(calls).toContainEqual(['emu-kill', 'emulator-5574', 5043]);
    expect(done.reaped.map((x) => x.key)).toEqual([
      'ios:UDID-B',
      'avd:nitro-ui-a',
    ]);
    expect(readPool(home).devices).toEqual([]);
  });

  it('notices a live lease that appears mid-pass even with no claim on the record', () => {
    // A warm `acquire --boot` writes the lease before anything is claimed, and a build or Metro
    // never claims at all, so the lease file is the only thing that shows this device is in use.
    twoIdleDevices();
    const { pool, calls } = fakePool({
      home,
      isPidAlive: () => true,
      state: {
        simulators: new Map([['UDID-B', 'Booted']]),
        serials: ['emulator-5574'],
      },
    });
    letTaskTake(pool, { withClaim: false });
    const done = pool.reap();
    expect(calls.filter((c) => c[0] === 'emu-kill')).toEqual([]);
    expect(done.kept).toEqual([
      {
        key: 'avd:nitro-ui-a',
        reason: 'a live lease holds it',
        idleMinutes: 40,
      },
    ]);
  });

  it('marks the pair booting from inside `ensureBooted`, so a reap in the wait cannot kill it', () => {
    // Through the real `ensureBooted`, with a second pool over the same files trying its reap
    // inside the boot wait.
    withLeases([]);
    withDevice(
      entryOf({ key: 'avd:nitro-ui-a', leaseId: null, usedAgo: 90 * MINUTE })
    );
    const booter = fakePool({
      home,
      state: { serials: [], simulators: new Map() },
    });
    // A second pool over the same files, whose device is up. The record it reads is already 90
    // minutes past its idle limit.
    const reaper = fakePool({
      home,
      state: { serials: ['emulator-5574'], simulators: new Map() },
    });
    let probe = null;
    let probing = false;
    const realSleep = booter.pool.sleep;
    booter.pool.sleep = (ms) => {
      if (probe == null && !probing) {
        probing = true;
        probe = reaper.pool.reap({ idleMinutes: 0 });
        // The emulator finishes coming up, so the wait ends instead of running to its timeout.
        booter.state.serials.push('emulator-5574');
        probing = false;
      }
      realSleep(ms);
    };
    // Android only: the fake simulator never comes up, and its boot is not the subject.
    const result = booter.pool.ensureBooted(
      PAIR_A,
      lease('X9-1', { task: 'X9' }),
      { platform: 'android' }
    );
    expect(result.booted).toEqual(['avd:nitro-ui-a']);
    expect(probe).not.toBeNull();
    expect(probe.kept[0]).toMatchObject({ reason: 'booting' });
    expect(probe.reaped).toEqual([]);
    expect(reaper.calls.filter((c) => c[0] === 'emu-kill')).toEqual([]);
    // The hand-off clears the phase, so the booted device is back on the idle clock.
    expect(readPool(home).devices[0].phase).toBe(null);
  });

  it('refuses to power a device off when a live lease holds it, asked directly', () => {
    withLeases([lease('B7-1', { task: 'B7', pairId: 'pair-a' })]);
    const { pool, calls } = fakePool({
      home,
      state: { serials: ['emulator-5574'], simulators: new Map() },
    });
    const entry = entryOf({
      key: 'avd:nitro-ui-a',
      leaseId: null,
      usedAgo: 40 * MINUTE,
    });
    // Both questions asked of the same live lease: by identifier from the caller's set, and by the
    // pool's own read when no set is handed in.
    expect(pool.shutdownDevice(entry, { held: new Set(['nitro-ui-a']) })).toBe(
      'refused'
    );
    expect(pool.shutdownDevice(entry)).toBe('refused');
    expect(
      pool.shutdownDevice(entry, { held: new Set(['emulator-5574']) })
    ).toBe('refused');
    expect(calls.filter((c) => c[0] === 'emu-kill')).toEqual([]);
    const ios = entryOf({
      key: 'ios:UDID-A',
      kind: 'ios',
      id: 'UDID-A',
      leaseId: null,
      usedAgo: 40 * MINUTE,
    });
    expect(pool.shutdownDevice(ios, { held: new Set(['UDID-A']) })).toBe(
      'refused'
    );
    expect(pool.shutdownDevice(ios)).toBe('refused');
    expect(calls.filter((c) => c[0] === 'shutdown-sim')).toEqual([]);
  });

  it('does not shut down an idle device the exclusive hand-off found untracked, under a lease', () => {
    // A pool device booted outside the pool has no record. The lease holds pair-a; the bench
    // names pair-a's AVD in `shutdownKeys` and may exempt only its own lease.
    withLeases([lease('B7-1', { task: 'B7', pairId: 'pair-a' })]);
    writeFileSync(
      join(home, 'pool.json'),
      JSON.stringify({ version: 1, devices: [] })
    );
    const { pool, calls } = fakePool({
      home,
      state: { serials: ['emulator-5574'], simulators: new Map() },
    });
    const done = pool.reap({
      shutdownKeys: ['avd:nitro-ui-a', 'ios:UDID-A'],
      reason: 'exclusive acquire',
      exceptLeaseId: 'BENCH-1',
    });
    expect(calls.filter((c) => c[0] === 'emu-kill')).toEqual([]);
    expect(calls.filter((c) => c[0] === 'shutdown-sim')).toEqual([]);
    expect(done.kept.map((x) => x.key)).toEqual([
      'avd:nitro-ui-a',
      'ios:UDID-A',
    ]);
    expect(done.reaped).toEqual([]);
  });

  it('lets a live lease protect its own devices from its own reap', () => {
    withLeases([
      lease('X1-1'),
      lease('B7-1', { task: 'B7', pairId: 'pair-b' }),
    ]);
    withDevice(entryOf({ key: 'avd:nitro-ui-a', usedAgo: 31 * MINUTE }));
    const { pool, calls } = fakePool({
      home,
      state: { serials: ['emulator-5574'], simulators: new Map() },
    });
    // Even with the exemption passed by hand.
    const done = pool.reap({ exceptLeaseId: 'X1-1' });
    expect(done.reaped).toEqual([]);
    expect(done.kept[0]).toMatchObject({
      key: 'avd:nitro-ui-a',
      reason: 'lease-held',
    });
    expect(calls.filter((c) => c[0] === 'emu-kill')).toEqual([]);
    expect(readPool(home).devices).toHaveLength(1);
  });

  it('still reaps an abandoned boot under a lease that has gone', () => {
    withLeases([lease('B7-1', { task: 'B7', pairId: 'pair-b' })]);
    withDevice(
      entryOf({ key: 'avd:nitro-ui-a', leaseId: null, usedAgo: 31 * MINUTE })
    );
    const { pool, calls } = fakePool({
      home,
      state: { serials: ['emulator-5574'], simulators: new Map() },
    });
    const done = pool.reap({ idleMinutes: 0 });
    expect(done.reaped).toEqual([
      { key: 'avd:nitro-ui-a', reason: 'lease-gone' },
    ]);
    expect(calls).toContainEqual(['emu-kill', 'emulator-5574', 5043]);
  });

  it('never powers off a pair an exclusive lease is holding for a bench', () => {
    // An exclusive lease holds *every* pair and writes no pool records for them, so the record's
    // `leaseId` is no help here: only the lease file knows the bench is measuring right now.
    withLeases([
      {
        ...lease('BENCH-1', { task: 'BENCH' }),
        exclusive: true,
        holds: ['pair-a', 'pair-b'],
      },
    ]);
    withDevice(
      entryOf({ key: 'avd:nitro-ui-a', leaseId: null, usedAgo: 90 * MINUTE })
    );
    const { pool, calls } = fakePool({
      home,
      state: { serials: ['emulator-5574'], simulators: new Map() },
    });
    const done = pool.reap({ idleMinutes: 0 });
    expect(done.reaped).toEqual([]);
    expect(done.kept[0]).toMatchObject({ reason: 'lease-held' });
    expect(calls.filter((c) => c[0] === 'emu-kill')).toEqual([]);
  });

  it('never powers off a device that is in the middle of booting', () => {
    withLeases([]);
    withDevice(
      entryOf({
        key: 'avd:nitro-ui-a',
        leaseId: null,
        usedAgo: 90 * MINUTE,
        phase: 'booting',
      })
    );
    const { pool, calls } = fakePool({
      home,
      state: { serials: ['emulator-5574'], simulators: new Map() },
    });
    const done = pool.reap({ idleMinutes: 0 });
    expect(done.reaped).toEqual([]);
    expect(done.kept[0]).toMatchObject({ reason: 'booting' });
    expect(calls.filter((c) => c[0] === 'emu-kill')).toEqual([]);
  });

  it('writes the booting phase before the wait, so a warm reuse cannot be reaped mid-boot', () => {
    // `markBooting` keeps the record's old timestamps, so on a warm reuse the record is past
    // its idle limit for the whole boot wait.
    withLeases([]);
    withDevice(
      entryOf({ key: 'avd:nitro-ui-a', leaseId: null, usedAgo: 90 * MINUTE })
    );
    const { pool, calls } = fakePool({
      home,
      state: { serials: ['emulator-5574'], simulators: new Map() },
    });
    // Not the reaping process's lease: the reap in that window comes from a different process.
    pool.markBooting(PAIR_A, lease('X9-1', { task: 'X9' }));
    expect(readPool(home).devices[0]).toMatchObject({
      phase: 'booting',
      phaseAtMs: NOW,
    });
    const done = pool.reap({ idleMinutes: 0 });
    expect(done.reaped).toEqual([]);
    expect(done.kept[0]).toMatchObject({ reason: 'booting' });
    expect(calls.filter((c) => c[0] === 'emu-kill')).toEqual([]);
    // The boot finishing closes the window: the same reap after `notePair` does power it off.
    pool.notePair(PAIR_A, lease('X9-1', { task: 'X9' }), {
      booted: ['avd:nitro-ui-a'],
    });
    expect(readPool(home).devices[0].phase).toBe(null);
    const after = pool.reap({ idleMinutes: 0 });
    expect(after.reaped).toEqual([
      { key: 'avd:nitro-ui-a', reason: 'lease-gone' },
    ]);
  });

  it('lets a booting phase expire, so a task that died mid-boot cannot wedge a device', () => {
    // A boot that outlives `settleTimeoutMs` is a crashed task. 31 s past the bound, not on it.
    withLeases([]);
    withDevice(
      entryOf({
        key: 'avd:nitro-ui-a',
        leaseId: null,
        usedAgo: 90 * MINUTE,
        phase: 'booting',
      })
    );
    const state = readPool(home);
    state.devices[0].phaseAtMs = NOW - BOOTING_PROTECTION_MS - 31_000;
    writeFileSync(poolStatePath(home), JSON.stringify(state, null, 2));
    const { pool, calls } = fakePool({
      home,
      state: { serials: ['emulator-5574'], simulators: new Map() },
    });
    expect(deviceIsBusy(state.devices[0], NOW)).toBe(false);
    const done = pool.reap({ idleMinutes: 0 });
    expect(done.reaped).toEqual([
      { key: 'avd:nitro-ui-a', reason: 'lease-gone' },
    ]);
    expect(calls).toContainEqual(['emu-kill', 'emulator-5574', 5043]);
  });

  it('takes --idle-minutes over what devices.json says, for a device nobody leases', () => {
    // devices.json in this fixture says 30, and the record carries that 30.
    withLeases([]);
    withDevice(
      entryOf({ key: 'avd:nitro-ui-a', leaseId: null, usedAgo: 1 * MINUTE })
    );
    const { pool, calls } = fakePool({
      home,
      state: { serials: ['emulator-5574'], simulators: new Map() },
    });
    const done = pool.reap({ idleMinutes: 0 });
    expect(done.reaped).toEqual([
      { key: 'avd:nitro-ui-a', reason: 'lease-gone' },
    ]);
    expect(calls).toContainEqual(['emu-kill', 'emulator-5574', 5043]);
    // And the default is still the config's: no argument, no early power-off.
    withDevice(
      entryOf({ key: 'avd:nitro-ui-a', leaseId: null, usedAgo: 1 * MINUTE })
    );
    expect(pool.reap().kept[0]).toMatchObject({
      key: 'avd:nitro-ui-a',
      reason: 'unowned-grace',
    });
  });

  it('leaves a device alone while a live claim holds it', () => {
    withLeases([lease('B7-1', { task: 'B7', pairId: 'pair-b' })]);
    withDevice(
      entryOf({
        key: 'avd:nitro-ui-a',
        leaseId: null,
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
    withLeases([]);
    withDevice(
      entryOf({ key: 'ios:UDID-A', leaseId: null, usedAgo: 41 * MINUTE })
    );
    const { pool, calls } = fakePool({
      home,
      state: { serials: [], simulators: new Map([['UDID-A', 'Booted']]) },
    });
    expect(pool.reap().reaped).toEqual([
      { key: 'ios:UDID-A', reason: 'lease-gone' },
    ]);
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
    // A wedged guest can ignore `emu kill`. Dropping the record then would leave a live device
    // nobody tracks.
    withLeases([]);
    withDevice(
      entryOf({ key: 'avd:nitro-ui-a', leaseId: null, usedAgo: 41 * MINUTE })
    );
    const { pool, calls } = fakePool({
      home,
      state: { serials: ['emulator-5574'], shutdownWorks: false },
    });
    const done = pool.reap();
    expect(done.failed).toEqual([
      { key: 'avd:nitro-ui-a', reason: 'lease-gone' },
    ]);
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

  it('asks the device which AVD it is before powering it off', () => {
    // The record and devices.json agree, so the kill happens, after the device has answered for
    // itself on the pair's adb server.
    withLeases([]);
    withDevice(
      entryOf({ key: 'avd:nitro-ui-a', leaseId: null, usedAgo: 41 * MINUTE })
    );
    const { pool, calls } = fakePool({
      home,
      state: { serials: ['emulator-5574'], simulators: new Map() },
    });
    const done = pool.reap();
    expect(done.reaped).toHaveLength(1);
    const asked = calls.findIndex((c) => c[0] === 'avd-name');
    const killed = calls.findIndex((c) => c[0] === 'emu-kill');
    expect(asked).toBeGreaterThanOrEqual(0);
    expect(calls[asked]).toEqual(['avd-name', 'emulator-5574', 5043]);
    expect(killed).toBeGreaterThan(asked);
  });

  it('never touches another pair serial because a record named it', () => {
    // The record is `avd:nitro-ui-a` carrying serial `emulator-5576`, which is pair-b's, and a
    // live lease holds pair-b. The kill's address has to come from the pair the record names.
    withLeases([lease('B7-1', { task: 'B7', pairId: 'pair-b' })]);
    withDevice({
      ...entryOf({
        key: 'avd:nitro-ui-a',
        leaseId: null,
        usedAgo: 41 * MINUTE,
      }),
      serial: 'emulator-5576',
      adbPort: 5045,
    });
    const { pool, calls } = fakePool({
      home,
      state: {
        serials: ['emulator-5574', 'emulator-5576'],
        simulators: new Map(),
      },
    });
    const done = pool.reap();
    expect(calls.some((c) => c.includes('emulator-5576'))).toBe(false);
    expect(calls.some((c) => c.includes(5045))).toBe(false);
    expect(done.reaped).toEqual([
      { key: 'avd:nitro-ui-a', reason: 'lease-gone' },
    ]);
    expect(calls).toContainEqual(['emu-kill', 'emulator-5574', 5043]);
  });

  it('refuses when the device answers to a different AVD than the record names', () => {
    // The pair's serial is attached, but the emulator says it is another AVD: one hand-started
    // on that console port, or devices.json was edited under the pool.
    withLeases([]);
    withDevice(
      entryOf({ key: 'avd:nitro-ui-a', leaseId: null, usedAgo: 41 * MINUTE })
    );
    const { pool, calls, logs } = fakePool({
      home,
      state: {
        serials: ['emulator-5574'],
        simulators: new Map(),
        avdNames: { 'emulator-5574': 'somebody-elses-avd' },
      },
    });
    const done = pool.reap();
    expect(done.reaped).toEqual([]);
    expect(calls.filter((c) => c[0] === 'emu-kill')).toEqual([]);
    expect(logs.join('\n')).toContain(
      'answers to AVD somebody-elses-avd, not nitro-ui-a'
    );
    // The record survives: nothing was proved about the device, so the next reap asks again.
    expect(readPool(home).devices).toHaveLength(1);
  });

  it('refuses when the device will not identify itself', () => {
    // A console that is not ready does not answer with a name, even though `adb devices`
    // already says the device is online.
    withLeases([]);
    withDevice(
      entryOf({ key: 'avd:nitro-ui-a', leaseId: null, usedAgo: 41 * MINUTE })
    );
    const { pool, calls } = fakePool({
      home,
      state: {
        serials: ['emulator-5574'],
        simulators: new Map(),
        avdNames: { 'emulator-5574': null },
      },
    });
    const done = pool.reap();
    expect(done.reaped).toEqual([]);
    expect(done.failed).toEqual([]);
    expect(calls.filter((c) => c[0] === 'emu-kill')).toEqual([]);
    expect(done.refused.some((r) => r.key === 'avd:nitro-ui-a')).toBe(true);
  });

  it('uses the pair from devices.json when the record disagrees about the serial', () => {
    // devices.json is the declaration; `pool.json` caches what was true at hand-out time and
    // goes stale when a pair is renumbered.
    withLeases([]);
    withDevice({
      ...entryOf({
        key: 'avd:nitro-ui-a',
        leaseId: null,
        usedAgo: 41 * MINUTE,
      }),
      serial: 'emulator-5576',
      adbPort: 5045,
    });
    const { pool, calls, logs } = fakePool({
      home,
      state: {
        serials: ['emulator-5574'],
        simulators: new Map(),
        avdNames: { 'emulator-5576': 'nitro-ui-b' },
      },
    });
    pool.reap();
    expect(calls).toContainEqual(['avd-name', 'emulator-5574', 5043]);
    expect(calls).toContainEqual(['emu-kill', 'emulator-5574', 5043]);
    expect(calls.filter((c) => c[0] === 'emu-kill')).not.toContainEqual([
      'emu-kill',
      'emulator-5576',
      5045,
    ]);
    expect(logs.join('\n')).toContain('devices.json says emulator-5574');
  });

  it('never derives a kill from the record when devices.json renumbered the pair', () => {
    // Here pair-b is the one renumbered, and its record still points at the old port's serial.
    withLeases([]);
    withDevice({
      ...entryOf({
        key: 'avd:nitro-ui-b',
        leaseId: null,
        usedAgo: 41 * MINUTE,
      }),
      serial: 'emulator-5574',
      adbPort: 5043,
    });
    const { pool, calls } = fakePool({
      home,
      state: {
        // Only the *stale* serial is attached: the new one does not exist. A device the pool cannot
        // reach is "already off", not something to kill on the strength of the record.
        serials: ['emulator-5574'],
        simulators: new Map(),
      },
    });
    const done = pool.reap();
    expect(calls.filter((c) => c[0] === 'emu-kill')).toEqual([]);
    expect(done.alreadyOff).toEqual([{ key: 'avd:nitro-ui-b' }]);
  });

  it('keeps the record of an emulator whose adb server did not answer', () => {
    // `adb devices` on a wedged server is killed at its timeout with no stdout, which looks
    // exactly like "no emulator is attached".
    withLeases([]);
    withDevice(
      entryOf({ key: 'avd:nitro-ui-a', leaseId: null, usedAgo: 41 * MINUTE })
    );
    const { pool, calls, logs } = fakePool({
      home,
      state: {
        serials: ['emulator-5574'],
        simulators: new Map(),
        adbFails: true,
      },
    });
    const done = pool.reap();
    expect(done.failed).toEqual([
      { key: 'avd:nitro-ui-a', reason: 'lease-gone' },
    ]);
    expect(done.alreadyOff).toEqual([]);
    expect(calls.filter((c) => c[0] === 'emu-kill')).toEqual([]);
    expect(readPool(home).devices).toHaveLength(1);
    expect(logs.join('\n')).toContain('adb did not answer');
  });

  it('keeps the record of a simulator whose simctl did not answer', () => {
    // Two ways to fail to answer: a nonzero exit and output that is not JSON. Both are "unknown".
    withLeases([]);
    withDevice(
      entryOf({
        key: 'ios:UDID-A',
        kind: 'ios',
        id: 'UDID-A',
        leaseId: null,
        usedAgo: 41 * MINUTE,
      })
    );
    const { pool, calls, logs } = fakePool({
      home,
      state: { simulators: new Map(), simctlFails: true },
    });
    const done = pool.reap();
    expect(done.failed).toEqual([{ key: 'ios:UDID-A', reason: 'lease-gone' }]);
    expect(done.alreadyOff).toEqual([]);
    expect(calls.filter((c) => c[0] === 'shutdown-sim')).toEqual([]);
    expect(readPool(home).devices).toHaveLength(1);
    expect(logs.join('\n')).toContain('simctl did not answer');
  });

  it('does not hold the lease lock while it talks to devices', () => {
    // The fake `emu kill` below takes the lease lock itself, as a concurrent `acquire` would. It
    // can only succeed if the reaper released the lock before talking to the device.
    withLeases([]);
    withDevice(entryOf({ key: 'avd:nitro-ui-a', usedAgo: 41 * MINUTE }));
    const { pool } = fakePool({
      home,
      state: { serials: ['emulator-5574'], simulators: new Map() },
    });
    pool.ops.shutdownAndroid = (serial) => {
      // If the reaper still held the lock here, `withLock` would block on itself and time out.
      const inside = withLock({
        lockFile: join(home, 'leases.lock'),
        timeoutMs: 2_000,
        mutate: () => 'got it',
      });
      if (inside !== 'got it') {
        throw new Error(
          `the lease lock was still held during emu kill (${serial})`
        );
      }
      return true;
    };
    expect(pool.reap({ exceptLeaseId: 'X1-1' }).reaped).toHaveLength(1);
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
    expect(logs.join('\n')).toContain('NITRO_UI_GATE_DEVICE_FORCE=1');
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
      // A claim writes state and never touches a device, so the pool needs no ops.
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
    // Nothing is up to begin with: the devices only appear in the listings after the first wait.
    const realSleep = pool.sleep;
    pool.sleep = (ms) => {
      realSleep(ms);
      state.serials = ['emulator-5574'];
      state.simulators = new Map([['UDID-A', 'Booted']]);
    };
    const result = pool.ensureBooted(PAIR_A, lease());
    // The adb server port goes to the boot itself: an emulator registers with the server named
    // in its own launch environment.
    expect(calls).toContainEqual([
      'boot-emulator',
      { avd: 'nitro-ui-a', port: 5574, adbPort: 5043 },
    ]);
    expect(calls).toContainEqual(['boot-sim', 'UDID-A']);
    expect(result.booted.sort()).toEqual(['avd:nitro-ui-a', 'ios:UDID-A']);
    expect(result.degraded).toEqual([]);
    expect(result.loadSettled).toBe(true);
    expect(result.load).toBe(3);
    // Time moved: 4 s polling for the devices, then 2 s per load sample.
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
    // A mistyped AVD name, or no emulator on PATH: `emulator` exits at once.
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
