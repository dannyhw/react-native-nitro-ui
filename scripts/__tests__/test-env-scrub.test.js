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
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import {
  LEASE_SCOPED_PROBE_NAMES,
  childEnv,
  isLeaseScopedEnvName,
  withoutLeaseEnv,
} from './helpers/scrubbed-env.js';
import {
  callScrubsLease,
  callSetsEnv,
  callSpreadsProcessEnv,
  dataMask,
  definitionText,
  deviceAwareScripts,
  deviceAwareTarget,
  envValueIdentifiers,
  spawnCalls,
} from './helpers/spawn-env-audit.js';

const REPO_ROOT = join(__dirname, '..', '..');

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

/**
 * The same property, asked of the shape the X32/X33 reports actually named.
 *
 * Those two tasks did not lose a Metro pre-flight: a unit suite died on
 * `lease: ANDROID_SERIAL=… and EMULATOR_PORT=… disagree` because `bench-baseline-merge.test.js`
 * gave its child `ANDROID_SERIAL: 'emulator-5599'` *on top of* the sourced lease's
 * `EMULATOR_PORT`. The fixture has to be that shape — a fixture with only `NITRO_UI_LEASE_ID` set
 * would pass without the scrub, which is the direction a guard must not be able to fake.
 */
describe('a device-aware child of a suite cannot see the shell’s lease', () => {
  /** A complete lease, agreeing with itself, as `lease.mjs` prints it. */
  const FAKE_LEASE = {
    NITRO_UI_LEASE_ID: 'X34-poison',
    NITRO_UI_LEASE_TASK: 'X34',
    NITRO_UI_LEASE_PLATFORM: 'both',
    IOS_SIM_UDID: 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
    IOS_SIM: 'iPhone 17',
    IOS_VERSION: '27.0',
    ANDROID_AVD: 'nitroui_a',
    ANDROID_API_LEVEL: '35',
    AVD_PROFILE: 'pixel_9',
    EMULATOR_PORT: '5584',
    ANDROID_SERIAL: 'emulator-5584',
    ANDROID_ADB_SERVER_PORT: '5043',
    METRO_PORT: '8295',
    NITRO_UI_HOME: join(tmpdir(), 'x34-poison-home'),
    NITRO_UI_LEASE_BOOT: '1',
  };

  /**
   * A child that answers the two questions the incident turned on: does the *real* lease check
   * survive my environment, and which lease names did I actually receive?
   *
   * It calls the shipped function rather than a copy of its rule, so the case cannot drift from
   * the refusal: `checkEmulatorEnv` is what threw in X32's log, and `requireLeaseDevice` is what
   * X28 added on top of it.
   */
  function spawnLeaseProbe(env) {
    const dir = mkdtempSync(join(tmpdir(), 'x34-env-probe-'));
    const probe = join(dir, 'probe.mjs');
    try {
      writeFileSync(
        probe,
        'import { pathToFileURL } from "node:url";\n' +
          `const core = await import(pathToFileURL(${JSON.stringify(
            join(REPO_ROOT, 'scripts', 'lease-core.mjs')
          )}).href);\n` +
          'core.checkEmulatorEnv(process.env);\n' +
          'core.requireLeaseDevice({ env: process.env, platform: "android" });\n' +
          'const seen = process.argv.slice(1).filter((name) => {\n' +
          '  const value = process.env[name];\n' +
          "  return value !== undefined && value !== '';\n" +
          '});\n' +
          'process.stdout.write(JSON.stringify(seen));\n'
      );
      const result = spawnSync(
        process.execPath,
        [probe, ...LEASE_SCOPED_PROBE_NAMES],
        { encoding: 'utf8', env, timeout: 60_000 }
      );
      return {
        status: result.status,
        seen: (() => {
          try {
            return JSON.parse(String(result.stdout));
          } catch {
            return null;
          }
        })(),
        message: `${String(result.stdout ?? '')}${String(result.stderr ?? '')}`,
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /** Poisons `process.env` the way `source <(lease.mjs acquire …)` does, for one case. */
  function withFakeLease(run) {
    const saved = {};
    for (const [name, value] of Object.entries(FAKE_LEASE)) {
      saved[name] = process.env[name];
      process.env[name] = value;
    }
    try {
      return run();
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  }

  it('scrubs the lease a suite overrides half of (the X32/X33 shape)', () => {
    withFakeLease(() => {
      // Exactly the fixture shape that died: the test's own serial, the shell's port. The
      // comment in `bench-baseline-merge.test.js` is now the contract; before X34 the suite
      // inherited the port and `checkEmulatorEnv` refused the pair it was being handed.
      const child = spawnLeaseProbe(
        childEnv({ ANDROID_SERIAL: 'emulator-5599' })
      );
      expect(child.status).toBe(0);
      // The only lease-shaped name the child may hold is the one this case handed it. Every
      // other name the poison set is gone, which is the whole property.
      expect(child.seen).toEqual(['ANDROID_SERIAL']);
      // And every name the lease printed is one the child cannot have read.
      const left = (child.seen ?? []).filter(
        (name) => isLeaseScopedEnvName(name) && !(name in { ANDROID_SERIAL: 1 })
      );
      expect(left).toEqual([]);
    });
  });

  it('would have handed the same child a pair that disagrees (the same case without the scrub)', () => {
    // The fixture's own red proof: an unscrubbed spread of the same poisoned environment has to
    // fail for the same reason X32's `check` did. If this ever goes green, the poison has stopped
    // being fatal and the case above is decoration — which is exactly how a scrub guard rots.
    withFakeLease(() => {
      const child = spawnLeaseProbe({
        ...process.env,
        ANDROID_SERIAL: 'emulator-5599',
      });
      expect(child.status).not.toBe(0);
      expect(child.message).toContain('disagree about which emulator');
    });
  });

  it('keeps a test’s own lease values, which is what makes the scrub usable', () => {
    // The suites assert device-claim behaviour by handing a child a lease id and a `NITRO_UI_HOME`
    // of their own (`gate.test.js`, `lease.test.js`). A scrub that beat them would make those
    // tests impossible to write, so the order matters: scrub first, `extra` last.
    withFakeLease(() => {
      // A named Android half, spelled out the way `lease.mjs` prints it: `requireLeaseDevice`
      // refuses a lease that names a platform and withholds that half's identifiers, so a child
      // that gets here has received a *whole* Android half — from this case, never from the
      // shell. The shell's own pair is a different one (5584), so any leak would also disagree.
      const child = spawnLeaseProbe(
        childEnv({
          NITRO_UI_LEASE_ID: 'FIXTURE-1',
          NITRO_UI_HOME: join(tmpdir(), 'x34-fixture-home'),
          ANDROID_AVD: 'nitro-ui-fixture',
          ANDROID_SERIAL: 'emulator-5598',
          EMULATOR_PORT: '5598',
          ANDROID_ADB_SERVER_PORT: '5044',
          METRO_PORT: '8299',
        })
      );
      const expected = [
        'ANDROID_ADB_SERVER_PORT',
        'ANDROID_AVD',
        'ANDROID_SERIAL',
        'EMULATOR_PORT',
        'METRO_PORT',
        'NITRO_UI_HOME',
        'NITRO_UI_LEASE_ID',
      ];
      // One assertion over the child's own answer, because a refusal here is a fact about the
      // scrub and the reader needs the reason, not a bare exit code.
      expect({
        status: child.status,
        seen: [...(child.seen ?? [])].sort(),
      }).toEqual({
        status: 0,
        seen: expected.sort(),
      });
    });
  });
});

/**
 * The line between "a call this file makes" and "a call this file writes", checked on its own.
 *
 * Both ways this rule can be wrong are silent. Too wide and a real leak stops counting as a site —
 * the audit goes green on a suite that hands `process.env` to `gate.mjs`. Too narrow and it cries
 * wolf at a fixture's prose until somebody widens it, which is the route by which a guard stops
 * being a guard. So the boundary is asserted, not trusted.
 */
describe('dataMask (which `spawn(` is a call site of this file)', () => {
  it('does not count a call written inside generated source', () => {
    const source = [
      'function gateScript() {',
      '  return [',
      '    \'const { spawn } = require("node:child_process");\',',
      '    \'const run = spawn(process.execPath, ["gate.mjs"], { env: process.env });\',',
      "  ].join('\\n');",
      '}',
    ].join('\n');
    expect(spawnCalls(source)).toEqual([]);
    // The mask is the reason, not a pattern that stopped matching: the text is there, the position
    // is data. Saying it the other way round would pass for the wrong reason.
    const line = source.split('\n')[3];
    expect(line).toContain('spawn(');
    expect(dataMask(source)[3]).not.toContain('spawn(');
  });

  it('still counts a real call that mentions a script in prose around it', () => {
    // The loophole, spelled out: a comment naming `gate.mjs` is the cheapest way to make a leak
    // invisible to this audit, and it must not be.
    const source = [
      "const CLI = join(root, 'scripts', 'gate.mjs');",
      "// Run gate.mjs with a scrubbed environment — don't inherit this shell's lease.",
      'const run = spawn(process.execPath, [CLI], { env: childEnv() }); // don’t inherit',
    ].join('\n');
    expect(spawnCalls(source).map((call) => call.line)).toEqual([3]);
  });

  it('does not count a call that only exists in a doc comment', () => {
    const source = [
      '/**',
      ' * Use it as: spawn(process.execPath, [CLI], { env: childEnv() })',
      ' */',
      'const run = spawn(process.execPath, [CLI], { env: childEnv() });',
    ].join('\n');
    expect(spawnCalls(source).map((call) => call.line)).toEqual([4]);
  });
});

/**
 * Coverage, not taste: the guard has to notice a *new* device-aware spawn site, because that is
 * how X32 and X33 got there (`bench-baseline-merge.test.js` predates the lease rules and nobody
 * thought to audit it). Both sides of the match are read from the tree.
 */
describe('no suite spawns a device-aware script from an unscrubbed environment', () => {
  const aware = deviceAwareScripts(join(REPO_ROOT, 'scripts'));

  it('knows which scripts a sourced lease would change the behaviour of', () => {
    // The list is the guard's whole premise, so it is asserted against the scripts the X32/X33
    // reports named, not against a count: an empty match per script is the failure this exists for.
    // The five the reports named. `harness.mjs` is deliberately not on this list: it is the
    // `react-native-harness` CLI wrapper and reads no device variable of its own — the device
    // reaches it through the harness config in `example/`, which is not a script this scan walks.
    for (const script of [
      'lease.mjs',
      'gate.mjs',
      'run.mjs',
      'ios.mjs',
      'android.mjs',
    ]) {
      expect(
        [...aware.keys()].filter((path) => path.endsWith(`/${script}`))
      ).not.toEqual([]);
    }
    // And a script that reads only a test knob is *not* device aware: `sync-example-lock.mjs`
    // reads `NITRO_UI_LOCK_SYNC_ROOT`, which says nothing about a device, and a guard that
    // called that one device aware would be ignored within a month because it cries wolf.
    expect(
      [...aware.entries()].filter(([script]) =>
        script.endsWith('sync-example-lock.mjs')
      )
    ).toEqual([]);
  });

  it('finds the sites, and every one of them scrubs', () => {
    const suites = readdirSync(__dirname)
      .filter((name) => name.endsWith('.test.js'))
      .sort();
    expect(suites.length).toBeGreaterThan(20);
    const offending = [];
    let guarded = 0;
    for (const name of suites) {
      const source = readFileSync(join(__dirname, name), 'utf8');
      for (const call of spawnCalls(source)) {
        const target = deviceAwareTarget(call.targetText, source, aware);
        if (target == null) continue;
        // An `env:` built in a helper is judged on the helper's text too: `env: env(extra)` is
        // clean exactly when the function behind it scrubs, and reading only the call site would
        // call it clean either way.
        const effective = [
          call.window,
          ...envValueIdentifiers(call.window).map((id) =>
            definitionText(source, id)
          ),
        ].join('\n');
        if (callScrubsLease(effective)) {
          guarded += 1;
          continue;
        }
        // No `env` at all is the worst case, not the safe one: the child gets the suite's own
        // environment wholesale. Only an environment the suite assembled by hand is clean.
        if (callSetsEnv(call.window) && !callSpreadsProcessEnv(effective))
          continue;
        offending.push(
          `${relative(REPO_ROOT, join(__dirname, name))}:${String(call.line)} hands ` +
            `${target.script.split('/').pop()} (reads ${target.names.slice(0, 3).join(', ')}) ` +
            (callSetsEnv(call.window)
              ? 'an unscrubbed process.env'
              : 'no environment of its own at all')
        );
      }
    }
    expect(offending).toEqual([]);
    // A guard that matched nothing would pass the assertion above forever. The number is how many
    // device-aware sites the scrub is actually protecting — the count of suites that spawn a real
    // CLI with a scrubbed environment. If it drops, a site went missing rather than being fixed.
    expect(guarded).toBeGreaterThanOrEqual(12);
  });
});
