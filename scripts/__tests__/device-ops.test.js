import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { deviceOperations } from '../device-pool.mjs';

/**
 * One stub for each tool: print the answer file for the subcommand being run, then exit
 * with its status file. No answer file means "printed nothing"; no status file means 0.
 * Answers come from files because `spawnSync` inherits the process environment, not the
 * `env` handed to `deviceOperations`.
 */
const STUB = (kind) =>
  [
    '#!/bin/sh',
    'here=$(dirname "$0")',
    'answer() { cat "$here/../answers/$1" 2>/dev/null; }',
    'status() { cat "$here/../answers/$1.status" 2>/dev/null || printf 0; }',
    ...(kind === 'adb' ? ['pwd -P > "$here/../answers/adb.cwd"'] : []),
    'case "$*" in',
    kind === 'adb'
      ? [
          '  *\'emu avd name\'*) answer avd_name; exit "$(status avd_name)" ;;',
          '  *devices*) answer devices; exit "$(status devices)" ;;',
        ].join('\n')
      : ['  *list*) answer sim_list; exit "$(status sim_list)" ;;'].join('\n'),
    '  *) exit 0 ;;',
    'esac',
    '',
  ].join('\n');

/**
 * A stub `emulator` that records how it was started: its argv and the adb server port in
 * its environment. An emulator registers with the adb server named by
 * `ANDROID_ADB_SERVER_PORT` in its own environment, not the one later adb calls use.
 */
const EMULATOR_STUB = [
  '#!/bin/sh',
  'here=$(dirname "$0")',
  'printf %s "$*" > "$here/../answers/emu.argv"',
  'printf %s "${ANDROID_ADB_SERVER_PORT-none}" > "$here/../answers/emu.adb_server"',
  'pwd -P > "$here/../answers/emu.cwd"',
  'exit 0',
  '',
].join('\n');

let home;

const readIf = (file) => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'nitro-ui-ops-'));
  const bins = join(home, 'bin');
  const answers = join(home, 'answers');
  mkdirSync(bins, { recursive: true });
  mkdirSync(answers, { recursive: true });
  for (const [name, kind] of [
    ['adb', 'adb'],
    ['xcrun', 'simctl'],
    ['emulator', 'emulator'],
  ]) {
    writeFileSync(
      join(bins, name),
      kind === 'emulator' ? EMULATOR_STUB : STUB(kind)
    );
    chmodSync(join(bins, name), 0o755);
  }
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

/** What the stubbed tool prints (and exits with) for its next question. */
const answer = (name, text, status = null) => {
  writeFileSync(join(home, 'answers', name), text);
  if (status != null)
    writeFileSync(join(home, 'answers', `${name}.status`), String(status));
};

const ops = (env = {}) =>
  deviceOperations({
    home,
    env: {
      NITRO_UI_ADB_BIN: join(home, 'bin/adb'),
      NITRO_UI_SIMCTL_BIN: join(home, 'bin/xcrun'),
      ...env,
    },
  });

/** The same, with tools that do not exist: what a call killed at its timeout looks like. */
const opsMissing = () =>
  deviceOperations({
    home,
    env: {
      NITRO_UI_ADB_BIN: join(home, 'no-such-adb'),
      NITRO_UI_SIMCTL_BIN: join(home, 'no-such-xcrun'),
    },
  });

describe('the identity check in front of an Android kill', () => {
  const asked = () => ops().emulatorAvdName('emulator-5574', 5043);

  it('takes the AVD name from the answer, without the banner', () => {
    // What a real `adb -s emulator-5574 emu avd name` prints: the name, then `OK`.
    answer('avd_name', 'nitro-ui_a\nOK\n');
    expect(asked()).toBe('nitro-ui_a');
  });

  for (const [what, fixture] of [
    ['the ok banner on its own', 'OK\n'],
    ['a serial rather than a name', 'emulator-5574\n'],
    ['an offline device', 'error: device offline\n'],
    ['a device that is not there', 'error: device not found\n'],
    ['nothing at all', ''],
    ['only whitespace', '   \n'],
  ]) {
    it(`answers "no name" for ${what}`, () => {
      answer('avd_name', fixture);
      expect(asked()).toBe(null);
    });
  }
});

