/**
 * The a11y sweep's device: bring up each case's screen, and answer with the tree as
 * the accessibility service serves it. Both happen outside an `agent-device` session
 * because `uiautomator dump` is killed while its snapshot helper holds the device's
 * single `UiAutomation` connection, and the rule grades `clickable` and `scrollable`,
 * which the driver's own node map does not carry: it folds `clickable` into a wider
 * flag and leaves `scrollable` out.
 *
 * @file
 */
import { blockMs, sleep } from './support.mjs';
import { screenTab } from './screens.mjs';
import { imeServiceShown } from './ime-frame.mjs';
import { findByTestId, parseHierarchy } from './uiautomator.mjs';
import { runA11ySweep } from './a11y-sweep.mjs';
import { countAppPopupWindows } from './popup-windows.mjs';
import { readWindowFocus } from './window-focus.mjs';
import { clearSweepEvidence, keepSweepEvidence } from './a11y-evidence.mjs';

/** Taps one tab gets before its screen is called unreachable. */
const TAB_TAPS = 3;

/** How long one tap is given to bring its screen up, in ms. */
const SCREEN_DEADLINE_MS = 15_000;

/** How far the tab bar is probed sideways for a tab scrolled out of the window. */
const TAB_SWIPES = 10;

/** How long a cold launch gets to put the app's tab bar on screen, in ms. */
const LAUNCH_DEADLINE_MS = 120_000;

/** How often the app is brought forward while another window keeps focus, in ms. */
const BRING_FORWARD_EVERY_MS = 3000;

/** `KEYCODE_BACK`. */
const KEY_BACK = 4;

/**
 * Run the a11y pass over its cases, on the device `adbShell` speaks to.
 *
 * @param {(
 *   id: string,
 *   title: string,
 *   options: {rerun: string[]}
 * ) => import('./a11y-sweep.mjs').A11ySweepLog} begin opens one log line per case, the
 *   way the control checks open theirs
 * @param {object} device
 * @param {(command: string) => string} device.adbShell one `adb shell` command, stdout;
 *   the caller owns the serial and the adb server, as every device read in this gate does
 * @param {() => void} device.stopDaemon bring the driver's daemon down: the dumps below
 *   are only readable while nothing else holds the device's accessibility connection, so
 *   this is what makes the pass possible rather than a longer retry loop
 * @param {ReadonlyArray<{ id: string, label: string }>} device.tabs the example's tabs,
 *   in bar order, read from `example/src/App.tsx`
 * @param {string} device.appId the example's package, relaunched before the first dump
 * @param {ReadonlyArray<import('./a11y.mjs').A11yControl>} [device.cases] the cases to
 *   read; every case when left out
 * @param {string} [device.out] the run's output folder, where a red case's final dump
 *   and screenshot are written; nothing is kept when left out
 * @returns {Promise<{covered: string[], matched: string[], stale: string[]}>}
 */
export async function runA11ySweepOnDevice(begin, device) {
  const harness = new SweepDevice(device);
  try {
    device.stopDaemon();
  } catch {
    // A daemon that is already down is the state this pass needs in any case.
  }
  const out = device.out;
  if (out != null) clearSweepEvidence(out);
  await harness.startFromLaunch();
  return await runA11ySweep(
    begin,
    {
      goToScreen: (screen, log) => harness.goToScreen(screen, log),
      dump: () => harness.hierarchy(),
      scrollToTop: () => harness.scrollToTop(),
      scrollPage: async (pixels) => {
        // The empty strip at the right edge: anywhere else the swipe can start on
        // Material 3's own calendar scroller and turn the month instead of the page.
        const { width, height } = harness.size();
        const y = Math.round(height * 0.7);
        harness.swipe(width - 8, y, width - 8, y - pixels, 400);
        await sleep(500);
      },
      keepEvidence:
        out == null
          ? undefined
          : (control) =>
              keepSweepEvidence({
                out,
                id: control.id,
                label: control.label,
                xml: harness.lastXml,
                adbShell: device.adbShell,
              }),
    },
    device.cases
  );
}

