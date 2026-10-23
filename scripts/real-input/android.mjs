#!/usr/bin/env node
/**
 * Real-input checks on Android: `adb shell input` delivers the touch, and
 * `uiautomator dump` is the only thing the assertions read.
 *
 * `adb shell input tap/swipe` injects events into the system InputManager, so
 * they travel InputDispatcher → window → React Native's touch handler → the
 * hosted Compose control, exactly as a finger does. That is the point of this
 * suite: `react-native-harness` drives controls through in-app hooks and has
 * never proved that path works (docs/tasks/T15-real-input.md).
 *
 * Nothing here attaches to the app's process or talks to Nitro. Every asserted
 * value is read out of the accessibility tree - what a screen reader, and a
 * person, has.
 *
 * Usage (devices and ports come from the environment, as everywhere else here):
 *
 *   ANDROID_AVD=<avd> ANDROID_ADB_SERVER_PORT=<port> METRO_PORT=<port> \
 *     bun run test:real-input:android [--control switch|slider|button]
 *
 * The emulator must already be booted: AGENTS.md says only touch devices you
 * started, so this script boots nothing and shuts nothing down.
 */

import fs from 'node:fs';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import process from 'node:process';

import {
  AbortedCheck,
  artifactsDir,
  blockMs,
  chosenControls,
  ensureMetro,
  run,
  sleep,
  Suite,
} from './support.mjs';
import { REAL_INPUT_CONTROLS } from './controls.mjs';
import {
  findByDescription,
  findByTestId,
  findTab,
  parseHierarchy,
} from './uiautomator.mjs';
import { assertSupportedNode } from '../node-version.mjs';

// One Node across every device gate: the harness cannot run on Node 25/26 at
// all, so a real-input run on that runtime is not comparable evidence.
assertSupportedNode({ command: 'bun run test:real-input:android' });

const BUNDLE_ID = 'nitroui.example';
const ACTIVITY = `${BUNDLE_ID}/.MainActivity`;

/** The on-screen echoes the checks read (testIDs from `example/src`). */
const ECHO = {
  switchValue: 'switch-controlled-value',
  buttonCount: 'real-input-count',
  sliderStart: 'slider-start-count',
  sliderChange: 'slider-change-count',
  sliderComplete: 'slider-complete-count',
  sliderValue: 'slider-phase-value',
  sliderControlledValue: 'slider-controlled-value',
};

/** How long a control gets to react to a gesture it should have answered. */
const REACT_TIMEOUT = Number(process.env.REAL_INPUT_TIMEOUT ?? 8000);
/** How long the first render may take (a cold Metro bundle is slow). */
const READY_TIMEOUT = Number(process.env.REAL_INPUT_READY_TIMEOUT ?? 180000);

/**
 * ## Adding a control
 *
 * Add one entry here, one in `scripts/real-input/controls.mjs`, and one iOS
 * check in `example/ios/NitroUiExampleUITests/RealInputTests.swift`. A control
 * listed in the table but missing here is reported as a failure, never skipped.
 *
 * Each check gets the `t` object from `makeContext`: it is the only way in, so a
 * check cannot reach adb, Nitro or the app process by accident.
 */
