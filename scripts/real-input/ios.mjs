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
 *     bun run test:real-input:ios [--control <id>]   # ids: controls.mjs
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
import { parseTestResults, realInputLine } from './ios-log.mjs';
import { REAL_INPUT_CONTROLS, iosCheckName } from './controls.mjs';
import {
  A11Y_CONTROLS,
  checkIosControlA11y,
  parseIosA11yLog,
  staleExemptions,
} from './a11y.mjs';
import { assertSupportedNodeOrReexec } from '../node-version.mjs';
import { currentCodeTree, recordBuild } from '../app-stamp.mjs';
import { iosModuleCacheArgs } from '../build-speed-lib.mjs';

// One Node across every device gate: the harness cannot run on Node 25/26 at
// all, so a real-input run on that runtime is not comparable evidence. When this
// shell is on the wrong Node, restart under the `.nvmrc` one rather than refusing
// a device run - `bun run test:real-input:*` is a device gate, not a shell test.
assertSupportedNodeOrReexec({
  command: 'bun run test:real-input:ios',
  entryUrl: import.meta.url,
});

const BUNDLE_ID = 'nitroui.example';
const WORKSPACE = 'NitroUiExample.xcworkspace';
const SCHEME = 'NitroUiExampleUITests';
const TEST_CLASS = 'RealInputTests';

/**
 * The accessibility pass's method name, and the id it reports under.
 *
 * It is not a control: it asserts nothing about a press, and a control's totals have to
 * keep meaning "every control answered a real touch". `A11Y_METHOD` is exempt from the
 * coverage guard below for the same reason `a11y-sweep.mjs` does not appear in the
 * Android `CHECKS` table, and it is reported through `Suite.beginAuxiliary`, which is how
 * the Android half reports its own sweep.
 */
