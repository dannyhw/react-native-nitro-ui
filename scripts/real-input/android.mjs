#!/usr/bin/env node
/**
 * The Android real-input gate: the e2e suite in `example/e2e/` delivers the touch and
 * the assertions read what the app draws. This file is the orchestrator — the lease’s
 * device, the stamped APK, Metro and the private agent-device daemon — then the sweep
 * and the `uiautomator` checks, and finally one exit code for the run.
 *
 * The emulator must already be booted, and only the serial this shell exported is
 * addressed, through the adb server that lease owns.
 */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

import { artifactsDir, ensureMetro, run, Suite } from './support.mjs';
import { androidRunPlan, androidUsage } from './android-run.mjs';
import {
  FOLLOWUPS_FILE,
  recordResults,
  TEST_SUFFIX,
} from './android-results.mjs';
import { REAL_INPUT_CONTROLS } from './controls.mjs';
import { exampleTabs } from './tab-targets.mjs';
import { runA11ySweepOnDevice } from './a11y-sweep-device.mjs';
import {
  runTreeChecksOnDevice,
  TREE_CHECK_IDS,
} from './android-tree-checks.mjs';
import { assertSupportedNodeOrReexec } from '../node-version.mjs';
import { assertFreshApp, colorize } from '../app-stamp.mjs';
import { isReservedSerial, requireLeaseDevice } from '../lease-core.mjs';
import { emulatorLaunchCommand } from '../emulator-launch.mjs';

// One Node across every device gate: the harness cannot run on Node 25/26 at
// all, so a real-input run on that runtime is not comparable evidence.
assertSupportedNodeOrReexec({
  command: 'bun run test:real-input:android',
  entryUrl: import.meta.url,
});

/** The example app's applicationId. */
const BUNDLE_ID = 'nitroui.example';

/** Where the suite lives, relative to the repo root. */
const E2E_DIR = 'example/e2e';

/**
 * Where an e2e run writes, relative to `example/e2e`.
 *
 * e2e refuses an `--output` outside its own project root, so the report and the
 * screenshots live beside the suite rather than in the shared `.real-input/`
 * evidence directory. The absolute path is printed before the run, so a reader
 * of a gate log knows where to look.
 */
const E2E_OUTPUT = path.join('.e2e', 'android');

/**
 * What one e2e run may spend, in ms.
 *
 * The gate has no timeout of its own, and a run that hangs holds its lease.
 * The ceiling is the full suite's own length plus a tail of about a third, so
 * it moves when the suite grows, never to get a slow run through; e2e ends
 * the run at the deadline and exits non-zero, which is a red gate rather than
 * a wedged one.
 */
const RUN_MAX_MS = 45 * 60 * 1000;

/** @returns {string} */
function repoRoot() {
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
}

/**
 * @param {string} file
 * @returns {string | null}
 */