const CHECKS = {
  /**
   * A real tap must flip the hosted Material 3 Switch and bring the new value
   * back to React. The echo is React's own render, so it only changes if the
   * touch reached Compose, Compose told Nitro, and Nitro told JS.
   *
   * @param {ReturnType<typeof makeContext>} t
   */
  switch: async (t) => {
    const control = await t.requireControl('Controlled switch');
    const before = t.requireEcho(ECHO.switchValue);
    t.log.checkEquals('the Switch starts off', before, 'off');

    await t.tapNode(control);
    const flipped = t.waitForEchoToChange(
      ECHO.switchValue,
      before,
      'a real tap to register'
    );
    t.log.checkEquals(
      'one real tap flips the Switch (React renders "on")',
      flipped,
      'on'
    );

    await t.tapNode(control);
    const back = t.waitForEchoToChange(
      ECHO.switchValue,
      'on',
      'a second real tap to register'
    );
    t.log.checkEquals(
      'a second real tap flips it back (React renders "off")',
      back,
      'off'
    );
  },

  /**
   * A real drag must move the thumb and report every phase.
   *
   * The phases Slider is uncontrolled and counts each callback separately, so a
   * missing `onSlidingStart` cannot hide behind an `onValueChange` that still
   * worked. The controlled Slider is dragged too: there the echo is React's own
   * state, so it proves the whole loop - touch → Compose → Nitro → JS →
   * re-render → value back down to native - with nothing but a finger in it.
   *
   * @param {ReturnType<typeof makeContext>} t
   */
  slider: async (t) => {
    const phases = await t.requireControl('Phases slider');
    t.log.checkEquals(
      'no gesture has been reported yet',
      `${t.requireEcho(ECHO.sliderStart)} ${t.requireEcho(
        ECHO.sliderChange
      )} ${t.requireEcho(ECHO.sliderComplete)}`,
      'start=0 change=0 complete=0'
    );

    // Press down a quarter of the way along the track and release three quarters
    // of the way in: both ends are inside the track and away from its rounded
    // caps, where a press can miss the control.
    await t.dragControl(phases, 0.25, 0.75, 800);
    t.waitForEcho(ECHO.sliderComplete, 'complete=1', 'one drag to finish');
    t.log.checkEquals(
      'one drag fires onSlidingStart exactly once',
      t.requireEcho(ECHO.sliderStart),
      'start=1'
    );
    t.log.checkEquals(
      'one drag fires onSlidingComplete exactly once',
      t.requireEcho(ECHO.sliderComplete),
      'complete=1'
    );
    const changeText = t.requireEcho(ECHO.sliderChange);
    t.log.check(
      `a drag reports the way over, not only the end (${changeText})`,
      Number(changeText.replace('change=', '')) >= 2
    );
    const landed = t.value(ECHO.sliderValue);
    t.log.check(
      `the thumb lands right of centre (${t.requireEcho(ECHO.sliderValue)})`,
      landed != null && landed > 0.6
    );

    await t.dragControl(phases, 0.75, 0.25, 800);
    t.waitForEcho(ECHO.sliderComplete, 'complete=2', 'a second drag to finish');
    t.log.checkEquals(
      'a second drag fires both phases again',
      `${t.requireEcho(ECHO.sliderStart)} ${t.requireEcho(ECHO.sliderComplete)}`,
      'start=2 complete=2'
    );
    const backValue = t.value(ECHO.sliderValue);
    t.log.check(
      `dragging back moves the value the other way (${t.requireEcho(
        ECHO.sliderValue
      )})`,
      backValue != null && backValue < 0.4
    );

    const controlled = await t.requireControl('Controlled slider');
    const before = t.value(ECHO.sliderControlledValue);
    t.log.checkEquals('the controlled Slider starts at 0.25', before, 0.25);
    await t.dragControl(controlled, 0.2, 0.8, 800);
    const after = t.waitForValueToRise(
      ECHO.sliderControlledValue,
      before,
      'a real drag to reach React'
    );
    t.log.check(
      `the controlled value echo follows the real drag (${String(before)} → ${String(after)})`,
      after != null && after > before + 0.2
    );
  },

  /**
   * A real tap must reach the hosted Button's `onPress`, and a real tap on a
   * disabled one must not.
   *
   * The two Buttons share one counter, which is what makes the disabled half
   * mean something: `onPress` is passed to it as well, so a library that let a
   * disabled control fire would move the number. The counter is React's own
   * render, so it only moves if the touch reached Compose, Compose told Nitro,
   * and Nitro told JS.
   *
   * @param {ReturnType<typeof makeContext>} t
   */
  button: async (t) => {
    const control = await t.requireControl('Real-input button');
    const disabled = await t.requireControl('Real-input disabled button');
    t.log.checkEquals(
      'the Button starts with no presses recorded',
      t.requireEcho(ECHO.buttonCount),
      '0'
    );

    await t.tapNode(control);
    const first = t.waitForEcho(
      ECHO.buttonCount,
      '1',
      'a real tap to reach onPress'
    );
    t.log.checkEquals(
      'one real tap on the enabled Button reaches onPress',
      first,
      '1'
    );

    // The disabled one gets the same tap. Nothing should happen, and the way to
    // say that is to keep watching the same number the enabled Button moves.
    await t.tapNode(disabled);
    const afterDisabled = t.requireEchoToStay(
      ECHO.buttonCount,
      '1',
      'a tap on the disabled Button to be refused'
    );
    t.log.checkEquals(
      'a real tap on the disabled Button does not press it',
      afterDisabled,
      '1'
    );

    // And the counter is still live: without this, the line above could have
    // passed because the app stopped rendering rather than because the disabled
    // Button refused the touch.
    await t.tapNode(control);
    const second = t.waitForEcho(
      ECHO.buttonCount,
      '2',
      'a second real tap to reach onPress'
    );
    t.log.checkEquals(
      'a second real tap presses the enabled Button again',
      second,
      '2'
    );
  },
};

