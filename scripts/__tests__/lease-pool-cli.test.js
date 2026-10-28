/**
 * The lease owns the device lifecycle (X11), tested through the real CLI in a real `NITRO_UI_HOME`.
 *
 * `device-pool.test.js` covers the decisions with injected operations; this file covers what only a
 * process boundary shows - that `acquire` boots nothing unless asked, that `--no-boot` still reaps,
 * that a `devices.json` a person did not write is never powered off, and that the rows `list`
 * prints come from the same file the reaper reads. Those are the claims in AGENTS.md and
 * CONTRIBUTING.md, so they are checked at the level a task actually invokes.
 *
 * The three device tools are stubs that append their argv to a calls file, so a test can assert
 * both directions - "it did power this one off" and "it never powered that one off, or even asked
 * about it" - instead of inferring either from a state file. `NITRO_UI_SIMCTL_BIN` /
 * `NITRO_UI_ADB_BIN` are the same override `doctor.mjs` and the unowned-device check use;
 * `EMULATOR_BIN` is the pool's own.
 */

import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..');
const CLI = join(REPO_ROOT, 'scripts', 'lease.mjs');
const EXAMPLE_CONFIG = join(REPO_ROOT, 'scripts', 'devices.example.json');

/** devices.example.json's pair-a, so the fixtures name what the config really says. */
const UDID_A = '00000000-0000-4000-8000-00000000000A';
const SERIAL_A = 'emulator-5574';

const MINUTE = 60_000;

