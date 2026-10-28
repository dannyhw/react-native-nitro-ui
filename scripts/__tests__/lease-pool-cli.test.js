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
const AVD_A = 'nitro-ui-a';

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
  /**
   * What `pm clear` answers, in order, with the last one repeating.
   *
   * Every pattern requires the word `shell`, because that is the whole of M1: `adb -s X pm clear Y`
   * is not a command — adb answers `unknown command pm` on stderr with empty stdout and exit 1,
   * which this table would happily have reported as "the device refused to clear". Requiring
   * `shell` in the match means a reset that drops it matches nothing, prints nothing, and the
   * cases that assert a successful reset go red instead of quietly passing.
   */
  const pmClearLines = {
    success: [`  *'shell pm clear'*) printf 'Success' ;;`],
    settle: [
      // The counter file lives next to the calls file, so a test run in a fresh home starts clean.
      `  *'shell pm clear'*)`,
      `      n=$(cat "$NITRO_UI_FAKE_CALLS.count" 2>/dev/null || echo 0)`,
      `      n=$((n+1)); printf '%s' "$n" > "$NITRO_UI_FAKE_CALLS.count"`,
      `      if [ "$n" -lt 3 ]; then printf 'Failed'; else printf 'Success'; fi ;;`,
    ],
    fail: [`  *'shell pm clear'*) printf 'Failed' ;;`],
    // The device-side command refusing, as it does for a package that is not installed.
    unknownPackage: [
      `  *'shell pm clear'*) printf 'Error: unknown package\\n' ; exit 1 ;;`,
    ],
  };

  const tools = ({
    androidUp = false,
    iosUp = false,
    pmClear = 'success',
  } = {}) => {
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
    //
    // `simctl` answers by subcommand, because the pool now asks it three different questions: which
    // devices exist, "remove this app" (M2's reset), and "where is its data container?". The last
    // one has to fail after an uninstall - a stub that printed the same JSON for every call made the
    // reset read "the data container survived" on a device that had just had the app removed.
    const simctlLines = [
      '#!/bin/sh',
      'echo "simctl $*" >> "$NITRO_UI_FAKE_CALLS"',
      'case "$*" in',
      // Two different questions come through `get_app_container`, and one stub answer for both is
      // how a reset starts lying: `… app` is "is it installed?" (X11 N5, asked *before* the reset),
      // `… data` is "did the uninstall take the data with it?" (M2, asked after, and the honest
      // answer here is no container). Installed by default, because that is what a pooled simulator
      // is; `NITRO_UI_FAKE_APP_INSTALLED=0` is the fresh device.
      "  *'get_app_container'*' app'*)",
      '      if [ "${NITRO_UI_FAKE_APP_INSTALLED-1}" = 1 ]; then',
      "        printf '%s\\n' '/Users/x/Library/Developer/CoreSimulator/Devices/UDID-A/bundle/NitroUiExample.app'",
      '      else',
      "        printf '%s\\n' 'Unable to find application container' ; exit 1",
      '      fi ;;',
      "  *'get_app_container'*) exit 1 ;;",
      "  *'uninstall'*) exit 0 ;;",
      "  *'install'*) exit 0 ;;",
      `  *) printf '%s' ${shellQuote(JSON.stringify(listing))} ;;`,
      'esac',
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
      // "Is the package on the device?" (`adb shell pm path <pkg>`), asked before the clear so a
      // fresh AVD is a no-op instead of four retries and a misleading line (X11 N5). Matched ahead
      // of `pm clear`, whose pattern would not match it anyway - the order is only so a reader sees
      // which question comes first.
      "  *'pm path'*)",
      '      if [ "${NITRO_UI_FAKE_PM_PATH-1}" = 1 ]; then',
      "        printf 'package:/data/app/~~abc==/nitroui.example-def=.apk\\n'",
      '      else',
      "        printf 'No package found for user: 0\\n' ; exit 1",
      '      fi ;;',
      // A device that answers `Failed` twice and then `Success`, counted in a file: that is what
      // an emulator whose `sys.boot_completed` is already 1 really does while PackageManager
      // settles, and it is what the first real boot of this code reported as a failed reset.
      ...(pmClearLines[pmClear] ?? pmClearLines.success),
      "  *'emu kill'*) printf 'OK' ;;",
      // Which AVD is behind a serial (`adb -s X emu avd name`), answered the way a real emulator
      // does it - name, then `OK`. This is the identity check in front of every `emu kill` (X11
      // review M4), so a stub that stayed silent about it would make every shutdown answer
      // "unidentified" and the reaper would look like it worked by never doing anything. The table
      // mirrors devices.example.json; `NITRO_UI_FAKE_AVD_NAME` is what a device that disagrees with
      // it answers.
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

  /** A leases.json with exactly these leases, so a case can be "somebody holds this pair right now". */
  const withLeaseFile = (leases) => {
    writeFileSync(
      join(home, 'leases.json'),
      `${JSON.stringify({ leases }, null, 2)}\n`
    );
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
    // devices is the load this machine cannot afford - an iOS simulator boot alone takes `load1` to
    // 58-74 on this box (X11 report item 6), and a cold boot is the whole reason the pool exists.
    expect(log()).toBe('');
    expect(poolDevices()).toEqual([]);
  });

  it('boots the pair it hands out when told to, from the shared launch config', () => {
    tools({ androidUp: true, iosUp: true });
    const acquired = cli(['acquire', '--task', 'T1', '--boot']);
    expect(acquired.status).toBe(0);
    // Both devices were already up, so nothing should have been started - the warm path is the
    // common one, and paying for a boot that was not needed is the bug this path exists to avoid.
    expect(acquired.stderr).toContain('is already up - reusing it');
    expect(log()).not.toContain('emulator @');
    expect(log()).not.toContain('simctl boot');
    expect(poolDevices().map((x) => x.key)).toEqual([
      'avd:nitro-ui-a',
      `ios:${UDID_A}`,
    ]);
    expect(log()).toContain(`adb -P 5043 -s ${SERIAL_A} shell pm clear`);
    // And on iOS, a reset that is actually a reset (M2): the app is removed, which takes its data
    // container with it, and the pool checks the container is gone rather than trusting `install`.
    expect(log()).toContain(`simctl uninstall ${UDID_A} nitroui.example`);
    expect(log()).toContain(
      `simctl get_app_container ${UDID_A} nitroui.example data`
    );
  });

  it('reinstalls the app after an iOS reset when HARNESS_APP_PATH is set', () => {
    // Uninstall is only safe because every consumer installs first. When the pool can see the
    // build, it puts the app back so a device never leaves the pool empty for something that does
    // not (and the row says it did).
    const app = join(home, 'NitroUiExample.app');
    writeFileSync(app, 'not really an app bundle');
    tools({ androidUp: true, iosUp: true });
    const acquired = cli(['acquire', '--task', 'T15', '--boot'], {
      HARNESS_APP_PATH: app,
    });
    expect(acquired.status).toBe(0);
    expect(log()).toContain(`simctl uninstall ${UDID_A} nitroui.example`);
    expect(log()).toContain(`simctl install ${UDID_A} ${app}`);
    expect(acquired.stderr).toContain('reset ios:');
    expect(acquired.stderr).not.toContain('FAILED');
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
    // And it says what the wait cost (N4): the docs' "54 s"/"~200 s" were folklore nobody timed, so
    // the pool prints the number instead of anyone quoting them. This fixture's device never comes
    // up, so the honest reading is the timeout it gave up at.
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
    // Booting is opt-in; reaping is not, and must not be tied to it - but what the reaper may
    // reach is a device *nobody leases* (X11 review M3). T3 holds pair-a under a live lease and 120
    // idle minutes is a debugging session, not an abandoned boot. The automatic reap on `acquire`
    // stays quiet about devices it is keeping, so the load-bearing check is that it never touched
    // the device.
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
    // The other half of M3's alternative: `reap --idle-minutes 0` is "power the pool off now", and
    // a person who wants their machine back gets every *unheld* device off. A leased one is not
    // silently evicted on a flag from somebody else's shell; they are told whose it is, and
    // releasing it is what changes the answer.
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
    // X11 review M4, through the real CLI against stub devices. The record for pair-a names pair-b's
    // serial while a live lease holds pair-b: the old code killed what the record said, which was
    // the *leased* emulator. Now the address comes from the pair, so the only device this command
    // can reach is pair-a's own, and pair-b is never even asked who it is.
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
    // Nothing at all was addressed on pair-b's adb server or its serial: the kill is aimed at the
    // device the *pair* says this record is, and the disagreement is printed instead of obeyed.
    expect(log()).not.toContain('emulator-5576');
    expect(log()).not.toContain('-P 5045');
    expect(reaped.stderr).toContain(
      `the record says emulator-5576, devices.json says ${SERIAL_A}`
    );
    expect(log()).toContain(`adb -P 5043 -s ${SERIAL_A} emu kill`);
    expect(poolDevices()).toEqual([]);
  });

  it('refuses to power a device off when it will not identify itself', () => {
    // The live check in front of every kill: an emulator that is attached but does not answer
    // `adb emu avd name` with the AVD the pool means stays up. Nothing here proves pair-a's
    // emulator is pair-a's, so nothing is powered off, and the record survives to be asked again.
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
    // The same command with a device that answers correctly, so the case above cannot pass by the
    // identity check being absent, mis-parsed, or never reached.
    tools({ androidUp: true });
    warmDevice(idleEntry());
    expect(cli(['reap', '--idle-minutes', '0']).status).toBe(0);
    expect(log()).toContain(`adb -P 5043 -s ${SERIAL_A} emu avd name`);
    expect(log()).toContain(`adb -P 5043 -s ${SERIAL_A} emu kill`);
    expect(poolDevices()).toEqual([]);
  });

  it('keeps a device whose lease date it cannot read', () => {
    // `~/.nitro-ui/leases.json` is a file a person edits. An unreadable `acquiredAt` used to make
    // `now - acquiredAt` NaN, every comparison false, and a live lease read as expired - so the
    // reaper powered off a device mid-suite on the strength of a date format. A lease the pool
    // cannot date is kept: a wedged lease is visible in `list` and removable, a killed device is
    // neither.
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
    // X11 fix round 2's scope decision, at the CLI: a lease is a booking. Round 1's version of this
    // case asserted the opposite — that `acquire --no-boot` reaped an abandoned boot as a side
    // effect — and that side effect is exactly what killed a task's own claim-less run when it ran
    // `lease.mjs list` in its sourced shell (re-review M3's failure scenario). The abandoned boot is
    // still reapable; the command is `lease.mjs reap`, typed by somebody who means it.
    tools({ androidUp: true });
    warmDevice(idleEntry({ leaseId: 'gone' }));
    const acquired = cli(['acquire', '--task', 'T1', '--no-boot']);
    expect(acquired.status).toBe(0);
    expect(acquired.stderr).not.toContain('shutting down emulator');
    expect(log()).not.toContain('emu kill');
    expect(poolDevices()).toHaveLength(1);
    // And the explicit command reaches the same record once nothing leases it, because nothing about
    // the record changed: same fixture, one word more on the command line, device off. Releasing
    // first is also the rule the reap's own message points at - "somebody is using it" is answered
    // by `release`, not by a flag.
    expect(cli(['release', 'T1']).status).toBe(0);
    const reaped = cli(['reap']);
    expect(reaped.status).toBe(0);
    expect(reaped.stderr).toContain('shutting down emulator');
    expect(log()).toContain(`adb -P 5043 -s ${SERIAL_A} emu kill`);
    expect(poolDevices()).toEqual([]);
  });

  it('never reaps from `list`, which is the command every task runs most', () => {
    // The exact shape of the re-review's probe P3: task A holds a live lease, its run has no
    // in-flight claim (a build, Metro, a direct real-input run), and it looks at `list` — which used
    // to reap, exempting its own lease, and power its own emulator off mid-run.
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
    // The command a machine's human types when they want their own machine back. devices.json
    // says 30 in this fixture (and the record carries that 30), and this device is only five
    // minutes idle, so the plain reap keeps it - and used to keep it even when 0 was asked for,
    // because the config value won the comparison. `lease.mjs reap --idle-minutes 0` said
    // "keeping avd:nitro-ui-a up (idle, under the limit)" about the very number the caller
    // overrode.
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

  it('leaves an idle device alone when told not to reap', () => {
    // The device is reported *up* on purpose: a stub that answered "no devices" would let a
    // forced reap pass this case by forgetting the record without ever touching a device, which
    // is what it did the first time round.
    tools({ androidUp: true });
    warmDevice(idleEntry());
    // `lease.mjs reap` rather than `acquire`: since the no-passive-reaping decision, an acquire
    // kills nothing whatever the flags, so the only command that can honour `--no-reap` is the one
    // somebody typed. Both halves are here so this is about the flag and not an unreachable path.
    const suppressed = cli(['reap', '--no-reap']);
    expect(suppressed.status).toBe(0);
    expect(log()).not.toContain('emu kill');
    expect(poolDevices()).toHaveLength(1);
    const reaped = cli(['reap']);
    expect(reaped.status).toBe(0);
    expect(log()).toContain(`adb -P 5043 -s ${SERIAL_A} emu kill`);
    expect(poolDevices()).toEqual([]);
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
    // Where the flag has teeth now: the explicit reap, suppressed.
    expect(cli(['reap', '--no-reap']).status).toBe(0);
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

  it('retries a reset on a device still settling, instead of reporting it failed', () => {
    // The pool resets a device it has just booted, and such a device can answer `Failed` for a
    // few seconds. A single attempt made the lease say "FAILED - the next run inherits its data"
    // about a device that was fine, which is the opposite of what the reset is for.
    tools({ androidUp: true, iosUp: true, pmClear: 'settle' });
    const acquired = cli(['acquire', '--task', 'T1', '--boot']);
    expect(acquired.status).toBe(0);
    expect(acquired.stderr).toContain(
      'reset avd:nitro-ui-a: pm clear (3 tries)'
    );
    expect(acquired.stderr).not.toContain('FAILED');
  });

  it("says so, in the device's own words, when the reset never succeeds", () => {
    tools({ androidUp: true, iosUp: true, pmClear: 'fail' });
    const acquired = cli(['acquire', '--task', 'T1', '--boot']);
    expect(acquired.status).toBe(0);
    // Still a successful lease: a device that cannot be cleared is worth using, and the warning
    // is the honest part. But it quotes `pm clear` rather than inventing a reason.
    expect(acquired.stderr).toContain(
      'reset avd:nitro-ui-a: pm clear FAILED (Failed)'
    );
    expect(acquired.stderr).toContain('the next run inherits its data');
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

  it('powers the pool off for an exclusive lease that did not ask for a boot', () => {
    // X11 review M6. CONTRIBUTING tells a bench host to lease *without* `--boot` (the bench boots
    // its own device, slowly, on purpose) and separately promises that `--exclusive` powers the
    // machine down. The power-off used to live on the boot path only, so the documented invocation
    // left every other task's emulator running under the baseline.
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

  it('powers off a pool device that was booted outside the pool, for an exclusive lease', () => {
    // The exclusive power-off is enumerated from devices.json, not from the records, because the
    // harness boots a cold device itself and a person can start one by hand: no `pool.json` record
    // means nothing to a reaper that only reads records, and the machine is not quiet.
    tools({ androidUp: true });
    const acquired = cli(['acquire', '--task', 'BENCH', '--exclusive']);
    expect(acquired.status).toBe(0);
    expect(log()).toContain(`adb -P 5043 -s ${SERIAL_A} emu kill`);
  });

  it("leaves another task's device up under an exclusive lease, and says so", () => {
    // An exclusive lease means "give me a quiet machine", not "evict whoever is running": the bench
    // is refused while any lease is live, so reaching this point already means nobody else holds a
    // lease - but a device whose lease expired mid-flight is another matter, and the honest answer
    // has to name what it left alone rather than claim the machine is off.
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
    // X11 re-review N1: the same file that round 1 handled well for *leasing* handled badly for
    // killing. `readPool` moved the unparseable file aside and returned an empty pool, and the reap
    // then believed it: "no records, no claims, nothing leased in the records" is precisely the
    // answer that lets an exclusive acquire `emu kill` the device whose live claim was in the file
    // nobody could read. Reading is cheap and the file is the only record of who held what, so a
    // pool that cannot remember powers nothing off, names the file, and leaves it where it is.
    writeFileSync(join(home, 'pool.json'), 'not json at all');
    const reaped = cli(['reap']);
    expect(reaped.status).toBe(0);
    expect(reaped.stderr).toMatch(/reap skipped \(pool state was unreadable/);
    expect(reaped.stderr).toMatch(/pool\.json - nothing is powered off/);
    expect(log()).not.toContain('emu kill');
    // The evidence is not consumed by the refusal: a read that "recovers" by rewriting the file as
    // empty is how the next command becomes confidently, wrongly certain nothing was in use.
    expect(readFileSync(join(home, 'pool.json'), 'utf8')).toBe(
      'not json at all'
    );
    expect(listHome('pool.json.corrupt-')).toHaveLength(0);
  });

  it('reaps nothing on an exclusive acquire either, when the pool state was unreadable', () => {
    // The probe that made this a nit rather than a must-fix: a corrupt file that held a live claim
    // on pair-b whose lease had already gone. `--exclusive` builds its kill list from devices.json
    // (`shutdownKeys`), so it does not need a readable pool.json to *find* pair-b — which is exactly
    // why it must not run at all when the state could not be read.
    tools({ androidUp: true });
    writeFileSync(join(home, 'pool.json'), '{"devices": [truncated');
    const acquired = cli(['acquire', '--task', 'BENCH', '--exclusive']);
    expect(acquired.status).toBe(0);
    expect(acquired.stderr).toMatch(/reap skipped \(pool state was unreadable/);
    expect(log()).not.toContain('emu kill');
    // The lease still exists: naming a pair does not need the pool's memory, only killing does.
    expect(acquired.stdout).toContain('NITRO_UI_LEASE_ID');
  });

  it('keeps a corrupt pool.json as evidence and carries on leasing', () => {
    // The lease half of the same file is still a lease (X11 fix round 2): nothing passive writes or
    // reaps from it any more, so the corrupt file survives a plain `acquire` untouched, for the human
    // the reap's message asks for. Where the pool *is* written - a boot, a claim - `readPool` still
    // moves it aside and keeps it, which `device-pool.test.js` covers.
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