async function main() {
  const controls = chosenControls(process.argv.slice(2));
  const suite = new Suite('android', controls);
  const out = artifactsDir('android');
  const metroPort = Number(process.env.METRO_PORT ?? 8291);
  const device = resolveDevice(process.env);
  const apk =
    process.env.HARNESS_APP_PATH ??
    path.resolve(
      repoRoot(),
      'example/android/app/build/outputs/apk/debug/app-debug.apk'
    );

  console.log(
    `real-input (android): ${device.serial} · ${device.avd} · adb server ` +
      `${process.env.ANDROID_ADB_SERVER_PORT ?? 'default'} · Metro ${String(metroPort)}`
  );

  // The shared table and `CHECKS` have to describe one suite. A control with no
  // check is reported as a failure, never skipped; a check with no control would
  // never run at all, which is the same silent gap from the other side. (The
  // comparisons are against the whole table, not the `--control` selection, so a
  // filtered run does not report the controls it left out as rogue.)
  for (const id of Object.keys(CHECKS)) {
    if (!REAL_INPUT_CONTROLS.some((control) => control.id === id)) {
      throw new Error(
        `real-input: android.mjs has a check for "${id}" but no control in ` +
          'scripts/real-input/controls.mjs names it. Add the control to the ' +
          'table (and an iOS check for it) so both platforms cover it.'
      );
    }
  }
  for (const control of controls) {
    if (CHECKS[control.id] == null) {
      suite.markMissing(control.id);
    }
  }
  const toRun = controls.filter((control) => CHECKS[control.id] != null);
  if (toRun.length === 0) {
    return suite.finish();
  }

  const stopMetro = await ensureMetro({
    port: metroPort,
    logFile: path.join(out, 'metro.log'),
  });
  const harness = new DeviceHarness({
    serial: device.serial,
    bundleId: BUNDLE_ID,
    metroPort,
    out,
  });

  try {
    harness.install(apk);
    harness.prepareLaunch();
    harness.launch();
    await harness.waitForReady(READY_TIMEOUT);

    for (const control of toRun) {
      const log = suite.begin(control);
      await harness.goToScreen(control.screen);
      try {
        await CHECKS[control.id](makeContext(harness, log));
      } catch (error) {
        if (!(error instanceof AbortedCheck)) {
          throw error;
        }
      }
    }
  } finally {
    harness.teardown();
    stopMetro();
  }

  return suite.finish();
}

/**
 * @returns {string}
 */
function repoRoot() {
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
}

/**
 * adb, the accessibility tree and the gestures. Everything a check can do to the
 * device goes through here.
 */
