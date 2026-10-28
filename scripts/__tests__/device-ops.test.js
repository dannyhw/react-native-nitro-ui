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
          '  *\'pm path\'*) answer pm_path; exit "$(status pm_path)" ;;',
        ].join('\n')
      : [
          "  *'get_app_container'*' app'*) answer app_container; exit \"$(status app_container)\" ;;",
          '  *\'get_app_container\'*) answer data_container; exit "$(status data_container)" ;;',
          '  *list*) answer sim_list; exit "$(status sim_list)" ;;',
        ].join('\n'),
    '  *) exit 0 ;;',
    'esac',
    '',
  ].join('\n');

let home;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'nitro-ui-ops-'));
  const bins = join(home, 'bin');
  const answers = join(home, 'answers');
  mkdirSync(bins, { recursive: true });
  mkdirSync(answers, { recursive: true });
  for (const [name, kind] of [
    ['adb', 'adb'],
    ['xcrun', 'simctl'],
  ]) {
    writeFileSync(join(bins, name), STUB(kind));
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

const ANDROID = {
  kind: 'android',
  key: 'avd:nitro-ui-a',
  serial: 'emulator-5574',
  adbPort: 5043,
};

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

describe('is the app on the device (X11 re-review N5)', () => {
  it('reads a `package:` line as installed', () => {
    answer(
      'pm_path',
      'package:/data/app/~~abc==/nitroui.example-def=.apk\n',
      0
    );
    expect(ops().deviceAppInstalled(ANDROID, 'nitroui.example')).toMatchObject({
      answered: true,
      ok: true,
    });
  });

  it("reads `No package found` as not installed, on the device's word", () => {
    // `pm path` exits 1 and prints the reason, and that *is* an answer: it is what turns a fresh AVD
    // into a reset that had nothing to do instead of four retries and a misleading line.
    answer('pm_path', 'No package found for user: 0\n', 1);
    expect(ops().deviceAppInstalled(ANDROID, 'nitroui.example')).toMatchObject({
      answered: true,
      ok: false,
    });
  });

  it('is unknown for an iOS simulator whose container lookup fails the same way', () => {
    answer('app_container', 'Unable to find application container\n', 1);
    expect(
      ops().deviceAppInstalled(
        { kind: 'ios', key: 'ios:UDID-A', udid: 'UDID-A' },
        'nitroui.example'
      )
    ).toMatchObject({ answered: true, ok: false });
    answer('app_container', '/Users/x/Library/.../NitroUiExample.app\n', 0);
    expect(
      ops().deviceAppInstalled(
        { kind: 'ios', key: 'ios:UDID-A', udid: 'UDID-A' },
        'nitroui.example'
      )
    ).toMatchObject({ answered: true, ok: true });
  });

  it('is unknown when there is no tool to ask', () => {
    expect(
      opsMissing().deviceAppInstalled(ANDROID, 'nitroui.example')
    ).toMatchObject({ answered: false, ok: false });
    expect(
      opsMissing().deviceAppInstalled(
        { kind: 'ios', key: 'ios:UDID-A', udid: 'UDID-A' },
        'nitroui.example'
      )
    ).toMatchObject({ answered: false, ok: false });
  });

  it('is unknown for an android device with no serial to address', () => {
    // Not a tool failure but the same three-way answer, for the same reason: "I could not ask" must
    // never become "it is not installed", or a record missing its serial turns into a confident
    // no-op and the next task inherits the storage the reset was supposed to clear.
    expect(
      ops().deviceAppInstalled(
        { kind: 'android', key: 'avd:nitro-ui-a', serial: null },
        'nitroui.example'
      )
    ).toMatchObject({ answered: false, ok: false });
  });
});
