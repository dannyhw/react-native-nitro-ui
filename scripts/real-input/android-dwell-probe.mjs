#!/usr/bin/env node
/**
 * F7: does Android drop a short press the way iOS does?
 *
 * `docs/tasks/F7-quick-tap.md` asks for the same press lengths on both platforms
 * and says "not affected" is only allowed with numbers, so this measures them
 * rather than reasoning about them.
 *
 * The press is `adb shell input swipe x y x y <ms>` — a zero-distance swipe, which
 * is a press that stays where it started with its length set by the caller. `input
 * tap` would be the obvious command and has no such knob: it injects a
 * fixed-duration down/up pair, so the one thing being measured is exactly what it
 * cannot express. A zero-distance swipe reaches the view tree as a down, no motion,
 * then an up — what a finger does, and what a hosted control has to answer.
 *
 * The witness is a rendered count, the same shape iOS's `--quiet` arm reads: the
 * example's Switch screen carries `probe-hosted-events` (this library's Switch) and
 * `probe-native-events` (React Native's own, as the positive control). The count's
 * delta is what arrived.
 *
 * Usage (device and port come from the lease, as everywhere else):
 *
 *   ANDROID_SERIAL=emulator-55xx EMULATOR_PORT=55xx ANDROID_ADB_SERVER_PORT=<port> \
 *   METRO_PORT=<port> node scripts/real-input/android-dwell-probe.mjs \
 *       --dwell-ms 10,40,80 --taps 12 --json docs/tasks/F7/android-dwell.json
 *
 * The APK must already be built and stamped (`scripts/build-app.mjs --platform
 * android`): this installs it, never builds it, and boots nothing.
 */

import fs from 'node:fs';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import process from 'node:process';

import { artifactsDir, ensureMetro, run, sleep } from './support.mjs';
import {
  findByDescription,
  findByTestId,
  findTab,
  parseHierarchy,
} from './uiautomator.mjs';
import { assertFreshApp } from '../app-stamp.mjs';
import { checkEmulatorEnv, isReservedSerial } from '../lease-core.mjs';

const REPO = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../..'
);
const BUNDLE_ID = 'nitroui.example';
const ACTIVITY = `${BUNDLE_ID}/${BUNDLE_ID}.MainActivity`;

const argv = process.argv.slice(2);
function flag(name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : fallback;
}

const DWELL_MS = flag('--dwell-ms', '10,40,80')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value));
const TAPS = Number(flag('--taps', '12'));
/** Which control to press, and the rendered count that proves it acted. */
const TARGET = flag('--target', 'probe-hosted-switch');
const WITNESS = flag('--witness', 'probe-hosted-events');
/** React Native's own Switch on the same screen: this arm's positive control. */
const CONTROL = flag('--control', 'probe-native-switch');
const CONTROL_WITNESS = flag('--control-witness', 'probe-native-events');
const LABEL = flag('--label', '');
const JSON_OUT = flag('--json', '');

const serial = process.env.ANDROID_SERIAL;
if (serial == null || serial === '') {
  throw new Error('android-dwell-probe: ANDROID_SERIAL is not set.');
}
// Same discipline the suite has: an adb server sees every emulator on the box,
// including the human's, so the lease's own checks run before anything is pressed.
checkEmulatorEnv(process.env);
if (isReservedSerial(serial)) {
  throw new Error(
    `android-dwell-probe: ${serial} is reserved for the human and cannot be ` +
      'used by a probe.'
  );
}
const metroPort = Number(process.env.METRO_PORT ?? 8291);
const out = artifactsDir('android');
const apk =
  process.env.HARNESS_APP_PATH ??
  path.resolve(
    REPO,
    'example/android/app/build/outputs/apk/debug/app-debug.apk'
  );

/**
 * @param {ReadonlyArray<string>} args
 */
function adb(args) {
  return run('adb', ['-s', serial, ...args]);
}

function shell(command) {
  return adb(['shell', command]);
}

function screenSize() {
  const size = shell('wm size').stdout.match(/(\d+)x(\d+)/);
  if (size == null) {
    throw new Error('android-dwell-probe: `wm size` said nothing useful.');
  }
  return { width: Number(size[1]), height: Number(size[2]) };
}