function readOrNull(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Where `adb` lives: the SDK the environment names, or whatever is on PATH.
 *
 * @param {NodeJS.ProcessEnv} env
 */
function adbBinary(env) {
  const sdk = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
  return sdk != null && fs.existsSync(path.join(sdk, 'platform-tools/adb'))
    ? path.join(sdk, 'platform-tools/adb')
    : 'adb';
}

/**
 * The `adb` for this run: pinned to the lease's server and the lease's serial.
 *
 * Every call carries `-P` and `-s`. An unqualified `adb` reaches whichever device the
 * server lists first, and another emulator is usually on that server.
 *
 * @param {NodeJS.ProcessEnv} env
 */
function adbPrefix(env) {
  const port = env.ANDROID_ADB_SERVER_PORT;
  return (/** @type {string[]} */ args) => [
    ...(port != null && port !== '' ? ['-P', String(port)] : []),
    ...args,
  ];
}

/**
 * The device this run may address: the leased serial, on the leased adb server.
 *
 * @param {NodeJS.ProcessEnv} env
 */
function resolveDevice(env) {
  const device = requireLeaseDevice({
    env,
    platform: 'android',
    command: 'real-input (android)',
    // Never a fallback, lease named or not: this suite runs on the emulator its
    // lease exported or it does not run.
    requireDevice: true,
  });
  const assigned = device.avd;
  if (assigned != null && /^PR15\d\d/i.test(assigned)) {
    throw new Error(
      `real-input: ANDROID_AVD="${assigned}" is the one reserved ` +
        'for the human running this gate. Refusing to touch it.'
    );
  }
  if (isReservedSerial(device.serial)) {
    throw new Error(
      `real-input: ${device.serial} is the serial no lease may use. ` +
        'Refusing to touch it.'
    );
  }

  const adb = adbPrefix(env);
  const bootHint = emulatorLaunchCommand({
    avd: assigned ?? '<avd>',
    port: device.emulatorPort,
    snapshot: 'cold',
  });
  const listed = run(adbBinary(env), adb(['devices']), { env });
  if (listed.status !== 0) {
    throw new Error(
      `real-input: \`adb devices\` failed: ` +
        (listed.stderr.trim() === ''
          ? listed.stdout.trim()
          : listed.stderr.trim())
    );
  }
  const serials = listed.stdout
    .split('\n')
    .slice(1)
    .map((line) => line.split('\t')[0] ?? '')
    .filter((line) => line.startsWith('emulator-'));
  if (!serials.includes(device.serial)) {
    throw new Error(
      `real-input: the lease names ${device.serial} (AVD ${assigned ?? '?'}), ` +
        `and adb server ${env.ANDROID_ADB_SERVER_PORT ?? 'default'} lists ` +
        `${serials.length === 0 ? 'no emulator' : serials.join(', ')}. Boot it:\n` +
        `  ${bootHint}`
    );
  }
  return device;
}

/**
 * The control ids the suite has files for. Two silent gaps are closed here: a control
 * with no file would pass by never running, and a file named after a control that left
 * the table would run for nobody.
 *
 * @param {string} dir `example/e2e/real-input`
 */
function suiteFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(TEST_SUFFIX))
    .map((file) => file.slice(0, -TEST_SUFFIX.length));
}

/**
 * Install the stamped build and point it at this run’s Metro.
 *
 * `debug_http_host` and `adb reverse` together point the app at a non-default Metro
 * port. The XML goes over base64: nested quotes do not survive adb’s shell and the
 * device’s `sh -c` inside `run-as`.
 * @param {object} options
 * @param {(args: ReadonlyArray<string>) => {status: number, stdout: string, stderr: string}} options.adb
 * @param {string} options.apk
 * @param {number} options.metroPort
 */
function installAndPoint({ adb, apk, metroPort }) {
  const installed = adb(['install', '-r', '-d', apk]);
  if (installed.status !== 0) {
    throw new Error(
      `real-input: installing ${path.basename(apk)} failed: ` +
        `${installed.stdout}\n${installed.stderr}`.trim()
    );
  }
  // The shade belongs to no app, and a run that is stopped mid-gesture can leave it
  // down: the next run then finds its own screen covered by SystemUI and reports every
  // control as unreachable. Collapsing it is the one thing a run has to undo that it
  // cannot blame on the previous one.
  adb(['shell', 'cmd', 'statusbar', 'collapse']);
  const prefs = `shared_prefs/${BUNDLE_ID}_preferences.xml`;
  const xml =
    `<?xml version="1.0" encoding="utf-8" standalone="yes" ?>\n<map>` +
    `<string name="debug_http_host">localhost:${String(metroPort)}</string></map>`;
  const encoded = Buffer.from(xml, 'utf8').toString('base64');
  adb([
    'shell',
    `run-as ${BUNDLE_ID} sh -c 'mkdir -p shared_prefs && ` +
      `echo ${encoded} | base64 -d > ${prefs}'`,
  ]);
  const written = adb(['shell', `run-as ${BUNDLE_ID} cat ${prefs}`]);
  if (!written.stdout.includes(`localhost:${String(metroPort)}`)) {
    throw new Error(
      `real-input: the app cannot be pointed at Metro on ` +
        `${String(metroPort)} - the debug_http_host preference did not stick. ` +
        `${prefs} reads back as:\n${written.stdout}`
    );
  }
  const reverse = adb([
    'reverse',
    `tcp:${String(metroPort)}`,
    `tcp:${String(metroPort)}`,
  ]);
  if (reverse.status !== 0) {
    throw new Error(
      `real-input: adb reverse tcp:${String(metroPort)} failed: ` +
        reverse.stderr.trim()
    );
  }
}

