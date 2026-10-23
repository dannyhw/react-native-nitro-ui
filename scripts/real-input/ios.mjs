#!/usr/bin/env node
/**
 * Real-input checks on iOS: XCUITest synthesises the touch, and the only thing
 * the assertions read is text the app renders on screen.
 *
 * XCUITest delivers events through the simulator's own event path, so they
 * travel IOHIDEvent → window server → React Native's touch handler → the hosted
 * SwiftUI control, the way a finger's do. That is the point of this suite:
 * `react-native-harness` drives controls through in-app hooks and has never
 * proved that path works (docs/tasks/T15-real-input.md).
 *
 * Nothing here attaches to the app's process or talks to Nitro. The checks live
 * in `example/ios/NitroUiExampleUITests/RealInputTests.swift` and read the
 * screen by accessibility identifier; this script only builds, installs, points
 * the app at Metro, runs the cases and turns the log into the shared report.
 *
 * Usage (devices and ports come from the environment, as everywhere else here):
 *
 *   IOS_UDID=<simulator udid> METRO_PORT=<port> \
 *     bun run test:real-input:ios [--control switch|slider|button]
 *
 * The simulator must already be booted: AGENTS.md says only touch devices you
 * started, so this script boots nothing and shuts nothing down.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  artifactsDir,
  chosenControls,
  ensureMetro,
  run,
  sleep,
  Suite,
} from './support.mjs';
import { REAL_INPUT_CONTROLS, iosCheckName } from './controls.mjs';

const BUNDLE_ID = 'nitroui.example';
const WORKSPACE = 'NitroUiExample.xcworkspace';
const SCHEME = 'NitroUiExampleUITests';
const TEST_CLASS = 'RealInputTests';

/**
 * Guard that the Swift file and the shared table describe one suite, then pick
 * out the selected controls that actually have a check.
 *
 * A control with no method is reported as a failure by the caller, never
 * skipped; a method with no table entry is an error. Either would let a control
 * quietly leave the suite. Both comparisons are against the *whole* table: a
 * `--control` run must not report the controls it left out as rogue.
 *
 * @param {string} swiftSource
 * @param {ReadonlyArray<import('./controls.mjs').RealInputControl>} controls the
 *   controls this run selected
 * @returns {ReadonlyArray<import('./controls.mjs').RealInputControl>} the
 *   selected controls that have a check
 */
