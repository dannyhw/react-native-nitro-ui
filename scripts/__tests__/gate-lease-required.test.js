import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, afterAll } from 'vitest';

import {
  deviceGateLeaseRefusal,
  deviceGatePlatform,
  isDeviceGate,
  resolveGate,
} from '../gate-core.mjs';
import {
  REQUIREMENTS,
  diskRefusal,
  freeDiskGbFrom,
  isCiRunner,
} from '../doctor-core.mjs';
import { requireLeaseDevice } from '../lease-core.mjs';
import { withoutLeaseEnv } from './helpers/scrubbed-env.js';
import { FREE_LSOF } from './helpers/free-lsof-stub.js';
import {
  DEFAULT_PAIR,
  OTHER_PAIR,
  leaseRecord,
  leasedEnv,
  serialFor,
  writeLeaseStore,
} from './helpers/lease-store.js';

const CLI = path.join(process.cwd(), 'scripts', 'gate.mjs');

/* ---------------------------- the checkout fixture --------------------------- */

const cleanup = [];

afterAll(() => {
  for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
});

function gitIn(dir, args) {
  // A fixture identity: CI runners have no git user, and `commit` refuses
  // without one. Signing is off: a host that signs commits has no key for it.
  const result = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  }
}

function makeCheckout() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'x28-gate-'));
  fs.mkdirSync(path.join(dir, 'nitrogen/generated/ios'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'nitrogen/generated/ios/NitroUiAutolinking.swift'),
    '// marker\n'
  );
  fs.mkdirSync(path.join(dir, 'example'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'example/package.json'), '{"name":"x"}\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.gates/\nfake-bin/\n');
  gitIn(dir, ['init', '-q', '-b', 'main']);
  gitIn(dir, ['add', '-A']);
  gitIn(dir, ['commit', '-qm', 'base']);
  gitIn(dir, ['checkout', '-qb', 'task/x28-fixture']);
  cleanup.push(dir);
  return dir;
}

/** Stands in for every gate's real command, and records that it ran at all. */
function writeFakeRunner(dir) {
  const bin = path.join(dir, 'fake-bin');
  fs.mkdirSync(bin, { recursive: true });
  const script =
    '#!/bin/sh\n' +
    'echo "fake runner: $*"\n' +
    '[ -n "$FAKE_RAN_FILE" ] && echo "$*" > "$FAKE_RAN_FILE"\n' +
    'echo "Test Suites: 1 passed, 1 total"\n' +
    'echo "Tests: 3 passed, 3 total"\n' +
    'exit ${FAKE_EXIT:-0}\n';
  // `bash` too: a smoke gate is spawned as `bash scripts/smoke/<kind>.sh`, and
  // the real pack script has nothing to pack in this fixture.
  for (const name of ['node', 'bun', 'bash']) {
    fs.writeFileSync(path.join(bin, name), script);
    fs.chmodSync(path.join(bin, name), 0o755);
  }
  return bin;
}

/** Runs the real `gate.mjs` in the fixture without the calling shell's lease. */
function runCli(dir, args, extraEnv = {}) {
  const bin = writeFakeRunner(dir);
  const ranFile = path.join(dir, 'runner-ran.txt');
  fs.rmSync(ranFile, { force: true });
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      ...withoutLeaseEnv(process.env),
      // A leased env carries METRO_PORT and a device gate checks that the port is
      // free; the stub answers "free" whatever is listening on this machine.
      ...FREE_LSOF,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      FAKE_RAN_FILE: ranFile,
      ...extraEnv,
    },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    all: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    ranFile,
    ran: fs.existsSync(ranFile),
  };
}

