/**
 * Does `test:native:android` know when it is not the one that should run?
 *
 * X15 item 2 wired the step into `check`, and a step in the chain has to be honest
 * about running nothing: `android/src/test` holds the Kotlin twin of the event-count
 * handshake, and the reason it is being added at all is that nobody has to remember to
 * ask for it. So the ways it declines - a machine with no Android SDK, and a CI run
 * whose Android job owns the task - are the difference between "proved" and "quietly
 * skipped", and each has to say why in the log a reader sees.
 *
 * The cases run the real script file, in a scratch tree: the claim is about shell
 * logic, and re-stating the condition in JavaScript would keep passing while the script
 * did something else. `ROOT` is derived from the script's own location, so copying it
 * into `<scratch>/scripts/` moves every path it reads - the SDK probe, the
 * `example/android` it `cd`s into, the `./gradlew` it execs - into a directory this
 * file owns. `gradlew` is a stand-in that records its arguments and exits, so a case
 * that reached gradle says so, without an SDK, a dependency download, or a device.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from '@jest/globals';

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'native-tests-android.sh');

let scratch = null;
afterEach(() => {
  if (scratch != null) fs.rmSync(scratch, { recursive: true, force: true });
  scratch = null;
});

/**
 * The script, run against a scratch tree of its own.
 *
 * @param {object} options
 * @param {boolean} [options.sdk] whether an SDK is discoverable (`ANDROID_HOME`)
 * @param {Record<string, string>} [options.env] what the case is about, e.g. `{ CI: 'true' }`
 * @param {string[]} [options.args] extra arguments on the *script's* command line
 * @returns {{status: number | null, output: string, gradleArgs: string[] | null}}
 *   `gradleArgs` is null when the script never reached gradle, which is how a skip is
 *   told apart from a run
 */
function runScript({ sdk = false, env = {}, args = [] } = {}) {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'x15-android-tests-'));
  fs.mkdirSync(path.join(scratch, 'scripts'), { recursive: true });
  fs.copyFileSync(
    SCRIPT,
    path.join(scratch, 'scripts', 'native-tests-android.sh')
  );
  const projectDir = path.join(scratch, 'example', 'android');
  fs.mkdirSync(projectDir, { recursive: true });
  const sdkDir = path.join(scratch, 'sdk');
  fs.mkdirSync(sdkDir, { recursive: true });
  const argsFile = path.join(scratch, 'gradle-args');
  fs.writeFileSync(
    path.join(projectDir, 'gradlew'),
    `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(argsFile)}\necho "gradle stub: $*"\nexit 0\n`
  );
  fs.chmodSync(path.join(projectDir, 'gradlew'), 0o755);

  const result = spawnSync(
    'bash',
    [path.join(scratch, 'scripts', 'native-tests-android.sh'), ...args],
    {
      cwd: scratch,
      encoding: 'utf8',
      timeout: 60_000,
      env: {
        // Nothing inherited: each case says whether an SDK exists and whether this is
        // CI, rather than reading this machine or this runner's environment.
        ANDROID_HOME: sdk ? sdkDir : '',
        ANDROID_SDK_ROOT: '',
        CI: '',
        NITRO_UI_ANDROID_ARCH: '',
        PATH: process.env.PATH ?? '',
        ...env,
      },
    }
  );
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    gradleArgs: fs.existsSync(argsFile)
      ? fs.readFileSync(argsFile, 'utf8').trim().split('\n')
      : null,
  };
}

describe('test:native:android', () => {
  it('runs the library JVM task, with one ABI, when the SDK is there', () => {
    const run = runScript({ sdk: true });
    expect(run.status).toBe(0);
    expect(run.gradleArgs).not.toBeNull();
    expect(run.gradleArgs).toContain(
      ':react-native-nitro-ui:testDebugUnitTest'
    );
    // One ABI, not the whole list: the JVM tests run no native code, so this is the
    // X6-build-speed rule about what CMake needs to *configure*.
    expect(
      run.gradleArgs.some((arg) => /^-PreactNativeArchitectures=\S+$/.test(arg))
    ).toBe(true);
  });

  it('names the SDK as the reason when the machine has none', () => {
    // A contributor on a Mac with no Android SDK, or a container: `check` has to stay
    // green, so this exits 0 - but the reason has to be printed, or "no Kotlin tests
    // ran" is invisible in a log that otherwise says nothing went wrong.
    const run = runScript();
    expect(run.status).toBe(0);
    expect(run.gradleArgs).toBeNull();
    expect(run.output).toMatch(/no Android SDK/);
    expect(run.output).toMatch(/skipped/);
  });

  it("hands the run to CI's Android job rather than proving it twice", () => {
    // The `checks` runner *does* have an SDK, so "no SDK" is not why it declines
    // there - and running it in both jobs would pay for a cold gradle cache to prove
    // the same thing twice, in a job that never sets up a JDK. The skip has to name
    // who owns it, or a green `check` row in CI reads as "no Kotlin tests ran
    // anywhere".
    const run = runScript({ sdk: true, env: { CI: 'true' } });
    expect(run.status).toBe(0);
    expect(run.gradleArgs).toBeNull();
    expect(run.output).toMatch(/skipped/);
    expect(run.output).toMatch(/build-android/);
  });

  it('runs wherever CI is not, so both skips are guards and not the rule', () => {
    // Without the opposite of the case above, a script that always skipped would pass
    // this whole file. That is the real risk in a step added for coverage: a skip that
    // reads as a pass.
    expect(runScript({ sdk: true }).gradleArgs).not.toBeNull();
    expect(runScript({ sdk: true, env: { CI: '' } }).gradleArgs).not.toBeNull();
    // And `CI=false` is not CI: a task runner that exports a falsy flag must not
    // switch the coverage off.
    expect(
      runScript({ sdk: true, env: { CI: 'false' } }).gradleArgs
    ).not.toBeNull();
  });

  it('passes an argument through to gradle, so a re-run can force the task', () => {
    // `bun run test:native:android -- --rerun-tasks` is how a person proves these
    // tests actually execute rather than reporting `UP-TO-DATE`; swallowed arguments
    // would make that impossible, and invisible.
    const plain = runScript({ sdk: true });
    expect(plain.gradleArgs ?? []).not.toContain('--rerun-tasks');
    const forced = runScript({ sdk: true, args: ['--rerun-tasks'] });
    expect(forced.gradleArgs ?? []).toContain('--rerun-tasks');
  });

  it('really is run by the CI job it hands off to', () => {
    // The skip above is only honest if the job it names runs the script. Together the
    // two assertions say "exactly one place in CI runs this": remove the step from
    // `ci.yml` and the skip becomes the coverage vanishing from CI, quietly.
    const workflow = fs.readFileSync(
      path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml'),
      'utf8'
    );
    const buildAndroid =
      /\n {2}build-android:\n([\s\S]*?)(?=\n {2}[a-z-]+:\n|\n {2}#)/.exec(
        workflow
      );
    expect(buildAndroid).not.toBeNull();
    expect(String(buildAndroid?.[1])).toMatch(
      /scripts\/native-tests-android\.sh/
    );
  });
});