async function hierarchy() {
  const remote = '/sdcard/android-dwell.xml';
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    shell(`uiautomator dump ${remote}`);
    const read = shell(`cat ${remote}`);
    if (read.stdout.includes('<node')) {
      fs.writeFileSync(path.join(out, 'hierarchy.xml'), read.stdout);
      return parseHierarchy(read.stdout);
    }
    // A window mid-animation refuses the dump; the probe polls anyway.
    await sleep(500);
  }
  throw new Error(
    'android-dwell-probe: `uiautomator dump` returned nothing usable. The ' +
      `device may be asleep or the app crashed. Its log ends:\n${tailAppLog()}`
  );
}

function tailAppLog() {
  const pid = shell(`pidof ${BUNDLE_ID}`).stdout.trim().split(/\s+/)[0];
  if (pid == null || pid === '') {
    return `(no ${BUNDLE_ID} process is running)`;
  }
  return adb(['logcat', '-d', '--pid', pid])
    .stdout.split('\n')
    .filter((line) => line !== '')
    .slice(-20)
    .join('\n');
}

/**
 * Point the debug build at this task's Metro, the way `android.mjs` does it.
 *
 * `debug_http_host` is the preference the app reads for the bundler address and
 * `adb reverse` maps the device's localhost onto this host, so a non-default port
 * needs both. Written as base64 for the same reason the suite does it that way: the
 * XML has to survive adb's shell *and* the device's `sh -c` inside `run-as`.
 */
function prepareLaunch() {
  const prefs = `shared_prefs/${BUNDLE_ID}_preferences.xml`;
  const xml =
    `<?xml version="1.0" encoding="utf-8" standalone="yes" ?>\n<map>` +
    `<string name="debug_http_host">localhost:${String(metroPort)}</string></map>`;
  const encoded = Buffer.from(xml, 'utf8').toString('base64');
  shell(
    `run-as ${BUNDLE_ID} sh -c 'mkdir -p shared_prefs && ` +
      `echo ${encoded} | base64 -d > ${prefs}'`
  );
  const written = shell(`run-as ${BUNDLE_ID} cat ${prefs}`);
  if (!written.stdout.includes(`localhost:${String(metroPort)}`)) {
    throw new Error(
      'android-dwell-probe: the app cannot be pointed at Metro on ' +
        `${String(metroPort)} — ${prefs} reads back as:\n${written.stdout}`
    );
  }
  const reverse = adb([
    'reverse',
    `tcp:${String(metroPort)}`,
    `tcp:${String(metroPort)}`,
  ]);
  if (reverse.status !== 0) {
    throw new Error(
      `android-dwell-probe: adb reverse tcp:${String(metroPort)} failed: ` +
        reverse.stderr.trim()
    );
  }
}

/**
 * Press one control `taps` times at `dwellMs`, reading the witness once per press.
 *
 * The control is re-read before every press: the row can be laid out again while
 * the probe runs, and a stale coordinate would press the empty space where the
 * control used to be. The witness is read once per press rather than polled, which
 * is the shape iOS's quiet arm proved it needed — `uiautomator dump` is slow enough
 * to be the load already.
 *
 * @param {() => Promise<{x: number, y: number}>} aim where to press, re-read each press
 * @param {number} dwellMs
 * @param {number} taps
 * @param {() => Promise<number | null>} reading
 */
async function pressRepeatedly(aim, dwellMs, taps, reading) {
  const start = await reading();
  for (let index = 1; index <= taps; index += 1) {
    const at = await aim();
    shell(
      `input swipe ${String(Math.round(at.x))} ${String(Math.round(at.y))} ` +
        `${String(Math.round(at.x))} ${String(Math.round(at.y))} ` +
        `${String(dwellMs)}`
    );
    await sleep(700);
    const now = await reading();
    console.log(
      `android-dwell-probe: tap ${String(index)}/${String(taps)} ` +
        `${String(start ?? '?')} -> ${String(now ?? '?')}`
    );
    await sleep(300);
  }
  const end = await reading();
  if (start == null || end == null) {
    throw new Error(
      'android-dwell-probe: the counting witness was unreadable, so the probe ' +
        'cannot say how many presses arrived.'
    );
  }
  return Math.max(0, end - start);
}

/**
 * Where to press a control, read from a fresh tree.
 *
 * `desc:<accessibilityLabel>` aims at a control by the label it publishes; anything
 * else is a `testID`. The prefix is not decoration: this library's hosted Compose
 * controls surface their `accessibilityLabel` as `content-desc` and no `resource-id`
 * of their own, while plain React Native views do the reverse. A probe that could
 * only speak one of the two would find React Native's `Switch` and report this
 * library's as missing, which is a bug in the probe and would read as a result.
 *
 * @param {string} selector
 */