class DeviceHarness {
  /**
   * @param {object} options
   * @param {string} options.serial
   * @param {string} options.bundleId
   * @param {number} options.metroPort
   * @param {string} options.out
   */
  constructor({ serial, bundleId, metroPort, out }) {
    this.serial = serial;
    this.bundleId = bundleId;
    this.metroPort = metroPort;
    this.out = out;
    this.remoteDump = '/sdcard/real-input.xml';
    // The tab bar is the top of the screen; 12% of its height covers the tabs on
    // any density without ever reaching the content below them.
    this.tabBandY = Math.round(this.displayHeight() * 0.12);
  }

  /**
   * @param {ReadonlyArray<string>} args
   */
  adb(args) {
    return run('adb', ['-s', this.serial, ...args]);
  }

  /**
   * @param {string} command
   */
  shell(command) {
    return this.adb(['shell', command]);
  }

  /**
   * @returns {number}
   */
  displayHeight() {
    const size = this.shell('wm size');
    const match = size.stdout.match(/(\d+)x(\d+)/);
    if (match == null) {
      throw new Error(
        `real-input: \`adb shell wm size\` said nothing useful: ${size.stdout.trim()}`
      );
    }
    return Number(match[2]);
  }

  /**
   * @param {string} apk
   */
  install(apk) {
    if (!fs.existsSync(apk)) {
      throw new Error(
        `real-input: no debug APK at ${apk}. Build it first:\n` +
          '  cd example/android && ./gradlew :app:assembleDebug ' +
          '-PreactNativeArchitectures=arm64-v8a'
      );
    }
    const result = this.adb(['install', '-r', '-g', apk]);
    if (result.status !== 0) {
      throw new Error(
        `real-input: installing ${apk} failed:\n${result.stdout}\n${result.stderr}`
      );
    }
    console.log(`  apk: ${apk}`);
  }

  /**
   * Point the debug build at this task's Metro and make that port reachable.
   *
   * `debug_http_host` is the preference the app itself reads for the bundler
   * address, and `adb reverse` maps the device's localhost onto this host, so a
   * non-default Metro port needs both. The preference is written into the app's
   * own private prefs (`run-as` works because this is a debuggable build), which
   * is what react-native-harness does for the same reason.
   *
   * The XML goes over base64 rather than quoted: it has to survive adb's shell
   * *and* the device's `sh -c` inside `run-as`, and nested quotes do not make it
   * through both. A mangled attribute delimiter leaves SharedPreferences ignoring
   * the file, the app then looks for Metro on 8081, and the reason surfaces as an
   * "Unable to load script" RedBox minutes later. Base64 has no shell
   * metacharacters, and reading the file back turns any such surprise into an
   * immediate error here.
   */
  prepareLaunch() {
    const prefs = `shared_prefs/${this.bundleId}_preferences.xml`;
    const xml =
      `<?xml version="1.0" encoding="utf-8" standalone="yes" ?>\n<map>` +
      `<string name="debug_http_host">localhost:${String(this.metroPort)}</string></map>`;
    const encoded = Buffer.from(xml, 'utf8').toString('base64');
    this.shell(
      `run-as ${this.bundleId} sh -c 'mkdir -p shared_prefs && ` +
        `echo ${encoded} | base64 -d > ${prefs}'`
    );
    const written = this.shell(`run-as ${this.bundleId} cat ${prefs}`);
    if (!written.stdout.includes(`localhost:${String(this.metroPort)}`)) {
      throw new Error(
        `real-input: the app cannot be pointed at Metro on ` +
          `${String(this.metroPort)} - the debug_http_host preference did not ` +
          `stick. ${prefs} reads back as:\n${written.stdout}`
      );
    }
    const reverse = this.adb([
      'reverse',
      `tcp:${String(this.metroPort)}`,
      `tcp:${String(this.metroPort)}`,
    ]);
    if (reverse.status !== 0) {
      throw new Error(
        `real-input: adb reverse tcp:${String(this.metroPort)} failed: ` +
          reverse.stderr.trim()
      );
    }
  }

  launch() {
    this.shell(`am force-stop ${this.bundleId}`);
    const started = this.shell(`am start -W -n ${ACTIVITY}`);
    if (started.status !== 0 || !started.stdout.includes('Status: ok')) {
      throw new Error(
        `real-input: launching ${ACTIVITY} failed:\n${started.stdout}\n${started.stderr}`
      );
    }
  }

