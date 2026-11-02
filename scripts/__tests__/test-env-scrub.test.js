/**
 * `check` runs in a shell that has sourced a lease (X16 item 1, FOLLOWUPS 92).
 *
 * The claim under test is narrow and mechanical: a CLI child spawned by one of the gate suites must
 * not inherit the *calling shell's* lease. That matters because `gate.mjs` reads those variables as
 * instructions — with `METRO_PORT` exported it runs the Metro pre-flight (X15 item 1) and refuses
 * the run when the port is served, and with `NITRO_UI_HOME` it reads somebody else's lease file for
 * its device claim. The suites hand their children a throwaway checkout and a fake lease of their
 * own, so an inherited real one is a second, contradictory answer to the same question.
 *
 * G8 measured the cost: 25 failures across `gate.test.js`, `gate-check.test.js` and
 * `gate-logs.test.js` for a task that had followed AGENTS.md and sourced its lease first. The
 * reported workaround was "run `check` with the lease env unset" — a suite that passes only in a
 * shell nobody works in.
 *
 * ## How this is shown red
 *
 * Two ways, because the fixture has to be able to disagree with the answer:
 *
 *   1. `scripts/__tests__/gate.test.js`, `gate-check.test.js` and `gate-logs.test.js` fail when the
 *      suite runs under a sourced lease whose `METRO_PORT` is served — the real incident, with a
 *      real listener on the port rather than a stub.
 *   2. The end-to-end case below spawns a child that prints its own environment, so the assertion is
 *      on what the child *saw* rather than on a helper's return value. Point the scrubber at a name
 *      it should drop and the case stays green (that is the direction it cannot fake); revert the
 *      scrub and the printed names go non-empty.
 *
 * @file No device and no lease file: the child is `/bin/sh`, and the environment is the subject.
 */

import { spawnSync } from 'node:child_process';

import { describe, expect, it } from '@jest/globals';

import {
  LEASE_SCOPED_PROBE_NAMES,
  isLeaseScopedEnvName,
  withoutLeaseEnv,
} from './helpers/scrubbed-env.js';

/**
 * The `export NAME=` lines `renderEnvFile` writes, read out of `lease-core.mjs`'s source.
 *
 * Deliberately a text scan rather than importing the module and calling the function: that would
 * need a pair object built to the shape the renderer wants, and a fixture that failed to render a
 * line would quietly check one variable fewer.
 */