async function aimAt(selector) {
  const nodes = await hierarchy();
  const node = selector.startsWith('desc:')
    ? findByDescription(nodes, selector.slice('desc:'.length))
    : findByTestId(nodes, selector);
  if (node == null) {
    throw new Error(
      `android-dwell-probe: ${selector} is not in the tree, so the probe has ` +
        'nothing to press.'
    );
  }
  return { x: node.bounds.cx, y: node.bounds.cy };
}

/**
 * A rendered count, as a number, or null when no node says one.
 *
 * @param {string} testID
 */
async function readCount(testID) {
  const node = findByTestId(await hierarchy(), testID);
  if (node == null) {
    return null;
  }
  const text = (node.text ?? '').trim();
  return /^\d+$/.test(text) ? Number(text) : null;
}

function load1() {
  const result = run('sysctl', ['-n', 'vm.loadavg']);
  return Number(result.stdout.trim().split(/\s+/)[1] ?? '0');
}

async function main() {
  assertFreshApp({
    platform: 'android',
    artifact: apk,
    command: 'scripts/real-input/android-dwell-probe.mjs',
  });
  const stopMetro = await ensureMetro({
    port: metroPort,
    logFile: path.join(out, 'metro.log'),
  });
  try {
    const installed = shell(`pm list packages ${BUNDLE_ID}`);
    if (!installed.stdout.includes(`package:${BUNDLE_ID}`)) {
      throw new Error(
        `android-dwell-probe: ${BUNDLE_ID} is not installed on ${serial}. ` +
          'Install the stamped debug APK first (scripts/build-app.mjs).'
      );
    }
    prepareLaunch();
    shell(`am force-stop ${BUNDLE_ID}`);
    const started = shell(`am start -W -n ${ACTIVITY}`);
    if (started.status !== 0 || !started.stdout.includes('Status: ok')) {
      throw new Error(
        `android-dwell-probe: launching ${ACTIVITY} failed:\n${started.stdout}`
      );
    }
    // The tab bar is the app's only navigation, and finding it is also the proof
    // the bundle loaded from *this* Metro rather than the app's 8081 default.
    const bandY = Math.round(screenSize().height * 0.12);
    let ready = false;
    for (let waited = 0; waited < 120 && !ready; waited += 1) {
      ready = findTab(await hierarchy(), 'Switch', bandY) != null;
      if (!ready) {
        await sleep(1000);
      }
    }
    if (!ready) {
      throw new Error(
        `android-dwell-probe: no tab bar within 120 s (Metro ${String(metroPort)}). ` +
          `The app's log ends:\n${tailAppLog()}`
      );
    }

    /** @type {Array<Record<string, number | string>>} */
    const rows = [];
    for (const dwellMs of DWELL_MS) {
      const at = load1();
      console.log(
        `\nandroid-dwell-probe: ${String(dwellMs)} ms · ${String(TAPS)} taps · ` +
          `load1 ${at.toFixed(2)} · ${LABEL || '-'}`
      );
      const delivered = await pressRepeatedly(
        () => aimAt(TARGET),
        dwellMs,
        TAPS,
        () => readCount(WITNESS)
      );
      const positiveDelivered = await pressRepeatedly(
        () => aimAt(CONTROL),
        dwellMs,
        3,
        () => readCount(CONTROL_WITNESS)
      );
      console.log(
        `android-dwell-probe: RESULT ${TARGET} dwell=${String(dwellMs)}ms ` +
          `switch=${String(delivered)}/${String(TAPS)} ` +
          `${CONTROL}=${String(positiveDelivered)}/3`
      );
      rows.push({
        dwellMs,
        load1: Number(at.toFixed(2)),
        delivered,
        taps: TAPS,
        positive: positiveDelivered,
        positiveTaps: 3,
      });
    }
    if (JSON_OUT !== '') {
      fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true });
      fs.writeFileSync(JSON_OUT, `${JSON.stringify(rows, null, 2)}\n`);
    }
    return 0;
  } finally {
    shell(`am force-stop ${BUNDLE_ID}`);
    stopMetro();
  }
}

process.exitCode = await main().catch((error) => {
  console.error(`\nandroid-dwell-probe: ${String(error?.stack ?? error)}`);
  return 1;
});