function ledgerLines(dir) {
  const file = path.join(dir, '.gates', 'task', 'x28-fixture.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((raw) => raw.trim() !== '')
    .map((raw) => JSON.parse(raw));
}

/** With no options, the store holds one live lease over the default pair. */
function homeWith(dir, options = {}) {
  const home = path.join(dir, 'state');
  writeLeaseStore(home, options);
  return home;
}

/* ------------------------- which gates owe a lease -------------------------- */

describe('which gates are device gates (X28)', () => {
  it('asks of every gate that can boot or drive a device, filtered runs included', () => {
    for (const name of [
      'harness:ios',
      'harness:android',
      'harness:android:ColdSizing',
      'real-input:ios',
      'real-input:android',
      'real-input:android:--control:switch',
      'smoke:expo',
      'smoke:rn-cli',
      'bench',
      'bench:--platform:android',
    ]) {
      expect({ name, device: isDeviceGate(resolveGate(name)) }).toEqual({
        name,
        device: true,
      });
    }
  });

  it('leaves the gates that touch no device alone', () => {
    for (const name of ['check', 'smoke:pack']) {
      expect({ name, device: isDeviceGate(resolveGate(name)) }).toEqual({
        name,
        device: false,
      });
    }
  });

  it('names the platform each gate will drive, the way the runner reads it', () => {
    expect(deviceGatePlatform(resolveGate('harness:android'))).toBe('android');
    expect(
      deviceGatePlatform(
        resolveGate('bench', ['--platform', 'ios', '--plan', 'quick'])
      )
    ).toBe('ios');
    // A bench with no `--platform` names no device; the bench runner refuses it.
    expect(deviceGatePlatform(resolveGate('bench'))).toBeNull();
    // A smoke run decides from PLATFORM at run time, defaulting to both halves.
    expect(deviceGatePlatform(resolveGate('smoke:expo'), {})).toBe('both');
    expect(
      deviceGatePlatform(resolveGate('smoke:expo'), { PLATFORM: 'ios' })
    ).toBe('ios');
  });
});

/* ------------------- the decision, with no processes at all ------------------ */

describe('deviceGateLeaseRefusal (the decision)', () => {
  const now = 1_800_000_000_000;
  const pair = DEFAULT_PAIR;
  const other = OTHER_PAIR;
  const lease = leaseRecord({ now });
  const env = leasedEnv({ pair, lease });
  const harnessAndroid = resolveGate('harness:android');

  const decide = (over = {}, options = {}) =>
    deviceGateLeaseRefusal({
      env: { ...env, ...over.env },
      resolved: over.resolved ?? harnessAndroid,
      leases: over.leases ?? [lease],
      pairs: over.pairs ?? [pair, other],
      poolProblem: over.poolProblem ?? null,
      now,
      ...options,
    });

  it('lets a live lease through for the task, platform and devices it holds', () => {
    expect(decide()).toBeNull();
    expect(
      decide({ resolved: resolveGate('harness:android', ['ColdSizing']) })
    ).toBeNull();
    expect(decide({ resolved: resolveGate('real-input:android') })).toBeNull();
    expect(
      decide({ resolved: resolveGate('bench', ['--platform', 'android']) })
    ).toBeNull();
  });

  it('refuses with no lease in the environment, and says how to get one', () => {
    const refusal = decide({ env: { NITRO_UI_LEASE_ID: '' } });
    expect(refusal).toContain('is a device gate and this shell has no lease');
    expect(refusal).toContain('NITRO_UI_LEASE_ID is not set');
    expect(refusal).toContain('node scripts/lease.mjs acquire --task <ID>');
    expect(refusal).toContain('source /tmp/<ID>.env');
  });

  it('refuses a lease that was released', () => {
    const refusal = decide({ leases: [] });
    expect(refusal).toContain(`NITRO_UI_LEASE_ID=${lease.id} names no lease`);
    expect(refusal).toContain('released');
  });

  it('refuses a lease whose own ttl has run out', () => {
    const refusal = decide({
      leases: [leaseRecord({ ttlMinutes: 1, ageMs: 60 * 60_000, now })],
    });
    expect(refusal).toContain('is outlived');
    expect(refusal).toContain('1-minute ttl');
  });

  it('refuses a lease taken by another task', () => {
    // The environment and the store disagree about the task, as they do in a
    // shell that sourced two lease files.
    const refusal = decide({ env: { NITRO_UI_LEASE_TASK: 'G6' } });
    expect(refusal).toContain('environment from two leases');
    expect(refusal).toContain('but NITRO_UI_LEASE_TASK says G6');
  });

  it('refuses a lease taken for the other platform', () => {
    const refusal = decide({
      leases: [leaseRecord({ platform: 'ios', now })],
    });
    expect(refusal).toContain('drives android');
    expect(refusal).toContain('taken for ios devices');
    // The same lease is fine for an iOS gate.
    expect(
      decide({
        leases: [leaseRecord({ platform: 'ios', now })],
        resolved: resolveGate('harness:ios'),
      })
    ).toBeNull();
  });

  it('refuses a device the lease does not hold — the stray emulator', () => {
    // emulator-5554 is in no pair of the pool.
    const refusal = decide({ env: { ANDROID_SERIAL: 'emulator-5554' } });
    expect(refusal).toContain('would drive emulator-5554');
    expect(refusal).toContain('not the emulator of lease');
    // The other pair's emulator is in the pool, but this lease does not hold it.
    expect(
      decide({
        env: {
          ANDROID_SERIAL: serialFor(other),
          EMULATOR_PORT: String(other.android.emulatorPort),
          ANDROID_AVD: other.android.avd,
          ANDROID_ADB_SERVER_PORT: String(other.android.adbPort),
        },
      })
    ).toContain('not the emulator of lease');
  });

  it('refuses the machine’s own adb server under a leased serial', () => {
    // With no private server, `adb` uses the default port, which sees every device.
    const refusal = decide({ env: { ANDROID_ADB_SERVER_PORT: '' } });
    expect(refusal).toContain("address the machine's own adb server");
    expect(decide({ env: { ANDROID_ADB_SERVER_PORT: '5045' } })).toContain(
      'adb server 5045'
    );
  });

  it('refuses an environment whose AVD disagrees with its own serial', () => {
    const refusal = decide({ env: { ANDROID_AVD: 'nitro-ui-b' } });
    expect(refusal).toContain('environment from two leases');
    expect(refusal).toContain('whose AVD is nitro-ui-a');
  });

  it('refuses a run whose env names a simulator the lease does not hold', () => {
    const refusal = decide({
      resolved: resolveGate('harness:ios'),
      env: { IOS_SIM_UDID: other.ios.udid },
    });
    expect(refusal).toContain('is not a device of lease');
  });

  it('refuses IOS_UDID steering an iOS run off the leased simulator', () => {
    // The iOS real-input runner prefers IOS_UDID over IOS_SIM_UDID.
    const refusal = decide({
      resolved: resolveGate('real-input:ios'),
      env: { IOS_UDID: other.ios.udid },
    });
    expect(refusal).toContain('names two simulators');
  });

  it('refuses a run that sourced only half of its lease file', () => {
    expect(decide({ env: { ANDROID_SERIAL: '' } })).toContain(
      'ANDROID_SERIAL is not set'
    );
    expect(
      decide({
        resolved: resolveGate('harness:ios'),
        env: { IOS_SIM_UDID: '' },
      })
    ).toContain('IOS_SIM_UDID is not set');
  });

  it('refuses a lease record that holds no pair', () => {
    const refusal = decide({ leases: [{ ...lease, holds: undefined }] });
    expect(refusal).toContain('holds no pair');
  });

  it('refuses when the pool cannot be read, rather than guessing a device', () => {
    expect(
      decide({
        pairs: null,
        poolProblem: 'devices.json is not usable: pairs must list at least one',
      })
    ).toContain('refused rather than run unverifiable');
    // A pool edited after the lease was taken.
    expect(decide({ pairs: [{ ...pair, id: 'pair-renamed' }] })).toContain(
      'no pair in this machine'
    );
  });

  it('says nothing about a gate that touches no device', () => {
    const nothing = { leases: [], pairs: [] };
    expect(decide({ resolved: resolveGate('check'), ...nothing })).toBeNull();
    expect(
      decide({ resolved: resolveGate('smoke:pack'), ...nothing })
    ).toBeNull();
  });

  it('asks a bench with no --platform nothing about devices', () => {
    expect(
      decide({ resolved: resolveGate('bench'), env: { ANDROID_SERIAL: '' } })
    ).toBeNull();
  });

  it('lets an exclusive lease run on any pair of the pool it holds', () => {
    // The environment names the other pair's emulator; the lease holds both pairs.
    expect(
      decide({
        leases: [
          leaseRecord({ exclusive: true, holds: [pair.id, other.id], now }),
        ],
        env: {
          ANDROID_SERIAL: serialFor(other),
          EMULATOR_PORT: String(other.android.emulatorPort),
          ANDROID_AVD: other.android.avd,
          ANDROID_ADB_SERVER_PORT: String(other.android.adbPort),
        },
      })
    ).toBeNull();
  });
});

/* --------------------- the real CLI, refusing before work -------------------- */

describeCli('gate.mjs refuses a device gate with no live lease', () => {
  it('refuses harness:android, runs nothing, and records nothing', () => {
    const dir = makeCheckout();
    const home = homeWith(dir);
    const run = runCli(dir, ['harness:android'], { NITRO_UI_HOME: home });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('gate: refused before the run');
    expect(run.stderr).toContain('this shell has no lease');
    expect(run.stderr).toContain('node scripts/lease.mjs acquire --task <ID>');
    expect(run.ran).toBe(false);
    expect(ledgerLines(dir)).toEqual([]);
    expect(fs.existsSync(path.join(home, 'pool.json'))).toBe(false);
  });

  it('refuses the gate from the incident — real-input:android with no lease env', () => {
    const dir = makeCheckout();
    const home = homeWith(dir);
    const run = runCli(dir, ['real-input:android'], { NITRO_UI_HOME: home });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('real-input:android is a device gate');
    expect(run.ran).toBe(false);
    expect(ledgerLines(dir)).toEqual([]);
  });

  it('refuses a filtered run exactly like the full one', () => {
    const dir = makeCheckout();
    const home = homeWith(dir);
    const run = runCli(dir, ['harness:android', '--', 'ColdSizing'], {
      NITRO_UI_HOME: home,
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('harness:android:ColdSizing is a device gate');
    expect(run.ran).toBe(false);
  });

  it('refuses a released lease even with every device variable still exported', () => {
    // Releasing a lease cannot unset the variables a shell already exported.
    const dir = makeCheckout();
    const home = homeWith(dir, { leases: [] });
    const run = runCli(dir, ['harness:android'], {
      ...leasedEnv({ pair: DEFAULT_PAIR, lease: leaseRecord() }),
      NITRO_UI_HOME: home,
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('names no lease in the lease store');
    expect(run.ran).toBe(false);
  });

  it('refuses an expired lease, by its own ttl', () => {
    const dir = makeCheckout();
    const stale = leaseRecord({ ttlMinutes: 1, ageMs: 10 * 60_000 });
    const home = homeWith(dir, { leases: [stale] });
    const run = runCli(dir, ['harness:android'], {
      ...leasedEnv({ pair: DEFAULT_PAIR, lease: stale }),
      NITRO_UI_HOME: home,
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('is outlived');
    expect(run.ran).toBe(false);
  });

  it('refuses a lease that belongs to another task or the other platform', () => {
    const dir = makeCheckout();
    const live = leaseRecord({ task: 'X28', platform: 'both' });
    const home = homeWith(dir, { leases: [live] });
    const otherTask = runCli(dir, ['harness:android'], {
      ...leasedEnv({ pair: DEFAULT_PAIR, lease: live }),
      NITRO_UI_HOME: home,
      NITRO_UI_LEASE_TASK: 'G30',
    });
    expect(otherTask.status).toBe(1);
    expect(otherTask.stderr).toContain('environment from two leases');

    const iosOnly = leaseRecord({ platform: 'ios' });
    const iosHome = homeWith(dir, { leases: [iosOnly] });
    const wrongPlatform = runCli(dir, ['harness:android'], {
      ...leasedEnv({ pair: DEFAULT_PAIR, lease: iosOnly }),
      NITRO_UI_HOME: iosHome,
    });
    expect(wrongPlatform.status).toBe(1);
    expect(wrongPlatform.stderr).toContain('drives android');
    expect(otherTask.ran).toBe(false);
    expect(wrongPlatform.ran).toBe(false);
  });

  it('refuses a serial that is not the lease’s, including a stranger’s emulator', () => {
    const dir = makeCheckout();
    const live = leaseRecord();
    const home = homeWith(dir, { leases: [live] });
    const base = leasedEnv({ pair: DEFAULT_PAIR, lease: live });
    const cases = [
      { ANDROID_SERIAL: 'emulator-5554', EMULATOR_PORT: '5554' },
      { ANDROID_SERIAL: 'emulator-5554', ANDROID_ADB_SERVER_PORT: '5043' },
      { ANDROID_SERIAL: '', EMULATOR_PORT: '' },
      { ANDROID_ADB_SERVER_PORT: '' },
      { ANDROID_ADB_SERVER_PORT: '5037' },
    ];
    for (const over of cases) {
      const run = runCli(dir, ['harness:android'], {
        ...base,
        NITRO_UI_HOME: home,
        ...over,
      });
      expect({ over: Object.keys(over).join('+'), status: run.status }).toEqual(
        {
          over: Object.keys(over).join('+'),
          status: 1,
        }
      );
      expect(run.ran).toBe(false);
    }
    expect(ledgerLines(dir)).toEqual([]);
  });

  it('refuses a backgrounded run in the shell that asked for it', () => {
    // `--background` re-spawns itself detached; a refusal in the child would
    // leave a run record and a log behind, with nobody waiting for them.
    const dir = makeCheckout();
    const home = homeWith(dir);
    const run = runCli(dir, ['harness:android', '--background'], {
      NITRO_UI_HOME: home,
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('gate: refused before the run');
    expect(run.stdout).not.toContain('started in the background');
    const records = fs.existsSync(path.join(dir, '.gates'))
      ? fs
          .readdirSync(path.join(dir, '.gates'), { recursive: true })
          .map(String)
          .filter((name) => name.endsWith('.gate.json'))
      : [];
    expect(records).toEqual([]);
    expect(ledgerLines(dir)).toEqual([]);
  });

  it('lets a live lease through, and records the device it ran on', () => {
    const dir = makeCheckout();
    const live = leaseRecord();
    const home = homeWith(dir, { leases: [live] });
    const run = runCli(dir, ['harness:android'], {
      ...leasedEnv({ pair: DEFAULT_PAIR, lease: live }),
      NITRO_UI_HOME: home,
    });
    expect(run.all).toContain('fake runner');
    expect(run.status).toBe(0);
    const lines = ledgerLines(dir);
    expect(lines.map((line) => [line.gate, line.lease, line.device])).toEqual([
      ['harness:android', live.id, serialFor(DEFAULT_PAIR)],
    ]);
  });

  it('runs check from a shell with no lease at all', () => {
    const dir = makeCheckout();
    const home = homeWith(dir, { leases: [] });
    const run = runCli(dir, ['check'], { NITRO_UI_HOME: home });
    expect(run.status).toBe(0);
    expect(run.ran).toBe(true);
    expect(ledgerLines(dir).map((line) => line.gate)).toEqual(['check']);
  });

  it('asks a bench the same question, and lets an exclusive lease pass', () => {
    const dir = makeCheckout();
    const home = homeWith(dir, { leases: [] });
    const refused = runCli(dir, ['bench', '--', '--platform', 'android'], {
      NITRO_UI_HOME: home,
    });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('is a device gate');
    expect(refused.ran).toBe(false);

    const exclusive = leaseRecord({
      exclusive: true,
      holds: [DEFAULT_PAIR.id, OTHER_PAIR.id],
    });
    const benchHome = homeWith(dir, { leases: [exclusive] });
    const allowed = runCli(dir, ['bench', '--', '--platform', 'android'], {
      ...leasedEnv({ pair: DEFAULT_PAIR, lease: exclusive }),
      NITRO_UI_HOME: benchHome,
    });
    expect(allowed.status).toBe(0);
    expect(allowed.ran).toBe(true);
  });

  it('refuses a smoke run that boots a device, and a pack that does not', () => {
    const dir = makeCheckout();
    const home = homeWith(dir, { leases: [] });
    const expo = runCli(dir, ['smoke:expo'], { NITRO_UI_HOME: home });
    expect(expo.status).toBe(1);
    expect(expo.stderr).toContain('smoke:expo is a device gate');
    expect(expo.ran).toBe(false);

    const pack = runCli(dir, ['smoke:pack'], { NITRO_UI_HOME: home });
    expect(pack.status).toBe(0);
    expect(pack.ran).toBe(true);
  });
});

/* ------------------------- a device gate on a full disk ---------------------- */

describe('a device gate on a full disk', () => {
  const floor = REQUIREMENTS.deviceRunMinFreeDiskGb;

  it('the decision: below the floor refuses, at the floor does not', () => {
    expect(diskRefusal({ freeGb: floor - 1 })).toContain(
      `${floor - 1} GB free`
    );
    expect(diskRefusal({ freeGb: floor - 1 })).toContain(
      'scripts/worktrees.mjs'
    );
    expect(diskRefusal({ freeGb: floor })).toBeNull();
    expect(diskRefusal({ freeGb: floor + 1 })).toBeNull();
  });

  it('an unreadable volume and an ephemeral CI runner are not refusals', () => {
    expect(diskRefusal({ freeGb: null })).toBeNull();
    expect(diskRefusal({ freeGb: Number.NaN })).toBeNull();
    expect(diskRefusal({ freeGb: 0, ci: true })).toBeNull();
  });

  it('outside a test, reads the measured value and lets nothing raise it', () => {
    expect(freeDiskGbFrom({}, 123)).toBe(123);
    expect(freeDiskGbFrom({ NITRO_UI_GATE_FREE_DISK_GB: '999' }, 3)).toBe(3);
    expect(freeDiskGbFrom({}, null)).toBeNull();
  });

  it('inside a test, asks only the cases that name a value', () => {
    const jest = { JEST_WORKER_ID: '1' };
    expect(
      freeDiskGbFrom({ ...jest, NITRO_UI_GATE_FREE_DISK_GB: '4' }, 123)
    ).toBe(4);
    // Under jest the measurement is ignored, so a test about something else does
    // not depend on the host's disk.
    expect(freeDiskGbFrom(jest, 3)).toBeNull();
    expect(
      freeDiskGbFrom({ ...jest, NITRO_UI_GATE_FREE_DISK_GB: ' ' }, 3)
    ).toBeNull();
    expect(
      freeDiskGbFrom({ ...jest, NITRO_UI_GATE_FREE_DISK_GB: 'full' }, 3)
    ).toBeNull();
    const vitest = { VITEST_WORKER_ID: '1' };
    expect(
      freeDiskGbFrom({ ...vitest, NITRO_UI_GATE_FREE_DISK_GB: '4' }, 123)
    ).toBe(4);
    expect(freeDiskGbFrom(vitest, 3)).toBeNull();
  });

  it('only a real CI runner is exempt', () => {
    expect(isCiRunner({ CI: 'true' })).toBe(true);
    expect(isCiRunner({ CI: '1' })).toBe(true);
    for (const value of ['false', '0', '', 'no']) {
      expect({ value, ci: isCiRunner({ CI: value }) }).toEqual({
        value,
        ci: false,
      });
    }
    expect(isCiRunner({})).toBe(false);
  });

  it('refuses a leased device gate, runs nothing and records nothing', () => {
    const dir = makeCheckout();
    const live = leaseRecord();
    const home = homeWith(dir, { leases: [live] });
    const run = runCli(dir, ['harness:android'], {
      ...leasedEnv({ pair: DEFAULT_PAIR, lease: live }),
      NITRO_UI_HOME: home,
      NITRO_UI_GATE_FREE_DISK_GB: String(floor - 1),
      // A CI runner is exempt from the floor, and this suite also runs on one.
      CI: '',
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('gate: refused before the run');
    expect(run.stderr).toContain(`${floor - 1} GB free`);
    expect(run.ran).toBe(false);
    expect(ledgerLines(dir)).toEqual([]);
  });

  it('lets the same gate run with room to spare', () => {
    const dir = makeCheckout();
    const live = leaseRecord();
    const home = homeWith(dir, { leases: [live] });
    const run = runCli(dir, ['harness:android'], {
      ...leasedEnv({ pair: DEFAULT_PAIR, lease: live }),
      NITRO_UI_HOME: home,
      NITRO_UI_GATE_FREE_DISK_GB: String(floor + 1),
      CI: '',
    });
    expect(run.status).toBe(0);
    expect(run.ran).toBe(true);
  });

  it('`CI=false` is a shell, not a runner: the floor still applies', () => {
    const dir = makeCheckout();
    const live = leaseRecord();
    const home = homeWith(dir, { leases: [live] });
    const env = {
      ...leasedEnv({ pair: DEFAULT_PAIR, lease: live }),
      NITRO_UI_HOME: home,
      NITRO_UI_GATE_FREE_DISK_GB: String(floor - 1),
    };
    const shell = runCli(dir, ['harness:android'], { ...env, CI: 'false' });
    expect(shell.status).toBe(1);
    expect(shell.stderr).toContain(`${floor - 1} GB free`);
    const runner = runCli(dir, ['harness:android'], { ...env, CI: 'true' });
    expect(runner.status).toBe(0);
    expect(runner.ran).toBe(true);
  });

  it('with no test seam at all, agrees with the disk it is really on', () => {
    // Without a runner's marker the child measures the disk for itself, so the
    // expectation is computed from the same volume here.
    const dir = makeCheckout();
    const live = leaseRecord();
    const home = homeWith(dir, { leases: [live] });
    const stats = fs.statfsSync(dir);
    const realGb = Math.floor((stats.bavail * stats.bsize) / 2 ** 30);
    const run = runCli(dir, ['harness:android'], {
      ...leasedEnv({ pair: DEFAULT_PAIR, lease: live }),
      NITRO_UI_HOME: home,
      // Would refuse if it were read; outside a test it is ignored.
      NITRO_UI_GATE_FREE_DISK_GB: '0',
      JEST_WORKER_ID: undefined,
      VITEST_WORKER_ID: undefined,
      CI: '',
    });
    expect({ realGb, ran: run.ran }).toEqual({ realGb, ran: realGb >= floor });
    if (realGb < floor) expect(run.stderr).toContain(`${realGb} GB free`);
    else expect(run.stderr).not.toContain('GB free');
  });

  it('says "no lease" before "disk", and never asks check about either', () => {
    const dir = makeCheckout();
    const home = homeWith(dir, { leases: [] });
    const unleased = runCli(dir, ['harness:android'], {
      NITRO_UI_HOME: home,
      NITRO_UI_GATE_FREE_DISK_GB: '0',
      CI: '',
    });
    expect(unleased.status).toBe(1);
    expect(unleased.stderr).toContain('is a device gate');
    expect(unleased.stderr).not.toContain('GB free');

    const check = runCli(dir, ['check'], {
      NITRO_UI_HOME: home,
      NITRO_UI_GATE_FREE_DISK_GB: '0',
      CI: '',
    });
    expect(check.status).toBe(0);
    expect(check.ran).toBe(true);
  });
});

/* ------------------- the runners: no device from a guess --------------------- */

describe('requireLeaseDevice (what a runner may use)', () => {
  const pair = DEFAULT_PAIR;
  const leased = leasedEnv({ pair, lease: leaseRecord() });

  it('refuses an Android runner that names no serial — the incident’s shape', () => {
    // The call the Android real-input runner makes, from a shell with no lease.
    const call = () =>
      requireLeaseDevice({
        env: {},
        platform: 'android',
        command: 'real-input (android)',
        requireDevice: true,
      });
    expect(call).toThrow(/ANDROID_SERIAL is not set/);
    expect(call).toThrow(/lease\.mjs acquire/);
    // The refusal comes before any `adb devices` call.
    expect(call).not.toThrow(/adb devices. failed/);
  });

  it('takes the leased serial, AVD and adb server together', () => {
    expect(
      requireLeaseDevice({
        env: leased,
        platform: 'android',
        command: 'real-input (android)',
        requireDevice: true,
      })
    ).toMatchObject({
      leased: true,
      serial: serialFor(pair),
      avd: pair.android.avd,
      adbServerPort: pair.android.adbPort,
      emulatorPort: pair.android.emulatorPort,
    });
  });

  it('refuses a leased run that would fall back to the default adb server', () => {
    const env = { ...leased };
    delete env.ANDROID_ADB_SERVER_PORT;
    expect(() =>
      requireLeaseDevice({
        env,
        platform: 'android',
        command: 'bun run harness:android',
      })
    ).toThrow(/machine's own adb server/);
  });

  it('refuses a leased run with no AVD, so the harness cannot reach its default', () => {
    // The harness config's default AVD is not the leased pair's.
    const env = { ...leased };
    delete env.ANDROID_AVD;
    expect(() =>
      requireLeaseDevice({
        env,
        platform: 'android',
        command: 'harness:android',
      })
    ).toThrow(/cannot find it/);
  });

  it('leaves a run with no lease and no requirement alone', () => {
    // A CI job that boots its own emulator runs the runner with no lease.
    expect(
      requireLeaseDevice({ env: {}, platform: 'android' }).serial
    ).toBeNull();
  });

  it('checks the emulator port rules before the serial question', () => {
    expect(() =>
      requireLeaseDevice({
        env: { ANDROID_SERIAL: 'emulator-5560' },
        platform: 'android',
        command: 'x',
        requireDevice: true,
      })
    ).toThrow(/reserved serial/);
  });
});

describe('the bench runner measures on one device or none', () => {
  /** A tree with an `adb` stub that answers `devices` and `emu avd name`. */
  function adbStub({ attached, avdOf }) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'x28-adb-'));
    const platformTools = path.join(root, 'platform-tools');
    fs.mkdirSync(platformTools, { recursive: true });
    const calls = path.join(root, 'calls.txt');
    const lines = [
      '#!/bin/sh',
      `echo "$*" >> "${calls}"`,
      'case "$*" in',
      '  *"emu avd name"*) echo "' + String(avdOf) + '"; exit 0;;',
      '  *" -s "*) echo ok; exit 0;;',
      'esac',
      "printf 'List of devices attached\\n'",
    ];
    for (const serial of attached) {
      lines.push(`printf '${serial}\\tdevice\\n'`);
    }
    fs.writeFileSync(path.join(platformTools, 'adb'), `${lines.join('\n')}\n`);
    fs.chmodSync(path.join(platformTools, 'adb'), 0o755);
    cleanup.push(root);
    return { root, calls };
  }

  /** Run `resolveAndroidDevice` in a child, against that stub. */
  function resolve(env) {
    const script =
      'const m = await import(' +
      JSON.stringify(path.join(process.cwd(), 'scripts/bench/devices.mjs')) +
      ');\n' +
      'try { console.log("DEVICE " + JSON.stringify(m.resolveAndroidDevice())); } ' +
      'catch (error) { console.log("REFUSED " + error.message); process.exitCode = 7; }';
    const file = path.join(env.__root, 'resolve.mjs');
    fs.writeFileSync(file, script);
    const result = spawnSync(process.execPath, [file], {
      encoding: 'utf8',
      env: {
        ...withoutLeaseEnv(process.env),
        ANDROID_HOME: env.__root,
        ...env,
      },
    });
    return `${result.stdout}${result.stderr}`;
  }

  it('refuses to switch to another emulator when its serial and AVD disagree', () => {
    const stub = adbStub({ attached: ['emulator-5599'], avdOf: 'nitro-ui-a' });
    const out = resolve({
      __root: stub.root,
      ANDROID_AVD: 'nitro-ui-a',
      ANDROID_SERIAL: 'emulator-5574',
    });
    expect(out).toContain('REFUSED');
    expect(out).toContain('is not the emulator running AVD');
    expect(out).toContain('Refusing to measure on either');
    expect(out).not.toContain('using emulator-5599');
  });

  it('refuses a leased bench that names no serial, at all', () => {
    const stub = adbStub({ attached: ['emulator-5599'], avdOf: 'nitro-ui-a' });
    const out = resolve({
      __root: stub.root,
      NITRO_UI_LEASE_ID: 'X28-1',
      NITRO_UI_LEASE_PLATFORM: 'android',
      ANDROID_AVD: 'nitro-ui-a',
    });
    expect(out).toContain('REFUSED');
    expect(out).toContain('ANDROID_SERIAL is not set');
    // The refusal comes before any adb call.
    expect(fs.existsSync(stub.calls)).toBe(false);
  });

  it('still resolves a CI bench that only names an AVD', () => {
    const stub = adbStub({ attached: ['emulator-5599'], avdOf: 'nitroui-ci' });
    const out = resolve({ __root: stub.root, ANDROID_AVD: 'nitroui-ci' });
    expect(out).toContain('DEVICE');
    expect(out).toContain('"serial":"emulator-5599"');
  });
});

/* --------------------- the fallback is gone, not hidden --------------------- */

describe('the Android runners have no device-list fallback', () => {
  const sources = {
    'scripts/real-input/android.mjs': (body) => {
      expect(body).toContain('requireLeaseDevice');
      expect(body).toContain('requireDevice: true');
      // Nothing may pick a serial by filtering the `adb devices` list.
      expect(body).not.toMatch(/serials\.filter\(/);
      expect(body).not.toMatch(/matching\.length/);
      expect(body).not.toMatch(/ANDROID_AVD \?\? 'nitroui'/);
    },
    'scripts/bench/devices.mjs': (body) => {
      expect(body).toContain('requireLeaseDevice');
      expect(body).not.toMatch(/; using \$\{match\}/);
    },
  };

  for (const [file, check] of Object.entries(sources)) {
    it(`${file} asks its lease instead of the device list`, () => {
      const text = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
      const start = text.indexOf(
        file.includes('real-input')
          ? 'function resolveDevice(env) {'
          : 'export function resolveAndroidDevice() {'
      );
      expect(start).toBeGreaterThan(-1);
      const body = text.slice(start, text.indexOf('\n}\n', start));
      check(body);
    });
  }
});

describe('the harness config asks its lease before it names a device', () => {
  // The config cannot be imported here, because it refuses to load without a
  // stamped app, so it is read as text.
  const text = fs.readFileSync(
    path.join(process.cwd(), 'example/rn-harness.config.mjs'),
    'utf8'
  );

  it('takes the simulator and the AVD from the lease, not an env default', () => {
    expect(text).toContain('const leaseDevice = requireLeaseDevice({');
    expect(text).toContain('const udid = leaseDevice.udid;');
    expect(text).toContain('return leaseDevice.avd ?? DEFAULT_AVD;');
    expect(text).not.toContain(
      'process.env.ANDROID_AVD ?? process.env.AVD ?? DEFAULT_AVD'
    );
  });

  it('declares the lease answer above the first thing that reads a device', () => {
    const declared = text.indexOf('const leaseDevice =');
    expect(declared).toBeGreaterThan(-1);
    for (const use of [
      'lease: ${avd()} boots',
      'device: iosDevice()',
      'androidEmulator(avd()',
    ]) {
      const at = text.indexOf(use);
      expect(at).toBeGreaterThan(-1);
      if (at < declared) {
        throw new Error(
          `${use} (offset ${String(at)}) reads a device before ` +
            `leaseDevice (offset ${String(declared)}) is declared: TDZ at config time`
        );
      }
    }
  });
});

function describeCli(name, fn) {
  describe(name, fn);
}
