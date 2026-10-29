#!/usr/bin/env node
/**
 * Measures how long a synthesised press has to last before the Switch screen
 * delivers it to a hosted SwiftUI Toggle, and writes the table.
 *
 * Why this is a script and not a gate: the number it produces is a measurement
 * about this machine and this iOS, not a contract the library promises. What it
 * settles is a design decision - the dwell `fingerTap` holds - and the review
 * that asked for it (F1 M1) is right that a dwell above a human tap would hide a
 * product bug rather than fix a test. So the answer has to be a table someone
 * can read, with the machine's load on each row, and not a green tick.
 *
 * One `xcodebuild` launch per dwell, because a press's shape is only meaningful
 * against a settled app: the probe re-launches so each dwell starts from the same
 * first-render state the suite's own cases get.
 *
 * Usage (same environment the real-input gate needs):
 *
 *   IOS_SIM_UDID=<udid> METRO_PORT=<port> \
 *     node scripts/real-input/dwell-probe.mjs [--taps 12] [--dwells 0,0.03,0.05,0.08,0.15]
 *      [--out docs/tasks/F1/dwell-probe.md] [--json /tmp/dwell.json]
 *
 * It builds for testing with the same arguments `ios.mjs` uses, so the binary is
 * the one the gate runs. Because it compiles into the same derived data, it
 * records the build (`recordBuild`) and installs it on the leased simulator, so
 * the next gate run can tell which tree the binary came from.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { artifactsDir, ensureMetro, run } from './support.mjs';
import { assertSupportedNodeOrReexec } from '../node-version.mjs';
import { currentCodeTree, recordBuild } from '../app-stamp.mjs';
import { iosModuleCacheArgs } from '../build-speed-lib.mjs';

assertSupportedNodeOrReexec({
  command: 'node scripts/real-input/dwell-probe.mjs',
  entryUrl: import.meta.url,
});

const WORKSPACE = 'NitroUiExample.xcworkspace';
const SCHEME = 'NitroUiExampleUITests';
const TEST_CLASS = 'RealInputTests';
const PROBE = 'testMeasureSwitchDwellDelivery';
const BUNDLE_ID = 'nitroui.example';

const args = process.argv.slice(2);

/**
 * @param {string} name
 * @param {string} fallback
 * @returns {string}
 */
function flag(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] != null ? args[index + 1] : fallback;
}

const TAPS = Number(flag('--taps', '12'));
// Which control to press, and which screen to find it on. The default is the busy
// Switch screen (200 switches in a scroller); pointing this at `host-switch-0` on
// the Host screen measures the same kind of control where far less is mounted, and
// the pair is what says whether a dropped press is about the gesture's shape or
// about how much the app has on screen.
const TARGET = flag('--target', 'switch-uncontrolled');
const TAB = flag('--tab', 'tab-switch');
const ANCHOR = flag('--anchor', 'switch-controlled-value');
/**
 * What counts as "delivered". `native` (the default, and F1's shape) reads the
 * control's own accessibility `value:`, which only a control that publishes one
 * has. `echo:<testID>` reads a rendered text instead, for the controls that do
 * not - a Button's press count, a SegmentedControl's event count. It is the
 * weaker witness: it cannot tell a dropped touch from a lost event, so an echo
 * row is read next to the same launch's `js-toggle` row, not on its own.
 */
const WITNESS = flag('--witness', 'native');
/** Free text naming the shape of the app this cell measured, carried into the log. */
const LABEL = flag('--label', '');
/**
 * Reuse the binary in `example/ios/build` instead of compiling: for a probe whose
 * variants differ only in JS, which comes from Metro, the compile would rebuild
 * the same native code once per cell. Nothing is stamped in this mode, so the
 * binary's own stamp keeps naming the tree it was really built from.
 */
const SKIP_BUILD = args.includes('--skip-build');
/**
 * Where across the control to press, cycled one press per entry. For a segmented
 * control, whose binding reports nothing when the same segment is chosen twice.
 */
const FRACTIONS = flag('--fractions', '');
/** The no-React-Native arm: a shape from `NitroUiProbe.swift`, and its row count. */
const PROBE_UI = flag('--probe-ui', '');
const PROBE_ROWS = flag('--rows', '200');
const DWELLS = flag('--dwells', '0,0.03,0.05,0.08,0.12,0.15')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value));
const OUT = flag('--out', '');
const JSON_OUT = flag('--json', '');

function load1() {
  const out = run('sysctl', ['-n', 'vm.loadavg']);
  const parts = out.stdout.trim().split(/\s+/);
  return Number(parts[1] ?? '0');
}

function iosDir() {
  return path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '../../example/ios'
  );
}

/**
 * Point the debug build at this task's Metro, the way `ios.mjs` does. Without it the
 * app looks for a bundler on 8081, renders nothing, and every probe question times
 * out on `tab-switch` - which reads like a dropped touch and is really an empty app.
 *
 * @param {string} udid
 * @param {number} port
 */