  /**
   * @param {number} timeoutMs
   */
  async waitForReady(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const nodes = this.hierarchy();
      const redbox = nodes.find((node) => node.resourceId.includes('redbox'));
      if (redbox != null) {
        // Fail now instead of waiting out the timeout: a RedBox means the app is
        // up and something inside it is wrong (a broken bundle, an unreachable
        // Metro, a JS exception), and every later check would fail the same way.
        throw new Error(
          'real-input: the app came up showing a JavaScript error rather than ' +
            `the example (Metro is on ${String(this.metroPort)}). Its own log ` +
            `ends:\n${this.tailAppLog()}`
        );
      }
      if (
        findTab(nodes, 'Switch', this.tabBandY) != null &&
        findTab(nodes, 'Slider', this.tabBandY) != null
      ) {
        return;
      }
      if (Date.now() > deadline) {
        throw new Error(
          'real-input: the app did not render its tab bar within ' +
            `${String(timeoutMs)}ms. Metro is on ${String(this.metroPort)} ` +
            `(log: ${path.join(this.out, 'metro.log')}). The app's log ends:\n` +
            this.tailAppLog()
        );
      }
      await sleep(1000);
    }
  }

  /**
   * @returns {string}
   */
  tailAppLog() {
    const pid = this.shell(`pidof ${this.bundleId}`)
      .stdout.trim()
      .split(/\s+/)[0];
    if (pid == null || pid === '') {
      return `(no ${this.bundleId} process is running)`;
    }
    // By pid and unfiltered: RN reports the real reason ("Unable to load
    // script", a native crash, a JS exception) under tags no `-s` list names.
    return this.adb(['logcat', '-d', '--pid', pid])
      .stdout.split('\n')
      .filter((line) => line !== '')
      .slice(-25)
      .join('\n');
  }

  /**
   * The example's three tabs are its only navigation.
   *
   * @param {'switch' | 'slider' | 'button'} screen
   */
  async goToScreen(screen) {
    const label = { switch: 'Switch', slider: 'Slider', button: 'Button' }[
      screen
    ];
    const anchor = {
      switch: ECHO.switchValue,
      slider: ECHO.sliderStart,
      button: ECHO.buttonCount,
    }[screen];
    if (findByTestId(this.hierarchy(), anchor) != null) {
      return;
    }
    const tab = findTab(this.hierarchy(), label, this.tabBandY);
    if (tab == null) {
      throw new Error(
        `real-input: no "${label}" tab in the accessibility tree, so the ` +
          'screen this check needs cannot be reached.'
      );
    }
    this.tap(tab);
    const deadline = Date.now() + REACT_TIMEOUT;
    for (;;) {
      if (findByTestId(this.hierarchy(), anchor) != null) {
        return;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `real-input: tapping the "${label}" tab did not bring up its screen.`
        );
      }
      await sleep(300);
    }
  }

  /**
   * A fresh accessibility tree, also kept on disk as the run's evidence.
   *
   * @returns {import('./uiautomator.mjs').UiautomatorNode[]}
   */
  hierarchy() {
    /** @type {string} */
    let xml = '';
    for (let attempt = 1; attempt <= 4 && xml === ''; attempt += 1) {
      const dumped = this.shell(`uiautomator dump ${this.remoteDump}`);
      const read = this.shell(`cat ${this.remoteDump}`);
      if (dumped.status === 0 && read.stdout.includes('<node')) {
        xml = read.stdout;
        break;
      }
      // A window that is still animating refuses the dump. The checks poll
      // anyway, so retrying for a moment is cheaper than a special case in every
      // check. This blocks the (single) thread of a short-lived CLI process.
      blockMs(500);
    }
    if (xml === '') {
      throw new Error(
        'real-input: `uiautomator dump` returned nothing usable. The device may ' +
          'be asleep or the app may have crashed. The app log ends:\n' +
          this.tailAppLog()
      );
    }
    fs.writeFileSync(path.join(this.out, 'hierarchy.xml'), xml);
    return parseHierarchy(xml);
  }

  /**
   * @param {import('./uiautomator.mjs').UiautomatorNode} node
   */
  tap(node) {
    this.shell(
      `input tap ${String(Math.round(node.bounds.cx))} ${String(Math.round(node.bounds.cy))}`
    );
  }

  /**
   * @param {number} x1
   * @param {number} y1
   * @param {number} x2
   * @param {number} y2
   * @param {number} durationMs
   */
  swipe(x1, y1, x2, y2, durationMs) {
    this.shell(
      `input swipe ${String(Math.round(x1))} ${String(Math.round(y1))} ` +
        `${String(Math.round(x2))} ${String(Math.round(y2))} ${String(durationMs)}`
    );
  }

  teardown() {
    this.shell(`am force-stop ${this.bundleId}`);
    this.adb(['reverse', '--remove', `tcp:${String(this.metroPort)}`]);
  }
}

