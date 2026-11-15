/**
 * The device operations, against stub binaries rather than a device.
 *
 * Every other test in this directory injects `ops`, which is the right call for testing *decisions*
 * — a pool that talks to a real emulator in a unit test is a slower, flakier test — but it also
 * means the code that turns a device's raw answer into a fact never runs. X11 re-review N3 found
 * that by deleting the parser in front of every Android kill (`emulatorAvdName`, the thing that
 * decides whether `emulator-5574` really is `nitro-ui_a`) and watching the whole suite stay green:
 * every fake answers with an AVD name, so a version that returned the first line of *any* answer was
 * indistinguishable from the real one.
 *
 * So this file does the opposite of the rest: it builds the real `deviceOperations` and points
 * `NITRO_UI_ADB_BIN` / `NITRO_UI_SIMCTL_BIN` at shell stubs — the trick `lease-pool-cli.test.js`
 * uses for the CLI — and answers with the shapes the real tools produce, including the ones that
 * mean "nothing was answered" (X11 re-review N2).
 *
 * The stubs read their answers from files rather than env vars because `deviceOperations`' `env` is
 * only read for the tool paths: `spawnSync` inherits the *process* environment, so a fixture that
 * tried to pass `FAKE_AVD_NAME` that way was silently ignored and every case answered "no output".
 */

import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { deviceOperations } from '../device-pool.mjs';

/**
 * One stub for each tool: print the answer file for the subcommand being run, then exit with its
 * status file. An absent answer file means "printed nothing", and an absent status file means 0, so
 * the two things a real tool does when it is wedged are both expressible.
 */
const STUB = (kind) =>
  [
    '#!/bin/sh',
    'here=$(dirname "$0")',
    'answer() { cat "$here/../answers/$1" 2>/dev/null; }',
    'status() { cat "$here/../answers/$1.status" 2>/dev/null || printf 0; }',
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
 * A stub `emulator` whose only job is to report how it was started: its argv, and the adb server in
 * the environment it was handed. That environment is the whole point — an emulator registers with
 * the adb server named by `ANDROID_ADB_SERVER_PORT` in *its own* environment, so a boot that uses the
 * pair's private server port for its later calls but not at launch produces a device that comes up
 * perfectly and is invisible to the pool for the entire boot timeout.
 */
const EMULATOR_STUB = [
  '#!/bin/sh',
  'here=$(dirname "$0")',
  'printf %s "$*" > "$here/../answers/emu.argv"',
  'printf %s "${ANDROID_ADB_SERVER_PORT-none}" > "$here/../answers/emu.adb_server"',
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
      // "No name" is what `shutdownDevice` turns into a refusal. The parser's job is that it answers
      // only when the answer is a name: `error: device offline` starts with a line, and a parser
      // that returned the first line of anything would compare *that* against the record, refuse,
      // and leave a warm device off every idle clock. And `OK` is the banner a successful answer ends
      // with, so accepting it is accepting the answer to the previous question. Every injected fake
      // hides all of this by answering with a name, which is how the mutation got through.
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
    // The distinction the next case makes, and it has to go both ways or the pool never forgets a
    // record: an empty listing with exit 0 is evidence the emulator is off, which is `already`.
    answer('devices', 'List of devices attached\n', 0);
    expect(ops().attachedSerialsResult(5043)).toMatchObject({
      ok: true,
      serials: [],
    });
  });

  it('says "unknown" when adb answers with a nonzero exit', () => {
    // A wedged server is killed at its timeout: no stdout, which is character-for-character what "no
    // emulator is attached" looks like. The exit status is the only thing that separates them, and
    // reading the empty one as "off" is how a live emulator left the pool's memory.
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
    // The bug this case exists for, found by the first cold boot on hardware rather than by any
    // fake: an emulator registers with the adb server named in *its own* environment, so a boot that
    // uses the pair's private server only in its later calls leaves a device that comes up in 31
    // seconds (`Boot completed in 31078 ms` in its log) while `adb -P 5043 devices` stays empty for
    // the whole 7-minute wait. `acquire --boot` is exactly that case: it boots before the env file
    // that exports `ANDROID_ADB_SERVER_PORT` exists, so the port has to be passed explicitly.
    const result = await opsWithEmulator().bootEmulator({
      avd: 'nitro-ui-a',
      port: 5574,
      adbPort: 5043,
    });
    expect(result).toBe(true);
    expect(await recorded('emu.adb_server')).toBe('5043');
    expect(await recorded('emu.argv')).toContain('-port 5574');
  });

  it('leaves the server alone when the pair names none', async () => {
    // No adbPort is a real configuration (a machine with one default server), and the launch must
    // then inherit the environment rather than invent a port - `none` is what the stub writes when
    // the variable is absent, and `undefined` or an empty string would be a different bug.
    await opsWithEmulator().bootEmulator({ avd: 'nitro-ui-a', port: 5574 });
    expect(await recorded('emu.adb_server')).toBe('none');
  });
});