/**
 * The device as the passes outside the driver see it: real injected input, and the tree
 * as `uiautomator` answers with it.
 *
 * Exported for `android-tree-checks.mjs`, which needs the same reach and a few more
 * gestures: a key press, a raw touch event, a tap at a point, the window count.
 */
export class SweepDevice {
  /**
   * @param {{ adbShell: (command: string) => string, tabs: ReadonlyArray<{ id: string, label: string }>, appId: string }} device
   */
  constructor({ adbShell, tabs, appId }) {
    this.adbShell = adbShell;
    this.tabs = tabs;
    this.appId = appId;
    this.remoteDump = '/sdcard/nitro-ui-a11y-sweep.xml';
    /** The text of the last dump `hierarchy` answered with. */
    this.lastXml = '';
    // The tab bar is the strip at the top of the window: 12% of its height covers the
    // tabs at any density without ever reaching the content below them.
    this.tabBandY = Math.round(this.size().height * 0.12);
  }

  /**
   * Bring the app up on its own first screen.
   *
   * The suite ends wherever its last test left the window — a sheet's own window, an
   * open keyboard, a shade a gesture pulled down — and a dump answers with the window
   * that holds focus, which by then may hold no part of the app at all. Launching is
   * what makes the first dump of this pass mean the same thing on every run.
   */
  async startFromLaunch() {
    this.adbShell(`am force-stop ${this.appId}`);
    this.adbShell('cmd statusbar collapse');
    this.adbShell(`am start -W -n ${this.appId}/.MainActivity`);
    await this.awaitApp({ timeoutMs: LAUNCH_DEADLINE_MS, backs: 0 });
  }

  /** The focused window, from the window manager (see `readWindowFocus`). */
  windowFocus() {
    // Not a bare `dumpsys window`: that one opens with the window state saved at the
    // last ANR, which these two sections leave out.
    const dump =
      this.adbShell('dumpsys window displays') +
      '\n' +
      this.adbShell('dumpsys window windows');
    return readWindowFocus(dump, this.appId);
  }

  /**
   * Wait until the app's activity holds focus and its tab bar is in the tree.
   *
   * Back is only sent while the app's own windows hold focus: to a popup or dialog it
   * put up, or to its keyboard. Sent while a launch is still settling it lands on the
   * activity underneath, or on the launcher, and closes the app. Anything else on top
   * is moved off instead: the shade collapsed, another app's activity replaced by
   * bringing this one to the front.
   *
   * @param {{ timeoutMs: number, backs: number, note?: (line: string) => void }} options
   *   `backs`: how many Back presses the app's own windows may take before this stops
   *   sending them. `note`: told each time the app is started again because its process
   *   was gone.
   */
  async awaitApp({ timeoutMs, backs, note }) {
    const deadline = Date.now() + timeoutMs;
    let backsLeft = backs;
    let broughtForwardAt = -Infinity;
    for (;;) {
      const focus = this.windowFocus();
      if (focus.owner === 'activity') {
        const nodes = this.hierarchy();
        const tabStrip = nodes.some(
          (node) => node.resourceId === 'example-tabs'
        );
        const ownWindow = nodes.some(
          (node) => node.resourceId === 'android:id/content'
        );
        if (tabStrip && ownWindow) return;
        if (backsLeft > 0 && this.imeShown()) {
          backsLeft -= 1;
          this.key(KEY_BACK);
          await sleep(700);
          continue;
        }
      } else if (focus.owner === 'app-window' && backsLeft > 0) {
        backsLeft -= 1;
        this.key(KEY_BACK);
        await sleep(700);
        continue;
      } else if (
        focus.owner === 'other' &&
        Date.now() - broughtForwardAt >= BRING_FORWARD_EVERY_MS
      ) {
        broughtForwardAt = Date.now();
        // An activity's window is named `package/class`; a system window (the shade,
        // the status bar) is named without a slash and is not an app to replace.
        if (focus.title?.includes('/') === true) {
          if (this.tryShell(`pidof ${this.appId}`).stdout.trim() === '') {
            note?.(
              `${this.appId} was not running and "${focus.title}" held focus, ` +
                'so the app was launched again'
            );
          }
          this.adbShell(`am start -n ${this.appId}/.MainActivity`);
        } else {
          this.adbShell('cmd statusbar collapse');
        }
      }
      if (Date.now() > deadline) {
        throw new Error(
          `real-input: ${this.appId} did not come back to its tab bar within ` +
            `${String(Math.round(timeoutMs / 1000))} s. The focused window was ` +
            `${focus.title == null ? 'none' : `"${focus.title}"`} (${focus.owner}), ` +
            'as `dumpsys window` reports mCurrentFocus.'
        );
      }
      await sleep(500);
    }
  }