describe('the lease owns the device lifecycle', () => {
  let home;
  let bins;
  let config;
  let calls;

  /**
   * Writes the stubs.
   *
   * `up` is what `adb devices` / `simctl list` report at the start of the command; the stubs are
   * deliberately dumb about it (a fixed answer), because every case here is about *which* device
   * operations the CLI chose to run, not about timing a boot - the wait loop has its own tests in
   * `device-pool.test.js`, with a clock.
   *
   * @param {{androidUp?: boolean, iosUp?: boolean}} options
   */
  const tools = ({ androidUp = false, iosUp = false } = {}) => {
    const listing = {
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [
          {
            udid: UDID_A,
            name: 'iPhone 17',
            state: iosUp ? 'Booted' : 'Shutdown',
          },
        ],
      },
    };
    // One `printf` of a pre-built string per stub: the JSON goes in through JSON.stringify, so
    // neither the shell nor the JS parser has to agree about quotes.
    const simctlLines = [
      '#!/bin/sh',
      'echo "simctl $*" >> "$NITRO_UI_FAKE_CALLS"',
      `printf '%s' ${shellQuote(JSON.stringify(listing))}`,
      '',
    ];
    const adbLines = [
      '#!/bin/sh',
      'echo "adb $*" >> "$NITRO_UI_FAKE_CALLS"',
      'case "$*" in',
      // `%b`, not `%s`: the serial and its state are separated by a real tab, and only `%b`
      // turns the `\t` in the text below into one. `%s` hands back a literal backslash-t, which
      // no `adb devices` parser reads as a device - the fixture bug that made every "did it boot
      // the emulator?" case answer no and still pass.
      `  *devices*) printf '%b\\n' ${shellQuote(adbDeviceText(androidUp))} ;;`,
      "  *boot_completed*) printf '1' ;;",
      "  *'pm clear'*) printf 'Success' ;;",
      "  *'emu kill'*) printf 'OK' ;;",
      'esac',
      'exit 0',
      '',
    ];
    writeFileSync(join(bins, 'simctl'), simctlLines.join('\n'));
    writeFileSync(join(bins, 'adb'), adbLines.join('\n'));
    // The pool starts an emulator detached; the stub records the argv and exits, which is all the
    // pool waits on (`adb devices` decides when a boot is over, not this process).
    writeFileSync(
      join(bins, 'emulator'),
      [
        '#!/bin/sh',
        'echo "emulator $*" >> "$NITRO_UI_FAKE_CALLS"',
        'exit 0',
        '',
      ].join('\n')
    );
    for (const name of ['simctl', 'adb', 'emulator'])
      chmodSync(join(bins, name), 0o755);
  };

  /** A single-quoted shell string, with the closing/reopening dance for embedded quotes. */
  const shellQuote = (text) => `'${String(text).replaceAll("'", "'\\''")}'`;

  /** Escapes, not literal whitespace: the stub prints them with `%b`. */
  const adbDeviceText = (androidUp) =>
    androidUp
      ? `List of devices attached\n${SERIAL_A}\tdevice`
      : 'List of devices attached';

  const cli = (args, extraEnv = {}) =>
    spawnSync(process.execPath, [CLI, ...args, '--config', config], {
      encoding: 'utf8',
      env: {
        ...process.env,
        NITRO_UI_HOME: home,
        NITRO_UI_LEASE_POLL_MS: '20',
        // A boot-wait must not sit behind a real three-minute load wait in a unit test either.
        NITRO_UI_LOAD_SETTLE_TIMEOUT_MS: '0',
        NITRO_UI_SIMCTL_BIN: join(bins, 'simctl'),
        NITRO_UI_ADB_BIN: join(bins, 'adb'),
        EMULATOR_BIN: join(bins, 'emulator'),
        NITRO_UI_FAKE_CALLS: calls,
        ...extraEnv,
      },
      timeout: 60_000,
    });

  /** Every stub invocation, one per line, since the file was last truncated. */
  const log = () => {
    try {
      return readFileSync(calls, 'utf8');
    } catch {
      return '';
    }
  };

  /** A pool.json with one warm device, idle for `minutes`. */
  const warmDevice = (entry) => {
    writeFileSync(
      join(home, 'pool.json'),
      `${JSON.stringify({ version: 1, devices: [entry] }, null, 2)}\n`
    );
  };
  /**
   * A warm record as the pool would write it.
   *
   * `kind` is the *platform* and the key prefix is `avd:` - the same distinction
   * `device-pool.mjs`'s `splitKey` exists for, and the same one this fixture got wrong first:
   * with `kind: 'avd'` the serial came out null, every shutdown answered "already off", and
   * three cases passed by doing nothing at all.
   */
  const idleEntry = ({
    key = 'avd:nitro-ui-a',
    leaseId = null,
    idleMinutes = 90,
    serial = SERIAL_A,
    claims = [],
  } = {}) => {
    const now = Date.now();
    const prefix = key.slice(0, key.indexOf(':'));
    const id = key.slice(key.indexOf(':') + 1);
    const kind = prefix === 'avd' ? 'android' : prefix;
    return {
      key,
      kind,
      id,
      leaseId,
      bootedAtMs: now - idleMinutes * MINUTE,
      lastUsedMs: now - idleMinutes * MINUTE,
      idleShutdownMinutes: 30,
      serial: kind === 'android' ? serial : null,
      adbPort: 5043,
      udid: kind === 'ios' ? id : null,
      claims,
    };
  };
  const poolDevices = () => {
    try {
      return JSON.parse(readFileSync(join(home, 'pool.json'), 'utf8')).devices;
    } catch {
      return [];
    }
  };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'nitro-ui-pool-cli-'));
    bins = mkdtempSync(join(tmpdir(), 'nitro-ui-pool-cli-bin-'));
    calls = join(home, 'calls.log');
    config = join(home, 'devices.json');
    copyFileSync(EXAMPLE_CONFIG, config);
    tools();
  });

  it('names devices and boots nothing, until asked', () => {
    const acquired = cli(['acquire', '--task', 'T1']);
    expect(acquired.status).toBe(0);
    expect(acquired.stderr).toContain('devices not booted');
    // The whole point of the default: a lease is a booking, and a booking that silently boots two
    // devices is the load this machine cannot afford (an iOS boot alone moves load1 past 100).
    expect(log()).toBe('');
    expect(poolDevices()).toEqual([]);
  });

  it('boots the pair it hands out when told to, from the shared launch config', () => {
    tools({ androidUp: true, iosUp: true });
    const acquired = cli(['acquire', '--task', 'T1', '--boot']);
    expect(acquired.status).toBe(0);
    // Both devices were already up, so nothing should have been started - the warm path is the
    // common one, and paying 54 s per task for a boot that was not needed is the bug.
    expect(acquired.stderr).toContain('is already up - reusing it');
    expect(log()).not.toContain('emulator @');
    expect(log()).not.toContain('simctl boot');
    expect(poolDevices().map((x) => x.key)).toEqual([
      'avd:nitro-ui-a',
      `ios:${UDID_A}`,
    ]);
    expect(log()).toContain(`adb -P 5043 -s ${SERIAL_A} pm clear`);
  });

  it('starts a device that is down, and records the boot on the lease', () => {
    // Nothing is up, and the emulator stays "down" as far as the stub is concerned: the lease still
    // has to come back (bounded), and it still has to have *asked* for the boot.
    const acquired = cli([
      'acquire',
      '--task',
      'T2',
      '--boot',
      '--boot-timeout-minutes',
      '0.02',
      '--no-reset',
    ]);
    expect(acquired.status).toBe(0);
    expect(acquired.stderr).toContain('booting android device nitro-ui-a:5574');
    expect(acquired.stderr).toContain('did not come up');
    expect(log()).toContain('emulator @nitro-ui-a -port 5574');
    expect(log()).toContain('-gpu host');
    expect(log()).toContain(`simctl boot ${UDID_A}`);
    // Headless: the pool that opens Simulator.app boots a device no lease handed out.
    expect(log()).not.toContain('open');
  });

  it('reaps an idle device even when it was told not to boot', () => {
    tools({ androidUp: true });
    warmDevice(idleEntry({ leaseId: 'T3-aaaa' }));
    writeFileSync(
      join(home, 'leases.json'),
      `${JSON.stringify(
        {
          leases: [
            {
              id: 'T3-aaaa',
              task: 'T3',
              platform: 'both',
              exclusive: false,
              holds: ['pair-a'],
              acquiredAt: new Date(Date.now() - 120 * MINUTE).toISOString(),
              ttlMinutes: 240,
            },
          ],
        },
        null,
        2
      )}\n`
    );
    const acquired = cli(['acquire', '--task', 'T1', '--no-boot']);
    expect(acquired.status).toBe(0);
    // Booting is opt-in; reaping is not, and must not be tied to it. Without this half, the only
    // way to get a warm device is to also accept an unbounded pile of idle ones.
    expect(acquired.stderr).toContain('shutting down emulator');
    expect(log()).toContain(`adb -P 5043 -s ${SERIAL_A} emu kill`);
    expect(poolDevices()).toEqual([]);
  });

  it('leaves an idle device alone when told not to reap', () => {
    // The device is reported *up* on purpose: a stub that answered "no devices" would let a
    // forced reap pass this case by forgetting the record without ever touching a device, which
    // is what it did the first time round.
    tools({ androidUp: true });
    warmDevice(idleEntry());
    const acquired = cli(['acquire', '--task', 'T1', '--no-boot', '--no-reap']);
    expect(acquired.status).toBe(0);
    expect(log()).not.toContain('emu kill');
    expect(poolDevices()).toHaveLength(1);
  });

  it('boots its own pair under --boot --no-reap, and still leaves others alone', () => {
    // The two switches are independent, and the combination is the one that shows it: `--boot`
    // means "warm the pair I am about to use", `--no-reap` means "do not touch anybody else's".
    // A caller that read `--no-reap` as "the pool is off" would lose the warm boot; one that read
    // `--boot` as "manage everything" would power off a device on a machine that said not to.
    tools({ androidUp: true, iosUp: true });
    warmDevice({
      ...idleEntry({ key: 'avd:nitro-ui-b', idleMinutes: 90 }),
      key: 'avd:nitro-ui-b',
      id: 'nitro-ui-b',
      serial: 'emulator-5576',
    });
    const acquired = cli(['acquire', '--task', 'T1', '--boot', '--no-reap']);
    expect(acquired.status).toBe(0);
    expect(acquired.stderr).toContain('is already up - reusing it');
    expect(poolDevices().map((x) => x.key)).toContain('avd:nitro-ui-a');
    // pair-b's device is 90 minutes idle and named in devices.json: reap would take it, and this
    // caller said not to reap.
    expect(log()).not.toContain('emu kill');
    expect(poolDevices().map((x) => x.key)).toContain('avd:nitro-ui-b');
  });

  it('takes the whole device lifecycle offline for NITRO_UI_LEASE_BOOT=0', () => {
    // The one variable a CI runner or a bench host sets in its profile, and the promise it makes
    // is stronger than `--no-boot`: nothing is booted *or* powered off, because that machine owns
    // its own devices. `--no-reap` only stops the cleanup; the env var stops the pool itself.
    tools({ androidUp: true });
    warmDevice(idleEntry());
    const acquired = cli(['acquire', '--task', 'T1'], {
      NITRO_UI_LEASE_BOOT: '0',
    });
    expect(acquired.status).toBe(0);
    expect(log()).toBe('');
    expect(poolDevices()).toHaveLength(1);
  });

  it('never powers off a device the config does not name', () => {
    // Somebody's AVD recorded in the state file by an older run, a hand edit, or a devices.json
    // swap. The pool shuts down what the machine *declared*, and this is the test that keeps the
    // promise that a script in this repo cannot reach a device a person is using.
    tools({ androidUp: true });
    warmDevice(
      idleEntry({ key: 'avd:somebody-elses', serial: 'emulator-5590' })
    );
    const reaped = cli(['reap']);
    expect(reaped.status).toBe(0);
    expect(reaped.stderr).toContain('not in devices.json');
    expect(log()).not.toContain('emu kill');
    expect(poolDevices()).toHaveLength(1);
  });

  it('never powers off the reserved serial, whatever the state file claims', () => {
    tools({ androidUp: true });
    warmDevice(idleEntry({ serial: 'emulator-5560' }));
    const reaped = cli(['reap']);
    expect(reaped.stderr).toContain('reserved');
    expect(log()).not.toContain('emu kill');
    expect(poolDevices()).toHaveLength(1);
  });

  it('powers off an idle simulator with simctl, not by opening anything', () => {
    tools({ iosUp: true });
    warmDevice(idleEntry({ key: `ios:${UDID_A}` }));
    const reaped = cli(['reap']);
    expect(reaped.status).toBe(0);
    expect(log()).toContain(`simctl shutdown ${UDID_A}`);
    expect(log()).not.toContain('open -a');
    expect(poolDevices()).toEqual([]);
  });

  it('reports the warm devices in `list`, with who holds them', () => {
    tools({ androidUp: true });
    warmDevice(idleEntry({ leaseId: null, idleMinutes: 4 }));
    const listed = cli(['list']);
    expect(listed.status).toBe(0);
    expect(listed.stdout).toContain('avd:nitro-ui-a');
    expect(listed.stdout).toContain('idle 4m of 30m');
    // A row that says "pool" without a serial would be a hint, not evidence.
    expect(listed.stdout).toContain(SERIAL_A);
  });

  it('will not power off a device a live process has claimed', () => {
    // The pid here is real: this test process, which every reap must therefore treat as busy even
    // though the record says four hours idle.
    warmDevice({
      ...idleEntry({ idleMinutes: 240 }),
      claims: [
        {
          pid: process.pid,
          id: 'live',
          gate: 'harness:android',
          at: Date.now(),
        },
      ],
    });
    const reaped = cli(['reap']);
    expect(reaped.stderr).toContain(
      'keeping avd:nitro-ui-a up (a run is using it)'
    );
    expect(log()).not.toContain('emu kill');
    expect(poolDevices()).toHaveLength(1);
  });

  it('shuts unheld pool devices down for an exclusive lease, idle or not', () => {
    tools({ androidUp: true });
    // Four minutes into a 30-minute clock: a bench does not care how idle it is, it cares that it
    // is running on the same machine as a booted emulator.
    warmDevice(idleEntry({ idleMinutes: 4 }));
    const acquired = cli([
      'acquire',
      '--task',
      'BENCH',
      '--exclusive',
      '--boot',
      '--no-reset',
    ]);
    expect(acquired.status).toBe(0);
    expect(acquired.stderr).toContain('exclusive');
    expect(log()).toContain(`adb -P 5043 -s ${SERIAL_A} emu kill`);
    expect(poolDevices()).toEqual([]);
  });

  it('keeps a corrupt pool.json as evidence and carries on leasing', () => {
    writeFileSync(join(home, 'pool.json'), 'not json at all');
    const acquired = cli(['acquire', '--task', 'T9', '--no-boot']);
    expect(acquired.status).toBe(0);
    expect(acquired.stdout).toContain('NITRO_UI_LEASE_ID');
    const kept = listHome('pool.json.corrupt-');
    expect(kept).toHaveLength(1);
    expect(readFileSync(join(home, kept[0]), 'utf8')).toBe('not json at all');
  });

  const listHome = (prefix) =>
    spawnSync('/bin/ls', [home], { encoding: 'utf8' })
      .stdout.split('\n')
      .filter((name) => name.startsWith(prefix));

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(bins, { recursive: true, force: true });
  });
});
