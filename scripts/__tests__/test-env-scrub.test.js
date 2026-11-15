import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { scrubLeaseEnv } from './helpers/jest-global-setup.js';
import {
  LEASE_SCOPED_PROBE_NAMES,
  childEnv,
  isLeaseScopedEnvName,
  withoutLeaseEnv,
} from './helpers/scrubbed-env.js';

const REPO_ROOT = join(__dirname, '..', '..');

/** The `export NAME=` lines `renderEnvFile` writes, read out of `lease-core.mjs`'s source. */
const RENDERED_NAMES = [
  ...require('node:fs')
    .readFileSync(`${__dirname}/../lease-core.mjs`, 'utf8')
    .matchAll(/exportLine\(\s*'([A-Z0-9_]+)'/g),
].map((match) => match[1]);

describe('jest starts with no lease in its environment', () => {
  it('removes every lease-scoped name and nothing else', () => {
    const env = {
      PATH: '/usr/bin',
      ANDROID_HOME: '/sdk',
      ANDROID_AVD_HOME: '/avd',
      NITRO_UI_LEASE_ID: 'G8-abc',
      NITRO_UI_GATE_LOG: '/tmp/somebody-elses-run.log',
      METRO_PORT: '8295',
      ANDROID_SERIAL: 'emulator-5574',
      IOS_SIM_UDID: 'poisoned-udid',
    };
    expect(scrubLeaseEnv(env).sort()).toEqual([
      'ANDROID_SERIAL',
      'IOS_SIM_UDID',
      'METRO_PORT',
      'NITRO_UI_GATE_LOG',
      'NITRO_UI_LEASE_ID',
    ]);
    expect(env).toEqual({
      PATH: '/usr/bin',
      ANDROID_HOME: '/sdk',
      ANDROID_AVD_HOME: '/avd',
    });
  });

  it('is the setup jest is configured to run', () => {
    const configured = require('../../package.json').jest.globalSetup;
    expect(
      require('node:path').resolve(
        configured.replace('<rootDir>', `${__dirname}/../..`)
      )
    ).toBe(require.resolve('./helpers/jest-global-setup.js'));
  });

  it('hands a child that was given no `env` an environment with no lease in it', () => {
    // No `env` option, so the child inherits what this jest process really has - not the copy a
    // test file sees as `process.env`.
    const printed = LEASE_SCOPED_PROBE_NAMES.map(
      (name) => `printf '%s=[%s]\\n' '${name}' "\${${name}-unset}"`
    ).join('\n');
    const child = spawnSync('/bin/sh', ['-c', printed], { encoding: 'utf8' });
    expect(child.status).toBe(0);
    const seen = String(child.stdout)
      .trim()
      .split('\n')
      .filter((line) => !line.endsWith('=[unset]'));
    expect(seen).toEqual([]);
    // And the copy a test file reads has none either, so `{ ...process.env, X }` is clean too.
    expect(Object.keys(process.env).filter(isLeaseScopedEnvName)).toEqual([]);
  });
});

describe('a test child does not inherit this shell’s lease', () => {
  it('scrubs every name lease.mjs prints into an env file', () => {
    // The names come from the shipped renderer, so a new lease variable the scrub misses
    // fails here.
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
      // A whole lease.
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
      NITRO_UI_GATE_LOG: '/tmp/somebody-elses-run.log',
      NITRO_UI_HOME: '/Users/tester/.nitro-ui',
    });
    const left = Object.keys(env).filter(isLeaseScopedEnvName);
    expect(left).toEqual([]);
    // `ANDROID_AVD` is matched exactly, not by prefix, so `ANDROID_AVD_HOME` survives.
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
    // Poisons `process.env` first, as a sourced lease does.
    const poisoned = {
      NITRO_UI_LEASE_ID: 'X16-poison',
      NITRO_UI_LEASE_TASK: 'X16',
      METRO_PORT: '8295',
      ANDROID_SERIAL: 'emulator-5574',
      IOS_SIM_UDID: 'poisoned-udid',
      IOS_VERSION: '27.0',
      NITRO_UI_GATE_LOG: '/tmp/poison.log',
    };
    // A test's own value for a lease-scoped name, which has to survive the scrub.
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
      // ...and where a test named one itself, its value is what the child sees.
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
   * Spawns a child that runs the shipped lease checks on its own environment, then prints
   * which lease names it received.
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
      const child = spawnLeaseProbe(
        childEnv({ ANDROID_SERIAL: 'emulator-5599' })
      );
      expect(child.status).toBe(0);
      // The only lease-shaped name the child may hold is the one this case handed it.
      expect(child.seen).toEqual(['ANDROID_SERIAL']);
      const left = (child.seen ?? []).filter(
        (name) => isLeaseScopedEnvName(name) && !(name in { ANDROID_SERIAL: 1 })
      );
      expect(left).toEqual([]);
    });
  });

  it('would have handed the same child a pair that disagrees (the same case without the scrub)', () => {
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
    withFakeLease(() => {
      // A whole Android half: `requireLeaseDevice` refuses a lease that names a platform and
      // withholds some of that half's identifiers.
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