  /** @returns {{ width: number, height: number }} the window, in device px. */
  size() {
    if (this.sizeCache == null) {
      const reported =
        /Physical size:\s*(\d+)x(\d+)|Override size:\s*(\d+)x(\d+)/g;
      const text = this.adbShell('wm size');
      const boxes = [...text.matchAll(reported)].map((match) => ({
        width: Number(match[1] ?? match[3]),
        height: Number(match[2] ?? match[4]),
      }));
      const used = boxes.at(-1);
      if (used == null) {
        throw new Error(
          'real-input: `wm size` named no size, so the a11y sweep has no window to ' +
            `aim a swipe at. It said: ${text.trim()}`
        );
      }
      this.sizeCache = used;
    }
    return this.sizeCache;
  }

  /** A fresh accessibility tree — the flags the rule grades are only in this one. */
  hierarchy() {
    let xml = '';
    let last = '';
    for (let attempt = 1; attempt <= 4 && xml === ''; attempt += 1) {
      const dumped = this.tryShell(`uiautomator dump ${this.remoteDump}`);
      // A refused dump leaves the file from the last one where it is, so the tree is
      // only read after the dump says it wrote a new one.
      const read =
        dumped.status === 0 ? this.tryShell(`cat ${this.remoteDump}`) : null;
      if (read?.stdout.includes('<node') === true) {
        xml = read.stdout;
        break;
      }
      last = read?.text ?? dumped.text;
      if (attempt < 4) blockMs(500);
    }
    if (xml === '') {
      throw new Error(
        'real-input: `uiautomator dump` answered nothing usable four times, so the ' +
          `a11y rule has no tree to grade. It said: ${last.slice(0, 300)}`
      );
    }
    this.lastXml = xml;
    return parseHierarchy(xml);
  }

  /**
   * @param {string} screen
   * @param {{ retried?: (line: string) => void, note?: (line: string) => void }} log
   */
  async goToScreen(screen, log) {
    const { anchor } = screenTab(screen);
    const tab = this.tabs.find((entry) => entry.id === screen);
    if (tab == null) {
      throw new Error(
        `real-input: no example tab "${screen}" in example/src/App.tsx's TABS, so ` +
          'the a11y sweep cannot reach the screen its case names.'
      );
    }
    const up = () =>
      this.hierarchy().some((node) => node.resourceId === anchor);
    // Two cases on one control is the common run, and standing on the screen is then
    // the answer; the scroll below costs a dump per swipe.
    if (up()) return;
    // From wherever the last case left the scroll: an anchor scrolled out of sight is
    // simply not in the dump, and this would go looking for a tab while standing on it.
    await this.scrollToTop();
    if (up()) return;
    for (let attempt = 1; attempt <= TAB_TAPS; attempt += 1) {
      // Re-looked-up on every attempt: the dump the last target came from is as old as
      // the window that expired, and a bar that has since scrolled makes it a miss.
      const target = await this.revealTab(tab);
      if (target == null) {
        throw new Error(
          `real-input: the "${tab.label}" tab could not be scrolled wholly onto the ` +
            'screen, so the a11y sweep cannot reach its screen reliably.'
        );
      }
      this.tap(target);
      const deadline = Date.now() + SCREEN_DEADLINE_MS;
      while (!up()) {
        if (Date.now() > deadline) break;
        await sleep(300);
      }
      if (up()) {
        if (attempt > 1) {
          log.retried?.(
            `navigation: the "${tab.label}" tab answered on tap ${String(attempt)}/` +
              `${String(TAB_TAPS)} — the earlier tap(s) were never delivered`
          );
        }
        return;
      }
      log.note?.(
        `navigation: tap ${String(attempt)}/${String(TAB_TAPS)} on the ` +
          `"${tab.label}" tab left no "${anchor}" in the tree — tapping again`
      );
    }
    throw new Error(
      `real-input: tapping the "${tab.label}" tab ${String(TAB_TAPS)} times did not ` +
        `bring up its screen (looking for resource-id "${anchor}").`
    );
  }