/**
 * The only API a check is written against.
 *
 * @param {DeviceHarness} harness
 * @param {import('./support.mjs').CheckLog} log
 */
function makeContext(harness, log) {
  /**
   * @param {string} testID
   * @returns {string | null}
   */
  const echo = (testID) => {
    const node = findByTestId(harness.hierarchy(), testID);
    return node == null ? null : node.text;
  };

  /**
   * @param {string} testID
   * @returns {number | null}
   */
  const value = (testID) => {
    const raw = echo(testID);
    if (raw == null) {
      return null;
    }
    const match = raw.match(/-?\d+(?:\.\d+)?/);
    return match == null ? null : Number(match[0]);
  };

  /**
   * @param {() => boolean} condition
   * @param {string} description
   */
  const until = (condition, description) => {
    const deadline = Date.now() + REACT_TIMEOUT;
    for (;;) {
      if (condition()) {
        return true;
      }
      if (Date.now() > deadline) {
        log.abort(`timed out waiting for ${description}`);
      }
      blockMs(250);
    }
  };

  return {
    log,

    /**
     * @param {string} testID
     */
    requireEcho(testID) {
      const shown = echo(testID);
      if (shown == null) {
        log.abort(
          `no on-screen text with testID "${testID}" in the accessibility tree`
        );
      }
      return shown;
    },

    /**
     * @param {string} description the control's `accessibilityLabel`
     */
    requireControl(description) {
      const node = findByDescription(harness.hierarchy(), description);
      if (node == null) {
        log.abort(
          `no control with accessibilityLabel "${description}" in the ` +
            'accessibility tree — the hosted control offers nothing a real tap ' +
            'could be aimed at'
        );
      }
      log.note(
        `"${description}" occupies ${node.bounds.x1},${node.bounds.y1} → ` +
          `${node.bounds.x2},${node.bounds.y2}`
      );
      return node;
    },

    /**
     * @param {import('./uiautomator.mjs').UiautomatorNode} node
     */
    async tapNode(node) {
      harness.tap(node);
      await sleep(250);
    },

    /**
     * Drag across a control between two fractions of its own width.
     *
     * @param {import('./uiautomator.mjs').UiautomatorNode} node
     * @param {number} from
     * @param {number} to
     * @param {number} durationMs
     */
    async dragControl(node, from, to, durationMs) {
      harness.swipe(
        node.bounds.x1 + node.bounds.width * from,
        node.bounds.cy,
        node.bounds.x1 + node.bounds.width * to,
        node.bounds.cy,
        durationMs
      );
      await sleep(400);
    },

    value,

    /**
     * @param {string} testID
     * @param {string} expected
     * @param {string} description
     */
    waitForEcho(testID, expected, description) {
      until(
        () => echo(testID) === expected,
        `${description} (${testID}="${expected}")`
      );
      return echo(testID);
    },

    /**
     * @param {string} testID
     * @param {string} previous
     * @param {string} description
     */
    waitForEchoToChange(testID, previous, description) {
      until(() => {
        const shown = echo(testID);
        return shown !== null && shown !== previous;
      }, `${description} (${testID} away from "${previous}")`);
      return echo(testID);
    },

    /**
     * Read an echo for `settleMs` and require that it never moved. The button
     * check needs the negative: "the disabled control did not answer" is a claim
     * about a period, not about one instant, and a single read could have been
     * taken before the touch was processed.
     *
     * @param {string} testID
     * @param {string} expected
     * @param {string} description
     * @param {number} [settleMs]
     */
    requireEchoToStay(testID, expected, description, settleMs = 1500) {
      const deadline = Date.now() + settleMs;
      /** @type {string | null} */
      let moved = null;
      for (;;) {
        const shown = echo(testID);
        if (shown !== expected && moved == null) {
          moved = shown;
        }
        if (moved != null || Date.now() >= deadline) {
          break;
        }
        blockMs(200);
      }
      if (moved != null) {
        log.abort(
          `${description}: ${testID} went to "${String(moved)}" when it should ` +
            `have stayed "${expected}"`
        );
      }
      return echo(testID);
    },

    /**
     * @param {string} testID
     * @param {number | null} previous
     * @param {string} description
     */
    waitForValueToRise(testID, previous, description) {
      until(
        () => {
          const shown = value(testID);
          return shown != null && previous != null && shown > previous;
        },
        `${description} (${testID} above ${String(previous)})`
      );
      return value(testID);
    },
  };
}