function checkCoverage(swiftSource, controls) {
  const declared = new Set(
    [...swiftSource.matchAll(/func (testRealInput\w+)\s*\(/g)].map((m) => m[1])
  );
  for (const name of declared) {
    if (
      !REAL_INPUT_CONTROLS.some((control) => iosCheckName(control.id) === name)
    ) {
      throw new Error(
        `real-input: ${TEST_CLASS}.swift has "${name}" but no control in ` +
          'scripts/real-input/controls.mjs names it. Add the control to the ' +
          'table (and a check for it on Android) so both platforms cover it.'
      );
    }
  }
  return controls.filter((control) => declared.has(iosCheckName(control.id)));
}

/**
 * Which simulator to drive. Never guessed from a device list: several tasks share
 * this machine, and the brief names the one this task owns.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {Promise<{ udid: string, name: string }>}
 */
async function resolveDevice(env) {
  const udid = env.IOS_UDID;
  if (udid == null || udid === '') {
    throw new Error(
      'real-input: IOS_UDID is not set. Point it at the simulator your brief ' +
        'assigns, e.g. IOS_UDID=$(xcrun simctl list devices available | ' +
        "grep -m1 iPhone | tr -dc 'A-F0-9-')"
    );
  }

  // A simulator that is still booting reads as `Booting` for a few seconds, and
  // this suite is normally started right after the task boots its device.
  const deadline = Date.now() + 60000;
  for (;;) {
    const listed = run('xcrun', ['simctl', 'list', 'devices', '-j']);
    if (listed.status !== 0) {
      throw new Error(
        `real-input: \`xcrun simctl list\` failed: ${listed.stderr}`
      );
    }
    /** @type {Record<string, Array<{ udid: string, name: string, state: string }>>} */
    const runtimes = JSON.parse(listed.stdout).devices;
    const devices = Object.values(runtimes).flat();
    const found = devices.find(
      (device) => device.udid === udid && device.state === 'Booted'
    );
    if (found != null) {
      return { udid, name: found.name };
    }
    if (Date.now() > deadline) {
      const state =
        devices.find((device) => device.udid === udid)?.state ?? 'unknown';
      const booted =
        devices
          .filter((device) => device.state === 'Booted')
          .map((device) => `${device.name} (${device.udid})`)
          .join(', ') || 'none';
      throw new Error(
        `real-input: simulator ${udid} is ${state}, not booted (booted: ` +
          `${booted}). Boot it first — this script deliberately boots nothing:` +
          `\n  xcrun simctl boot ${udid} && open -a Simulator`
      );
    }
    await sleep(2000);
  }
}

/**
 * Run xcodebuild, keeping the full log for evidence while printing the lines
 * that say what is happening.
 *
 * The status comes from the process exiting, not from its pipes closing:
 * xcodebuild leaves helpers (`xcresulttool`, the simulator agent) holding the
 * write end of the pipe after it is itself done, so waiting for `close` here
 * would hang a finished run - and a hung CI job is worse than a slow one.
 *
 * @param {ReadonlyArray<string>} args
 * @param {object} options
 * @param {string} options.logFile
 * @param {string} options.what for the error if it fails
 * @returns {Promise<number>} the exit status
 */
function xcodebuild(args, { logFile, what }) {
  console.log(`  ${what} (log: ${logFile})`);
  const out = fs.createWriteStream(logFile, { flags: 'w' });
  return new Promise((resolve, reject) => {
    const child = spawn('xcodebuild', [...args], {
      cwd: iosDir(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let done = false;
    const show = (chunk) => {
      if (done) {
        return;
      }
      out.write(chunk);
      for (const line of String(chunk).split('\n')) {
        if (
          /^\s*(Test Case|Test Suite|Testing failed|error:|warning: .*RealInput)|\*\* (TEST|BUILD)/.test(
            line
          )
        ) {
          console.log(`    ${line.trim()}`);
        }
      }
    };
    child.stdout.on('data', show);
    child.stderr.on('data', show);
    child.on('error', reject);
    child.on('exit', (status) => {
      done = true;
      out.end(() => resolve(status ?? 1));
    });
  });
}

/**
 * What each test case did, read out of an xcodebuild log.
 *
 * @param {string} log
 * @returns {Map<string, { outcome: string, notes: string[] }>} by method name
 */
function parseTestResults(log) {
  /** @type {Map<string, { outcome: string, notes: string[] }>} */
  const results = new Map();
  for (const match of log.matchAll(
    /Test Case '-\[[\w.]+ (\w+)\]' (passed|failed|skipped) \(([\d.]+) seconds\)/g
  )) {
    results.set(match[1], { outcome: match[2], duration: match[3], notes: [] });
  }
  for (const line of log.split('\n')) {
    if (!/error:/.test(line)) {
      continue;
    }
    const named = /(testRealInput\w+)/.exec(line);
    if (named != null && results.has(named[1])) {
      results.get(named[1]).notes.push(line.trim());
      continue;
    }
    // Anything else - a build or runner error - belongs to whichever case
    // failed, because that is the run it explains.
    for (const result of results.values()) {
      if (result.outcome === 'failed') {
        result.notes.push(line.trim());
      }
    }
  }
  return results;
}

/**
 * @returns {string}
 */
function iosDir() {
  return path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '../../example/ios'
  );
}

/**
 * Point the debug build at this task's Metro, in the place the build looks for
 * it. `RCT_jsLocation` is the user default React Native reads for the bundler
 * address, and the simulator shares this host's network, so `localhost` reaches
 * it. Writing it on the simulator rather than passing launch arguments keeps the
 * Swift file free of port plumbing.
 *
 * @param {string} udid
 * @param {number} port
 */
function setJsLocation(udid, port) {
  const location = `localhost:${String(port)}`;
  const write = run('xcrun', [
    'simctl',
    'spawn',
    udid,
    'defaults',
    'write',
    BUNDLE_ID,
    'RCT_jsLocation',
    '-string',
    location,
  ]);
  if (write.status !== 0) {
    throw new Error(
      `real-input: could not set RCT_jsLocation on ${udid}: ` +
        (write.stderr.trim() === '' ? write.stdout.trim() : write.stderr.trim())
    );
  }
  const read = run('xcrun', [
    'simctl',
    'spawn',
    udid,
    'defaults',
    'read',
    BUNDLE_ID,
    'RCT_jsLocation',
  ]);
  if (!read.stdout.includes(location)) {
    throw new Error(
      `real-input: RCT_jsLocation should read "${location}" on ${udid}, ` +
        `but it reads "${read.stdout.trim()}" (${read.stderr.trim()})`
    );
  }
  console.log(`  metro: ${BUNDLE_ID} will load its bundle from ${location}`);
}

/**
 * @param {string} udid
 */
function clearJsLocation(udid) {
  run('xcrun', [
    'simctl',
    'spawn',
    udid,
    'defaults',
    'delete',
    BUNDLE_ID,
    'RCT_jsLocation',
  ]);
}

async function main() {
  const controls = chosenControls(process.argv.slice(2));
  const suite = new Suite('ios', controls);
  const out = artifactsDir('ios');
  const metroPort = Number(process.env.METRO_PORT ?? 8291);
  const device = await resolveDevice(process.env);
  const root = iosDir();
  const derived = path.join(root, 'build');
  const app = path.join(
    derived,
    'Build/Products/Debug-iphonesimulator/NitroUiExample.app'
  );
  const buildLog = path.join(out, 'xcodebuild-build.log');
  const testLog = path.join(out, 'xcodebuild-test.log');

  const swiftFile = path.join(root, SCHEME, `${TEST_CLASS}.swift`);
  if (!fs.existsSync(swiftFile)) {
    throw new Error(`real-input: no UI test sources at ${swiftFile}`);
  }
  const swiftSource = fs.readFileSync(swiftFile, 'utf8');
  const declared = new Set(
    [...swiftSource.matchAll(/func (testRealInput\w+)\s*\(/g)].map((m) => m[1])
  );
  for (const control of controls) {
    if (!declared.has(iosCheckName(control.id))) {
      suite.markMissing(control.id);
    }
  }
  const toRun = checkCoverage(swiftSource, controls);
  if (toRun.length === 0) {
    return suite.finish();
  }

  console.log(
    `real-input (ios): ${device.name} · ${device.udid} · Metro ` +
      `${String(metroPort)} · scheme ${SCHEME}`
  );

  const stopMetro = await ensureMetro({
    port: metroPort,
    logFile: path.join(out, 'metro.log'),
  });
  let status = 1;
  try {
    const destination = `platform=iOS Simulator,id=${device.udid}`;
    // Same arguments for both phases: a different build setting between them
    // would make xcodebuild throw the whole build away.
    const settings = ['CODE_SIGNING_ALLOWED=NO'];
    const built = await xcodebuild(
      [
        'build-for-testing',
        '-workspace',
        WORKSPACE,
        '-scheme',
        SCHEME,
        '-configuration',
        'Debug',
        '-destination',
        destination,
        '-derivedDataPath',
        derived,
        ...settings,
      ],
      { logFile: buildLog, what: 'building the app and the UI-test bundle' }
    );
    if (built !== 0) {
      throw new Error(
        `real-input: building for testing failed (${built}). See ${buildLog}.`
      );
    }

    const installed = run('xcrun', ['simctl', 'install', device.udid, app]);
    if (installed.status !== 0) {
      throw new Error(
        `real-input: installing ${app} failed: ` +
          (installed.stderr.trim() === ''
            ? installed.stdout.trim()
            : installed.stderr.trim())
      );
    }
    setJsLocation(device.udid, metroPort);

    const selectors = toRun.map(
      (control) =>
        `-only-testing:${SCHEME}/${TEST_CLASS}/${iosCheckName(control.id)}`
    );
    status = await xcodebuild(
      [
        'test-without-building',
        '-workspace',
        WORKSPACE,
        '-scheme',
        SCHEME,
        '-configuration',
        'Debug',
        '-destination',
        destination,
        '-derivedDataPath',
        derived,
        // Without this, a *failing* case makes xcodebuild run `simctl diagnose`
        // afterwards - up to ten minutes of log gathering per failure, during
        // which the run looks hung. The evidence this suite keeps is the
        // xcodebuild log plus the accessibility dumps the checks print into it,
        // both under `.real-input/ios/`, and neither needs a result bundle.
        '-collect-test-diagnostics',
        'never',
        ...selectors,
        ...settings,
      ],
      { logFile: testLog, what: 'running the real-input cases' }
    );

    const log = fs.readFileSync(testLog, 'utf8');
    const outcomes = parseTestResults(log);
    for (const control of toRun) {
      const name = iosCheckName(control.id);
      const check = suite.begin(control);
      const outcome = outcomes.get(name);
      if (outcome == null) {
        check.abort(
          `${name}: no result in the xcodebuild log (exit ${String(status)}) — ` +
            'the case never reported, so this run cannot call it green. ' +
            `See ${testLog}.`
        );
        continue;
      }
      for (const note of outcome.notes) {
        check.note(note);
      }
      // Phrased so the line reads the same way whether the case passed or
      // failed: the suite's report prefixes failures with "failed:".
      check.check(
        `XCUITest reported "${outcome.outcome}" for ${name} in ` +
          `${String(outcome.duration)}s`,
        outcome.outcome === 'passed'
      );
    }
  } finally {
    clearJsLocation(device.udid);
    stopMetro();
  }

  return suite.finish();
}

process.exitCode = await main().catch((error) => {
  console.error(`\nreal-input (ios): ${String(error)}`);
  return 1;
});