  /**
   * Scroll the tab bar until one tab lies wholly inside the window.
   *
   * A tab half out of the window is dumped at its *clipped* box, so a tap aimed at its
   * centre would land on a neighbour; "wholly inside" is the box clear of both edges.
   *
   * @param {{ id: string, label: string }} tab
   */
  async revealTab(tab) {
    const { width } = this.size();
    const order = this.tabs.findIndex((entry) => entry.id === tab.id);
    for (let attempt = 0; ; attempt += 1) {
      const nodes = this.hierarchy();
      const target = this.tabNode(nodes, tab);
      if (target != null && target.bounds.x1 > 0 && target.bounds.x2 < width) {
        return target;
      }
      if (attempt === TAB_SWIPES) return null;
      const visible = this.tabs
        .map((entry, index) => ({ index, node: this.tabNode(nodes, entry) }))
        .filter((entry) => entry.node != null);
      if (visible.length === 0) {
        throw new Error(
          'real-input: no tab of the example is in the accessibility tree, so the ' +
            `"${tab.label}" tab cannot be scrolled to.`
        );
      }
      // +1: the tab lies to the right of the window, so the bar's content moves left.
      const towards =
        target != null
          ? target.bounds.x2 >= width
            ? 1
            : -1
          : order > visible.at(-1).index
            ? 1
            : -1;
      const y = visible[0].node.bounds.cy;
      const from = Math.round(width * (towards > 0 ? 0.75 : 0.25));
      this.swipe(from, y, from - towards * Math.round(width * 0.5), y, 600);
      await sleep(500);
    }
  }

  /**
   * Swipe the page back to its top, until a swipe stops moving anything.
   *
   * @param {number} [maxSwipes]
   */
  async scrollToTop(maxSwipes = 8) {
    const { width, height } = this.size();
    const x = width - 8;
    const from = Math.round(height * 0.25);
    const to = from + Math.round(height * 0.5);
    const signature = () =>
      this.hierarchy()
        .filter((node) => node.bounds.y1 > this.tabBandY + 8)
        .slice(0, 4)
        .map((node) => `${String(node.bounds.x1)},${String(node.bounds.y1)}`)
        .join(';');
    let previous = signature();
    for (let attempt = 0; attempt < maxSwipes; attempt += 1) {
      this.swipe(x, from, x, to, 400);
      await sleep(400);
      const now = signature();
      if (now === previous) return;
      previous = now;
    }
  }

  /**
   * The tab's node: the box the app put its `testID` on, or — for a tab whose id the
   * accessibility tree does not carry — the labelled box inside the tab band.
   */
  tabNode(nodes, tab) {
    const identified = findByTestId(nodes, `tab-${tab.id}`);
    if (identified != null) return identified;
    return (
      nodes.find(
        (node) =>
          node.contentDesc === tab.label &&
          node.bounds.cy <= this.tabBandY &&
          node.bounds.width > 0
      ) ?? null
    );
  }

  /** @param {import('./uiautomator.mjs').UiautomatorNode} node */
  tap(node) {
    this.adbShell(
      `input tap ${String(Math.round(node.bounds.cx))} ` +
        `${String(Math.round(node.bounds.cy))}`
    );
  }