/**
 * One e2e run, and what it proved.
 *
 * @param {object} options
 * @param {ReadonlyArray<string>} options.files Test files to run, relative to
 *   `example/e2e`. Empty runs every file.
 * @param {Record<string, string>} options.env The environment the run gets.
 * @returns {{status: number, report: any}}
 */
function runE2E({ files, env }) {
  const root = repoRoot();
  const binary = path.join(root, 'node_modules/.bin/e2e');
  if (!fs.existsSync(binary)) {
    throw new Error(
      'real-input: e2e is not installed. `bun install` at the repo root first ' +
        `(it is a devDependency of the example app: e2e + @e2e-dev/mobile).`
    );
  }
  const reportFile = path.join(root, E2E_DIR, E2E_OUTPUT, 'report.json');
  fs.rmSync(reportFile, { force: true });
  console.log(
    `real-input: e2e artifacts in ${path.join(root, E2E_DIR, E2E_OUTPUT)}`
  );
  const argv = [
    binary,
    'run',
    // Absolute: e2e resolves --config against the working directory, which is
    // already `example/e2e`, and a path joined from the repo root would be
    // doubled. The test arguments below stay relative, which is what the
    // config's `tests` patterns are written against.
    '--config',
    path.join(root, E2E_DIR, 'e2e.config.ts'),
    '--output',
    E2E_OUTPUT,
    '--workers',
    '1',
    '--retries',
    '0',
    '--max-duration',
    String(RUN_MAX_MS),
    ...files.map((file) => path.join('real-input', file)),
  ];
  // The runner's own stdout: e2e's list reporter is the readable half of the
  // gate log, and the JSON report is the half this file turns into a verdict.
  // `bun <file>` runs the CLI on the bun runtime whatever its `node` shebang
  // says, and the mobile driver's daemon then starts on bun too. e2e needs bun
  // 1.4.3 or newer, which `packageManager` pins.
  const result = spawnSync('bun', argv, {
    cwd: path.join(root, E2E_DIR),
    env,
    stdio: 'inherit',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error != null) {
    throw new Error(
      `real-input: e2e could not start on bun (is bun on PATH?): ${String(result.error)}`
    );
  }
  /** @type {any} */
  let report = null;
  if (fs.existsSync(reportFile)) {
    try {
      report = JSON.parse(fs.readFileSync(reportFile, 'utf8')).run ?? null;
    } catch (error) {
      console.error(
        `real-input: could not read ${reportFile}: ${String(error?.message ?? error)}`
      );
    }
  }
  return { status: result.status ?? 1, report };
}

/**
 * Stop the private agent-device daemon this run started, if it is still up.
 *
 * The tool's own shutdown, against the state dir this run owns: leaving it
 * running would hand the next run a daemon whose environment — including the
 * adb server this lease owns — is not the next run's.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string} stateDir
 */
function stopAgentDeviceDaemon(env, stateDir) {
  const binary = path.join(repoRoot(), 'node_modules/.bin/agent-device');
  if (!fs.existsSync(binary)) return;
  const stopped = spawnSync(
    process.execPath,
    [binary, 'daemon', 'stop', '--state-dir', stateDir],
    { env, stdio: 'ignore', timeout: 30000 }
  );
  if (stopped.status !== 0) {
    // Not a red run: a daemon that will not stop is cleaned up by its own idle
    // timeout, and the suite's verdict has already been decided.
    console.log(
      'agent-device: daemon stop did not confirm (idle timeout will)'
    );
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(androidUsage());
    return 0;
  }
  // Before anything reads the device: an unknown control or case is refused untouched.
  const plan = androidRunPlan(argv);
  const controls = plan.controls;
  const suite = new Suite('android', controls);
  const out = artifactsDir('android');
  const metroPort = Number(process.env.METRO_PORT ?? 8291);
  const apk =
    process.env.HARNESS_APP_PATH ??
    path.resolve(
      repoRoot(),
      'example/android/app/build/outputs/apk/debug/app-debug.apk'
    );

  // The suite installs an APK rather than building one, so it is exactly as
  // exposed to a stale artifact as the harness is: `adb install -r` of an old
  // debug build would report green for code that is not here.
  try {
    assertFreshApp({
      platform: 'android',
      artifact: apk,
      command: 'bun run test:real-input:android',
    });
  } catch (error) {
    // Before `adb` is even asked which devices exist: a refusal must not touch a
    // device another lease is holding.
    console.error(colorize(String(error?.message ?? error), 'red'));
    throw error;
  }

  const device = resolveDevice(process.env);
  console.log(
    `real-input (android): ${device.serial} · ${device.avd} · adb server ` +
      `${process.env.ANDROID_ADB_SERVER_PORT ?? 'default'} · Metro ${String(metroPort)}`
  );

  // The shared table and the suite's files have to describe one suite.
  const e2eDir = path.join(repoRoot(), E2E_DIR, 'real-input');
  const fileIds = suiteFiles(e2eDir);
  for (const id of fileIds) {
    if (REAL_INPUT_CONTROLS.some((control) => control.id === id)) {
      continue;
    }
    throw new Error(
      `real-input: ${E2E_DIR}/real-input/${id}${TEST_SUFFIX} names no control in ` +
        'scripts/real-input/controls.mjs. Either add the control to the table ' +
        '(and an iOS check for it) or delete the file.'
    );
  }
  const wanted = controls.filter((control) => fileIds.includes(control.id));
  for (const control of controls) {
    if (!fileIds.includes(control.id)) suite.markMissing(control.id);
  }
  if (wanted.length === 0 && !plan.a11yNamed) {
    return suite.finish();
  }

  const stopMetro = await ensureMetro({
    port: metroPort,
    logFile: path.join(out, 'metro.log'),
  });
  const adb = adbPrefix(process.env);
  const adbRun = (/** @type {string[]} */ args) =>
    run(adbBinary(process.env), adb([...args]), { env: process.env });
  /** One `adb shell` command for the sweep, with the failure's own stdout attached. */
  const adbShell = (/** @type {string} */ command) => {
    const result = adbRun(['shell', command]);
    if (result.status !== 0) {
      const failure =
        /** @type {NodeJS.ErrnoException & {status?: number, stdout?: string}} */ (
          new Error(
            `real-input: adb shell ${command} exited ${String(result.status)}: ` +
              `${String(result.stderr ?? '').trim() || String(result.stdout).trim()}`
          )
        );
      failure.status = result.status;
      failure.stdout = result.stdout;
      throw failure;
    }
    return String(result.stdout).trim();
  };
  // The tab bar the sweep navigates, read from the app rather than a copy of it.
  const tabs = exampleTabs(
    fs.readFileSync(path.join(repoRoot(), 'example/src/App.tsx'), 'utf8')
  );

  // A daemon of our own, in a directory of our own: agent-device's daemon keeps
  // the environment it started in, so a shared one would run this suite against
  // whichever adb server whoever started it had in mind. The allowlist is the
  // second half of that promise — to that daemon, no device but this one exists.
  const stateDir = path.join(out, 'agent-device');
  fs.mkdirSync(stateDir, { recursive: true });
  const env = {
    ...process.env,
    ANDROID_SERIAL: device.serial,
    AGENT_DEVICE_STATE_DIR: stateDir,
    AGENT_DEVICE_ANDROID_DEVICE_ALLOWLIST: device.serial,
    AGENT_DEVICE_NO_UPDATE_NOTIFIER: '1',
    // A gate that phones home is not a gate: nothing here may depend on, or
    // leak into, a vendor's telemetry.
    E2E_TELEMETRY_DISABLED: '1',
  };
  stopAgentDeviceDaemon(env, stateDir);

  try {
    installAndPoint({ adb: adbRun, apk, metroPort });
    // An empty file list runs every e2e file, so a run that names only a11y cases
    // skips e2e rather than asking it for nothing.
    const { status, report } =
      wanted.length === 0
        ? { status: 0, report: null }
        : runE2E({
            files: wanted.map((control) => `${control.id}${TEST_SUFFIX}`),
            env,
          });
    const controlsPassed =
      wanted.length === 0 ||
      recordResults(suite, wanted, report, {
        followups: readOrNull(path.join(repoRoot(), FOLLOWUPS_FILE)),
        readTestFile: (file) =>
          readOrNull(path.join(repoRoot(), E2E_DIR, file)),
      });
    // After the suite, and on every run that does not narrow it with `--a11y`: the pass
    // is one property of the tree per control, so a run that only checked four controls
    // still reads the whole table's a11y state. It stops the daemon it needs down itself.
    const sweep = await runA11ySweepOnDevice(
      (id, title, options) => suite.beginAuxiliary(id, title, options),
      {
        adbShell,
        tabs,
        appId: BUNDLE_ID,
        cases: plan.a11yCases,
        stopDaemon: () => stopAgentDeviceDaemon(env, stateDir),
      }
    );
    // The tree checks next, on the same daemon-less device: each is a rule the driver's
    // own node map cannot express, and a dump cannot be asked while it is attached.
    const tree =
      wanted.length === 0
        ? { covered: [] }
        : await runTreeChecksOnDevice(
            (id, title) => suite.beginAuxiliary(id, title),
            {
              adbShell,
              tabs,
              appId: BUNDLE_ID,
              only: wanted.map((control) => control.id),
              stopDaemon: () => stopAgentDeviceDaemon(env, stateDir),
            }
          );
    // Every way this run can fail has to reach the exit code. `--control` narrows
    // which checks exist; it does not narrow what counts as a pass, so a filtered
    // run is judged by the same list as a full one.
    const problems = [];
    if (status !== 0) {
      // A run error — a worker, a cleanup, a launch, the deadline — is a red gate
      // even when every test the report knows about passed.
      problems.push(`e2e exited ${String(status)}`);
    }
    if (!controlsPassed) {
      problems.push(
        'the e2e report does not prove every selected control passed'
      );
    }
    if (sweep.covered.length === 0) {
      problems.push('the a11y sweep reported no cases');
    }
    const unchecked = wanted
      .map((control) => control.id)
      .filter(
        (id) => TREE_CHECK_IDS.includes(id) && !tree.covered.includes(id)
      );
    if (unchecked.length > 0) {
      problems.push(`no uiautomator check ran for ${unchecked.join(', ')}`);
    }
    const summary = suite.finish();
    if (summary !== 0) {
      problems.push('a check failed');
    }
    for (const problem of problems) {
      console.log(`real-input: the run is red — ${problem}.`);
    }
    return problems.length === 0 ? 0 : 1;
  } finally {
    adbRun(['reverse', '--remove', `tcp:${String(metroPort)}`]);
    stopAgentDeviceDaemon(env, stateDir);
    stopMetro();
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(colorize(String(error?.stack ?? error), 'red'));
    process.exit(1);
  }
);
