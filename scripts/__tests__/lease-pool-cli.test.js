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

import { FREE_LSOF } from './helpers/free-lsof-stub.js';
import { withoutLeaseEnv } from './helpers/scrubbed-env.js';

const REPO_ROOT = join(__dirname, '..', '..');
const CLI = join(REPO_ROOT, 'scripts', 'lease.mjs');
const EXAMPLE_CONFIG = join(REPO_ROOT, 'scripts', 'devices.example.json');

/** devices.example.json's pair-a, so the fixtures name what the config really says. */
const UDID_A = '00000000-0000-4000-8000-00000000000A';
const SERIAL_A = 'emulator-5574';
const AVD_A = 'nitro-ui-a';
const AVD_B = 'nitro-ui-b';

const MINUTE = 60_000;

describe('the lease owns the device lifecycle', () => {
  let home;
  let bins;
  let config;
  let calls;

  /**
   * Writes the stubs. `up` is what `adb devices` / `simctl list` report, as a fixed answer.
   * With `stateful: true` the three tools read and write state files instead: `emu kill` /
   * `simctl shutdown` take a device down, `emulator @avd` / `simctl boot` bring it up, and
   * the next listing answers accordingly.
   *
   * @param {{androidUp?: boolean, iosUp?: boolean, stateful?: boolean}} options
   */
  const tools = ({
    androidUp = false,
    iosUp = false,
    stateful = false,
  } = {}) => {
    const listingFor = (iosState) => ({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [
          {
            udid: UDID_A,
            name: 'iPhone 17',
            state: iosState,
          },
        ],
      },
    });
    const listing = listingFor(iosUp ? 'Booted' : 'Shutdown');
    /** Reads one of the state files, or `fallback` when the case has not written it. */
    const readState = (kind, fallback) =>
      stateful
        ? `      if [ -f "$NITRO_UI_FAKE_STATE.${kind}" ]; then state=$(cat "$NITRO_UI_FAKE_STATE.${kind}"); else state=${fallback}; fi`
        : '';
    // One `printf` of a pre-built string per stub: the JSON goes in through JSON.stringify, so
    // neither the shell nor the JS parser has to agree about quotes.
    const simctlLines = [
      '#!/bin/sh',
      'echo "simctl $*" >> "$NITRO_UI_FAKE_CALLS"',
      'case "$*" in',
      // Stateful only: boot and shutdown write the state the listing below reads.
      ...(stateful
        ? [
            '  *\'boot\'*) echo up > "$NITRO_UI_FAKE_STATE.ios" ;;',
            '  *\'shutdown\'*) echo down > "$NITRO_UI_FAKE_STATE.ios" ;;',
            '  *)',
            readState('ios', iosUp ? "'up'" : "'down'"),
            '      if [ "$state" = up ]; then',
            `        printf '%s' ${shellQuote(JSON.stringify(listingFor('Booted')))}`,
            '      else',
            `        printf '%s' ${shellQuote(JSON.stringify(listingFor('Shutdown')))}`,
            '      fi ;;',
          ]
        : [`  *) printf '%s' ${shellQuote(JSON.stringify(listing))} ;;`]),
      'esac',
      '',
    ];
    const adbLines = [
      '#!/bin/sh',
      'echo "adb $*" >> "$NITRO_UI_FAKE_CALLS"',
      'case "$*" in',
      // `%b`, not `%s`: the serial and its state are separated by a real tab, and only `%b`
      // turns the `\t` in the text below into one. In the stateful shape the listing is built
      // from the state files instead.
      ...(stateful
        ? [
            // One state file per serial, because the pool has two emulators. `androidUp` is
            // pair-a's default; pair-b starts down unless a case seeds its file.
            '  *devices*)',
            "    printf 'List of devices attached\\n'",
            '    for s in emulator-5574 emulator-5576; do',
            '      st=down',
            `      case "$s" in emulator-5574) st=${androidUp ? "'up'" : "'down'"} ;; esac`,
            '      f="$NITRO_UI_FAKE_STATE.android-$s"',
            '      if [ -f "$f" ]; then st=$(cat "$f"); fi',
            '      if [ "$st" = up ]; then printf \'%s\\tdevice\\n\' "$s"; fi',
            '    done ;;',
          ]
        : [
            `  *devices*) printf '%b\\n' ${shellQuote(adbDeviceText(androidUp))} ;;`,
          ]),
      "  *boot_completed*) printf '1' ;;",
      ...(stateful
        ? [
            // The serial being killed is in the argv.
            "  *'emu kill'*)",
            '      case "$*" in',
            '        *emulator-5576*) echo down > "$NITRO_UI_FAKE_STATE.android-emulator-5576" ;;',
            '        *) echo down > "$NITRO_UI_FAKE_STATE.android-emulator-5574" ;;',
            "      esac; printf 'OK' ;;",
          ]
        : ["  *'emu kill'*) printf 'OK' ;;"]),
      // Which AVD is behind a serial (`adb -s X emu avd name`), answered as a real emulator
      // does: name, then `OK`. The table mirrors devices.example.json, and
      // `NITRO_UI_FAKE_AVD_NAME` is what a device that disagrees with it answers.
      "  *'emu avd name'*)",
      `      name="\${NITRO_UI_FAKE_AVD_NAME-}"`,
      '      if [ -z "$name" ]; then',
      '        case "$*" in',
      `          *${shellQuote(SERIAL_A)}*) name=${shellQuote(AVD_A)} ;;`,
      "          *emulator-5576*) name='nitro-ui-b' ;;",
      '        esac',
      '      fi',
      '      printf \'%s\\nOK\\n\' "$name" ;;',
      'esac',
      'exit 0',
      '',
    ];
    writeFileSync(join(bins, 'simctl'), simctlLines.join('\n'));
    writeFileSync(join(bins, 'adb'), adbLines.join('\n'));
    // The pool starts an emulator detached; the stub records the argv and exits. In the
    // stateful shape it also marks the device up, which is what the pool polls `adb devices` for.
    writeFileSync(
      join(bins, 'emulator'),
      [
        '#!/bin/sh',
        'echo "emulator $*" >> "$NITRO_UI_FAKE_CALLS"',
        ...(stateful
          ? [
              // The port is in the argv, so the boot marks up the serial it actually started.
              '    case "$*" in',
              '      *-port*5576*) echo up > "$NITRO_UI_FAKE_STATE.android-emulator-5576" ;;',
              '      *) echo up > "$NITRO_UI_FAKE_STATE.android-emulator-5574" ;;',
              '    esac',
            ]
          : []),
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
        // Never the calling shell's lease: an exported `NITRO_UI_LEASE_BOOT=1` would boot
        // devices in every case. A case that wants it passes it in `extraEnv`.
        ...withoutLeaseEnv(process.env),
        NITRO_UI_HOME: home,
        NITRO_UI_LEASE_POLL_MS: '20',
        // A boot wait must not sit behind a real load-settle wait.
        NITRO_UI_LOAD_SETTLE_TIMEOUT_MS: '0',
        NITRO_UI_SIMCTL_BIN: join(bins, 'simctl'),
        NITRO_UI_ADB_BIN: join(bins, 'adb'),
        EMULATOR_BIN: join(bins, 'emulator'),
        NITRO_UI_FAKE_CALLS: calls,
        // Where the stateful stubs keep "is this device up?", one file per platform.
        NITRO_UI_FAKE_STATE: join(home, 'fake-state'),
        // `acquire` asks about Metro ports; the helper answers that nothing is listening.
        ...FREE_LSOF,
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

  /** A leases.json with exactly these leases. */
  const withLeaseFile = (leases) => {
    writeFileSync(
      join(home, 'leases.json'),
      `${JSON.stringify({ leases }, null, 2)}\n`
    );
  };

  /**
   * A live gate claim, as `gate.mjs` writes it. The pid is this test process's: the CLI child
   * checks liveness for real, and a made-up pid would read as a claim from a dead process.
   */
  const CLAIM = [
    { pid: process.pid, id: 'gate-1', gate: 'harness:ios', at: Date.now() },
  ];

  /** A second record in `pool.json`, for a case that is about a *pair* rather than one device. */
  const warmDeviceSecond = (entry) => {
    const existing = poolDevices();
    writeFileSync(
      join(home, 'pool.json'),
      `${JSON.stringify({ version: 1, devices: [...existing, entry] }, null, 2)}\n`
    );
  };

  /**
   * Seeds the stateful stub's idea that one device is already up (`android-emulator-5576`, or
   * an iOS udid).
   */
  const seedUp = (which) => {
    writeFileSync(join(home, `fake-state.${which}`), 'up\n');
  };

  /** A pool.json with one warm device, idle for `minutes`. */
  const warmDevice = (entry) => {
    writeFileSync(
      join(home, 'pool.json'),
      `${JSON.stringify({ version: 1, devices: [entry] }, null, 2)}\n`
    );
  };
  /** A warm record as the pool would write it. `kind` is the platform; the key prefix is `avd:`. */
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
    expect(log()).toBe('');
    expect(poolDevices()).toEqual([]);
  });

  it('boots nothing when the shell running the suite has NITRO_UI_LEASE_BOOT=1', () => {
    // Poisoned on `process.env` itself, as a sourced lease does: the CLI child must see the
    // test's environment, not the caller's.
    tools({ stateful: true });
    const saved = process.env.NITRO_UI_LEASE_BOOT;
    process.env.NITRO_UI_LEASE_BOOT = '1';
    try {
      const acquired = cli(['acquire', '--task', 'T1']);
      expect(acquired.status).toBe(0);
      expect(acquired.stderr).toContain('devices not booted');
      expect(log()).not.toContain('emulator @');
      expect(log()).not.toContain('simctl boot');
    } finally {
      if (saved === undefined) delete process.env.NITRO_UI_LEASE_BOOT;
      else process.env.NITRO_UI_LEASE_BOOT = saved;
    }
  });

  it('boots the pair it hands out when told to, from the shared launch config', () => {
    tools({ androidUp: true, iosUp: true });
    const acquired = cli(['acquire', '--task', 'T1', '--boot']);
    expect(acquired.status).toBe(0);
    expect(acquired.stderr).toContain('is already up - reusing it');
    expect(log()).not.toContain('emulator @');
    expect(log()).not.toContain('simctl boot');
    expect(poolDevices().map((x) => x.key)).toEqual([
      'avd:nitro-ui-a',
      `ios:${UDID_A}`,
    ]);
    // A warm hand-off sends a serial nothing but the readiness probe.
    for (const line of log().split('\n')) {
      if (line.includes(`-s ${SERIAL_A}`)) {
        expect(line).toContain('getprop sys.boot_completed');
      }
    }
  });

  // An iOS-only lease must not address the emulator: it may be another task's device.
  it('touches only the simulator for an iOS-only lease', () => {
    tools({ androidUp: false, iosUp: false });
    const acquired = cli([
      'acquire',
      '--task',
      'Q9',
      '--platform',
      'ios',
      '--boot',
      '--boot-timeout-minutes',
      '0',
    ]);
    expect(acquired.status).toBe(0);
    expect(log()).toContain(`simctl boot ${UDID_A}`);
    // Nothing addressed to the emulator at all: `adb devices` lists the machine and is not a
    // command *to* a device, but `-s <serial>` and `emulator @avd` both are.
    expect(log()).not.toContain(`-s ${SERIAL_A}`);
    expect(log()).not.toContain('emulator @');
    expect(acquired.stdout).not.toContain('ANDROID_SERIAL');
  });

  it('touches only the emulator for an Android-only lease', () => {
    tools({ androidUp: false, iosUp: false });
    const acquired = cli([
      'acquire',
      '--task',
      'A1',
      '--platform',
      'android',
      '--boot',
      '--boot-timeout-minutes',
      // The emulator is spawned detached, so a zero-second wait returns before its stub has
      // written its line; this is the same short-but-real wait the boot cases below use.
      '0.02',
    ]);
    expect(acquired.status).toBe(0);
    expect(log()).toContain('emulator @nitro-ui-a -port 5574');
    expect(log()).not.toContain('simctl boot');
    expect(log()).not.toContain('simctl shutdown');
    expect(log()).not.toContain(UDID_A);
    expect(acquired.stdout).not.toContain('IOS_SIM_UDID');
  });

  it('keeps a re-acquired iOS lease on iOS when the second acquire names no platform', () => {
    // `--platform` defaults to `both`; the lease is for iOS, so the default must not widen it.
    tools({ androidUp: false, iosUp: false });
    withLeaseFile([
      {
        id: 'Q9-aaaa',
        task: 'Q9',
        platform: 'ios',
        exclusive: false,
        holds: ['pair-a'],
        acquiredAt: new Date().toISOString(),
        ttlMinutes: 240,
      },
    ]);
    const acquired = cli([
      'acquire',
      '--task',
      'Q9',
      '--boot',
      '--boot-timeout-minutes',
      '0',
    ]);
    expect(acquired.status).toBe(0);
    expect(log()).toContain(`simctl boot ${UDID_A}`);
    expect(log()).not.toContain('emulator @');
    expect(log()).not.toContain(`-s ${SERIAL_A}`);
    expect(acquired.stdout).not.toContain('ANDROID_SERIAL');
  });

  it('starts a device that is down, and records the boot on the lease', () => {
    // Nothing is up and the stub emulator stays down, so the lease comes back at its timeout.
    // The env names a display server and clears the GPU override, so the emulator's GPU mode
    // is `host` on any machine that runs this.
    const acquired = cli(
      ['acquire', '--task', 'T2', '--boot', '--boot-timeout-minutes', '0.02'],
      { DISPLAY: ':99', NITRO_UI_EMULATOR_GPU: '' }
    );
    expect(acquired.status).toBe(0);
    expect(acquired.stderr).toContain('booting android device nitro-ui-a:5574');
    expect(acquired.stderr).toContain('did not come up');
    expect(log()).toContain('emulator @nitro-ui-a -port 5574');
    expect(log()).toContain('-gpu host');
    expect(log()).toContain(`simctl boot ${UDID_A}`);
    // Headless: the pool that opens Simulator.app boots a device no lease handed out.
    expect(log()).not.toContain('open');
    // This fixture's device never comes up, so the wait it reports is the timeout.
    expect(acquired.stderr).toMatch(/boot wait took [\d.]+s/);
  });

  it('leaves a leased device alone while it was told not to boot', () => {
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
    // A live lease holds pair-a, so 120 idle minutes do not make its device reapable.
    expect(acquired.stderr).not.toContain('shutting down emulator');
    expect(log()).not.toContain(`${SERIAL_A} emu kill`);
    expect(poolDevices().map((x) => x.key)).toEqual([`avd:${AVD_A}`]);
    // Asked directly, the answer names the reason rather than the clock.
    const asked = cli(['reap']);
    expect(asked.stderr).toContain(
      `keeping avd:${AVD_A} up (a live lease holds it)`
    );
  });

  it('lets an operator override reach only devices nobody leases', () => {
    tools({ androidUp: true });
    warmDevice(idleEntry({ leaseId: 'T3-aaaa', idleMinutes: 5 }));
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
              acquiredAt: Date.now() - 5 * MINUTE,
              ttlMinutes: 240,
            },
          ],
        },
        null,
        2
      )}\n`
    );
    const reaped = cli(['reap', '--idle-minutes', '0']);
    expect(reaped.status).toBe(0);
    expect(reaped.stderr).toContain('a live lease holds it');
    expect(log()).not.toContain('emu kill');
    // Release the lease, and the same command powers it off.
    expect(cli(['release', 'T3-aaaa']).status).toBe(0);
    expect(cli(['reap', '--idle-minutes', '0']).status).toBe(0);
    expect(log()).toContain(`adb -P 5043 -s ${SERIAL_A} emu kill`);
    expect(poolDevices()).toEqual([]);
  });

  it('never reaches for a serial that belongs to another pair under a lease', () => {
    // The record for pair-a names pair-b's serial while a live lease holds pair-b.
    tools({ androidUp: true });
    warmDevice(idleEntry({ serial: 'emulator-5576' }));
    writeFileSync(
      join(home, 'leases.json'),
      `${JSON.stringify(
        {
          leases: [
            {
              id: 'B7-zzzz',
              task: 'B7',
              platform: 'both',
              exclusive: false,
              holds: ['pair-b'],
              acquiredAt: Date.now() - 5 * MINUTE,
              ttlMinutes: 240,
            },
          ],
        },
        null,
        2
      )}\n`
    );
    const reaped = cli(['reap', '--idle-minutes', '0']);
    expect(reaped.status).toBe(0);
    // Nothing was addressed to pair-b's adb server or its serial.
    expect(log()).not.toContain('emulator-5576');
    expect(log()).not.toContain('-P 5045');
    expect(reaped.stderr).toContain(
      `the record says emulator-5576, devices.json says ${SERIAL_A}`
    );
    expect(log()).toContain(`adb -P 5043 -s ${SERIAL_A} emu kill`);
    expect(poolDevices()).toEqual([]);
  });

  it('refuses to power a device off when it will not identify itself', () => {
    tools({ androidUp: true });
    warmDevice(idleEntry());
    const reaped = cli(['reap', '--idle-minutes', '0'], {
      NITRO_UI_FAKE_AVD_NAME: 'somebody-elses-avd',
    });
    expect(reaped.status).toBe(0);
    expect(log()).not.toContain('emu kill');
    expect(reaped.stderr).toContain('answers to AVD somebody-elses-avd');
    expect(poolDevices().map((x) => x.key)).toEqual([`avd:${AVD_A}`]);
  });

  it('powers a device off once it identifies itself', () => {
    tools({ androidUp: true });
    warmDevice(idleEntry());
    expect(cli(['reap', '--idle-minutes', '0']).status).toBe(0);
    expect(log()).toContain(`adb -P 5043 -s ${SERIAL_A} emu avd name`);
    expect(log()).toContain(`adb -P 5043 -s ${SERIAL_A} emu kill`);
    expect(poolDevices()).toEqual([]);
  });

  it('keeps a device whose lease date it cannot read', () => {
    tools({ androidUp: true });
    warmDevice(idleEntry({ leaseId: 'H5-iso0' }));
    writeFileSync(
      join(home, 'leases.json'),
      `${JSON.stringify(
        {
          leases: [
            {
              id: 'H5-iso0',
              task: 'H5',
              platform: 'both',
              exclusive: false,
              holds: ['pair-a'],
              acquiredAt: 'not a date at all',
              ttlMinutes: 240,
            },
          ],
        },
        null,
        2
      )}\n`
    );
    const reaped = cli(['reap', '--idle-minutes', '0']);
    expect(reaped.status).toBe(0);
    expect(log()).not.toContain('emu kill');
    expect(reaped.stderr).toContain('a live lease holds it');
  });

  it('never reaps from `acquire`, idle device or not', () => {
    tools({ androidUp: true });
    warmDevice(idleEntry({ leaseId: 'gone' }));
    const acquired = cli(['acquire', '--task', 'T1', '--no-boot']);
    expect(acquired.status).toBe(0);
    expect(acquired.stderr).not.toContain('shutting down emulator');
    expect(log()).not.toContain('emu kill');
    expect(poolDevices()).toHaveLength(1);
    // The explicit command reaches the same record once nothing leases it.
    expect(cli(['release', 'T1']).status).toBe(0);
    const reaped = cli(['reap']);
    expect(reaped.status).toBe(0);
    expect(reaped.stderr).toContain('shutting down emulator');
    expect(log()).toContain(`adb -P 5043 -s ${SERIAL_A} emu kill`);
    expect(poolDevices()).toEqual([]);
  });

  it('never reaps from `list`, which is the command every task runs most', () => {
    // The lease is live and nothing is claimed, as during a build or a Metro session.
    tools({ androidUp: true });
    warmDevice(idleEntry({ leaseId: 'T1-aaaa' }));
    withLeaseFile([
      {
        id: 'T1-aaaa',
        task: 'T1',
        platform: 'both',
        exclusive: false,
        holds: ['pair-a'],
        acquiredAt: new Date().toISOString(),
        ttlMinutes: 240,
      },
    ]);
    const listed = cli(['list']);
    expect(listed.status).toBe(0);
    expect(listed.stdout).toContain('avd:nitro-ui-a');
    expect(log()).not.toContain('emu kill');
    expect(poolDevices()).toHaveLength(1);
  });

  it('never reaps from `release` — the devices it just let go are the warm ones', () => {
    tools({ androidUp: true });
    warmDevice(idleEntry({ leaseId: 'T1-aaaa', idleMinutes: 31 }));
    withLeaseFile([
      {
        id: 'T1-aaaa',
        task: 'T1',
        platform: 'both',
        exclusive: false,
        holds: ['pair-a'],
        acquiredAt: new Date().toISOString(),
        ttlMinutes: 240,
      },
    ]);
    const released = cli(['release', 'T1']);
    expect(released.status).toBe(0);
    expect(released.stdout).toContain('released T1-aaaa');
    expect(log()).not.toContain('emu kill');
    expect(poolDevices()).toHaveLength(1);
  });

  it('honours `reap --idle-minutes 0` over devices.json, as power-off now', () => {
    // devices.json says 30 in this fixture and the device is five minutes idle, so the plain
    // reap keeps it.
    tools({ androidUp: true });
    warmDevice(idleEntry({ idleMinutes: 5 }));
    const kept = cli(['reap']);
    expect(kept.stderr).toContain('keeping avd:nitro-ui-a');
    expect(log()).not.toContain('emu kill');
    const reaped = cli(['reap', '--idle-minutes', '0']);
    expect(reaped.status).toBe(0);
    expect(log()).toContain(`adb -P 5043 -s ${SERIAL_A} emu kill`);
    expect(poolDevices()).toEqual([]);
  });

  it('takes the whole device lifecycle offline for NITRO_UI_LEASE_BOOT=0', () => {
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
    // An AVD the state file names from an older run, a hand edit, or a devices.json swap.
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
    expect(listed.stdout).toContain(SERIAL_A);
  });

  it('will not power off a device a live process has claimed', () => {
    // The pid is this test process's, so every reap must treat the device as busy.
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
    // Stateful, because the case is a sequence: power the pool off, then boot what the lease
    // names. Pair-b's emulator is up and idle and is the one to kill; pair-a's own devices
    // start down, so their boot below is a real boot.
    tools({ androidUp: false, iosUp: false, stateful: true });
    seedUp('android-emulator-5576');
    // With a record, so its removal below is observable.
    warmDevice(
      idleEntry({
        key: `avd:${AVD_B}`,
        serial: 'emulator-5576',
        idleMinutes: 4,
      })
    );
    const acquired = cli([
      'acquire',
      '--task',
      'BENCH',
      '--exclusive',
      '--boot',
      // An exclusive `--boot` has to name its platform.
      '--platform',
      'both',
    ]);
    expect(acquired.status).toBe(0);
    expect(acquired.stderr).toContain('exclusive');
    // Addressed through pair-b's own adb server (5045), as the pair declares.
    expect(log()).toContain('adb -P 5045 -s emulator-5576 emu kill');
    expect(acquired.stderr).toContain('shut down avd:nitro-ui-b');
    expect(poolDevices().map((x) => x.key)).not.toContain(`avd:${AVD_B}`);
    expect(acquired.stderr).toContain('booting android device nitro-ui-a:5574');
    // The pair the lease was handed is recorded as warm.
    expect(
      poolDevices()
        .map((x) => x.key)
        .sort()
    ).toEqual([`avd:${AVD_A}`, `ios:${UDID_A}`]);
  });

  it('boots the pair an exclusive lease names, after the power-off (X16 item 2)', () => {
    // Pair-b's emulator is the one to kill; pair-a's own devices start down, so the hand-off
    // has a real boot to do after it.
    tools({ androidUp: false, iosUp: false, stateful: true });
    seedUp('android-emulator-5576');
    const acquired = cli([
      'acquire',
      '--task',
      'BENCH',
      '--exclusive',
      '--boot',
      // An exclusive `--boot` has to name its platform.
      '--platform',
      'both',
    ]);
    expect(acquired.status).toBe(0);
    const logLines = log()
      .split('\n')
      .filter((line) => line !== '');
    const killed = logLines.findIndex((line) => line.includes('emu kill'));
    const booted = logLines.findIndex((line) => line.includes('emulator @'));
    expect(killed).toBeGreaterThanOrEqual(0);
    expect(booted).toBeGreaterThanOrEqual(0);
    // A boot that ran before the reap would have been powered off by it.
    expect(booted).toBeGreaterThan(killed);
    // Headless and on the pair's own console port, as every other pool boot is.
    expect(log()).toContain(`emulator @${AVD_A} -port 5574`);
    // iOS half: `simctl boot`, never `open -a Simulator` (that boots a device no lease handed out).
    expect(log()).toContain(`simctl boot ${UDID_A}`);
    expect(log()).not.toContain('open -a');
    expect(acquired.stderr).toMatch(/boot wait took [\d.]+s/);
    expect(acquired.stderr).not.toContain('did not come up');
  });

  it('boots only the platform an exclusive lease was taken for', () => {
    // The emulator starts down and the simulator up: `--platform android` spares only its own
    // platform's device, so the up simulator is still powered off.
    tools({ androidUp: false, iosUp: true, stateful: true });
    const acquired = cli([
      'acquire',
      '--task',
      'BENCH',
      '--exclusive',
      '--platform',
      'android',
      '--boot',
    ]);
    expect(acquired.status).toBe(0);
    expect(acquired.stderr).toContain('booting android device nitro-ui-a:5574');
    expect(log()).toContain('emulator @');
    expect(log()).not.toContain(`simctl boot ${UDID_A}`);
    // The simulator went down with the rest of the pool and stayed down.
    expect(log()).toContain(`simctl shutdown ${UDID_A}`);
    expect(
      poolDevices()
        .map((x) => x.key)
        .sort()
    ).toEqual([`avd:${AVD_A}`, `ios:${UDID_A}`].sort());
  });

  it('powers the pool off for an exclusive lease that did not ask for a boot', () => {
    tools({ androidUp: true });
    warmDevice(idleEntry({ idleMinutes: 4 }));
    const acquired = cli(['acquire', '--task', 'BENCH', '--exclusive']);
    expect(acquired.status).toBe(0);
    expect(log()).toContain(`adb -P 5043 -s ${SERIAL_A} emu kill`);
    expect(poolDevices()).toEqual([]);
    // And it boots nothing: that part of the promise is unchanged.
    expect(log()).not.toContain('emulator @');
    expect(log()).not.toContain('simctl boot');
  });

  // An exclusive `--boot` with no `--platform` is refused before the lease exists, so the
  // refusal cannot already have powered the pool off.
  it('lists --boot in its usage, and says an exclusive boot needs --platform', () => {
    // Matched as a flag of its own: `--no-boot` and `--boot-timeout-minutes` both contain the
    // text `--boot`.
    const bare = spawnSync(process.execPath, [CLI], {
      encoding: 'utf8',
      env: { ...withoutLeaseEnv(process.env), NITRO_UI_HOME: home },
    });
    expect(bare.status).toBe(2);
    expect(bare.stderr).toMatch(/\[--boot\]/);
    expect(bare.stderr).toMatch(/--exclusive --boot needs --platform/);
    // The refusal of that combination prints the same usage.
    tools({ stateful: true });
    const refused = cli([
      'acquire',
      '--task',
      'BENCH',
      '--exclusive',
      '--boot',
    ]);
    expect(refused.status).toBe(2);
    expect(refused.stderr).toMatch(/--exclusive --boot needs --platform/);
  });

  it('refuses an exclusive boot that did not name a platform, and takes nothing', () => {
    tools({ androidUp: true, iosUp: true, stateful: true });
    const acquired = cli([
      'acquire',
      '--task',
      'BENCH',
      '--exclusive',
      '--boot',
    ]);
    expect(acquired.status).toBe(2);
    expect(acquired.stderr).toContain('--platform');
    // Not a partial success: no lease was written...
    expect(acquired.stdout).not.toContain('NITRO_UI_LEASE_ID');
    // ...no device was powered off...
    expect(log()).not.toContain('emu kill');
    expect(log()).not.toContain('simctl shutdown');
    // ...and nothing was booted.
    expect(log()).not.toContain('emulator @');
    expect(log()).not.toContain('simctl boot');
  });

  it('still boots both devices when a platform of `both` was actually typed', () => {
    // The refusal is about a defaulted flag, not about the value.
    tools({ androidUp: false, iosUp: false, stateful: true });
    const acquired = cli([
      'acquire',
      '--task',
      'BENCH',
      '--exclusive',
      '--boot',
      '--platform',
      'both',
    ]);
    expect(acquired.status).toBe(0);
    expect(log()).toContain('emulator @');
    expect(log()).toContain(`simctl boot ${UDID_A}`);
  });

  it('spares both of the pair when `--platform both` is typed and both are up', () => {
    tools({ androidUp: true, iosUp: true, stateful: true });
    const acquired = cli([
      'acquire',
      '--task',
      'BENCH',
      '--exclusive',
      '--boot',
      '--platform',
      'both',
    ]);
    expect(acquired.status).toBe(0);
    expect(log()).not.toContain('emulator @');
    expect(log()).not.toContain(`simctl boot ${UDID_A}`);
    expect(acquired.stderr).toContain('spared avd:nitro-ui-a');
    expect(acquired.stderr).toContain(`spared ios:${UDID_A}`);
    // And the summary does not claim a machine that was not powered down.
    expect(acquired.stderr).toContain('2 spared');
    expect(acquired.stderr).not.toContain(
      'every device no other lease holds is off ('
    );
  });

  it('boots nothing for an exclusive lease when only the environment asked for a boot', () => {
    // Only a typed `--boot` may boot an exclusive lease; `NITRO_UI_LEASE_BOOT=1` does not.
    tools({ androidUp: true, iosUp: true, stateful: true });
    const acquired = cli(['acquire', '--task', 'BENCH', '--exclusive'], {
      NITRO_UI_LEASE_BOOT: '1',
    });
    expect(acquired.status).toBe(0);
    expect(acquired.stderr).toContain('not booted');
    expect(log()).not.toContain('emulator @');
    expect(log()).not.toContain('simctl boot');
    // The power-off does not depend on `--boot`.
    expect(log()).toContain(`adb -P 5043 -s ${SERIAL_A} emu kill`);
  });

  it('says the environment was ignored, rather than staying silent about a boot that did not come', () => {
    tools({ androidUp: true, stateful: true });
    const acquired = cli(['acquire', '--task', 'BENCH', '--exclusive'], {
      NITRO_UI_LEASE_BOOT: '1',
    });
    expect(acquired.stderr).toContain('NITRO_UI_LEASE_BOOT');
    expect(acquired.stderr).toContain('--boot');
  });

  it("leaves the bench's own warm device up instead of cold-starting it (X16 item 3)", () => {
    // Pair-a's emulator is already up and idle: killing it would only cost a reboot of the
    // one device the lease is about to use.
    tools({ androidUp: true, iosUp: true, stateful: true });
    warmDevice(
      idleEntry({ key: `avd:${AVD_A}`, idleMinutes: 4, leaseId: null })
    );
    const acquired = cli([
      'acquire',
      '--task',
      'BENCH',
      '--exclusive',
      '--boot',
      '--platform',
      'android',
    ]);
    expect(acquired.status).toBe(0);
    expect(log()).not.toContain(`adb -P 5043 -s ${SERIAL_A} emu kill`);
    // It stays up, so there is no boot to wait for and no boot cost to pay.
    expect(log()).not.toContain('emulator @');
    expect(acquired.stderr).toMatch(/already up|reusing/i);
    // The iOS half of the pool is still powered off: `--platform android` says which half this
    // lease will use, not which half of the machine may keep running.
    expect(log()).toContain(`simctl shutdown ${UDID_A}`);
    expect(acquired.stderr).toContain('spared');
  });

  it("still kills the bench's own device when it is not up, so the promise is kept", () => {
    // The spare applies only to a device that is up.
    tools({ androidUp: false, iosUp: false, stateful: true });
    warmDevice(idleEntry({ key: `avd:${AVD_A}`, idleMinutes: 4 }));
    const acquired = cli([
      'acquire',
      '--task',
      'BENCH',
      '--exclusive',
      '--boot',
      '--platform',
      'android',
    ]);
    expect(acquired.status).toBe(0);
    expect(acquired.stderr).not.toContain('spared');
    expect(log()).toContain('emulator @');
  });

  it("spares only the named platform's own device", () => {
    tools({ androidUp: true, iosUp: true, stateful: true });
    warmDevice(
      idleEntry({
        key: `avd:${AVD_A}`,
        idleMinutes: 4,
        serial: SERIAL_A,
      })
    );
    warmDeviceSecond(
      idleEntry({ key: `ios:${UDID_A}`, idleMinutes: 4, serial: null })
    );
    const acquired = cli([
      'acquire',
      '--task',
      'BENCH',
      '--exclusive',
      '--boot',
      '--platform',
      'android',
    ]);
    expect(acquired.status).toBe(0);
    expect(log()).not.toContain(`adb -P 5043 -s ${SERIAL_A} emu kill`);
    expect(log()).toContain(`simctl shutdown ${UDID_A}`);
    // The spared emulator is not counted as something this command powered off.
    expect(acquired.stderr).toMatch(/1 shut down/);
  });

  it('counts a spared device once, not again as held by a lease', () => {
    // The pool keeps the spared device on its own rule (this lease holds it), and the summary
    // must not also report it as held by a lease: no other lease is live here.
    tools({ androidUp: true, iosUp: true, stateful: true });
    warmDevice(
      idleEntry({
        key: `avd:${AVD_A}`,
        idleMinutes: 4,
        serial: SERIAL_A,
      })
    );
    warmDeviceSecond(
      idleEntry({ key: `ios:${UDID_A}`, idleMinutes: 4, serial: null })
    );
    const acquired = cli([
      'acquire',
      '--task',
      'BENCH',
      '--exclusive',
      '--boot',
      '--platform',
      'android',
    ]);
    expect(acquired.status).toBe(0);
    const summary = acquired.stderr
      .split('\n')
      .find((line) => line.startsWith('lease: exclusive - '));
    expect(summary).toContain('1 spared');
    expect(summary).not.toContain('held by a lease');
  });

  it('still counts a device kept for somebody else beside a spared one', () => {
    // The simulator carries a live run's claim, so the pool keeps it up and the summary must
    // still count it.
    tools({ androidUp: true, iosUp: true, stateful: true });
    warmDevice(
      idleEntry({
        key: `avd:${AVD_A}`,
        idleMinutes: 4,
        serial: SERIAL_A,
      })
    );
    warmDeviceSecond(
      idleEntry({
        key: `ios:${UDID_A}`,
        idleMinutes: 4,
        serial: null,
        claims: CLAIM,
      })
    );
    const acquired = cli([
      'acquire',
      '--task',
      'BENCH',
      '--exclusive',
      '--boot',
      '--platform',
      'android',
    ]);
    expect(acquired.status).toBe(0);
    expect(log()).not.toContain(`simctl shutdown ${UDID_A}`);
    const summary = acquired.stderr
      .split('\n')
      .find((line) => line.startsWith('lease: exclusive - '));
    expect(summary).toContain('1 spared');
    expect(summary).toContain('1 held by a lease');
  });

  it('powers off a pool device that was booted outside the pool, for an exclusive lease', () => {
    // No `pool.json` record: the exclusive power-off enumerates devices.json, not the records.
    tools({ androidUp: true });
    const acquired = cli(['acquire', '--task', 'BENCH', '--exclusive']);
    expect(acquired.status).toBe(0);
    expect(log()).toContain(`adb -P 5043 -s ${SERIAL_A} emu kill`);
  });

  it("leaves another task's device up under an exclusive lease, and says so", () => {
    tools({ androidUp: true });
    warmDevice(idleEntry({ idleMinutes: 4 }));
    writeFileSync(
      join(home, 'leases.json'),
      `${JSON.stringify(
        {
          leases: [
            {
              id: 'T7-live',
              task: 'T7',
              platform: 'both',
              exclusive: false,
              holds: ['pair-a'],
              acquiredAt: Date.now() - 2 * MINUTE,
              ttlMinutes: 240,
            },
          ],
        },
        null,
        2
      )}\n`
    );
    const acquired = cli([
      'acquire',
      '--task',
      'BENCH',
      '--exclusive',
      '--wait-minutes',
      '0',
    ]);
    // Refused outright: an exclusive lease waits for every other lease to end.
    expect(acquired.status).toBe(1);
    expect(acquired.stderr).toContain('T7');
    expect(log()).not.toContain('emu kill');
    expect(poolDevices().map((x) => x.key)).toEqual([`avd:${AVD_A}`]);
  });

  it('refuses to reap on a corrupt pool.json, and says which file', () => {
    writeFileSync(join(home, 'pool.json'), 'not json at all');
    const reaped = cli(['reap']);
    expect(reaped.status).toBe(0);
    expect(reaped.stderr).toMatch(/reap skipped \(pool state was unreadable/);
    expect(reaped.stderr).toMatch(/pool\.json - nothing is powered off/);
    expect(log()).not.toContain('emu kill');
    // The refusal leaves the file as it found it.
    expect(readFileSync(join(home, 'pool.json'), 'utf8')).toBe(
      'not json at all'
    );
    expect(listHome('pool.json.corrupt-')).toHaveLength(0);
  });

  it('reaps nothing on an exclusive acquire either, when the pool state was unreadable', () => {
    // `--exclusive` builds its kill list from devices.json, so it could find pair-b without a
    // readable pool.json. It still must not kill anything.
    tools({ androidUp: true });
    writeFileSync(join(home, 'pool.json'), '{"devices": [truncated');
    const acquired = cli(['acquire', '--task', 'BENCH', '--exclusive']);
    expect(acquired.status).toBe(0);
    expect(acquired.stderr).toMatch(/reap skipped \(pool state was unreadable/);
    expect(acquired.stderr).toContain('the pool was NOT powered off');
    expect(acquired.stderr).not.toContain(
      'every device no other lease holds is off'
    );
    expect(log()).not.toContain('emu kill');
    // The lease still exists: naming a pair does not need the pool's memory, only killing does.
    expect(acquired.stdout).toContain('NITRO_UI_LEASE_ID');
  });

  it('keeps a corrupt pool.json as evidence and carries on leasing', () => {
    // A plain `acquire` neither writes the pool nor reaps from it, so the corrupt file
    // survives untouched.
    writeFileSync(join(home, 'pool.json'), 'not json at all');
    const acquired = cli(['acquire', '--task', 'T9', '--no-boot']);
    expect(acquired.status).toBe(0);
    expect(acquired.stdout).toContain('NITRO_UI_LEASE_ID');
    expect(readFileSync(join(home, 'pool.json'), 'utf8')).toBe(
      'not json at all'
    );
    expect(listHome('pool.json.corrupt-')).toHaveLength(0);
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