  swipe(x1, y1, x2, y2, durationMs) {
    this.adbShell(
      `input swipe ${String(Math.round(x1))} ${String(Math.round(y1))} ` +
        `${String(Math.round(x2))} ${String(Math.round(y2))} ` +
        `${String(durationMs)}`
    );
  }

  /**
   * One raw touch event. A gesture that changes shape mid-way - a hold that becomes a drag
   * - is several of these in one stream.
   *
   * @param {'DOWN' | 'MOVE' | 'UP'} action
   * @param {number} x
   * @param {number} y
   */
  motion(action, x, y) {
    this.adbShell(
      `input motionevent ${action} ${String(Math.round(x))} ` +
        `${String(Math.round(y))}`
    );
  }

  /**
   * @param {number} keyCode 4 is `KEYCODE_BACK`
   */
  key(keyCode) {
    this.adbShell(`input keyevent ${String(keyCode)}`);
  }

  /** Real key events into the focused window, in adb's doubly-parsed argument form. */
  typeText(encoded) {
    this.adbShell(`input text ${encoded}`);
  }

  /** Whether a soft keyboard is on screen, from the input method's own report. */
  imeShown() {
    return imeServiceShown(this.adbShell('dumpsys input_method'));
  }

  /**
   * Whether the device is told to show a soft keyboard beside a hardware one. An
   * emulator reports a hardware keyboard and keeps the soft one away however focused
   * the field is, so a keyboard check has to ask for it and put it back after.
   *
   * @param {boolean} enabled
   */
  setImeWithHardKeyboard(enabled) {
    this.adbShell(
      `settings put secure show_ime_with_hard_keyboard ${enabled ? '1' : '0'}`
    );
  }

  /** @returns {boolean} the current `show_ime_with_hard_keyboard`, as written. */
  imeWithHardKeyboard() {
    return /1/.test(
      this.adbShell('settings get secure show_ime_with_hard_keyboard')
    );
  }

  /** @param {number} x @param {number} y */
  tapAt(x, y) {
    this.adbShell(
      `input tap ${String(Math.round(x))} ${String(Math.round(y))}`
    );
  }

  /**
   * How many pixels one dp is, from the device rather than from a comment: every geometry
   * rule these checks make is in pixels, and the ones that want to say "40 dp" can only do
   * it by converting. `wm density` answers a dpi and one dp is 160 dpi; an override line
   * wins when there is one, because that is what the device lays its controls out at.
   */
  density() {
    const out = this.adbShell('wm density');
    const dpi = Number(
      (
        out.match(/Override density:\s*(\d+(?:\.\d+)?)/) ??
        out.match(/Physical density:\s*(\d+(?:\.\d+)?)/)
      )?.[1]
    );
    if (!Number.isFinite(dpi) || dpi <= 0) {
      throw new Error(
        `real-input: \`adb shell wm density\` said nothing useful: ${out.trim()}`
      );
    }
    return dpi / 160;
  }

  /** The app's own popup windows right now (see `countAppPopupWindows`). */
  popupWindowCount() {
    return countAppPopupWindows(
      this.adbShell('dumpsys window windows'),
      this.appId
    );
  }

  /**
   * `adb shell`, without the throw: a refused dump is a moving window, not a failure,
   * and the caller decides after its last attempt whether the tree is missing.
   *
   * @param {string} command
   * @returns {{ status: number, stdout: string, text: string }}
   */
  tryShell(command) {
    try {
      const stdout = this.adbShell(command);
      return { status: 0, stdout, text: stdout };
    } catch (error) {
      const failure =
        /** @type {{ stdout?: unknown, status?: number, message?: string }} */ (
          /** @type {unknown} */ (error)
        );
      const stdout = String(failure.stdout ?? '');
      return {
        status: Number(failure.status ?? 1),
        stdout,
        text: `${stdout} ${String(failure.message ?? failure)}`,
      };
    }
  }
}
