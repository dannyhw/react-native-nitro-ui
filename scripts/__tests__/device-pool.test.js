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
  withLock,
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
      // Its own console port and adb server, deliberately not the ones pair-a's records carry: half
      // of M4 is a reaper killing the serial it *read* rather than the one the AVD it means lives
      // on, and a fixture where both pairs share a serial would make that invisible.
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
    // A record that names a lease which is no longer in the file is the same case: the task
    // released, or its lease expired, and the boot it left behind is nobody's to keep.
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
    // X11 review M3. The brief's rule is "devices with *no lease* are shut down after
    // idleShutdownMinutes", and the first version of this function reaped leased devices anyway,
    // attributing that to the brief. It matters because a live lease with no in-flight claim is
    // the ordinary state of a working task: `build-app.mjs`, Metro, `bun run harness:*`, a
    // direct real-input run, or simply a person thinking between two commands. None of those
    // claim a device, so a timestamp was the only protection - and 31 minutes of debugging is
    // well past 30.
    const held = entryOf({ key: 'avd:nitro-ui-a', usedAgo: 31 * MINUTE });
    expect(
      poolReapDecision(held, { nowMs: NOW, leases: [lease()] })
    ).toMatchObject({ action: 'keep', reason: 'lease-held', protected: true });
    // The operator's `--idle-minutes 0` does not reach it either (review M3's alternative): the
    // answer to "power the pool off now" is that somebody is *using* that device, and the way to
    // change it is their `release`, not a flag on someone else's command.
    expect(
      poolReapDecision(held, {
        nowMs: NOW,
        leases: [lease()],
        overrideIdleMinutes: 0,
      })
    ).toMatchObject({ action: 'keep', reason: 'lease-held', protected: true });
  });

  it('reaps a leased device whose lease has expired', () => {
    // The protection is for a *live* lease. One that has run out its TTL is what `list` calls
    // "abandoned", and nobody is coming back for that emulator.
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
    // `phase: 'booting'` is what the pool writes before it starts a boot and waits up to
    // `settleTimeoutMs` for the device and the machine's load. The record's timestamps are the
    // *previous* holder's, which can be past the idle limit already, and `notePair` refreshes
    // them only once the wait ends - so without this the boot itself is the window in which
    // another task's reaper powers the device off mid-air.
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
        // The lease is not the subject here, and a live lease *does* protect a device on a timer
        // (M3), so this is the caller's own lease: the question is whether a claim from a dead pid
        // counts as a claim, and the answer is no.
        exceptLeaseId: 'X1-1',
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
          exceptLeaseId: 'X1-1',
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
    // The record says 30 (that is what devices.json stamped at boot). An override of 0 is the
    // CLI's `--idle-minutes 0`; `??` is what makes it work, and `||` is the bug this pins.
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
    // A pooled simulator has the app installed - that is the state a reset starts from, and the
    // fake data container exists exactly as long as this says it does.
    iosInstalled: true,
    ...state,
  };
  const calls = [];
  let clearTries = 0;
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
      // The shape the real op returns: the device's own answer, not a bool. `appDataClearAnswers`
      // is a list so a fixture can be a device that settles - `pm clear` really does answer
      // `Failed` for a few seconds on an emulator that has just attached - and the last entry
      // repeats when the list runs out, so "keeps failing" is one fixture, not a special case.
      const answers = deviceState.appDataClearAnswers ?? [
        deviceState.appDataCleared ? 'Success' : 'Failed',
      ];
      const answer = answers[Math.min(clearTries, answers.length - 1)];
      clearTries += 1;
      return { ok: /Success/i.test(answer), answer };
    },
    shutdownAndroid: (serial, port) => {
      calls.push(['emu-kill', serial, port ?? null]);
      return deviceState.shutdownWorks;
    },
    /**
     * What the emulator answers when asked which AVD it is (`adb -s X emu avd name`), which is the
     * identity check in front of every kill. The default is the honest answer for a device that is
     * up - each pool serial names the AVD devices.json puts on that port - and `avdNames` lets a
     * fixture be the interesting case: a serial that answers to a *different* AVD than the record
     * claims, or one that answers nothing at all.
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
    simulators: () => deviceState.simulators,
    bootSimulator: (udid) => {
      calls.push(['boot-sim', udid]);
      return deviceState.simulatorBoots;
    },
    shutdownSimulator: (udid) => {
      calls.push(['shutdown-sim', udid]);
      return deviceState.shutdownWorks;
    },
    /**
     * The iOS reset's three calls, against a fake simulator that keeps a data container while the
     * app is installed. `iosInstalled` is the state a previous task leaves behind (true), and
     * `iosUninstallWorks: false` is the case where `simctl` says it removed the app but the
     * container is still there - the situation the exit code alone cannot see.
     */
    uninstallSimulatorApp: (udid, appId) => {
      calls.push(['uninstall-app', udid, appId]);
      if (deviceState.iosUninstallWorks === false) {
        return { ok: false, answer: 'Unable to uninstall: device is busy' };
      }
      deviceState.iosInstalled = false;
      return { ok: true, answer: 'uninstalled' };
    },
    installSimulatorApp: (udid, appPath) => {
      calls.push(['install-app', udid, appPath]);
      deviceState.iosInstalled = true;
      return { ok: true, answer: 'installed' };
    },
    simulatorDataContainer: (udid) => {
      calls.push(['data-container', udid]);
      return deviceState.iosInstalled === false
        ? null
        : `/Users/x/Library/Developer/CoreSimulator/Devices/${udid}/data/Containers/Data/Application/NITROUI`;
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
      // Recorded as well as advanced: "it waited twice between three attempts" is the assertion
      // that separates a retry loop from a busy-poll, and it needs the waits to be visible.
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
    // The private adb server is named on the way to the device: asking the default server would
    // be asking about an emulator it has never seen.
    expect(calls).toContainEqual(['emu-kill', 'emulator-5574', 5043]);
    expect(readPool(home).devices).toEqual([]);
  });

  it('never powers off a device another task holds under a live lease', () => {
    // X11 review M3, end to end: a live lease with no claim is the ordinary state of a working
    // task (building, running Metro, thinking), and `reap --idle-minutes 0` - the command
    // CONTRIBUTING recommends for "power the pool off now" - used to answer it with `emu kill` on
    // that task's emulator. The reviewer's probe case A and C in one fixture.
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
    // The exclusive hand-off's force list does not reach it either: `shutdownKeys` is an idle
    // filter, and a bench gets an honest "that pair is leased" instead of another task's device.
    const forced = pool.reap({
      shutdownKeys: ['avd:nitro-ui-a'],
      reason: 'exclusive acquire',
    });
    expect(forced.reaped).toEqual([]);
    expect(forced.kept[0]).toMatchObject({ reason: 'lease-held' });
    expect(calls.filter((c) => c[0] === 'emu-kill')).toEqual([]);
  });

  it('still reaps its own idle devices while holding a lease', () => {
    // The protection is against *other* people's leases. The pool's job is to power off what has
    // outlived its limit, and a task's own hand-off is exactly that: if "a live lease holds it"
    // covered your own, the idle clock would never fire for anyone who leases, which is everybody.
    withLeases([
      lease('X1-1'),
      lease('B7-1', { task: 'B7', pairId: 'pair-b' }),
    ]);
    withDevice(entryOf({ key: 'avd:nitro-ui-a', usedAgo: 31 * MINUTE }));
    const { pool, calls } = fakePool({
      home,
      state: { serials: ['emulator-5574'], simulators: new Map() },
    });
    const done = pool.reap({ exceptLeaseId: 'X1-1' });
    expect(done.reaped).toEqual([{ key: 'avd:nitro-ui-a', reason: 'idle' }]);
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
    // `phase: 'booting'` is written before the pool starts a boot and waits up to `settleTimeoutMs`
    // for the device and the machine's load, and `notePair` only refreshes the timestamps when that
    // wait ends. On a warm reuse of a record that is already past its idle limit, the boot itself
    // was the window in which another process's reap powered the device off mid-air.
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

  it('takes --idle-minutes over what devices.json says, for a device nobody leases', () => {
    // devices.json in this fixture says 30, and the record carries that 30. `reap({
    // idleMinutes: 0 })` is the operator's "power the pool off now" - the command a machine's
    // human reaches for when they want their fans back - and it used to be answered with
    // "keeping it up (idle, under the limit)", because the config value won the comparison.
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
    const done = pool.reap({ exceptLeaseId: 'X1-1' });
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

  it('asks the device which AVD it is before powering it off', () => {
    // X11 review M4: the reaper used to act on the serial in `pool.json`, checked only by AVD name,
    // and the name is not what `emu kill` is addressed to. Here the record and devices.json agree,
    // so the kill happens - after the device has answered for itself, on the pair's adb server.
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
    // The reviewer's probe case B: the record is `avd:nitro-ui-a` carrying serial `emulator-5576`,
    // while pair-b (`nitro-ui_b`, 5576 on adb server 5045) is held by a live lease. The old code ran
    // `adb -P 5045 -s emulator-5576 emu kill` - another task's emulator. Under the fix the address
    // comes from the pair the record names, so 5576 is never even asked a question, and what does
    // get powered off is pair-a's own device, after it answered for itself.
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
    // Last gate before the kill: the pair's serial is attached, and the pool is ready to power it
    // off, but the emulator itself says it is somebody else's AVD (a hand-started `emulator
    // @somebody_elses_avd -console-port 5574`, or devices.json edited under the pool). The device's
    // own answer wins over the pool's arithmetic, and nothing dies.
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
    // `adb emu avd name` on a console that is not ready answers `emulator-5554` / nothing. That is
    // an unidentified device, and an unidentified device is not one you get to power off - even
    // though `adb devices` already says it is online.
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
    // devices.json is the declaration, `pool.json` is a cache of what was true at hand-out time
    // (it gets renumbered; a task can have `ANDROID_SERIAL` set to something else in its shell).
    // The identity the kill is addressed to comes from the declaration, and a disagreement is
    // printed rather than silently obeyed - so a renumbering cannot aim the reaper at a neighbour.
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
    // The same protection from the other side: pair-b is the one being renumbered here, and its
    // record still points at the old port's serial. The kill must go to the *new* serial - and the
    // live check is what stops it when the old emulator is the only thing that answers.
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

  it('does not hold the lease lock while it talks to devices', () => {
    // X11 review N1: `reap` used to run `simctl list`, `simctl shutdown` and `adb emu kill` inside
    // the same `withLock` everyone else needs to acquire a lease. That lock has a 10-second timeout
    // and is stolen from whoever holds it past 30, so one slow shutdown used to fail every other
    // task's `acquire` and gate claim - and could lose the reaper its own lock mid-write. The fake
    // `emu kill` below takes the lock itself, which is exactly what a concurrent `acquire` does: it
    // can only succeed if the reaper has released it before picking up the phone.
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

  it('uninstalls the app on the simulator, and checks the data is really gone', () => {
    // X11 review M2. The row used to read "none needed (simctl install replaces the app
    // container)", which the repo's own platform-apple patch contradicts in its installed code:
    // `simctl install` *keeps* the container. So the pool printed a satisfied reset while one
    // task's NSUserDefaults and Documents sat on the device for the next one.
    const { pool, calls } = fakePool({ home });
    const ios = pool.resetPair(PAIR_A).find((r) => r.key === 'ios:UDID-A');
    expect(ios.action).toBe('simctl uninstall');
    expect(ios.ok).toBe(true);
    expect(calls).toContainEqual([
      'uninstall-app',
      'UDID-A',
      EXAMPLE_APP_ID.ios,
    ]);
    // The completeness check is a question to the simulator, not a trust in the exit code, and it
    // happens *after* the uninstall: asserting the order is the difference between this test and
    // one that passes whenever the two calls are both present.
    const uninstalled = calls.findIndex((c) => c[0] === 'uninstall-app');
    const checked = calls.findIndex((c) => c[0] === 'data-container');
    expect(checked).toBeGreaterThan(uninstalled);
  });

  it('fails the iOS reset when the data container survives the uninstall', () => {
    // The case an exit code cannot see: `simctl uninstall` returns 0 and the container is still
    // there. A reset that reports success here is the false claim this whole path exists to stop
    // making, so the row has to go red and name the container it found.
    const { pool } = fakePool({
      home,
      state: { iosUninstallWorks: false },
    });
    const ios = pool.resetPair(PAIR_A).find((r) => r.key === 'ios:UDID-A');
    expect(ios.ok).toBe(false);
    expect(ios.answer).toMatch(/Unable to uninstall/);
    // A container still present is a failed reset even if the command had answered `ok`.
    const { pool: survivor } = fakePool({ home });
    survivor.ops.uninstallSimulatorApp = () => ({
      ok: true,
      answer: 'uninstalled',
    });
    const liar = survivor.resetPair(PAIR_A).find((r) => r.key === 'ios:UDID-A');
    expect(liar.ok).toBe(false);
    expect(liar.answer).toMatch(/data container survived/);
  });

  it('reinstalls the harness app after an iOS reset, when one is available', () => {
    // Uninstalling is only safe because every consumer of a pooled device installs first. If the
    // pool knows where the app is, it leaves the device ready rather than empty.
    const { pool, calls } = fakePool({ home });
    const ios = pool
      .resetPair(PAIR_A, { reinstallApp: '/tmp/build/NitroUiExample.app' })
      .find((r) => r.key === 'ios:UDID-A');
    expect(ios.ok).toBe(true);
    expect(ios.answer).toContain('reinstalled /tmp/build/NitroUiExample.app');
    expect(calls).toContainEqual([
      'install-app',
      'UDID-A',
      '/tmp/build/NitroUiExample.app',
    ]);
    // Removed, then put back: the order is the point.
    const uninstalled = calls.findIndex((c) => c[0] === 'uninstall-app');
    const installed = calls.findIndex((c) => c[0] === 'install-app');
    expect(installed).toBeGreaterThan(uninstalled);
  });

  it('reports a `pm clear` that never succeeded as a failed reset, with the answer', () => {
    const { pool, calls } = fakePool({
      home,
      state: { appDataCleared: false },
    });
    const row = pool.resetPair(PAIR_A).find((r) => r.key === 'avd:nitro-ui-a');
    expect(row.ok).toBe(false);
    // The device's own word, not just "FAILED": `Failed` and `Error: unknown package` are
    // different problems to whoever reads the line, and both arrive as a nonzero pm clear.
    expect(row.answer).toContain('Failed');
    // Retried, and bounded: four asks is the ceiling, so a device that will never clear costs
    // three polls rather than hanging the lease.
    expect(calls.filter((c) => c[0] === 'pm')).toHaveLength(4);
    expect(row.attempts).toBe(4);
  });

  it('retries a reset on a device that is still settling, and reports the tries', () => {
    // The shape the first real boot of this code actually produced: `sys.boot_completed` is 1,
    // PackageManager is still waking, and `pm clear` answers Failed then Success. A single attempt
    // reported that as a failed reset on a device that was fine.
    const { pool, calls } = fakePool({
      home,
      state: { appDataClearAnswers: ['Failed', 'Failed', 'Success'] },
    });
    const row = pool.resetPair(PAIR_A).find((r) => r.key === 'avd:nitro-ui-a');
    expect(row).toMatchObject({ ok: true, attempts: 3, answer: 'Success' });
    expect(calls.filter((c) => c[0] === 'pm')).toHaveLength(3);
    // The waits between them are the injected clock, not a wall: three polls, and no real sleeping.
    expect(calls.filter((c) => c[0] === 'sleep')).toHaveLength(2);
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