describe('did the tool answer at all (X11 re-review N2)', () => {
  it('reads a listing from a server that answers', () => {
    answer('devices', 'List of devices attached\nemulator-5574\tdevice\n');
    expect(ops().attachedSerialsResult(5043)).toMatchObject({
      ok: true,
      serials: ['emulator-5574'],
    });
  });

  it('reads an empty listing from a healthy server as "nothing attached"', () => {
    answer('devices', 'List of devices attached\n', 0);
    expect(ops().attachedSerialsResult(5043)).toMatchObject({
      ok: true,
      serials: [],
    });
  });

  it('says "unknown" when adb answers with a nonzero exit', () => {
    // A wedged server killed at its timeout prints nothing, exactly like an empty
    // listing. Only the exit status tells them apart.
    answer('devices', 'List of devices attached\n', 1);
    const res = ops().attachedSerialsResult(5043);
    expect(res.ok).toBe(false);
    expect(res.serials).toEqual([]);
  });

  it('says "unknown" when there is no adb to ask', () => {
    const res = opsMissing().attachedSerialsResult(5043);
    expect(res.ok).toBe(false);
    expect(res.serials).toEqual([]);
    expect(res.answer).not.toBe('');
  });

  it('reads a real listing for its booted simulators', () => {
    answer(
      'sim_list',
      JSON.stringify({
        devices: {
          'com.apple.CoreSimulator.SimRuntime.iOS-26-0': [
            { udid: 'UDID-A', state: 'Booted' },
            { udid: 'UDID-B', state: 'Shutdown' },
          ],
        },
      })
    );
    expect(ops().bootedSimulatorsOrNull()).toEqual(['UDID-A']);
  });

  it('says "unknown" for a simulator listing it cannot parse, cannot get, or has no tool for', () => {
    answer('sim_list', '{"devices": {');
    expect(ops().simulatorsResult()).toMatchObject({ ok: false });
    answer('sim_list', '', 1);
    expect(ops().simulatorsResult()).toMatchObject({ ok: false });
    expect(opsMissing().simulatorsResult()).toMatchObject({ ok: false });
    // `bootedSimulatorsOrNull` is the same question in the shape `shutdownDevice` consumes, where
    // null means "leave the device alone" and an empty array means "it is already off".
    answer('sim_list', '{"devices": {');
    expect(ops().bootedSimulatorsOrNull()).toBe(null);
  });
});

describe('what an emulator is started with', () => {
  const opsWithEmulator = () =>
    deviceOperations({
      home,
      env: {
        NITRO_UI_ADB_BIN: join(home, 'bin/adb'),
        NITRO_UI_SIMCTL_BIN: join(home, 'bin/xcrun'),
        EMULATOR_BIN: join(home, 'bin/emulator'),
      },
    });

  /** The stub is detached, so its record of its own launch arrives asynchronously. */
  const recorded = async (file, deadlineMs = 5_000) => {
    const path = join(home, 'answers', file);
    const stop = Date.now() + deadlineMs;
    for (;;) {
      const text = readIf(path);
      if (text != null) return text;
      if (Date.now() > stop)
        throw new Error(
          `${file} was never written (the emulator never started)`
        );
      await new Promise((r) => setTimeout(r, 25));
    }
  };

  it('launches the emulator on the adb server the pair owns', async () => {
    // The port has to be in the emulator's own environment at launch: with it only on
    // the later adb calls, the device boots and never appears on the pair's server.
    const result = await opsWithEmulator().bootEmulator({
      avd: 'nitro-ui-a',
      port: 5574,
      adbPort: 5043,
    });
    expect(result).toBe(true);
    expect(await recorded('emu.adb_server')).toBe('5043');
    expect(await recorded('emu.argv')).toContain('-port 5574');
  });

  it('starts the emulator and adb in the pool state directory, not the caller\'s', async () => {
    // A state directory apart from the stubs, not created yet, and not this test's own
    // working directory (the checkout): an emulator keeps the directory it started in.
    const state = join(home, 'state');
    const opsIn = deviceOperations({
      home: state,
      env: {
        NITRO_UI_ADB_BIN: join(home, 'bin/adb'),
        NITRO_UI_SIMCTL_BIN: join(home, 'bin/xcrun'),
        EMULATOR_BIN: join(home, 'bin/emulator'),
      },
    });
    expect(process.cwd()).not.toBe(realpathSync(home));
    await opsIn.bootEmulator({ avd: 'nitro-ui-a', port: 5574, adbPort: 5043 });
    expect((await recorded('emu.cwd')).trim()).toBe(realpathSync(state));
    opsIn.attachedSerialsResult(5043);
    expect(readIf(join(home, 'answers', 'adb.cwd'))?.trim()).toBe(
      realpathSync(state)
    );
  });

  it('leaves the server alone when the pair names none', async () => {
    // `none` is what the stub writes when the variable is absent.
    await opsWithEmulator().bootEmulator({ avd: 'nitro-ui-a', port: 5574 });
    expect(await recorded('emu.adb_server')).toBe('none');
  });
});