/**
 * @param {string} serial
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
function avdName(serial, env) {
  const result = run('adb', ['-s', serial, 'emu', 'avd', 'name'], { env });
  return result.stdout.split('\n')[0]?.trim() ?? '';
}

/**
 * Which emulator to drive, and a refusal to drive any other.
 *
 * Several tasks share this machine and AGENTS.md names a device that belongs to
 * a person rather than to a task, so the serial is never guessed from a device
 * list: a candidate is checked by the AVD it actually runs, and the human's
 * device is refused by name as well.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ serial: string, avd: string }}
 */
function resolveDevice(env) {
  const avd = env.ANDROID_AVD ?? 'nitroui';
  if (/^PR15\d\d/i.test(avd)) {
    throw new Error(
      `real-input: ANDROID_AVD="${avd}" is the device AGENTS.md says belongs ` +
        'to the human. Refusing to touch it.'
    );
  }

  const listed = run('adb', ['devices'], { env });
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

  const wanted = env.ANDROID_SERIAL;
  if (wanted != null && wanted !== '') {
    if (!serials.includes(wanted)) {
      throw new Error(
        `real-input: ANDROID_SERIAL=${wanted} is not connected to adb server ` +
          `${env.ANDROID_ADB_SERVER_PORT ?? 'default'}.`
      );
    }
    if (avdName(wanted, env) !== avd) {
      throw new Error(
        `real-input: ANDROID_SERIAL=${wanted} runs AVD ` +
          `"${avdName(wanted, env)}", not the assigned "${avd}".`
      );
    }
    return { serial: wanted, avd };
  }

  const matching = serials.filter((serial) => avdName(serial, env) === avd);
  if (matching.length === 0) {
    throw new Error(
      `real-input: no running emulator for AVD "${avd}" on adb server ` +
        `${env.ANDROID_ADB_SERVER_PORT ?? 'default'}. Boot it first, e.g.\n` +
        `  ANDROID_ADB_SERVER_PORT=${env.ANDROID_ADB_SERVER_PORT ?? '5042'} ` +
        `emulator -avd ${avd} -port 5572 -gpu host -no-window -no-audio ` +
        '-no-boot-anim -no-snapshot-save'
    );
  }
  if (matching.length > 1) {
    throw new Error(
      `real-input: ${String(matching.length)} emulators run AVD "${avd}" ` +
        `(${matching.join(', ')}). Set ANDROID_SERIAL to pick one.`
    );
  }
  return { serial: matching[0], avd };
}

process.exitCode = await main().catch((error) => {
  console.error(`\nreal-input (android): ${String(error)}`);
  return 1;
});