const RENDERED_NAMES = [
  ...require('node:fs')
    .readFileSync(`${__dirname}/../lease-core.mjs`, 'utf8')
    .matchAll(/exportLine\(\s*'([A-Z0-9_]+)'/g),
].map((match) => match[1]);

describe('a test child does not inherit this shell’s lease', () => {
  it('scrubs every name lease.mjs prints into an env file', () => {
    // The list is what the incident is made of, and it comes from the shipped renderer. If
    // `renderEnvFile` gains a variable and the scrubber does not cover it, this goes red — which is
    // the direction that matters: a check that cannot see a new lease variable is a check that will
    // be wrong the day one is added.
    expect(RENDERED_NAMES.length).toBeGreaterThan(5);
    const missed = RENDERED_NAMES.filter((name) => !isLeaseScopedEnvName(name));
    expect(missed).toEqual([]);
  });

  it('drops the lease names and keeps the ones the suites need', () => {
    const env = withoutLeaseEnv({
      PATH: '/usr/bin',
      HOME: '/Users/tester',
      TMPDIR: '/tmp',
      ANDROID_HOME: '/Users/tester/Library/Android/sdk',
      ANDROID_SDK_ROOT: '/Users/tester/Library/Android/sdk',
      ANDROID_AVD_HOME: '/Users/tester/.android/avd',
      JAVA_HOME:
        '/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home',
      // A whole lease, as G8's shell had it.
      NITRO_UI_LEASE_ID: 'G8-abc',
      NITRO_UI_LEASE_TASK: 'G8',
      NITRO_UI_LEASE_PLATFORM: 'both',
      IOS_SIM_UDID: '49D5024D-967B-4B93-ACF6-F73BA0A19E9F',
      IOS_SIM: 'iPhone 17',
      IOS_VERSION: '27.0',
      ANDROID_AVD: 'nitroui_a',
      ANDROID_API_LEVEL: '35',
      AVD_PROFILE: 'pixel_9',
      EMULATOR_PORT: '5574',
      ANDROID_SERIAL: 'emulator-5574',
      ANDROID_ADB_SERVER_PORT: '5043',
      METRO_PORT: '8295',
      // A backgrounded launcher's log, and the device-stub overrides: same class, same reason.
      NITRO_UI_GATE_LOG: '/tmp/somebody-elses-run.log',
      NITRO_UI_HOME: '/Users/tester/.nitro-ui',
    });
    const left = Object.keys(env).filter(isLeaseScopedEnvName);
    expect(left).toEqual([]);
    // And the machine's own facts survive: `PATH`, the SDK roots, and the AVD *home* (matched
    // exactly as `ANDROID_AVD`, so a prefix rule would have taken this with it).
    expect(env).toMatchObject({
      PATH: '/usr/bin',
      HOME: '/Users/tester',
      ANDROID_HOME: '/Users/tester/Library/Android/sdk',
      ANDROID_SDK_ROOT: '/Users/tester/Library/Android/sdk',
      ANDROID_AVD_HOME: '/Users/tester/.android/avd',
      JAVA_HOME:
        '/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home',
    });
  });

  it('really does hand a child a scrubbed environment (end to end)', () => {
    // Not a unit test of a pure function: this is the shape the three gate suites use — build the
    // child env from `process.env`, spread a test's own values last, and spawn. The child prints
    // its own environment back, so the assertion is about the process boundary the incident lived
    // at. The fixture poisons `process.env` first, exactly as a sourced lease does.
    const poisoned = {
      NITRO_UI_LEASE_ID: 'X16-poison',
      NITRO_UI_LEASE_TASK: 'X16',
      METRO_PORT: '8295',
      ANDROID_SERIAL: 'emulator-5574',
      IOS_SIM_UDID: 'poisoned-udid',
      IOS_VERSION: '27.0',
      NITRO_UI_GATE_LOG: '/tmp/poison.log',
    };
    // A fixture's own value for one of the same names, set on purpose. The scrub runs before a
    // test's `extraEnv`, so this has to survive: the suites assert device-claim behaviour by
    // handing a child a lease id and a `NITRO_UI_HOME` of their own, and a scrub that beat them
    // would make those tests impossible to write.
    const intentional = {
      METRO_PORT: '8299',
      ANDROID_AVD: 'nitro-ui-fixture',
    };
    const saved = {};
    for (const [name, value] of Object.entries(poisoned)) {
      saved[name] = process.env[name];
      process.env[name] = value;
    }
    try {
      const printed = LEASE_SCOPED_PROBE_NAMES.map(
        (name) => `printf '%s=[%s]\\n' '${name}' "\${${name}-unset}"`
      ).join('\n');
      const child = spawnSync('/bin/sh', ['-c', printed], {
        encoding: 'utf8',
        env: {
          ...withoutLeaseEnv(process.env),
          // What a test setting one on purpose looks like: it has to win.
          METRO_PORT: '8299',
          ...intentional,
        },
      });
      expect(child.status).toBe(0);
      const seen = Object.fromEntries(
        String(child.stdout)
          .trim()
          .split('\n')
          .map((line) => {
            const match = /^([A-Z0-9_]+)=\[(.*)\]$/u.exec(line);
            return match ? [match[1], match[2]] : [line, ''];
          })
      );
      // Every inherited one is gone...
      for (const name of Object.keys(poisoned)) {
        if (name in intentional) continue;
        expect(seen[name]).toBe('unset');
      }
      // ...and where a test named one itself, its value is what the child sees — never the
      // inherited one. That is the second half of the property: the scrub has to run *before*
      // a test's own env, not instead of it.
      expect(seen.METRO_PORT).toBe('8299');
      expect(seen.ANDROID_AVD).toBe('nitro-ui-fixture');
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
