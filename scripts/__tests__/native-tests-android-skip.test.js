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
 * Runs the script against a scratch tree of its own, with a stub `gradlew` that records
 * its arguments.
 *
 * @param {object} options
 * @param {boolean} [options.sdk] whether an SDK is discoverable (`ANDROID_HOME`)
 * @param {Record<string, string>} [options.env]
 * @param {string[]} [options.args] extra arguments on the script's command line
 * @returns {{status: number | null, output: string, gradleArgs: string[] | null}}
 *   `gradleArgs` is null when the script never reached gradle
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
        // Nothing inherited from this machine: each case states its own SDK and `CI`.
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
    expect(
      run.gradleArgs.some((arg) => /^-PreactNativeArchitectures=\S+$/.test(arg))
    ).toBe(true);
  });

  it('names the SDK as the reason when the machine has none', () => {
    const run = runScript();
    expect(run.status).toBe(0);
    expect(run.gradleArgs).toBeNull();
    expect(run.output).toMatch(/no Android SDK/);
    expect(run.output).toMatch(/skipped/);
  });

  it("hands the run to CI's Android job rather than proving it twice", () => {
    const run = runScript({ sdk: true, env: { CI: 'true' } });
    expect(run.status).toBe(0);
    expect(run.gradleArgs).toBeNull();
    expect(run.output).toMatch(/skipped/);
    expect(run.output).toMatch(/build-android/);
  });

  it('runs wherever CI is not, so both skips are guards and not the rule', () => {
    expect(runScript({ sdk: true }).gradleArgs).not.toBeNull();
    expect(runScript({ sdk: true, env: { CI: '' } }).gradleArgs).not.toBeNull();
    expect(
      runScript({ sdk: true, env: { CI: 'false' } }).gradleArgs
    ).not.toBeNull();
  });

  it('passes an argument through to gradle, so a re-run can force the task', () => {
    const plain = runScript({ sdk: true });
    expect(plain.gradleArgs ?? []).not.toContain('--rerun-tasks');
    const forced = runScript({ sdk: true, args: ['--rerun-tasks'] });
    expect(forced.gradleArgs ?? []).toContain('--rerun-tasks');
  });

  it('runs for real in the CI job it hands off to, with that job’s own env', () => {
    // Actions sets `CI=true` on every step, so the step's own env from ci.yml must get
    // the script past its CI skip.
    const step = readAndroidJvmStepEnv();
    expect(step.env.NITRO_UI_ANDROID_JVM_TESTS).toBe('1');
    expect(step.run).toMatch(/scripts\/native-tests-android\.sh/);

    const run = runScript({ sdk: true, env: { CI: 'true', ...step.env } });
    expect(run.output).not.toMatch(/skipped/);
    expect(run.gradleArgs).not.toBeNull();
    expect(run.gradleArgs).toContain(
      ':react-native-nitro-ui:testDebugUnitTest'
    );
  });
});

/**
 * The `Android JVM unit tests` step of `build-android` in ci.yml: its `run:` line and
 * its `env:` map. Parsed by indentation: a step is six spaces, its keys eight, a map's
 * entries ten.
 *
 * @returns {{run: string, env: Record<string, string>}}
 */
function readAndroidJvmStepEnv() {
  const workflow = fs.readFileSync(
    path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml'),
    'utf8'
  );
  const job =
    /\n {2}build-android:\n([\s\S]*?)(?=\n {2}[a-z-]+:\n|\n {2}#)/.exec(
      workflow
    );
  expect(job).not.toBeNull();
  const lines = String(job?.[1]).split('\n');
  const runIndex = lines.findIndex((line) =>
    /^ {8}run:.*native-tests-android\.sh/.test(line)
  );
  expect(runIndex).toBeGreaterThan(-1);

  const env = {};
  let envIndex = -1;
  for (let i = runIndex - 1; i >= 0; i -= 1) {
    const line = lines[i] ?? '';
    if (line.trim() === '') continue;
    const indent = String(/^ */.exec(line)?.[0]).length;
    if (indent > 8) continue;
    if (indent < 8) break;
    if (/^ {8}env:\s*$/.test(line)) {
      envIndex = i;
      break;
    }
  }
  expect(envIndex).toBeGreaterThan(-1);
  for (let i = envIndex + 1; i < runIndex; i += 1) {
    const entry = /^ {10}([\w.-]+):\s*(.*?)\s*$/.exec(lines[i] ?? '');
    if (entry == null) continue;
    env[entry[1]] = entry[2].replace(/^['"]|['"]$/g, '');
  }
  return { run: lines[runIndex] ?? '', env };
}