function setJsLocation(udid, port) {
  run('xcrun', [
    'simctl',
    'spawn',
    udid,
    'defaults',
    'write',
    BUNDLE_ID,
    'RCT_jsLocation',
    '-string',
    `localhost:${String(port)}`,
  ]);
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

/**
 * @param {ReadonlyArray<string>} argv
 * @param {string} logFile
 * @param {Record<string, string>} extraEnv
 * @returns {Promise<number>}
 */
function xcodebuild(argv, logFile, extraEnv) {
  const out = fs.createWriteStream(logFile, { flags: 'w' });
  return new Promise((resolve, reject) => {
    const child = spawn('xcodebuild', [...argv], {
      cwd: iosDir(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...extraEnv },
    });
    let done = false;
    const show = (chunk) => {
      if (done) {
        return;
      }
      out.write(chunk);
      for (const line of String(chunk).split('\n')) {
        if (
          /^\s*(Test Case|Testing failed|error:)/.test(line) ||
          /real-input \(ios\): dwell-probe/.test(line)
        ) {
          console.log(`    ${line.trim()}`);
        }
      }
    };
    child.stdout.on('data', show);
    child.stderr.on('data', show);
    child.on('error', reject);
    // Same reason as `ios.mjs`: xcodebuild leaves helpers holding the write end
    // of the pipe after it is finished, so waiting for `close` would hang.
    child.on('exit', (status) => {
      done = true;
      out.end(() => resolve(status ?? 1));
    });
  });
}

/**
 * @param {string} log
 * @returns {{delivered: number, taps: number, control: number, controlTaps: number} | null}
 */
function readResult(log) {
  // `target=` is part of the line so a log of several ladders can be told apart;
  // the parse does not need it, and matching without it keeps this working for a
  // log written before the tag existed.
  const match =
    /RESULT target=\S+ dwell=([\d.]+)s switch=(\d+)\/(\d+) js-toggle=(\d+)\/(\d+)/.exec(
      log
    );
  if (match == null) {
    return null;
  }
  return {
    dwell: Number(match[1]),
    delivered: Number(match[2]),
    taps: Number(match[3]),
    control: Number(match[4]),
    controlTaps: Number(match[5]),
  };
}

async function main() {
  const udid = process.env.IOS_UDID ?? process.env.IOS_SIM_UDID;
  if (udid == null) {
    throw new Error('dwell-probe: IOS_SIM_UDID (or IOS_UDID) is not set.');
  }
  const metroPort = Number(process.env.METRO_PORT ?? 8291);
  const derived = path.join(iosDir(), 'build');
  // Taken before the compile, so the stamp written afterwards can claim only what
  // this tree actually produced.
  const treeBefore = currentCodeTree();
  const out = artifactsDir('ios');
  const stopMetro = await ensureMetro({
    port: metroPort,
    logFile: path.join(out, 'metro.log'),
  });
  try {
    const settings = [
      'CODE_SIGNING_ALLOWED=NO',
      ...iosModuleCacheArgs({ derivedData: derived, ccache: false }),
    ];
    const app = path.join(
      derived,
      'Build/Products/Debug-iphonesimulator/NitroUiExample.app'
    );
    if (!SKIP_BUILD) {
      const buildLog = path.join(out, 'dwell-probe-build.log');
      console.log(`dwell-probe: building (log: ${buildLog})`);
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
          `platform=iOS Simulator,id=${udid}`,
          '-derivedDataPath',
          derived,
          ...settings,
        ],
        buildLog,
        {}
      );
      if (built !== 0) {
        throw new Error(
          `dwell-probe: build-for-testing failed (${String(built)})`
        );
      }
    } else {
      // The variants of a JS-only matrix differ in what Metro serves, not in the
      // binary, so the compile would produce the same one every cell. The stamp
      // written by the build that *did* run still says which tree it came from,
      // and this mode deliberately does not overwrite it with a newer tree.
      console.log(
        'dwell-probe: --skip-build reusing ' +
          `${app}; no stamp is written by this run.`
      );
    }

    // The suite installs its own app because it needs the UI-test bundle, and so
    // does this: the probe drives the same binary the gate does. Same stamp guard,
    // because it compiles into the same derived data - the next harness run has to
    // be able to tell that this binary came from this tree.
    if (!SKIP_BUILD) {
      recordBuild({
        platform: 'ios',
        artifact: app,
        treeBefore,
        log: (message) => console.log(`  ${message}`),
      });
    }
    const installed = run('xcrun', ['simctl', 'install', udid, app]);
    if (installed.status !== 0) {
      throw new Error(
        `dwell-probe: installing ${app} failed: ` +
          (installed.stderr.trim() === ''
            ? installed.stdout.trim()
            : installed.stderr.trim())
      );
    }
    // Without this the app asks Metro on 8081, renders nothing, and every probe
    // question times out on `tab-switch` - which would read as a dropped touch and
    // is really an empty app.
    setJsLocation(udid, metroPort);

    /** @type {Array<Record<string, number>>} */
    const rows = [];
    for (const dwell of DWELLS) {
      const at = load1();
      console.log(
        `\ndwell-probe: dwell ${dwell.toFixed(2)}s · ${String(TAPS)} taps · load1 ${at.toFixed(2)}`
      );
      const logFile = path.join(
        out,
        `dwell-probe-${LABEL.replace(/[^a-zA-Z0-9._-]/g, '_') || 'cell'}-${dwell.toFixed(2)}.log`
      );
      const status = await xcodebuild(
        [
          'test-without-building',
          '-workspace',
          WORKSPACE,
          '-scheme',
          SCHEME,
          '-configuration',
          'Debug',
          '-destination',
          `platform=iOS Simulator,id=${udid}`,
          '-derivedDataPath',
          derived,
          '-collect-test-diagnostics',
          'never',
          `-only-testing:${SCHEME}/${TEST_CLASS}/${PROBE}`,
          ...settings,
        ],
        logFile,
        {
          // Xcode forwards its own environment to the test runner under this
          // prefix; `TEST_RUNNER_FOO=1 xcodebuild ...` puts `FOO=1` in the
          // process under test.
          TEST_RUNNER_NUI_PROBE_DWELL: dwell.toFixed(2),
          TEST_RUNNER_NUI_PROBE_TAPS: String(TAPS),
          TEST_RUNNER_NUI_PROBE_TARGET: TARGET,
          TEST_RUNNER_NUI_PROBE_TAB: TAB,
          TEST_RUNNER_NUI_PROBE_ANCHOR: ANCHOR,
          TEST_RUNNER_NUI_PROBE_WITNESS: WITNESS,
          TEST_RUNNER_NUI_PROBE_LABEL: LABEL,
          TEST_RUNNER_NUI_PROBE_FRACTIONS: FRACTIONS,
          // Only this arm of the probe builds a window with no React Native in
          // it; an empty value leaves the app's own launch untouched.
          ...(PROBE_UI === ''
            ? {}
            : {
                TEST_RUNNER_NUI_PROBE_UI: PROBE_UI,
                TEST_RUNNER_NUI_PROBE_ROWS: PROBE_ROWS,
              }),
        }
      );
      const log = fs.readFileSync(logFile, 'utf8');
      const result = readResult(log);
      if (result == null) {
        throw new Error(
          `dwell-probe: dwell ${dwell.toFixed(2)}s produced no RESULT line ` +
            `(xcodebuild exit ${String(status)}). See ${logFile}.`
        );
      }
      rows.push({
        dwell,
        load1: Number(at.toFixed(2)),
        delivered: result.delivered,
        taps: result.taps,
        jsToggle: result.control,
        jsToggleTaps: result.controlTaps,
      });
      console.log(
        `dwell-probe:   switch ${String(result.delivered)}/${String(result.taps)} · js-toggle ` +
          `${String(result.control)}/${String(result.controlTaps)}`
      );
    }

    const table = renderTable(rows);
    console.log(`\n${table}`);
    if (OUT !== '') {
      const target = path.resolve(OUT);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(
        target,
        `# F1 dwell probe — delivery vs press duration\n\n` +
          `Generated by \`node scripts/real-input/dwell-probe.mjs --out ${OUT}\` on ` +
          `${new Date().toISOString()} against \`${TARGET}\` (${TAB}). ` +
          `Witness: its own native ` +
          `\`value:\` on the Switch screen (200 \`switch-list-*\` switches mounted), one ` +
          `\`xcodebuild\` launch per dwell, ${String(TAPS)} presses each. \`js-toggle\` is RN's ` +
          `own \`Pressable\` on the same screen, pressed with the same shape: it says the ` +
          `event path was alive for that launch.\n\n${table}\n`
      );
      console.log(`dwell-probe: wrote ${OUT}`);
    }
    if (JSON_OUT !== '') {
      fs.writeFileSync(JSON_OUT, `${JSON.stringify(rows, null, 2)}\n`);
    }
  } finally {
    clearJsLocation(udid);
    stopMetro();
  }
  return 0;
}

/**
 * @param {Array<Record<string, number>>} rows
 * @returns {string}
 */
function renderTable(rows) {
  const lines = [
    '| Dwell | Delivered | `js-toggle` | load1 at start |',
    '| --- | --- | --- | --- |',
  ];
  for (const row of rows) {
    lines.push(
      `| ${row.dwell.toFixed(2)} s | ${String(row.delivered)}/${String(row.taps)} | ` +
        `${String(row.jsToggle)}/${String(row.jsToggleTaps)} | ${row.load1.toFixed(2)} |`
    );
  }
  return lines.join('\n');
}

process.exitCode = await main().catch((error) => {
  console.error(`\ndwell-probe: ${String(error)}`);
  return 1;
});