const A11Y_METHOD = 'testRealInputA11y';
const A11Y_ID = 'a11y';

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
    if (name === A11Y_METHOD) continue;
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
  // `IOS_SIM_UDID` is what `scripts/lease.mjs` exports; `IOS_UDID` wins when both are set.
  const udid = env.IOS_UDID || env.IOS_SIM_UDID;
  if (udid == null || udid === '') {
    throw new Error(
      'real-input: neither IOS_UDID nor IOS_SIM_UDID is set. Lease a device ' +
        '(node scripts/lease.mjs acquire --task <id>) or point IOS_UDID at a ' +
        'simulator, e.g. IOS_UDID=$(xcrun simctl list devices available | ' +
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
      // Deliberately not `&& open -a Simulator`: on Xcode 27 the app attaches to DeviceKit and
      // boots a device of its own choosing, so the window this hint used to ask for becomes a
      // second simulator nobody leased. A run needs the device booted, not visible; a human who
      // wants to watch it can open the app by hand.
      throw new Error(
        `real-input: simulator ${udid} is ${state}, not booted (booted: ` +
          `${booted}). Boot it first — this script deliberately boots nothing:` +
          `\n  node scripts/lease.mjs acquire --task <ID> --boot` +
          `\n  xcrun simctl boot ${udid}`
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
          ) ||
          realInputLine(line) != null
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
    // M3: this suite writes its own stamp, so it has to prove the tree stood
    // still while xcodebuild read it. Taken here, after Metro is up and before
    // the compile, so nothing that happens between the two hashes is a tool
    // tidying up after itself.
    const treeBefore = currentCodeTree();
    const destination = `platform=iOS Simulator,id=${device.udid}`;
    // Same arguments for both phases: a different build setting between them
    // would make xcodebuild throw the whole build away.
    // This suite compiles without ccache, so it names the module cache Xcode
    // would have picked anyway: a `build-app.mjs` build in the same derived data
    // has CCACHE_BASEDIR and compiles into its own, and a `.pcm` written by that
    // environment makes this one report Foundation defined in two places.
    const settings = [
      'CODE_SIGNING_ALLOWED=NO',
      ...iosModuleCacheArgs({ derivedData: derived, ccache: false }),
    ];
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

    // This suite builds its own app (it needs the UI-test bundle), so it cannot
    // inherit a stamp from `build-app.mjs` - but it uses the same fixed derived
    // data path, and installing an app that lost a generated hybrid would be the
    // same false evidence. Inspect what was just built, and let the harness use
    // it: the stamp is refreshed to say this binary came from this tree.
    try {
      recordBuild({
        platform: 'ios',
        artifact: app,
        treeBefore,
        log: (message) => console.log(`  ${message}`),
      });
    } catch (error) {
      throw new Error(
        `real-input: ${String(error?.message ?? error)}\n` +
          '       an incremental xcodebuild that never recompiled the generated ' +
          'hybrids is the usual cause: `rm -rf example/ios/build` and run again.'
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

    const selectors = toRun
      .map(
        (control) =>
          `-only-testing:${SCHEME}/${TEST_CLASS}/${iosCheckName(control.id)}`
      )
      // The a11y pass rides every run, filtered or not. `--control switch` is how a task
      // iterates on one control, and the accessibility rule is the one thing on this
      // platform that needs no gesture to be worth re-checking — excluding it would mean
      // the mutation that proves it red had to be run as a full suite.
      .concat(`-only-testing:${SCHEME}/${TEST_CLASS}/${A11Y_METHOD}`);
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
      for (const retried of outcome.retries) {
        check.retried(retried);
      }
      // Phrased so the line reads the same way whether the case passed or
      // failed: the suite's report prefixes failures with "failed:".
      check.check(
        `XCUITest reported "${outcome.outcome}" for ${name} in ` +
          `${String(outcome.duration)}s`,
        outcome.outcome === 'passed'
      );
    }

    reportA11yPass({ log, suite, status, testLog });
  } finally {
    clearJsLocation(device.udid);
    stopMetro();
  }

  return suite.finish();
}

/**
 * The accessibility pass's own section of the report.
 *
 * One auxiliary check per case in `A11Y_CONTROLS`, decided by the rule in
 * `a11y.mjs` — the same file the Android sweep reads — from the elements the Swift pass
 * printed. Two reasons it is done here rather than as `XCTAssert` calls in the test file:
 * the rule needs the shared table (which label, which trait, which debt row), and a rule
 * decided in a log parser can be shown red with a fixture in
 * `scripts/__tests__/real-input-a11y.test.js` instead of on a device.
 *
 * Three things make a case fail, and each is reported separately so a reader learns which
 * half of the rule broke:
 *
 * - no elements at all for a case: the pass did not reach the screen, so the case is
 *   *not run* and says so — a control nobody measured is never a pass.
 * - the case's own XCUITest method failed or never reported: same reason.
 * - the rule found problems: new ones fail the run; ones that match a debt row are
 *   printed as `known failing`, and a debt row that matched nothing is itself reported, so
 *   a fix has to delete its row rather than let it sit there excusing nothing.
 *
 * @param {object} args
 * @param {string} args.log the xcodebuild test log
 * @param {import('./support.mjs').Suite} args.suite
 * @param {number} args.status xcodebuild's exit status
 * @param {string} args.testLog where that log lives, for the failure message
 */
function reportA11yPass({ log, suite, status, testLog }) {
  const outcome = parseTestResults(log).get(A11Y_METHOD);
  let trees;
  try {
    trees = parseIosA11yLog(log);
  } catch (error) {
    // A line whose box did not parse means the format moved under the parser. That is a
    // broken measurement, not a control's failure, so it fails the run outright rather
    // than reporting fourteen cases as unmeasured.
    const check = suite.beginAuxiliary(
      A11Y_ID,
      'the accessibility rule (XCUITest)'
    );
    check.abort(`${String(error?.message ?? error)} — see ${testLog}`);
    return;
  }
  /** @type {string[]} */
  const covered = [];
  /** @type {string[]} */
  const matched = [];
  for (const entry of A11Y_CONTROLS) {
    // A case with no lines was never measured. Saying `not measured` rather than staying
    // quiet is the difference between a gap and a pass — the same rule `markMissing`
    // applies to a control with no check.
    const check = suite.beginAuxiliary(
      `a11y:${entry.id}`,
      `${entry.component} a11y (XCUITest)`
    );
    const nodes = trees.get(entry.id);
    if (nodes == null || nodes.length === 0) {
      check.check(
        `no elements were printed for ${entry.id}, so this run never read its ` +
          `accessibility tree (the pass reported "${String(
            outcome?.outcome ?? 'nothing'
          )}"; exit ${String(status)}). See ${testLog}`,
        false
      );
      continue;
    }
    covered.push(entry.id);
    for (const node of nodes) {
      check.note(
        `${node.type} id="${node.id}" label="${node.label}" ` +
          `value="${node.value}" box ${iosBoxText(node.frame)}` +
          `${node.anchor ? ' [the React Native wrapper]' : ''}`
      );
    }
    const result = checkIosControlA11y(entry, nodes);
    for (const problem of result.known) {
      check.note(problem);
    }
    if (result.exempt) matched.push(entry.id);
    // The line has to agree with the notes above it (X4 re-review, low). Printing "is named
    // on one element, at the control's own box, as the slider it claims to be" with a
    // `known failing (… announced as an other and not as a slider)` note two lines earlier
    // is a ✓ that contradicts the finding: a reader who scans the verdict column, or a tool
    // that greps for the ✓, gets the opposite of the run's own answer. So the passing line
    // says which of the two kinds of pass this is, and the debt one says that the rule was
    // answered *only* because a row excuses the finding.
    check.check(
      result.failures.length === 0
        ? result.known.length === 0
          ? `${entry.hybridView} is named on one element, at the control's own box, as ${
              entry.iosTrait == null
                ? 'a control'
                : `the ${entry.iosTrait} it claims to be`
            }`
          : `${entry.hybridView} has no new a11y finding — and no clean pass either: ` +
            `${String(result.known.length)} of its problems match a debt row, printed ` +
            'above, so the rule is answered by the exemption rather than by the tree'
        : result.failures.join(' | '),
      result.failures.length === 0
    );
  }

  const stale = staleExemptions(covered, matched, 'ios');
  if (stale.length > 0) {
    const check = suite.beginAuxiliary(
      'a11y:ios-debt',
      'the iOS a11y debt list still describes this code'
    );
    for (const line of stale) check.check(line, false);
  }
}

/**
 * @param {{x: number, y: number, width: number, height: number}} frame
 */
function iosBoxText(frame) {
  return `(${frame.x}, ${frame.y}, ${frame.width}x${frame.height})`;
}

process.exitCode = await main().catch((error) => {
  console.error(`\nreal-input (ios): ${String(error)}`);
  return 1;
});
