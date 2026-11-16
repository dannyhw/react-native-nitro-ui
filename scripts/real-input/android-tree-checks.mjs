/**
 * The Android real-input checks that only a `uiautomator` dump can make, run after the
 * e2e suite with its daemon down: the dump cannot be asked while the driver holds the
 * device's one accessibility connection, and its node map carries no `clickable`,
 * `checkable` or `scrollable` — the flags these checks read off the node a finger lands
 * on. The device is the caller's: one `adb shell` at a time, at the leased serial only.
 *
 * @file
 */
import { blockMs, runCheck, sleep } from './support.mjs';
import { REAL_INPUT_CONTROLS } from './controls.mjs';
import { ECHO } from './screens.mjs';
import { imeServiceShown } from './ime-frame.mjs';
import {
  findAllByDescription,
  findAllByText,
  findByDescription,
  findByTestId,
} from './uiautomator.mjs';
import {
  nativeChecked,
  nativeEnabled,
  tightestFlaggedNode,
} from './android-tree.mjs';
import {
  CALENDAR_WIDE_MIN_DP,
  calendarGridProblems,
  expectedColumnDp,
  measureCalendarGrid,
} from './android-calendar.mjs';
import { SweepDevice } from './a11y-sweep-device.mjs';

/** How long a press gets to show its witness, in ms. */
const REACT_TIMEOUT = Number(process.env.REAL_INPUT_TIMEOUT ?? 8000);

/** The poll for a witness that reads the accessibility tree, which costs about 2 s. */
const DUMP_POLL_MS = 500;

/** Below this a box has nothing for a finger to land on. */
const MIN_PRESSABLE_PX = 16;

/** `KEYCODE_BACK`. */
const KEY_BACK = 4;

/**
 * The checks' view of the device: a dump, an injected touch, and the log they report to.
 *
 * @param {SweepDevice} device
 * @param {import('./report.mjs').CheckLog} log
 */
function makeContext(device, log) {
  /**
   * @param {string} testID
   * @returns {string | null}
   */
  const echo = (testID) => {
    const node = findByTestId(device.hierarchy(), testID);
    return node == null ? null : node.text;
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
      const node = findByDescription(device.hierarchy(), description);
      if (node == null) {
        log.abort(
          `no control with accessibilityLabel "${description}" in the ` +
            'accessibility tree — the hosted control offers nothing a real tap ' +
            'could be aimed at'
        );
      }
      if (node.bounds.width === 0 || node.bounds.height === 0) {
        log.abort(
          `accessibilityLabel "${description}" is named in the tree with no box - ` +
            'it is composed outside the scroll clip, so no real tap can be aimed ' +
            'at it. Scroll it into view first (`requireControlOnScreen`).'
        );
      }
      log.note(
        `"${description}" occupies ${node.bounds.x1},${node.bounds.y1} → ` +
          `${node.bounds.x2},${node.bounds.y2}`
      );
      return node;
    },

    dump() {
      return device.hierarchy();
    },

    /**
     * @param {string} testID
     */
    nodeByTestId(testID) {
      return findByTestId(device.hierarchy(), testID);
    },

    density() {
      return device.density();
    },

    screenSize: () => device.size(),

    /**
     * Scrolls until the control is on screen and big enough to press, and says how far it
     * had to travel. A control named with a clipped box is not pressable, and the two
     * failures are counted apart because they need different fixes.
     *
     * @param {string} description
     */
    async requireControlOnScreen(description) {
      let namedOffScreen = 0;
      let clipped = 0;
      let scrolls = 0;
      /** @type {import('./uiautomator.mjs').UiautomatorNode | null} */
      let lastClipped = null;
      const { width, height } = device.size();
      // Down first, then back up. The page is wherever the previous control's checks
      // left it, and on a screen this long a control the earlier scroll travelled past
      // is not a control that has gone away.
      for (const direction of [1, -1]) {
        for (let attempt = 0; attempt < 6; attempt += 1) {
          const node = findByDescription(device.hierarchy(), description);
          if (node != null && node.bounds.width > 0 && node.bounds.height > 0) {
            const centreX = (node.bounds.x1 + node.bounds.x2) / 2;
            const centreY = (node.bounds.y1 + node.bounds.y2) / 2;
            const pressable =
              node.bounds.height >= MIN_PRESSABLE_PX &&
              centreX > 0 &&
              centreX < width &&
              centreY > 0 &&
              centreY < height;
            if (pressable) {
              if (scrolls > 0) {
                log.note(
                  `"${description}" needed ${String(scrolls)} scroll` +
                    `${scrolls === 1 ? '' : 's'} to come on screen` +
                    (namedOffScreen > 0
                      ? ` - after ${String(namedOffScreen)} naming` +
                        `${namedOffScreen === 1 ? '' : 's'} with no box (composed ` +
                        'outside the clip)'
                      : '') +
                    (clipped > 0
                      ? `, and ${String(clipped)} with a box clipped to ` +
                        `${String(MIN_PRESSABLE_PX)} px or less`
                      : '')
                );
              }
              log.note(
                `"${description}" occupies ${node.bounds.x1},${node.bounds.y1} → ` +
                  `${node.bounds.x2},${node.bounds.y2}`
              );
              return node;
            }
            clipped += 1;
            lastClipped = node;
          } else if (node != null) {
            namedOffScreen += 1;
          }
          scrolls += 1;
          device.swipe(
            width / 2,
            direction > 0 ? height * 0.7 : height * 0.32,
            width / 2,
            direction > 0 ? height * 0.32 : height * 0.7,
            400
          );
          await sleep(400);
        }
      }
      if (lastClipped != null) {
        log.abort(
          `"${description}" is only ever named with a box of ` +
            `${String(lastClipped.bounds.width)} x ` +
            `${String(lastClipped.bounds.height)} px, which is not a box a finger can ` +
            'be aimed at — the control is clipped out of the scroll.'
        );
      }
      log.abort(
        `scrolling twelve times, down then back up, never brought ` +
          `"${description}" on screen` +
          (namedOffScreen > 0
            ? `, although it was named ${String(namedOffScreen)} time` +
              `${namedOffScreen === 1 ? '' : 's'} with no box at all`
            : '')
      );
    },

    /**
     * @param {import('./uiautomator.mjs').UiautomatorNode} node
     */
    async tapNode(node) {
      device.tap(node);
      await sleep(250);
    },

    /**
     * Press, then wait for the witness that the press arrived, and retry while it is
     * absent: a synthesised injection can be dropped, and a check that taps once and
     * waits reports a lost delivery as a control that refuses a finger.
     *
     * When `nativeState` moves while the witness does not, this stops and says so.
     *
     * @param {object} options
     * @param {string} options.what
     * @param {string} options.waitingFor
     * @param {(attempt: number) => Promise<void>} options.press
     * @param {() => string | null} options.reading
     * @param {(shown: string | null) => boolean} options.raised
     * @param {() => string | null} [options.nativeState]
     * @param {number} [options.attempts]
     * @param {number} [options.windowMs]
     * @param {number} [options.pollMs] a witness that dumps the tree costs about 2 s each,
     *   and polling one at 100 ms spends the whole wait on readings
     * @returns {Promise<{delivered: boolean, shown: string | null}>}
     */
    async pressUntil({
      what,
      waitingFor,
      press,
      reading,
      raised,
      nativeState,
      attempts = 3,
      windowMs = REACT_TIMEOUT,
      pollMs = 100,
    }) {
      /** @type {string | null} */
      let shown = null;
      const echoStart = reading();
      const stateStart = nativeState == null ? null : nativeState();
      if (nativeState != null && stateStart == null) {
        log.abort(
          `${waitingFor}: ${what} was given a native-state witness and it read ` +
            'nothing, so a delivered touch could not be told from a lost event. The ' +
            'control publishes no state to read, or the label names the wrong node.'
        );
      }
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        await press(attempt);
        const deadline = Date.now() + windowMs;
        for (;;) {
          shown = reading();
          if (raised(shown)) {
            if (attempt > 1) {
              log.retried(
                `${waitingFor}: ${what} answered on tap ${String(attempt)}/${String(
                  attempts
                )} - the earlier tap(s) were never delivered`
              );
            }
            return { delivered: true, shown };
          }
          if (Date.now() > deadline) {
            break;
          }
          blockMs(pollMs);
        }
        if (nativeState != null) {
          const moved = nativeState();
          if (
            moved != null &&
            stateStart != null &&
            moved !== stateStart &&
            shown === echoStart
          ) {
            // The echo gets a second window before the accusation: a JS thread that is
            // merely very slow looks exactly like a lost event from here.
            const graceDeadline = Date.now() + windowMs;
            for (;;) {
              shown = reading();
              if (raised(shown)) {
                log.note(
                  `${waitingFor}: ${what} answered ${String(windowMs)}ms after its ` +
                    'press, late enough that the control had already changed - a slow ' +
                    'JS thread, not a lost event'
                );
                return { delivered: true, shown };
              }
              if (Date.now() > graceDeadline) {
                break;
              }
              blockMs(pollMs);
            }
            log.abort(
              `${waitingFor}: ${what} took the touch and lost the event - the control's ` +
                `own state moved from "${stateStart}" to "${moved}" and its echo is ` +
                `still "${String(shown)}", the value it had before any press, ${String(
                  windowMs * 2
                )}ms later. Not retried: a further press would land the event and make a ` +
                'lost change look like a dropped tap.'
            );
          }
        }
        log.note(
          `${waitingFor}: tap ${String(attempt)}/${String(attempts)} on ${what} left ` +
            `"${String(shown)}" - tapping again`
        );
      }
      return { delivered: false, shown };
    },

    /**
     * @param {string} description the control's `accessibilityLabel`
     * @returns {string | null} `"on"` / `"off"`, or null when no node answers
     */
    nativeChecked(description) {
      return nativeChecked(device.hierarchy(), description);
    },

    /**
     * @param {string} description the control's `accessibilityLabel`
     * @returns {string | null} `"true"` / `"false"`, or null when nothing answers
     */
    nativeEnabled(description) {
      return nativeEnabled(device.hierarchy(), description);
    },

    /**
     * Tap a control until the on-screen *value* it should change says so.
     *
     * Any movement of the echo is not enough: a check that then asserts the new value is
     * one dropped tap away from reporting a control that refuses a finger.
     *
     * @param {() => Promise<import('./uiautomator.mjs').UiautomatorNode> | import('./uiautomator.mjs').UiautomatorNode} lookUp
     * @param {string} testID
     * @param {string} expected
     * @param {string} waitingFor
     * @param {{aim?: (node: import('./uiautomator.mjs').UiautomatorNode) => Promise<void>, attempts?: number, nativeLabel?: string, atLeast?: boolean}} [options]
     */
    async tapUntilValue(lookUp, testID, expected, waitingFor, options = {}) {
      // An ignored `aim` presses the middle of the control, which fails a segment check and
      // blames delivery, so a mis-shaped option is refused rather than read as "no aim".
      const known = ['aim', 'attempts', 'nativeLabel', 'atLeast'];
      const unknown = Object.keys(options).filter((k) => !known.includes(k));
      if (typeof options === 'function' || unknown.length > 0) {
        log.abort(
          `${waitingFor}: tapUntilValue was given ${
            typeof options === 'function'
              ? 'a positional aim function (it is now { aim })'
              : `unknown option(s) ${unknown.join(', ')} - the fifth argument is ` +
                '{ aim, attempts, nativeLabel, atLeast }'
          }. Refusing to tap: an ignored aim presses the middle of the control, ` +
            'which fails a segment check and blames delivery.'
        );
      }
      const { aim, attempts = 3, nativeLabel, atLeast = false } = options;
      const target = Number(expected);
      if (atLeast && !Number.isInteger(target)) {
        log.abort(
          `${waitingFor}: atLeast needs a counter, and "${expected}" is not one`
        );
      }
      const { delivered, shown } = await this.pressUntil({
        what: `"${testID}"`,
        waitingFor,
        attempts,
        press: async (attempt) => {
          const node = await lookUp();
          if (nativeLabel != null && attempt === 1) {
            // A label that does not name the pressed control would consult somebody
            // else's state, so the option is checked rather than trusted.
            if (node.contentDesc !== nativeLabel) {
              log.abort(
                `${waitingFor}: nativeLabel "${nativeLabel}" does not name the control ` +
                  `being pressed ("${node.contentDesc}") - the native-state witness ` +
                  'would read the wrong control'
              );
            }
          }
          if (aim == null) {
            await this.tapNode(node);
          } else {
            await aim(node);
          }
        },
        reading: () => echo(testID),
        nativeState:
          nativeLabel == null
            ? undefined
            : () => this.nativeChecked(nativeLabel),
        raised: (current) =>
          atLeast
            ? current != null && Number(current) >= target
            : current === expected,
      });
      if (!delivered) {
        log.abort(
          `${waitingFor}: ${String(attempts)} real taps left ${testID} at "${String(
            shown
          )}" rather than ${atLeast ? 'at least ' : ''}"${expected}" - either the taps were never ` +
            'delivered or the control ignores a real touch. One delivered ' +
            'tap was enough to pass, so this is not a control that answers sometimes.'
        );
      }
      return /** @type {string} */ (shown);
    },

    /**
     * Tap the field of a `compact` control until its dialog or popup is really up: a popup
     * is the only witness while it is open.
     *
     * @param {() => Promise<import('./uiautomator.mjs').UiautomatorNode>} lookUp
     * @param {string} waitingFor
     * @param {() => number} countUp
     * @param {{attempts?: number, windowMs?: number, pollMs?: number}} [options]
     */
    async tapUntilUp(lookUp, waitingFor, countUp, options = {}) {
      const { delivered, shown } = await this.pressUntil({
        what: 'its window',
        waitingFor,
        ...options,
        press: async () => {
          await this.tapNode(await lookUp());
        },
        reading: () => String(countUp()),
        raised: (current) => current !== '0',
      });
      if (!delivered) {
        const attempts = String(options.attempts ?? 3);
        log.abort(
          `${waitingFor}: ${attempts} real taps opened nothing - either the taps ` +
            'were never delivered or the control cannot present. ' +
            'The dump above is the screen a finger would have found.'
        );
      }
      return shown;
    },

    /**
     * Tap an open menu's row until the *value* it should report arrives. The row is
     * re-found each attempt and only pressed while it is still up: a pick that travelled
     * closes the menu, and pressing where the menu was would aim at whatever it left behind.
     *
     * @param {string} option
     * @param {string} testID
     * @param {string} expected
     * @param {string} waitingFor
     * @param {number} [attempts]
     */
    async tapOptionUntilValue(
      option,
      testID,
      expected,
      waitingFor,
      attempts = 3
    ) {
      const { delivered, shown } = await this.pressUntil({
        what: `menu row "${option}"`,
        waitingFor,
        attempts,
        press: async (attempt) => {
          if (
            attempt > 1 &&
            findAllByText(device.hierarchy(), option).length === 0
          ) {
            return;
          }
          await this.tapNode(
            this.waitForOption(option, 'the menu row to still be up')
          );
        },
        reading: () => echo(testID),
        raised: (current) => current === expected,
      });
      if (!delivered) {
        log.abort(
          `${waitingFor}: ${String(attempts)} real taps on "${option}" left ${testID} ` +
            `"${String(shown)}" rather than "${expected}" - either the taps were never ` +
            'delivered or the row ignores a real touch.'
        );
      }
      return /** @type {string} */ (shown);
    },

    /**
     * @param {string} testID
     */
    echo(testID) {
      return echo(testID);
    },

    /**
     * @param {number} ms
     */
    async settle(ms) {
      await sleep(ms);
    },

    /**
     * @param {string} testID
     * @param {(text: string | null) => boolean} matches
     * @param {number} timeoutMs
     * @returns {string | null} the last text seen, matched or not
     */
    echoWithin(testID, matches, timeoutMs = 2500) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const shown = echo(testID);
        if (matches(shown) || Date.now() > deadline) {
          return shown;
        }
        blockMs(100);
      }
    },

    /**
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
     * @param {(node: import('./uiautomator.mjs').UiautomatorNode) => boolean} predicate
     * @param {string} why
     * @param {number} minCount
     * @param {number} [timeoutMs]
     */
    /**
     * Look a control up again, and say if it moved.
     *
     * A picker's anchor widens on purpose when the chosen title is wider than the last
     * one, so every second touch on the same control is aimed at the box it has now.
     *
     * @param {string} description the control's `accessibilityLabel`
     * @param {import('./uiautomator.mjs').UiautomatorNode} previous where it was
     */
    requireControlAt(description, previous) {
      const node = this.requireControl(description);
      if (this.boundsText(node) !== this.boundsText(previous)) {
        this.log.note(
          `"${description}" moved from ${this.boundsText(previous)} to ` +
            `${this.boundsText(node)} - the tap is aimed at the new box`
        );
      }
      return node;
    },

    waitForNodes(predicate, why, minCount = 1, timeoutMs = REACT_TIMEOUT) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const found = device.hierarchy().filter(predicate);
        if (found.length >= minCount) {
          return found;
        }
        if (Date.now() > deadline) {
          log.abort(`timed out waiting for ${why}`);
        }
        blockMs(250);
      }
    },

    /**
     * The popup row with this label: Material's own rows name themselves with a localised
     * string rather than a testID.
     *
     * @param {string} text
     * @param {string} description
     */
    waitForOption(text, description) {
      /** @type {import('./uiautomator.mjs').UiautomatorNode | null} */
      let found = null;
      until(() => {
        found = findAllByText(device.hierarchy(), text)[0] ?? null;
        return found != null;
      }, `${description} - no popup row labelled "${text}"`);
      return /** @type {import('./uiautomator.mjs').UiautomatorNode} */ (found);
    },

    /**
     * Every node carrying this `accessibilityLabel`.
     *
     * @param {string} description
     */
    nodesNamed(description) {
      return findAllByDescription(device.hierarchy(), description);
    },

    /**
     * @param {import('./uiautomator.mjs').UiautomatorNode} node
     */
    boundsText(node) {
      const { x1, y1, x2, y2 } = node.bounds;
      return `${String(x1)},${String(y1)} → ${String(x2)},${String(y2)}`;
    },

    /**
     * @param {string} text the option's label
     */
    optionIsSelected(text) {
      const nodes = device.hierarchy();
      const label = findAllByText(nodes, text)[0];
      if (label == null) {
        return false;
      }
      const { cx, cy } = label.bounds;
      const row = nodes.find(
        (node) =>
          node.checkable === 'true' &&
          node.bounds.x1 <= cx &&
          cx <= node.bounds.x2 &&
          node.bounds.y1 <= cy &&
          cy <= node.bounds.y2
      );
      return row != null && row.checked === 'true';
    },

    popupWindowCount() {
      return device.popupWindowCount();
    },

    /**
     * A popup comes down on the app's next frame and then on WindowManager's own schedule,
     * so reading the count in the moment after a touch races both.
     *
     * @param {number} expected
     * @param {string} description
     */
    waitForPopupCount(expected, description) {
      const startedAt = Date.now();
      let count = device.popupWindowCount();
      while (count !== expected) {
        if (Date.now() - startedAt > REACT_TIMEOUT) {
          log.abort(
            `timed out after ${String(REACT_TIMEOUT)}ms waiting for ${description} - ` +
              `popup windows ${String(count)}, expected ${String(expected)}`
          );
        }
        blockMs(100);
        count = device.popupWindowCount();
      }
      const waitedMs = Date.now() - startedAt;
      if (waitedMs > 250) {
        log.note(
          `popup windows reached ${String(expected)} after ${String(waitedMs)}ms`
        );
      }
      return count;
    },

    async pressBack() {
      device.key(KEY_BACK);
      await sleep(400);
    },

    /**
     * @param {number} x1
     * @param {number} y1
     * @param {number} x2
     * @param {number} y2
     * @param {number} durationMs
     */
    async swipePx(x1, y1, x2, y2, durationMs) {
      device.swipe(x1, y1, x2, y2, durationMs);
      await sleep(300);
    },

    /**
     * @param {number} x
     * @param {number} y
     */
    async tapPx(x, y) {
      device.tapAt(x, y);
      await sleep(250);
    },

    /**
     * @param {string} testID
     */
    async tapTestId(testID) {
      const node = findByTestId(device.hierarchy(), testID);
      if (node == null) {
        log.abort(`no view with testID "${testID}" on screen to tap`);
      }
      device.tap(node);
      await sleep(250);
    },

    displayWidth() {
      return device.size().width;
    },

    displayHeight() {
      return device.size().height;
    },

    /**
     * A hold that turns into a drag in the same gesture: DOWN, `holdMs` still, then five
     * MOVEs to `dyPx` and the UP there (`input motionevent`, one touch stream).
     *
     * @param {number} x
     * @param {number} y
     * @param {number} dyPx
     * @param {number} [holdMs]
     */
    async holdThenDrag(x, y, dyPx, holdMs = 900) {
      device.motion('DOWN', x, y);
      await sleep(holdMs);
      for (let step = 1; step <= 5; step += 1) {
        device.motion('MOVE', x, y + (dyPx * step) / 5);
      }
      device.motion('UP', x, y + dyPx);
      await sleep(300);
    },

    /**
     * Scroll the page by `pixels` with one swipe (negative scrolls up).
     *
     * Aimed at the empty strip at the right edge: anywhere else the swipe can start on
     * Material 3's own calendar scroller and turn the month instead of the page.
     *
     * @param {number} pixels
     */
    async scrollPage(pixels) {
      const nodes = device.hierarchy();
      const width = Math.max(...nodes.map((node) => node.bounds.x2), 1);
      const height = Math.max(...nodes.map((node) => node.bounds.y2), 1);
      const x = width - 8;
      const from = height * 0.7;
      device.swipe(x, from, x, from - pixels, 400);
      await sleep(500);
    },

    /** A tap on the empty strip near the bottom of the window: outside any popup. */
    async tapScrim() {
      const height = device.size().height;
      const width = device.size().width;
      device.tapAt(Math.round(width / 2), Math.round(height * 0.8));
      await sleep(400);
    },

    /** Whether a soft keyboard is on screen, from the input method's own report. */
    imeShown() {
      return imeServiceShown(device.adbShell('dumpsys input_method'));
    },

    /**
     * Ask the device to show a soft keyboard beside a hardware one, and hand back what
     * the setting said before so the caller can put it back.
     *
     * @param {boolean} enabled
     * @returns {boolean} the previous value
     */
    setImeWithHardKeyboard(enabled) {
      const previous = device.imeWithHardKeyboard();
      device.setImeWithHardKeyboard(enabled);
      return previous;
    },

    /**
     * Real key events into the focused window: `input text`, with no target argument,
     * so the field has to hold focus already.
     *
     * @param {string} text
     */
    async type(text) {
      device.typeText(encodeInputText(text));
      await sleep(300);
    },

    /**
     * Take the soft keyboard down if it is up, and leave focus where it is.
     *
     * Only when it is up: Back is offered to the IME first, but with no keyboard it is
     * the app's Back, which sends a React Native root to the background.
     */
    async hideKeyboard() {
      if (device.imeShown()) {
        device.key(KEY_BACK);
        await sleep(500);
      }
    },
  };
}

/**
 * adb's `input text` argument form.
 *
 * The string is parsed twice - by the device's shell and by the `input` tool - so a
 * space travels as `%s`. Anything outside a safe set is refused rather than escaped by
 * guesswork: a check that typed the wrong string and asserted on it is worse than one
 * that says it cannot type that string.
 *
 * @param {string} text
 * @returns {string}
 */
function encodeInputText(text) {
  let encoded = '';
  for (const char of text) {
    if (char === ' ') {
      encoded += '%s';
    } else if (/^[A-Za-z0-9._\-@:/]$/.test(char)) {
      encoded += char;
    } else {
      throw new Error(
        `real-input: cannot type "${char}" with \`input text\` (outside the set it ` +
          'accepts after being parsed twice)'
      );
    }
  }
  return encoded;
}

/* --------------------------------------------------------------------------- *
 * The helpers the moved checks share.
 * --------------------------------------------------------------------------- */

function contextEcho(t) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const part of (t.echo('ctx-echo') ?? '').split(';')) {
    const [key, value] = part.split('=');
    if (key != null && value != null && /^-?\d+$/.test(value)) {
      out[key] = Number(value);
    }
  }
  return out;
}

/**
 * Poll the echo until `ok` accepts it or `timeoutMs` passes; the last reading either way.
 *
 * @param {ReturnType<typeof makeContext>} t
 * @param {(echo: Record<string, number>) => boolean} ok
 */
async function contextEchoWhen(t, ok, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let echo = contextEcho(t);
  while (!ok(echo) && Date.now() < deadline) {
    await sleep(250);
    echo = contextEcho(t);
  }
  return echo;
}

/**
 * The open popup's window and its rows, or `null` while the app's own window is on top.
 * The popup is the `android:id/content` window that is not the whole display.
 *
 * @param {ReturnType<typeof makeContext>} t
 */
function contextPopup(t) {
  const nodes = t.dump();
  const width = t.displayWidth();
  const height = t.displayHeight();
  const content = nodes.find(
    (node) =>
      node.resourceId === 'android:id/content' &&
      !(
        node.bounds.x1 === 0 &&
        node.bounds.y1 === 0 &&
        node.bounds.x2 === width &&
        node.bounds.y2 === height
      )
  );
  if (content == null) return null;
  return {
    bounds: content.bounds,
    rows: nodes.filter((node) => node.text !== '').map((node) => node.text),
    nodes,
  };
}

/** @param {ReturnType<typeof makeContext>} t */
async function contextPopupWithin(t, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const popup = contextPopup(t);
    if (popup != null || Date.now() > deadline) return popup;
    await sleep(250);
  }
}

/**
 * The point `fx`, `fy` of the way across a node, px.
 *
 * @param {import('./uiautomator.mjs').UiautomatorNode['bounds']} bounds
 * @param {number} fx
 * @param {number} fy
 */
function pointIn(bounds, fx, fy) {
  return {
    x: Math.round(bounds.x1 + (bounds.x2 - bounds.x1) * fx),
    y: Math.round(bounds.y1 + (bounds.y2 - bounds.y1) * fy),
  };
}

/**
 * Close whatever popup is up with Back, and wait for its window to go.
 *
 * @param {ReturnType<typeof makeContext>} t
 */
async function contextClose(t) {
  if (contextPopup(t) == null) return;
  await t.pressBack();
  t.waitForPopupCount(0, 'Back to close the context menu');
  await sleep(300);
}

/**
 * The node with this testID, scrolled wholly inside `ctx-scroll` with slow drags on the
 * right-edge strip: no fling, and no ContextMenu under the finger.
 *
 * @param {ReturnType<typeof makeContext>} t
 * @param {string} testID
 */
async function contextReveal(t, testID) {
  const edge = t.displayWidth() - 8;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const view = t.nodeByTestId('ctx-scroll')?.bounds;
    const node = t.nodeByTestId(testID)?.bounds;
    if (view == null) t.log.abort('the ContextMenu screen has no ctx-scroll');
    if (node != null && node.y1 >= view.y1 + 8 && node.y2 <= view.y2 - 8) {
      return node;
    }
    // Absent from the dump means scrolled out of sight, and everything here is below.
    const down = node == null || node.y2 > view.y2 - 8;
    const from = Math.round((view.y1 + view.y2) / 2);
    await t.swipePx(edge, from, edge, down ? from - 350 : from + 350, 900);
  }
  const last = t.nodeByTestId(testID);
  if (last == null) t.log.abort(`no "${testID}" on the ContextMenu screen`);
  return last.bounds;
}

/** @param {ReturnType<typeof makeContext>} t */
async function contextTop(t) {
  const edge = t.displayWidth() - 8;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if ((contextEcho(t).scrollY ?? 0) <= 0) return;
    const view = t.nodeByTestId('ctx-scroll')?.bounds;
    if (view == null) return;
    const from = Math.round(view.y1 + (view.y2 - view.y1) * 0.3);
    await t.swipePx(edge, from, edge, from + 700, 300);
    await sleep(500);
  }
}

/** @param {ReturnType<typeof makeContext>} t */
async function contextReset(t) {
  await contextClose(t);
  await contextTop(t);
  await t.tapTestId('ctx-reset');
  await contextEchoWhen(t, (echo) => echo.press === 0 && echo.opens === 0);
}

function dayGrid(t, description) {
  const cells = t.waitForNodes(
    isDayCell,
    `${description}'s dialog to open with a month grid`,
    14
  );
  // Reading order, so the middle of the list is the middle of the month: furthest
  // from the 1st, the 30th and today, which are the days a picker may be showing.
  return cells.sort(
    (a, b) => a.bounds.y1 - b.bounds.y1 || a.bounds.x1 - b.bounds.x1
  );
}

/**
 * A day cell of Material 3's calendar: clickable, square, and named with a date
 * that carries its year.
 *
 * @param {import('./uiautomator.mjs').UiautomatorNode} node
 */
function isDayCell(node) {
  const { width, height } = node.bounds;
  return (
    node.clickable === 'true' &&
    node.enabled === 'true' &&
    width >= 24 &&
    Math.abs(width - height) <= 4 &&
    /\d{4}/.test(`${node.text} ${node.contentDesc}`)
  );
}

/**
 * The dialog's Cancel affordance, labelled the way `android.R.string.cancel` labels it.
 *
 * The alternatives are what other Android builds say for the same button, so the check
 * does not hinge on one locale — the same reason `isConfirmLabel` lists four words.
 *
 * @param {import('./uiautomator.mjs').UiautomatorNode} node
 */
function isCancelLabel(node) {
  return /^(Cancel|Close|Dismiss|Back)$/.test(node.text.trim());
}

/**
 * The drums of a time wheel, as the accessibility tree shows them. A drum’s rows are
 * plain `Text` nodes when the dump carries them at all, which is enough to aim a fling
 * at the column’s own x and to read which row the drum stopped on.
 *
 * Columns are found by clustering on x, not by dividing the box: rows of one drum share
 * an x exactly, so a gap of more than 20 px is a different column — a 12-hour wheel
 * keeps an AM/PM column to the right of the two drums.
 *
 * @param {ReturnType<typeof makeContext>} t
 * @param {import('./uiautomator.mjs').UiautomatorNode} drum the wheel’s own node
 */
function timeWheelColumns(t, drum) {
  const rows = t
    .dump()
    .filter(
      (node) =>
        /^\d{1,2}$/.test(node.text.trim()) &&
        node.bounds.cx >= drum.bounds.x1 &&
        node.bounds.cx <= drum.bounds.x2 &&
        node.bounds.cy >= drum.bounds.y1 &&
        node.bounds.cy <= drum.bounds.y2
    )
    .sort((a, b) => a.bounds.cx - b.bounds.cx);
  /** @type {Array<typeof rows>} */
  const columns = [];
  for (const row of rows) {
    const previous = columns.at(-1);
    if (previous != null && row.bounds.cx - previous.at(-1).bounds.cx <= 20) {
      previous.push(row);
    } else {
      columns.push([row]);
    }
  }
  return columns.map((column) => ({
    x: Math.round(
      column.reduce((sum, node) => sum + node.bounds.cx, 0) / column.length
    ),
    // The row a person reads as the value: the one whose centre is nearest the middle
    // of the drum, which is where `ScrollField`'s selection line is.
    centre: column.reduce((best, node) =>
      Math.abs(node.bounds.cy - drum.bounds.cy) <
      Math.abs(best.bounds.cy - drum.bounds.cy)
        ? node
        : best
    ),
    count: column.length,
    pitch:
      column.length > 1
        ? Math.round(
            (column.at(-1).bounds.cy - column[0].bounds.cy) /
              (column.length - 1)
          )
        : 0,
  }));
}

/**
 * Bring a whole drum into the window, with the echo rows beside it.
 *
 * `requireControlOnScreen` stops when a centre is inside the window, and a drum is
 * 315-525 px of this device’s ~2 000 px, so half of it can hang off the bottom edge,
 * where the row under the centre line is not in the dump and a swipe that leaves the
 * window drags the page instead of the drum. The band is centred, not nudged to the
 * nearest edge, so a correction has room in either direction.
 *
 * @param {ReturnType<typeof makeContext>} t
 * @param {string} label the drum’s `accessibilityLabel`
 * @param {string[]} echoIds testIDs that have to be visible with it
 */
async function positionWheel(t, label, echoIds) {
  const screen = t.screenSize();
  // The usable band is not the whole window: the example app's tab bar sits over the
  // bottom of it and its header over the top, and a node under either keeps real bounds
  // in the dump while a finger there would press the bar instead. 12 % / 14 % of the
  // window is comfortably more than either on this device's profile.
  const bandTop = Math.round(screen.height * 0.12);
  const bandBottom = Math.round(screen.height * 0.86);
  // Reach it first, and in both directions. `requireControlOnScreen` scrolls six times
  // from wherever the page happens to be and then gives up naming what it never found,
  // which is the wrong instrument for a control at either end of a page as long as
  // these two screens are — the wheel fixtures sit below everything the earlier checks
  // read, so the page arrives at them from above, and a control that has slid past is
  // not a control that has gone away.
  const found = () => t.nodesNamed(label).length > 0;
  for (const direction of [1, -1]) {
    for (let attempt = 0; attempt < 12 && !found(); attempt += 1) {
      await t.scrollPage(direction * 700);
    }
    if (found()) {
      break;
    }
  }
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const drum = t.requireControl(label);
    const echoes = echoIds
      .map((id) => t.nodeByTestId(id))
      .filter((node) => node != null);
    const top = Math.min(drum.bounds.y1, ...echoes.map((n) => n.bounds.y1));
    const bottom = Math.max(drum.bounds.y2, ...echoes.map((n) => n.bounds.y2));
    if (
      echoes.length === echoIds.length &&
      top >= bandTop &&
      bottom <= bandBottom
    ) {
      return drum;
    }
    await t.scrollPage(
      Math.max(
        -700,
        Math.min(700, Math.round((top + bottom) / 2 - screen.height / 2))
      )
    );
  }
  return t.requireControl(label);
}

/**
 * Bring a control’s centre to the middle of the window, and hand back its node there.
 *
 * A check about to open a window the platform places for itself cannot use a control
 * found anywhere in the window: Material opens above an anchor when there is no room
 * under it, so wherever the previous check left the page would decide where the menu
 * appears. A box is handed back only once a second read agrees, since a dump taken
 * while the list is coasting names a box the tap would miss.
 *
 * @param {ReturnType<typeof makeContext>} t
 * @param {string} label the control’s `accessibilityLabel`
 * @returns {{ node: import('./uiautomator.mjs').UiautomatorNode, centred: boolean,
 *   offCentre: number }} the control, whether it came to rest in the band, and how many px
 *   off the middle its centre was when this gave up or settled
 */
function timeWheelDrums(t, control) {
  const found = ['Select hour', 'Select minutes'].map((description) =>
    t
      .dump()
      .find(
        (node) =>
          node.contentDesc === description &&
          node.bounds.cx >= control.bounds.x1 &&
          node.bounds.cx <= control.bounds.x2 &&
          node.bounds.cy >= control.bounds.y1 &&
          node.bounds.cy <= control.bounds.y2
      )
  );
  return found.every((node) => node != null)
    ? /** @type {any} */ (found)
    : null;
}

/**
 * [timeWheelColumns] with a fallback for a drum whose rows the tree does not carry.
 *
 * When the dump can see the rows, the row under the centre line is the strongest
 * oracle available for “the value shown is the value reported”. When it cannot, the
 * fling still has an aim and the event-count assertions still mean what they say, so
 * what is lost is the row comparisons — said to be lost, not skipped quietly.
 *
 * @param {ReturnType<typeof makeContext>} t
 * @param {import('./uiautomator.mjs').UiautomatorNode} drum
 */
function wheelColumns(t, drum) {
  const columns = timeWheelColumns(t, drum);
  if (columns.length >= 2) {
    return columns;
  }
  // No rows to cluster on: aim at the drums' own boxes when the tree names them, and
  // only then at the thirds, which are a guess about Material's layout rather than a
  // reading of it.
  const drums = timeWheelDrums(t, drum);
  return [0, 1].map((index) => ({
    x:
      drums != null
        ? drums[index].bounds.cx
        : Math.round(
            drum.bounds.x1 + drum.bounds.width * (index === 0 ? 1 / 6 : 1 / 2)
          ),
    centre: { text: '' },
    count: 0,
    pitch: Math.round(40 * t.density()),
    synthetic: true,
  }));
}

/**
 * The two `variant="wheel"` drums, rolled with a finger: a drum presses nothing, so
 * what a roll is worth asserting is how many events it costs.
 */
async function checkTimeDrums(t) {
  // A drum per field, and a pick is a roll that comes to rest. `ScrollField` names the
  // row nearest its snap line continuously, so a control that read each of those as a
  // pick would report one event per row crossed, on the real input path.
  const SEEDED = '2024-06-15 09:20';
  // Not `requireControlOnScreen`: a 200 dp drum is 525 px of a ~2 000 px window, so
  // "the centre is on screen" can still mean "the snap line and half the rows are
  // not", which would make both the row reading and the fling below wrong.
  const wheel = await positionWheel(t, 'Real-input wheel time picker', [
    ECHO.wheelTimeValue,
    ECHO.wheelTimeEvents,
  ]);
  // The echo is empty, and that is the assertion: this picker is uncontrolled, so
  // what it shows is its own business and what it has *reported* is the echo's. The
  // seeded 09:20 is what the drums are on, and a `ScrollField` keeps its rows out of
  // the accessibility tree, so the check learns the roll moved the time from the two
  // echoes below rather than from a row it cannot read.
  t.log.checkEquals(
    'the uncontrolled wheel has reported no time yet',
    t.requireEcho(ECHO.wheelTimeValue),
    '-'
  );
  t.log.checkEquals(
    'and has reported no change',
    t.requireEcho(ECHO.wheelTimeEvents),
    '0'
  );
  const density = t.density();
  t.log.note(
    `time wheel box: ${t.boundsText(wheel)} at ${String(density)} x = ` +
      `${String(Math.round(wheel.bounds.height / density))} dp tall, ` +
      `${String(Math.round(wheel.bounds.width / density))} dp wide`
  );

  // What TalkBack is offered, read out of the tree it navigates. The value itself travels
  // as `stateDescription`, which a `uiautomator dump` does not transcribe, so this records
  // the node’s class, its name and whether it says it scrolls.
  const wheelNodes = t.nodesNamed('Real-input wheel time picker');
  // The assertion is that the wheel is named at all - zero is the failure this can
  // catch, and does if `nuiControlSemantics` is dropped. How many nodes end up
  // carrying the name is the widget's decision, not ours: each drum publishes semantics of
  // its own (the column's name and its rows), so a name that lands on the control can also
  // land on a drum. Recorded rather than asserted, and raised as the a11y finding it is - a
  // reader that meets the label twice hears it twice.
  t.log.check(
    `the wheel is named in the tree (${String(wheelNodes.length)} node(s) carry ` +
      '"Real-input wheel time picker")',
    wheelNodes.length >= 1
  );
  if (wheelNodes.length > 1) {
    t.log.warn(
      `the label is on ${String(wheelNodes.length)} nodes, not one: a screen ` +
        'reader meets "Real-input wheel time picker" once per node. The two drums ' +
        'themselves are not separately named, so which drum is which is not said ' +
        'either.'
    );
  }
  t.log.note(
    `wheel a11y node: class=${String(wheelNodes[0]?.className)} ` +
      `enabled=${String(wheelNodes[0]?.enabled)} ` +
      `scrollable=${String(wheelNodes[0]?.scrollable)} ` +
      `content-desc=${String(wheelNodes[0]?.contentDesc)}`
  );

  // Material's own names for the two drums, read out of the tree the check aims with.
  // This is a real assertion because it is the aim: without it the fling below would be
  // pointed at a fraction of the control's box, and a miss would look like a control that
  // does not roll.
  const drums = timeWheelDrums(t, wheel);
  t.log.check(
    'the tree names both drums, so each fling can be aimed at one of them',
    drums != null
  );
  if (drums != null) {
    t.log.note(
      `hour drum ${t.boundsText(drums[0])} (${String(
        Math.round(drums[0].bounds.width / density)
      )} x ` +
        `${String(Math.round(drums[0].bounds.height / density))} dp), minute drum ` +
        `${t.boundsText(drums[1])} - ${String(
          Math.round(drums[1].bounds.x1 - drums[0].bounds.x2)
        )} px apart`
    );
  }

  const columnsBefore = wheelColumns(t, wheel);
  const rowsReadable = columnsBefore[0]?.synthetic !== true;
  if (rowsReadable) {
    t.log.check(
      `the drum rows are in the tree (${String(columnsBefore.length)} columns: ` +
        `${columnsBefore.map((c) => String(c.count)).join('+')} rows visible)`,
      true
    );
    t.log.note(
      `drums: hour column x=${String(columnsBefore[0].x)} ` +
        `centre="${columnsBefore[0].centre.text}" ` +
        `pitch=${String(columnsBefore[0].pitch)}px; minute column ` +
        `x=${String(columnsBefore[1].x)} ` +
        `centre="${columnsBefore[1].centre.text}" ` +
        `pitch=${String(columnsBefore[1].pitch)}px`
    );
  } else {
    t.log.warn(
      'the drum rows are NOT in the accessibility tree - `ScrollField` keeps its ' +
        "rows to itself, so the aim is the control's own thirds and the four " +
        '"the row shown is the value reported" comparisons below cannot be made ' +
        'from a dump; the event-count assertions can, and are the point of the flings.'
    );
  }
  /** Re-read a drum's columns, with the same fallback every time. */
  const columnsOf = (drum) => wheelColumns(t, drum);

  // Roll one drum downwards, into the hours/minutes before the seeded 09:20 — the
  // direction that cannot cross noon and so cannot change the AM/PM half of a 12-hour
  // drum. Three rows of pitch: far enough that a per-row emit is loud, short enough to
  // stay inside the drum’s own rows. `drum` is re-read every time, because the page
  // settles after a fling.
  const rollDown = async (drumLabel, column) => {
    const box = t.requireControl(drumLabel).bounds;
    // The drum’s own box with a 12 % margin at each end, top to bottom, in 130 ms — the
    // shape the Picker’s drum fling uses. The aim is [timeWheelDrums]’s box, not a fraction
    // of the control’s, so a drum that does not turn under this is the control’s problem
    // and not the check’s aim. Where the tree does show rows the travel shrinks to three
    // rows of the measured pitch, so the row comparisons are about a roll a reader can count.
    const pad = Math.round(box.height * 0.12);
    const travel = rowsReadable
      ? Math.min(
          Math.round(column.pitch * 1.5),
          Math.round(box.height / 2) - pad
        )
      : null;
    await t.swipePx(
      column.x,
      travel == null ? box.y1 + pad : Math.round(box.cy - travel),
      column.x,
      travel == null ? box.y2 - pad : Math.round(box.cy + travel),
      130
    );
  };

  // Exactly one event, then a quiet period: an event landing after the quiet window
  // is one that landed after a rest, which is what the settle is supposed to prevent.
  const expectOneRoll = (expected, label, echoId) => {
    const reported = t.echoWithin(echoId, (value) => value === expected, 8000);
    t.log.checkEquals(
      `one roll of the ${label} reports exactly one change, not one per row crossed`,
      reported,
      expected
    );
    t.requireEchoToStay(echoId, expected, `the ${label} drum at rest`, 1500);
  };

  await rollDown('Real-input wheel time picker', columnsBefore[0]);
  expectOneRoll('1', 'hour', ECHO.wheelTimeEvents);
  const afterHour = t.requireEcho(ECHO.wheelTimeValue);
  t.log.checkEquals(
    `the hour moved off the seeded one ("${afterHour}")`,
    afterHour.slice(11, 13) !== SEEDED.slice(11, 13),
    true
  );
  t.log.checkEquals(
    'and rolling the hour left the day alone',
    afterHour.slice(0, 10),
    SEEDED.slice(0, 10)
  );
  // The value shown is the value reported. Read out of the tree the person's finger
  // stopped: the row now under the hour drum's centre line, which in a 12-hour wheel
  // is the 12-hour form of the hour JS was told - hence the modulo, with the
  // AM/PM half recorded beside it rather than asserted.
  if (rowsReadable) {
    const hourColumn = columnsOf(wheel)[0];
    t.log.checkEquals(
      `the row under the hour drum's centre line is the hour reported ` +
        `(drum "${hourColumn.centre.text}", reported ${afterHour})`,
      Number(hourColumn.centre.text) % 12,
      Number(afterHour.slice(11, 13)) % 12
    );
  }
  // Which half of the day a wheel is in is read twice: from the AM/PM column's own node
  // (the drum is named by the two values it holds), and from any AM/PM row the dump happens
  // to carry. Reading only the rows would call a 12-hour wheel 24-hour on a tree that
  // publishes no rows at all — and the modulo below would then look like a bug rather than
  // as what a 12-hour row cannot say on its own.
  const periodDrum = t
    .dump()
    .find(
      (node) =>
        /^(AM|PM)\/(AM|PM)$/.test(node.contentDesc.trim()) &&
        node.bounds.cx >= wheel.bounds.x1 &&
        node.bounds.cx <= wheel.bounds.x2
    );
  const period = periodDrum
    ? periodDrum.contentDesc.trim().split('/')
    : t
        .dump()
        .filter(
          (node) =>
            /^(AM|PM)$/i.test(node.text.trim()) &&
            node.bounds.cx >= wheel.bounds.x1 &&
            node.bounds.cx <= wheel.bounds.x2
        )
        .map((node) => node.text.trim());
  t.log.note(
    period.length > 0
      ? `the wheel is a 12-hour one (${period.join('/')} column): the assertion ` +
          'above compares the row with the reported hour modulo 12, and the half the ' +
          'row does not carry is the reported day part, which was checked unchanged'
      : 'the wheel is a 24-hour one, so the row is the reported hour itself'
  );

  // Two more rolls of the same drum. Every roll is aimed at the hour column and rolls
  // *downwards*, into the hours before the seeded one: the minute drum's x is a guess
  // this tree cannot check (its rows are not in the dump), and a swipe that lands on
  // the AM/PM toggle instead would move the hour by twelve and make the assertion
  // below about the wrong thing. Downwards also cannot cross noon, so no roll of this
  // check changes the half of the day the wheel is in.
  let previous = afterHour;
  for (const [expected, label] of [
    ['2', 'second'],
    ['3', 'third'],
  ]) {
    await rollDown('Real-input wheel time picker', columnsBefore[0]);
    expectOneRoll(expected, `${label} hour roll`, ECHO.wheelTimeEvents);
    const after = t.requireEcho(ECHO.wheelTimeValue);
    t.log.checkEquals(
      `the ${label} roll moved the time again ("${previous}" → "${after}")`,
      after !== previous,
      true
    );
    t.log.checkEquals(
      `and the ${label} roll left the day the time picker was seeded on`,
      after.slice(0, 10),
      SEEDED.slice(0, 10)
    );
    previous = after;
  }

  // The drum whose parent refuses every roll. On the dial a refused pick is a value the
  // model never had; a drum stays where the finger left it, so the snap-back has to reach
  // the pager — and a drum left on the refused row would also swallow the next pick of
  // that same time. Both halves are checked: the roll is reported, and the rows in the
  // tree are back on the seeded time.
  const refusedLabel = 'Real-input wheel refusing picker';
  const refused = await positionWheel(t, refusedLabel, [
    ECHO.wheelRefuseEvents,
  ]);
  const refusedBefore = columnsOf(refused);
  if (rowsReadable) {
    t.log.checkEquals(
      'the refusing drum starts on the time its parent holds',
      Number(refusedBefore[0].centre.text) % 12,
      9
    );
  }
  t.log.checkEquals(
    'and has reported nothing',
    t.requireEcho(ECHO.wheelRefuseEvents),
    '0'
  );
  await rollDown(refusedLabel, refusedBefore[0]);
  expectOneRoll('1', 'refusing drum', ECHO.wheelRefuseEvents);
  // The rollback, read where a person reads it. One settle, then the parent's no,
  // then the widget's own road home — so give it a beat before the tree is asked.
  // The beat is also an assertion: the rollback must not itself be an event, or the
  // snap-back would loop — settle, report, revert, settle, report.
  t.requireEchoToStay(
    ECHO.wheelRefuseEvents,
    '1',
    'the refused roll, rolled back',
    1500
  );
  if (rowsReadable) {
    const refusedAfter = columnsOf(refused);
    t.log.checkEquals(
      `the refused roll left the hour drum on the parent's hour, not the rolled ` +
        `one (row "${refusedAfter[0].centre.text}")`,
      Number(refusedAfter[0].centre.text) % 12,
      9
    );
  }
  // And the reason that matters: with the drum back where it started, the same roll
  // is a fresh selection again rather than the instant the model already holds.
  await rollDown(refusedLabel, columnsOf(refused)[0]);
  expectOneRoll('2', 'refusing drum, second roll', ECHO.wheelRefuseEvents);
  t.log.checkEquals(
    'the parent still refuses, so the time it sends never moved',
    t.requireEcho(ECHO.wheelRefuseEvents),
    '2'
  );

  // `mode="date"` with the same variant is *not* a drum: there is no Material date
  // wheel, so the variant keeps the inline calendar (documented). The box says it -
  // a calendar is far taller than a 200 dp drum, and a drum 58 dp wide is not a grid.
  const dateWheel = await positionWheel(t, 'Real-input wheel date picker', []);
  const dateHeightDp = Math.round(dateWheel.bounds.height / density);
  const drumHeightDp = Math.round(wheel.bounds.height / density);
  t.log.note(
    `wheel + mode="date" box: ${t.boundsText(dateWheel)} = ` +
      `${String(dateHeightDp)} dp tall, against the time wheel's ` +
      `${String(drumHeightDp)} dp`
  );
  t.log.check(
    `the "wheel" that is a calendar is unmistakably a calendar ` +
      `(${String(dateHeightDp)} dp tall, more than the drum's ` +
      `${String(drumHeightDp)} dp plus a week of rows)`,
    dateHeightDp > drumHeightDp + 100
  );
}

/**
 * The two inline calendars whose grid the box is supposed to decide, both measured.
 *
 * An `inline` picker is a `fillWidth` control, so `measureContent()` answers the box’s
 * width whether or not the calendar fits inside it, and the dump is the only thing that
 * can see the columns.
 *
 * Two fixtures, because the control decides rather than applying one size: a 320 dp box
 * too narrow for Material’s 48 dp grid, and a calendar stretched past 360 dp.
 *
 * @param {ReturnType<typeof makeContext>} t
 */
async function checkInlineCalendarGrids(t) {
  const density = t.density();

  /** The two rows `DatePickerScreen` draws for this, and what each box should produce. */
  const wanted = [
    { label: 'Wide inline calendar', wide: true, grid: null, box: null },
    { label: 'Narrow inline calendar', wide: false, grid: null, box: null },
  ];
  let namedWithNoBox = 0;

  // The search is for a measurable grid, not merely for a control’s name: Compose keeps
  // naming a scrolled-past node with `bounds=[0,0][0,0]`, and the header row is ~470 px
  // below the top of a 1344 px calendar, so a box clipped to the bottom of the screen has
  // no header in it.
  for (
    let attempt = 0;
    attempt < 12 && wanted.some((want) => want.grid == null);
    attempt += 1
  ) {
    const tree = t.dump();
    for (const want of wanted) {
      if (want.grid != null) {
        continue;
      }
      const node = tree.find(
        (candidate) => candidate.contentDesc === want.label
      );
      if (node == null) {
        continue;
      }
      if (node.bounds.width <= 0 || node.bounds.height <= 0) {
        namedWithNoBox += 1;
        continue;
      }
      const grid = measureCalendarGrid(tree, node.bounds, density);
      if (grid != null) {
        want.grid = grid;
        want.box = node.bounds;
      }
    }
    if (wanted.some((want) => want.grid == null)) {
      await t.scrollPage(600);
    }
  }

  if (namedWithNoBox > 0) {
    t.log.note(
      `an inline calendar was named with a zero-sized box ${String(namedWithNoBox)} ` +
        'time before its columns came on screen'
    );
  }

  for (const want of wanted) {
    if (want.grid == null) {
      t.log.abort(
        `"${want.label}" never showed a weekday header row, scrolling to the end of ` +
          'the page - the calendar is either not laid out at all or is drawn without one'
      );
    }
    const widthDp = (want.box.x2 - want.box.x1) / density;
    const expectedDp = expectedColumnDp(widthDp);
    // The premise of each row, asserted rather than assumed: a fixture that quietly
    // stopped being wide (or narrow) would still be *measurable*, and the rule below
    // would then measure it against the other row's floor and agree with whatever the
    // control did. `wideBox`'s negative margins are what make one row wide at all.
    t.log.check(
      `"${want.label}" is laid out in a ${widthDp.toFixed(0)} dp box, ` +
        `${want.wide ? 'at' : 'under'} the ${String(CALENDAR_WIDE_MIN_DP)} dp ` +
        'width that decides the touch target',
      want.wide
        ? widthDp >= CALENDAR_WIDE_MIN_DP
        : widthDp < CALENDAR_WIDE_MIN_DP
    );
    const problems = calendarGridProblems(want.grid, {
      minColumnDp: expectedDp,
    });
    t.log.check(
      `the ${widthDp.toFixed(0)} dp inline calendar lays a whole week out on ` +
        `${String(expectedDp)} dp targets: ${want.grid.detail} ` +
        `(narrowest ${want.grid.minWidthDp.toFixed(1)} dp)` +
        `${problems.length === 0 ? '' : ` - ${problems.join('; ')}`}`,
      problems.length === 0
    );
  }
}

/**
 * Wait for a dialog's month grid to leave the accessibility tree.
 *
 * This is what "the dialog is closed" means on Android for this control: a `Dialog` is
 * not a `Pop-Up Window`, so `popupWindowCount()` stays 0 whether the dialog leaked or
 * not, and the app's own text is unreadable while it is up. The grid going away is the
 * reading that survives both.
 *
 * @param {ReturnType<typeof makeContext>} t
 * @param {string} description what to name in the failure line
 */
async function waitForDialogGone(t, description) {
  const deadline = Date.now() + REACT_TIMEOUT;
  for (;;) {
    if (t.dump().filter(isDayCell).length === 0) {
      return;
    }
    if (Date.now() > deadline) {
      t.log.abort(`timed out waiting for ${description}`);
    }
    await t.settle(250);
  }
}

/* --------------------------------------------------------------------------- *
 * The checks. Each is the one this gate made before the e2e suite existed, on the
 * screen named in `controls.mjs`, with the parts the suite already covers left out.
 * --------------------------------------------------------------------------- */

/** The scroll that must not open a menu, and the hold that must. */
async function contextMenuChecks(t) {
  const { log } = t;
  await contextReset(t);
  const target = t.nodeByTestId('ctx-target')?.bounds;
  if (target == null) log.abort('no ctx-target on the ContextMenu screen');

  // 1. Hold, then drag in the same gesture: the menu is up and the page stays still.
  //    Back closes it.
  {
    const from = pointIn(target, 0.4, 0.5);
    const before = contextEcho(t);
    await t.holdThenDrag(from.x, from.y, -400);
    const popup = await contextPopupWithin(t, 2000);
    log.check('a hold then a drag opens the menu', popup != null);
    await t.pressBack();
    t.waitForPopupCount(0, 'Back to close the menu');
    const after = await contextEchoWhen(
      t,
      (e) => e.closes === before.closes + 1
    );
    log.checkEquals(
      'and the page under it did not move (scrollY)',
      after.scrollY,
      before.scrollY
    );
    log.checkEquals(
      'Back closes it, reported once',
      after.closes - before.closes,
      1
    );
  }

  // 2. An accessible ContextMenu is long-clickable: what TalkBack offers its
  //    double-tap-and-hold on.
  {
    await contextReveal(t, 'ctx-accessible');
    const named = t
      .dump()
      .find((node) => node.contentDesc === 'Message from Grace');
    log.checkEquals('it is long-clickable', named?.longClickable, 'true');
    log.checkEquals('and focusable', named?.focusable, 'true');
    // A long-clickable node is an actionable stop, so a menu that is not `accessible`
    // has to offer none: it would otherwise read its own Text as a stop the app never
    // asked for.
    const plain = t.nodeByTestId('ctx-bottom');
    log.checkEquals(
      'a ContextMenu that is not accessible offers TalkBack no long-click',
      plain?.longClickable,
      'false'
    );
    log.checkEquals('and is not focusable', plain?.focusable, 'false');
  }
}

/** The two wheels of a `variant="wheel"` time picker, and the inline calendars. */
async function datePickerChecks(t) {
  // The grids first, and not for the sake of the grids: the drum sits below them on a
  // page so long that `positionWheel`'s own swipes cannot travel it from the top — at
  // that point the right-hand strip it aims at is calendar, not page. The grid search
  // arrives there, and the wheel check goes on from where it left the page.
  await checkInlineCalendarGrids(t);
  await checkTimeDrums(t);
}

/** The hosted dialog's two dismissals: Back and Cancel. */
async function hostedDatePickerChecks(t) {
  // `HostScreen` seeds the popup Host's DatePicker at 2026-05-17 and echoes what JS
  // holds. Written by hand rather than formatted, so no locale moves the assertion.
  const SEEDED = '2026-05-17';
  await t.tapUntilUp(
    () => t.requireControlOnScreen('Hosted date picker'),
    'a real tap on the hosted DatePicker field to open its dialog',
    () => t.dump().filter(isDayCell).length,
    { pollMs: DUMP_POLL_MS }
  );
  dayGrid(t, 'the hosted DatePicker');
  await t.pressBack();
  await waitForDialogGone(t, 'the back gesture to take the hosted dialog down');
  t.log.checkEquals(
    'Back closes the hosted dialog and reports no day',
    t.requireEcho(ECHO.hostDateValue),
    SEEDED
  );
  t.log.check(
    'and the app text is readable again once the dialog is gone',
    t.nodeByTestId(ECHO.hostDateValue) != null
  );
  // 3b. Cancel: closes it and reports nothing. The witness is the grid leaving.
  await t.tapUntilUp(
    () => t.requireControlOnScreen('Hosted date picker'),
    'a real tap on the hosted DatePicker field to open its dialog again',
    () => t.dump().filter(isDayCell).length,
    { pollMs: DUMP_POLL_MS }
  );
  dayGrid(t, 'the hosted DatePicker');
  await t.pressUntil({
    what: "the dialog's Cancel button",
    waitingFor: 'a real tap on Cancel to take the hosted dialog down',
    press: async () => {
      await t.tapNode(
        t.waitForNodes(isCancelLabel, "the dialog's Cancel button", 1)[0]
      );
    },
    reading: () => String(t.dump().filter(isDayCell).length),
    raised: (current) => current === '0',
    pollMs: DUMP_POLL_MS,
  });
  await waitForDialogGone(t, 'Cancel to take the hosted dialog down');
  t.log.checkEquals(
    'Cancel closes the hosted dialog and reports no day',
    t.requireEcho(ECHO.hostDateValue),
    SEEDED
  );
}

/** A hosted Progress's width, beside the Slider in the same Host. */
async function hostedMixedChecks(t) {
  // All five children have to be read in one breath, so the scroll goes to the last of
  // them first: `uiautomator dump` lists nothing off screen.
  await t.requireControlOnScreen('Mixed button');
  const tree = t.dump();
  const nodeNamed = (name) => tree.find((entry) => entry.contentDesc === name);
  const widthOf = (name) => {
    const node = nodeNamed(name);
    return node == null ? 0 : node.bounds.width;
  };
  const linear = widthOf('Mixed linear progress');
  const circular = widthOf('Mixed circular progress');
  const slider = widthOf('Mixed slider');
  const switcher = widthOf('Mixed switch');
  t.log.note(
    `widths in px - slider=${String(slider)}, bar=${String(
      linear
    )}, indicator=${String(circular)}, switch=${String(switcher)}`
  );
  // Both linear controls fill the Host, so they agree with each other; both
  // intrinsic ones keep their own width, so they are much narrower than the Host.
  t.log.check(
    `the linear bar is as wide as the Slider (${String(linear)} vs ${String(
      slider
    )})`,
    Math.abs(linear - slider) <= Math.max(8, linear * 0.05)
  );
  t.log.check(
    `the circular indicator keeps its own width (${String(
      circular
    )} vs ${String(linear)})`,
    circular > 0 && circular * 3 < linear
  );
  t.log.check(
    `the Switch keeps its own width too (${String(
      switcher
    )} vs ${String(linear)})`,
    switcher > 0 && switcher * 3 < linear
  );
  const indicator = nodeNamed('Mixed circular progress');
  t.log.check(
    `the indicator is drawn as a square, not stretched across the Host (${
      indicator == null
        ? 'no node'
        : `${String(indicator.bounds.width)} x ${String(
            indicator.bounds.height
          )}`
    })`,
    indicator != null &&
      Math.abs(indicator.bounds.width - indicator.bounds.height) <= 8
  );
}

/** `enabled` on the node a tap lands on, not on the label's own node. */
async function dialogChecks(t) {
  // The titles `DialogScreen` gives its dialogs. None appears anywhere else on the
  // screen, so a text match names one window: `Locked action` and `Locked share` are
  // the disabled ones. A Compose `Dialog` (and a `ModalBottomSheet`, which is one)
  // is a window of its own that is not a `Pop-Up Window`, and while it is up
  // `uiautomator dump` returns its tree rather than the app's - so the echo is read
  // only with every dialog down, and "up" is read as the dialog's own title.
  const ALERT = 'Delete the draft?';
  const upCount = (text) => () =>
    t.dump().filter((node) => node.text === text).length;
  const opener = (testID) => () => {
    const node = t.nodeByTestId(testID);
    if (node == null) {
      t.log.abort(`no opener with testID "${testID}" on the Dialogs screen`);
    }
    return node;
  };
  const open = async (testID, witness, description) => {
    await t.tapUntilUp(opener(testID), description, upCount(witness), {
      pollMs: DUMP_POLL_MS,
    });
    t.waitForOption(witness, description);
  };
  // The node a person acts on is not the label's own: measured on this screen, each
  // action is a clickable `View` whose child `TextView` carries the text, and that
  // child reads `enabled="true"` whatever the action is (a disabled one's `View` reads
  // `enabled="false" focusable="false"`). So this reads the innermost clickable node
  // that contains the label's centre - the one TalkBack stops on and a tap lands on.
  const actionNodeOf = (text) => {
    const nodes = t.dump();
    const label = nodes.find((node) => node.text === text);
    if (label == null) return undefined;
    const { cx, cy } = label.bounds;
    return nodes
      .filter(
        (node) =>
          node.clickable === 'true' &&
          node.bounds.x1 <= cx &&
          cx <= node.bounds.x2 &&
          node.bounds.y1 <= cy &&
          cy <= node.bounds.y2
      )
      .sort(
        (a, b) =>
          a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height
      )[0];
  };
  const enabledOf = (text) => actionNodeOf(text)?.enabled;
  // 2. A real tap opens the alert; JS opened it, so it reports nothing (read once
  //    it is down again, in step 5's whole-log comparison).
  await open('dialog-open-alert', ALERT, 'the real tap that opens the alert');
  // 3. The disabled action is disabled in the accessibility tree too, and its twin
  //    is not. The text node sits inside the button Compose merges it into, so the
  //    node's own `enabled` is the button's.
  t.log.checkEquals(
    'a disabled action is a node that is not enabled',
    enabledOf('Locked action'),
    'false'
  );
  t.log.checkEquals(
    'and an ordinary action is enabled',
    enabledOf('Delete draft'),
    'true'
  );

  // 4. A real tap on the disabled action takes nothing and leaves the alert up. One
  //    press: the right outcome is silence; step 5 is its barrier.
  await t.tapNode(t.waitForOption('Locked action', 'the disabled action'));
  await t.settle(1500);
  t.log.checkEquals(
    'a real tap on a disabled action leaves the alert up',
    upCount(ALERT)(),
    1
  );
  const waitGone = async (text, description) => {
    const deadline = Date.now() + REACT_TIMEOUT;
    while (upCount(text)() > 0) {
      if (Date.now() > deadline) {
        t.log.abort(`timed out waiting for ${description}`);
      }
      await t.settle(250);
    }
  };

  // 5. The action that reports, before the close it causes.
  t.log.checkEquals(
    'a real tap on an action reports its id, then the close - once each, in order',
    await t.tapOptionUntilValue(
      'Delete draft',
      ECHO.dialogLog,
      'action:delete > presented:false',
      'the real tap on "Delete draft"'
    ),
    'action:delete > presented:false'
  );
  await waitGone(ALERT, 'the action to take the alert down');

  // 6. Back and a tap outside close a dismissible alert, and report the close alone.
  await open('dialog-open-alert', ALERT, 'the real tap that reopens the alert');
  await t.pressBack();
  await waitGone(ALERT, 'Back to take the dismissible alert down');
  await open('dialog-open-alert', ALERT, 'the real tap that opens it again');
  await t.tapScrim();
  await waitGone(ALERT, 'a tap outside to take the dismissible alert down');
  t.log.checkEquals(
    'Back and a tap outside each closed the alert with one close and no action',
    t.requireEcho(ECHO.dialogLog),
    'action:delete > presented:false > presented:false > presented:false'
  );
}

/** `checked` on the chip's own node, and `enabled` on a disabled one's. */
async function chipChecks(t) {
  const named = (label) => t.requireControl(label);

  // 1. On, then off.
  await t.tapUntilValue(
    () => named('Real-input chip'),
    ECHO.chipValue,
    'on',
    'the real tap that selects the chip',
    { nativeLabel: 'Real-input chip' }
  );
  t.log.checkEquals(
    'a second real tap deselects it (React renders "off")',
    await t.tapUntilValue(
      () => named('Real-input chip'),
      ECHO.chipValue,
      'off',
      'the real tap that deselects the chip',
      { nativeLabel: 'Real-input chip' }
    ),
    'off'
  );
  t.log.checkEquals(
    'two taps report two changes',
    t.requireEcho(ECHO.chipEvents),
    '2'
  );
  t.log.checkEquals(
    "the deselected chip's node stops saying it is checked",
    t.nativeChecked('Real-input chip'),
    'off'
  );
  // 3. The assist chip presses once per tap.
  t.log.checkEquals(
    'one real tap on the assist chip reaches onPress once',
    await t.tapUntilValue(
      () => named('Real-input assist chip'),
      ECHO.chipPresses,
      '1',
      'the real tap on the assist chip'
    ),
    '1'
  );

  // 4. Neither disabled chip takes a tap. Each is wired to its enabled twin's
  //    counter, so a stray delivery is a number that moved. Not retried: the claim
  //    is about a period in which nothing may move.
  const disabledFilter = named('Real-input disabled chip');
  // Read off the clickable touch target around the label, not the labelled node:
  // `nativeEnabled` says why (the labelled node reports enabled either way).
  t.log.checkEquals(
    'the disabled filter chip announces itself not enabled',
    t.nativeEnabled('Real-input disabled chip'),
    'false'
  );
  t.log.checkEquals(
    'the disabled assist chip announces itself not enabled',
    t.nativeEnabled('Real-input disabled assist chip'),
    'false'
  );
  t.log.checkEquals(
    'its enabled twin announces itself enabled (so the reads above can say true)',
    t.nativeEnabled('Real-input assist chip'),
    'true'
  );
  await t.tapNode(disabledFilter);
}

/** `checked` on the box's own node, through a real tap in both directions. */
async function checkboxChecks(t) {
  const named = (label) => t.requireControl(label);
  const BOX = 'Real-input checkbox';

  // 1. Before any touch: the two counters at rest, and the box's own state. The
  //    native read is the one a stale render cannot fake.
  t.log.checkEquals(
    'the checkbox has reported no change before a touch',
    t.requireEcho(ECHO.checkboxEvents),
    '0'
  );
  t.log.checkEquals(
    'the counter the disabled checkbox reports into starts at zero, so a stray ' +
      'delivery is a number that moved rather than a callback nobody saw',
    t.requireEcho(ECHO.checkboxDisabledEvents),
    '0'
  );
  t.log.checkEquals(
    'the box publishes a toggleable state, and it says unchecked',
    t.nativeChecked(BOX),
    'off'
  );
  // The raw flags of the node that carries the name, as evidence: the `class=`
  // Compose writes for `Role.Checkbox` has not been measured on a device the way the
  // Spinner class the Picker and Menu checks assert has, so it is recorded rather than
  // guessed at, the way the Menu's popup rows are. The toggle itself is asserted
  // above, where the reading is the library's own.
  for (const node of t.nodesNamed(BOX)) {
    t.log.note(
      `name node "${node.contentDesc}": checkable=${node.checkable} ` +
        `checked=${node.checked} enabled=${node.enabled} ` +
        `clickable=${node.clickable} class=${node.className}`
    );
  }

  // 2. Checked: one tap, one change, and the box agrees. Each tap is confirmed by the
  //    value it should produce before the next one is made (as in `switch`), and
  //    carries the box's own state as the witness that tells a dropped delivery from a
  //    lost change event.
  await t.tapUntilValue(
    () => named(BOX),
    ECHO.checkboxValue,
    'on',
    'the real tap that checks the box',
    { nativeLabel: BOX }
  );
  t.log.checkEquals(
    "the checked box's node says it is checked",
    t.nativeChecked(BOX),
    'on'
  );
  t.log.checkEquals(
    'one real tap reports one change',
    t.requireEcho(ECHO.checkboxEvents),
    '1'
  );

  // 3. Unchecked again. This is the assertion that catches a native box which only
  //    ever asks for `true`: the tap above would have lit the "on" echo all the same,
  //    so the echo back at "off", the node back at unchecked and the counter at
  //    exactly 2 are what say a second tap asked for `false`.
  t.log.checkEquals(
    'a second real tap unchecks it (React renders "off")',
    await t.tapUntilValue(
      () => named(BOX),
      ECHO.checkboxValue,
      'off',
      'the real tap that unchecks the box',
      { nativeLabel: BOX }
    ),
    'off'
  );
  t.log.checkEquals(
    'the unchecked box reports it back',
    t.nativeChecked(BOX),
    'off'
  );
}

/** `checked` on the toggle icon button's own node, through a real tap. */
async function iconButtonChecks(t) {
  const named = (label) => t.requireControl(label);
  const TOGGLE = 'Real-input toggle icon button';

  // 1. At rest. Every number is zero and the toggle's own node says unchecked, so
  //    each later assertion is about a number that moved and not about a screen
  //    that started mid-story.
  t.log.checkEquals(
    'the toggle starts off (React renders "off")',
    t.requireEcho(ECHO.iconButtonValue),
    'off'
  );
  t.log.checkEquals(
    'the toggle has reported no change before a touch',
    t.requireEcho(ECHO.iconButtonEvents),
    '0'
  );
  t.log.checkEquals(
    'the refusing toggle has been asked for nothing yet',
    `${t.requireEcho(ECHO.iconButtonRefusedLast)} ${t.requireEcho(
      ECHO.iconButtonRefusedEvents
    )}`,
    'none 0'
  );
  t.log.checkEquals(
    'the counter the disabled controls report into starts at zero, so a stray ' +
      'delivery is a number that moved rather than a callback nobody saw',
    t.requireEcho(ECHO.iconButtonDisabledEvents),
    '0'
  );
  // Both disabled forms have to refuse a real touch: a person only learns a control is
  // off when pressing it does nothing, and the two forms take input differently.
  for (const [form, label] of [
    ['press', 'Real-input disabled icon button'],
    ['toggle', 'Real-input disabled toggle icon button'],
  ]) {
    const inert = await t.requireControlOnScreen(label);
    for (let tap = 1; tap <= 3; tap += 1) {
      await t.tapNode(inert);
    }
    t.log.checkEquals(
      `three real taps on the disabled ${form} form report nothing`,
      t.requireEchoToStay(
        ECHO.iconButtonDisabledEvents,
        '0',
        `three real taps on the disabled ${form} form`
      ),
      '0'
    );
  }
  t.log.checkEquals(
    'the toggle publishes a toggleable state, and it says unchecked',
    t.nativeChecked(TOGGLE),
    'off'
  );

  // 2. Pressed twice: two reports, one per tap, and nothing else moved. The counter
  //    is asserted as an exact number rather than `atLeast`, which is the point — a
  //    press that fired twice per tap is the bug this row is for.
  const BOX = 'Real-input icon button';
  for (const count of ['1', '2']) {
    t.log.checkEquals(
      `real tap ${count} on the press button reports one onPress`,
      await t.tapUntilValue(
        () => named(BOX),
        ECHO.iconButtonPresses,
        count,
        `the real tap that makes press ${count}`
      ),
      count
    );
  }
  t.log.checkEquals(
    'two presses on the press button change no toggle: the value echo is where it started',
    t.requireEcho(ECHO.iconButtonValue),
    'off'
  );
  t.log.checkEquals(
    'and the toggle still reports no change',
    t.requireEcho(ECHO.iconButtonEvents),
    '0'
  );

  // 3. The toggle, once per direction. `nativeLabel` is passed because the node
  //    publishes its own state: without that witness a lost change event is
  //    exactly what a retry would turn green.
  t.log.checkEquals(
    'one real tap checks the toggle (React renders "on")',
    await t.tapUntilValue(
      () => named(TOGGLE),
      ECHO.iconButtonValue,
      'on',
      'the real tap that checks the toggle',
      { nativeLabel: TOGGLE }
    ),
    'on'
  );
  t.log.checkEquals(
    "the checked toggle's own node says it is checked",
    t.nativeChecked(TOGGLE),
    'on'
  );
  t.log.checkEquals(
    'one real tap reports one change',
    t.requireEcho(ECHO.iconButtonEvents),
    '1'
  );
  t.log.checkEquals(
    'a second real tap unchecks it (React renders "off")',
    await t.tapUntilValue(
      () => named(TOGGLE),
      ECHO.iconButtonValue,
      'off',
      'the real tap that unchecks the toggle',
      { nativeLabel: TOGGLE }
    ),
    'off'
  );
  t.log.checkEquals(
    'the unchecked toggle reports it back',
    t.nativeChecked(TOGGLE),
    'off'
  );
  t.log.checkEquals(
    'two taps report two changes, one per tap',
    t.requireEcho(ECHO.iconButtonEvents),
    '2'
  );
  t.log.checkEquals(
    'a tap on the toggle is not also a press: the press counter stayed at 2',
    t.requireEcho(ECHO.iconButtonPresses),
    '2'
  );
}

/** `checked` and `enabled` on a group item's own node, not its title's. */
async function buttonGroupChecks(t) {
  const TOGGLES = 'Real-input formatting toggles';
  const DISABLED_ITEM = 'Real-input group with a disabled item';
  const DISABLED_GROUP = 'Real-input disabled group';

  /**
   * The node a tap on one item has to be aimed at, or `null` when the group is not
   * drawing that item at all — the normal answer for an overflowed row.
   *
   * Both spellings of “name” are accepted, and the name is only where the search
   * starts: Material draws each item as its own box, a separate title and a role
   * decoration that carries no state, so taps, `checked` and `enabled` all come off
   * the item’s own node.
   *
   * @param {string} groupLabel the group’s `accessibilityLabel`
   * @param {string} title the item’s title
   */
  const itemOf = (groupLabel, title) => {
    const group = t.requireControl(groupLabel);
    const tree = t.dump();
    const named = tree.filter((node) => {
      const { bounds } = node;
      return (
        (node.text === title || node.contentDesc === title) &&
        bounds.width > 0 &&
        bounds.height > 0 &&
        bounds.x1 >= group.bounds.x1 - 1 &&
        bounds.y1 >= group.bounds.y1 - 1 &&
        bounds.x2 <= group.bounds.x2 + 1 &&
        bounds.y2 <= group.bounds.y2 + 1
      );
    });
    if (named.length === 0) {
      return null;
    }
    const control = tightestFlaggedNode(tree, named[0], 'clickable');
    if (control == null) {
      const { bounds } = named[0];
      t.log.abort(
        `group "${groupLabel}" draws the title "${title}" but no clickable node ` +
          `contains it — the name is on [${named[0].className}] at ` +
          `[${String(bounds.x1)},${String(bounds.y1)}]` +
          `[${String(bounds.x2)},${String(bounds.y2)}], so nothing here can be ` +
          'pressed, checked or disabled by a reader'
      );
    }
    return control;
  };

  /** Like {@link itemOf}, and aborts with the group and item named when absent. */
  const requireItem = (groupLabel, title) => {
    const node = itemOf(groupLabel, title);
    if (node == null) {
      t.log.abort(
        `group "${groupLabel}" draws no item titled "${title}" in its own box - ` +
          'the row either did not compose it or named it something else, so no ' +
          'real tap can be aimed at it'
      );
    }
    return node;
  };

  /**
   * Whether one item's own node publishes a checked state, as `"on"` / `"off"`.
   *
   * Read from the item node rather than through `nativeChecked`, which needs a
   * `contentDescription` to start from and an item drawn with its title has none —
   * and "which `Bold`?" is answered by geometry, not by a name four nodes share.
   * `itemOf` has already resolved that geometry, so a `null` here means the item is
   * drawn without a toggle state at all, which is the answer step 1 asserts against.
   */
  const itemChecked = (groupLabel, title) => {
    const node = itemOf(groupLabel, title);
    if (node == null || node.checkable !== 'true') {
      return null;
    }
    return node.checked === 'true' ? 'on' : 'off';
  };

  // 1. At rest: every counter at zero and the controlled toggles showing the set
  //    React gave them, so every number below is one that moved.
  t.log.checkEquals(
    'the toggles start at the set React rendered ("bold")',
    t.requireEcho(ECHO.buttonGroupToggleState),
    'bold'
  );
  t.log.checkEquals(
    'and have reported no change before a touch',
    t.requireEcho(ECHO.buttonGroupToggleEvents),
    '0'
  );
  t.log.checkEquals(
    'the refusing group has been asked for nothing yet',
    `${t.requireEcho(ECHO.buttonGroupRefusedLast)} ` +
      `${t.requireEcho(ECHO.buttonGroupRefusedEvents)}`,
    'none 0'
  );
  t.log.checkEquals(
    'the counter the disabled group and its disabled item report into starts at ' +
      'zero, so a stray delivery is a number that moved',
    t.requireEcho(ECHO.buttonGroupDisabledEvents),
    '0'
  );
  t.log.checkEquals(
    'the controlled toggle publishes a checkable state, and it says checked',
    itemChecked(TOGGLES, 'Bold'),
    'on'
  );
  // The flags of the two nodes the check above just read, as evidence: the class
  // Compose writes for `Role.Checkbox` and the `checked` a screen reader is handed,
  // recorded the way the Checkbox and IconButton checks record theirs.
  for (const title of ['Bold', 'Italic']) {
    const node = requireItem(TOGGLES, title);
    t.log.note(
      `item node "${title}": clickable=${node.clickable} ` +
        `checkable=${node.checkable} checked=${node.checked} ` +
        `enabled=${node.enabled} class=${node.className}`
    );
  }
  t.log.checkEquals(
    'one real tap checks an unchecked toggle',
    await t.tapUntilValue(
      () => requireItem(TOGGLES, 'Italic'),
      ECHO.buttonGroupToggleState,
      'bold,italic',
      'the real tap that checks "Italic"'
    ),
    'bold,italic'
  );
  t.log.checkEquals(
    'one tap reported one change',
    t.requireEcho(ECHO.buttonGroupToggleEvents),
    '1'
  );
  t.log.checkEquals(
    'a second real tap unchecks it again',
    await t.tapUntilValue(
      () => requireItem(TOGGLES, 'Italic'),
      ECHO.buttonGroupToggleState,
      'bold',
      'the real tap that unchecks "Italic"'
    ),
    'bold'
  );
  t.log.checkEquals(
    'the item publishes that back',
    itemChecked(TOGGLES, 'Italic'),
    'off'
  );
  // The disabled pair: the group that is disabled, and the group with one disabled
  // item. Both report into one counter the enabled items never touch.
  t.log.note(
    `disabled item: enabled=${
      itemOf(DISABLED_ITEM, 'Cut')?.enabled
    } for "Cut", enabled=${
      itemOf(DISABLED_GROUP, 'Copy')?.enabled
    } for the whole group — evidence beside the counters below`
  );
  await t.tapNode(requireItem(DISABLED_ITEM, 'Cut'));
  t.log.checkEquals(
    'a real tap on the disabled item reports no onPress',
    t.requireEchoToStay(
      ECHO.buttonGroupDisabledEvents,
      '0',
      'a tap on the disabled item to be refused'
    ),
    '0'
  );
  await t.tapNode(requireItem(DISABLED_GROUP, 'Copy'));
  t.log.checkEquals(
    'a real tap inside the disabled group reports no onPress either',
    t.requireEchoToStay(
      ECHO.buttonGroupDisabledEvents,
      '0',
      'a tap on the disabled group to be refused'
    ),
    '0'
  );
  t.log.checkEquals(
    'and nothing else answered: no action item was tapped here, so the press count ' +
      'never moved and the toggles have reported exactly one change each way',
    `${t.requireEcho(ECHO.buttonGroupPresses)} ` +
      `${t.requireEcho(ECHO.buttonGroupToggleEvents)}`,
    '0 2'
  );
}

/** `checked` and `enabled` on a radio row's own node, not its label's. */
async function pickerChecks(t) {
  const RADIO_ROWS = ['Basalt', 'Flint', 'Obsidian'];
  const RADIO_LOCKED_ROWS = ['Gabbro', 'Peridot', 'Scoria'];
  // The row a screen reader stops on, not the words inside it: a Compose row keeps its
  // own state on its own node and leaves the label a node of its own, so reading the
  // node that carries the text reports every disabled row as enabled.
  const radioRowNode = (label, nodes = t.dump()) =>
    tightestFlaggedNode(
      nodes,
      findAllByText(nodes, label)[0] ?? null,
      'checkable'
    );
  const describeRow = (node) =>
    node == null
      ? 'no checkable row around the label'
      : `${node.className} enabled=${node.enabled} checkable=${node.checkable} ` +
        `checked=${node.checked} at ${node.bounds.x1},${node.bounds.y1}-` +
        `${node.bounds.x2},${node.bounds.y2}`;
  // The menu variant first, while the page is still at its top: the platform places
  // this popup by the room under the anchor, and Back is the person's other way out.
  const anchor = await t.requireControlOnScreen('Real-input picker');
  t.log.checkEquals(
    'a real tap on the anchor opens the menu as a popup window',
    await t.tapUntilUp(
      () => t.requireControlAt('Real-input picker', anchor),
      'a real tap on the anchor to open a popup window',
      () => t.popupWindowCount()
    ),
    '1'
  );
  await t.pressBack();
  t.log.checkEquals(
    'Back shuts the popup (no window left behind)',
    t.waitForPopupCount(0, 'the back gesture to take the popup down'),
    0
  );
  // The way out that changes nothing: the row already on show. It closes the menu and
  // reports no choice. The row tap stays blind because its correct outcome is that
  // nothing is reported, so there is no witness to wait for and a retry would press a
  // closing menu a second time.
  await t.tapUntilUp(
    () => t.requireControlAt('Real-input picker', anchor),
    'a real tap that reopens the menu',
    () => t.popupWindowCount()
  );
  await t.tapNode(
    t.waitForOption('Onyx', 'the menu to show the current choice')
  );
  t.log.checkEquals(
    'tapping the row that is already chosen closes the menu',
    t.waitForPopupCount(
      0,
      'a pick of the row already chosen to take the menu down'
    ),
    0
  );
  t.log.checkEquals(
    'and a choice that changed nothing reports nothing',
    t.requireEcho(ECHO.pickerEvents),
    '0'
  );

  await t.requireControlOnScreen('Real-input radio picker');
  t.log.checkEquals(
    'the radio group has reported no index before a touch',
    t.requireEcho(ECHO.radioIndex),
    '-'
  );
  t.log.checkEquals(
    'and no popup window belongs to it - the rows are the control',
    t.popupWindowCount(),
    0
  );
  // A real tap on row 2. `tapOptionUntilValue` re-finds the row each attempt and
  // stops re-pressing once the label is gone from the tree; for a row that is
  // always up, a repeat tap on the row already chosen is the control's own no-op,
  // so a retry can never double-count a pick.
  t.log.checkEquals(
    'a real tap on radio row 2 reaches JS as index 2',
    await t.tapOptionUntilValue(
      RADIO_ROWS[2],
      ECHO.radioIndex,
      '2',
      'a real tap on the radio row to register'
    ),
    '2'
  );
  t.log.checkEquals(
    'one row tap reports one change',
    t.requireEcho(ECHO.radioEvents),
    '1'
  );
  t.log.checkEquals(
    'a row tap opened no window',
    t.waitForPopupCount(0, 'the row tap to open nothing'),
    0
  );
  // The same pick, read from the tree a screen reader navigates: exactly one row
  // says `checked`, and it is the row that was tapped. This is the radio group's
  // version of step 1's "the open menu marks the current choice selected" - and
  // stronger, because all three rows are on screen to be compared.
  for (const [row, chosen] of [
    [RADIO_ROWS[0], false],
    [RADIO_ROWS[1], false],
    [RADIO_ROWS[2], true],
  ]) {
    t.log.checkEquals(
      `the tree marks "${row}" as ${chosen ? 'the chosen row' : 'not chosen'}`,
      String(t.optionIsSelected(row)),
      String(chosen)
    );
  }
  // The same lookup on the group that *is* live, so a `false` below cannot be the
  // lookup answering nothing. `className` is recorded, not asserted: what Compose
  // writes for `Role.RadioButton` has not been measured the way the Spinner class
  // the menu checks assert has, and the Checkbox precedent is to log the class
  // until it has.
  const enabledTree = t.dump();
  for (const row of RADIO_ROWS) {
    t.log.checkEquals(
      `the enabled group's row "${row}" says it is enabled`,
      String(radioRowNode(row, enabledTree)?.enabled),
      'true'
    );
  }
  t.log.note(
    `radio row node, enabled group: "${RADIO_ROWS[2]}" -> ` +
      `${describeRow(radioRowNode(RADIO_ROWS[2], enabledTree))}`
  );
  // The disabled group: its rows say so in the tree, and a real tap on one moves
  // nothing. Both halves matter - a row that *looks* disabled but answers a finger
  // is the bug, and a row that refuses while the tree says it is enabled is the
  // same bug pointing the other way for a screen reader.
  await t.requireControlOnScreen('Real-input disabled radio picker');
  const disabledTree = t.dump();
  for (const row of RADIO_LOCKED_ROWS) {
    t.log.checkEquals(
      `the disabled group's row "${row}" says it is not enabled`,
      String(radioRowNode(row, disabledTree)?.enabled),
      'false'
    );
  }
  t.log.note(
    `radio row node, disabled group: "${RADIO_LOCKED_ROWS[0]}" -> ` +
      `${describeRow(radioRowNode(RADIO_LOCKED_ROWS[0], disabledTree))}`
  );
  await t.tapNode(
    t.waitForOption(
      RADIO_LOCKED_ROWS[1],
      'the disabled group to have a row on screen'
    )
  );
  t.log.checkEquals(
    'a real tap on a disabled row reports nothing',
    t.requireEchoToStay(ECHO.radioIndex, '2', 'a tap on a disabled radio row'),
    '2'
  );

  // The plain menu variant again, for what a screen reader is offered: the dump is the
  // only witness here, and a name sitting on a node that does not say it is disabled
  // misdescribes the control however well the taps land.
  await t.requireControlOnScreen('Real-input disabled picker');
  const lockedNodes = t.nodesNamed('Real-input disabled picker');
  t.log.checkEquals(
    'the disabled picker is one node as well',
    lockedNodes.length,
    1
  );
  t.log.checkEquals(
    'and that node is the one that says it is disabled',
    lockedNodes[0]?.enabled,
    'false'
  );

  // The accessibility `enabled` flag is a claim about the tree; a refusal is a claim
  // about input, and only a real tap measures that. The ordinary picker, tapped the
  // same way right after, is what turns "nothing happened" into "this one refused".
  const locked = await t.requireControlOnScreen('Real-input disabled picker');
  await t.tapNode(locked);
  t.log.checkEquals(
    'a real tap on the disabled picker opens no menu',
    t.waitForPopupCount(0, 'a tap on the disabled picker to open nothing'),
    0
  );
  await t.tapUntilUp(
    () => t.requireControlOnScreen('Real-input enabled picker'),
    'a real tap on the enabled picker to open its menu',
    () => t.popupWindowCount()
  );
  t.log.checkEquals(
    'the ordinary picker, tapped the same way, opens one - so the line above measured a refusal',
    t.popupWindowCount(),
    1
  );
  await t.pressBack();
  t.waitForPopupCount(0, "the enabled picker's popup to come down");
  // What a screen reader is offered: a name on a node with no value, or spread over two
  // nodes, misdescribes the control however well the taps land.
  const pickerNode = t.nodesNamed('Real-input enabled picker');
  t.log.checkEquals(
    "one node carries the enabled picker's name, so it is announced once",
    pickerNode.length,
    1
  );
  t.log.checkEquals(
    'and that same node carries the value it shows',
    pickerNode[0]?.text,
    'Mica'
  );
  t.log.checkEquals(
    'it is the node a tap is aimed at, too (the name is not parked on a container)',
    pickerNode[0]?.clickable,
    'true'
  );
  t.log.checkEquals(
    'the node announces the role of a list of choices',
    pickerNode[0]?.className,
    'android.widget.Spinner'
  );
}

/** `enabled` on the disabled row's own node, and the live row behind it. */
async function listItemChecks(t) {
  const LIVE = 'Real-input item';
  const DISABLED = 'Real-input disabled item';
  // 5. A disabled item takes nothing, and the tree says so before the taps do. Then the
  //    live item proves the silence was a refusal and not a dead screen.
  await t.requireControlOnScreen(DISABLED);
  t.log.checkEquals(
    'the disabled item is in the tree as disabled, so a reader is told it is inert ' +
      'instead of being handed a control that does nothing',
    t.nativeEnabled(DISABLED),
    'false'
  );
  const disabledNode = await t.requireControlOnScreen(DISABLED);
  for (let tap = 1; tap <= 3; tap += 1) {
    await t.tapNode(disabledNode);
  }
  t.log.checkEquals(
    'three real taps on a disabled item report nothing',
    t.requireEchoToStay(
      ECHO.listItemDisabledEvents,
      '0',
      'three real taps on a disabled item'
    ),
    '0'
  );
  // Read from the counter rather than hard-coded: the held press in the highlight
  // sample above is itself a press this counter has counted, so the absolute number is
  // a fact about how many checks ran above, while "one more after one more tap" is the
  // claim. A hard-coded 11 here failed on the first real run for exactly that reason.
  const beforeBarrier = Number(t.requireEcho(ECHO.listItemPresses));
  const wantedBarrier = String(beforeBarrier + 1);
  t.log.checkEquals(
    `and input is alive: the live item still presses (${beforeBarrier} -> ` +
      `${wantedBarrier})`,
    await t.tapUntilValue(
      () => t.requireControl(LIVE),
      ECHO.listItemPresses,
      wantedBarrier,
      'a real tap on the live item after the disabled one'
    ),
    wantedBarrier
  );
}

/** The split trigger's list half, and the Back that answers it. */
async function menuChecks(t) {
  const SPLIT_ACTION = 'Real-input split menu';
  const SPLIT_LIST = 'More options';
  // What a screen reader is offered by the plain trigger: Compose merges the trigger's
  // semantics into one node, so its name, its value and its role all land there.
  await t.requireControlOnScreen('Real-input menu');
  const trigger = t.nodesNamed('Real-input menu');
  t.log.checkEquals(
    'and that same node carries the title it paints as its value',
    trigger[0]?.text,
    'Actions'
  );
  t.log.checkEquals(
    'the node announces the role of a list of choices',
    trigger[0]?.className,
    'android.widget.Spinner'
  );
  await t.requireControlOnScreen(SPLIT_ACTION);
  // The halves of ONE control share a vertical band, so the band is what pairs them,
  // and every press re-reads it: the boxes this lookup returns are the boxes the taps
  // are aimed at.
  const listHalf = () => {
    const nodes = t.dump();
    const action = findAllByDescription(nodes, SPLIT_ACTION)[0];
    if (action == null) {
      t.log.abort(
        `no node named "${SPLIT_ACTION}" in the accessibility tree - the split ` +
          'trigger offers nothing a real tap could be aimed at'
      );
    }
    const named = findAllByDescription(nodes, SPLIT_LIST).filter(
      (node) =>
        node.bounds.y1 === action.bounds.y1 &&
        node.bounds.y2 === action.bounds.y2 &&
        node.bounds.x2 > action.bounds.x1
    );
    if (named.length === 0) {
      t.log.abort(
        `no "${SPLIT_LIST}" half beside "${SPLIT_ACTION}" in the accessibility tree`
      );
    }
    return named[0];
  };

  // The action half first, because it has no window of its own to answer with: the
  // echo is the only witness that this half is a press and not a second way to open
  // the same list.
  const actionHalf = () => {
    const nodes = t.dump();
    const named = findAllByDescription(nodes, SPLIT_ACTION);
    if (named.length === 0) {
      t.log.abort(
        `no node named "${SPLIT_ACTION}" in the accessibility tree - the split ` +
          'trigger offers nothing a real tap could be aimed at'
      );
    }
    return named[0];
  };
  await t.tapNode(actionHalf());
  t.log.checkEquals(
    'a real tap on the action half runs the primary action',
    t.requireEcho(ECHO.menuSplitEvents),
    'action'
  );
  t.log.checkEquals(
    'and raises no list - no window, and no open in the echo either',
    `${String(t.popupWindowCount())} | ${t.requireEcho(ECHO.menuSplitEvents)}`,
    '0 | action'
  );

  // One press of the list half is one open, and Back is the person's other way out of
  // it: a window the platform closes and the control does not report is a window that
  // can be left behind.
  await t.tapUntilUp(
    listHalf,
    'a real tap on the list half of the split trigger',
    () => t.popupWindowCount(),
    { pollMs: DUMP_POLL_MS }
  );
  await t.pressBack();
  t.log.checkEquals(
    'the list half shuts on Back',
    t.waitForPopupCount(0, 'the split list to come down'),
    0
  );
  t.log.checkEquals(
    'one press of the list half is one open and one close',
    t.requireEcho(ECHO.menuSplitEvents),
    'action > open > close'
  );
}

/** Back takes a hosted popup's window down, and leaves none. */
async function hostedPickerChecks(t) {
  let aimed = await t.requireControlOnScreen('Hosted picker');
  t.log.checkEquals(
    'a real tap on the hosted anchor opens the menu as a popup window',
    await t.tapUntilUp(
      () => (aimed = t.requireControlAt('Hosted picker', aimed)),
      'a real tap on the hosted anchor to open a popup window',
      () => t.popupWindowCount()
    ),
    '1'
  );
  await t.pressBack();
  t.log.checkEquals(
    'Back shuts the hosted popup (no window left behind)',
    t.waitForPopupCount(0, 'the back gesture to take the hosted popup down'),
    0
  );
  t.log.checkEquals(
    'opening and dismissing reported no selection - a menu is not a choice',
    t.requireEcho(ECHO.hostPickerIndex),
    '1'
  );
}

/** What a screen reader is offered around a `<Host>`: its own text, in order. */
/**
 * Draw the three hosted Switches together: back to the top of the page first, then down.
 *
 * A `<Host>` child only earns a box in the dump once it has been drawn, and the page is wherever
 * the previous control's checks left it, so a search from there can spend every scroll travelling
 * away. The three rows are the first block of Hosts, so the walk restarts above them. The drags
 * are on the right-edge strip, where no control owns the finger.
 *
 * @param {ReturnType<typeof makeContext>} t
 */
async function walkOntoHostedSwitches(t) {
  const names = ['Hosted switch 0', 'Hosted switch 1', 'Hosted switch 2'];
  const { width, height } = t.screenSize();
  const edge = width - 8;
  const middle = Math.round(height / 2);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await t.swipePx(edge, middle, edge, middle + 900, 300);
  }
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (
      names.every((name) =>
        t.nodesNamed(name).some((node) => node.bounds.height > 0)
      )
    ) {
      return;
    }
    await t.swipePx(edge, middle, edge, middle - 500, 600);
  }
}

async function hostedSwitchChecks(t) {
  await walkOntoHostedSwitches(t);
  await t.requireControlOnScreen('Hosted switch 0');
  // `uiautomator dump` lists nodes in traversal order, so where a hosted label sits
  // among the plain React Native text nodes around it is the order TalkBack reads them
  // in. The `<Host>` here sits between two `Text`s and holds three labelled Switches,
  // which gives both halves of the claim: one node per child, in mount order, between
  // the RN siblings rather than before or after them.
  const tree = t.dump();
  // Matched without case because the tree carries what is drawn, not what JSX says:
  // this screen's section headings carry `textTransform: 'uppercase'`.
  const textOrder = (needle) =>
    tree.findIndex((node) =>
      node.text.toLowerCase().includes(needle.toLowerCase())
    );
  const descOrder = (description) =>
    tree.findIndex((node) => node.contentDesc === description);
  const section = textOrder('Three Switches, one composition');
  const followingNote = textOrder('The Host has a height');
  const hosted = [0, 1, 2].map((index) =>
    descOrder(`Hosted switch ${String(index)}`)
  );

  // A red ordering claim has to say where the tree actually put things, and a missing
  // node has to say what it saw instead.
  const where = tree
    .map((node, index) =>
      node.text || node.contentDesc
        ? `${String(index)}:${(node.text || node.contentDesc).slice(0, 22)}`
        : null
    )
    .filter(Boolean)
    .join(' | ');
  t.log.note(
    `tree positions — section=${String(section)}, hosted=${hosted.join(
      '/'
    )}, note=${String(followingNote)}; named nodes: ${where}`
  );

  t.log.checkEquals(
    'the tree carries the RN text above the Host',
    section >= 0,
    true
  );
  t.log.checkEquals(
    'the tree carries the RN note below the Host',
    followingNote >= 0,
    true
  );
  t.log.checkEquals(
    'the tree carries a node for each hosted Switch',
    hosted.map((at) => at >= 0),
    [true, true, true]
  );
  t.log.checkEquals(
    'each hosted Switch is its own labelled node, in mount order',
    hosted,
    [...hosted].sort((left, right) => left - right)
  );
  t.log.checkEquals(
    'the RN text above the Host is read before every hosted Switch',
    hosted.map((at) => at > section),
    [true, true, true]
  );
  t.log.checkEquals(
    'the RN note below the Host is read after every hosted Switch',
    hosted.map((at) => at < followingNote),
    [true, true, true]
  );
}

/** Keystrokes reach the field inside a popover, before that popover closes. */
async function popoverChecks(t) {
  const FIELD = 'Rename this list';
  const upCount = (text) => () =>
    t.dump().filter((node) => node.text === text).length;
  const waitGone = async (witness, description) => {
    const deadline = Date.now() + REACT_TIMEOUT;
    while (upCount(witness)() > 0) {
      if (Date.now() > deadline) {
        t.log.abort(`timed out waiting for ${description}`);
      }
      await t.settle(250);
    }
  };
  // Outside: the log line, a `Text` with no press of its own at the top of the page,
  // above every anchor. Aimed at its first line rather than its centre, because that
  // line grows downward as events arrive and a centre tap would drift onto the Reset
  // button.
  const logNode = t.nodeByTestId(ECHO.popoverLog);
  if (logNode == null) {
    t.log.abort('no "popover-log" on the Popover screen to tap outside on');
  }
  const outside = { x: logNode.bounds.x1 + 6, y: logNode.bounds.y1 + 4 };

  // An emulator answers `hw.keyboard=yes`, which hides the soft keyboard, and the
  // keystrokes have to go to a field the IME is actually attached to; the setting goes
  // back either way.
  const hardKeyboard = t.setImeWithHardKeyboard(true);
  try {
    await t.tapTestId('popover-field-anchor');
    t.waitForOption(FIELD, 'the popover with a field to open');
    const field = t.nodeByTestId('popover-inner-field');
    if (field == null) {
      t.log.abort('the field popover is up without its TextInput in the tree');
    }
    await t.tapNode(field);
    const imeDeadline = Date.now() + REACT_TIMEOUT;
    while (!t.imeShown() && Date.now() < imeDeadline) {
      await t.settle(250);
    }
    // Asserted on the committed value rather than on one entry per character, because
    // `input text` can deliver both characters in one commit and RN then reports the
    // field's text once. The screen also records the popover's own close from that
    // outside tap, so the claim is the order the log carries — a bare suffix cannot see
    // which of the two happened first.
    await t.type('ab');
    await t.hideKeyboard();
    await t.tapPx(outside.x, outside.y);
    await t.settle(400);
    await waitGone(FIELD, 'the outside tap to take the field popover down');
    const typedLog = t.requireEcho(ECHO.popoverLog);
    t.log.checkEquals(
      `real keystrokes reach the field inside the popover, before its own close (${typedLog.slice(-70)})`,
      typedLog.includes('typed:ab') &&
        typedLog.indexOf('typed:ab') <
          typedLog.lastIndexOf('field:presented:false'),
      true
    );
  } finally {
    t.setImeWithHardKeyboard(hardKeyboard);
  }
}

/** One named radio node per option, each carrying the selection. */
async function segmentedControlChecks(t) {
  await t.requireControlOnScreen('Real-input segmented control');
  t.log.checkEquals(
    'no change has been reported before a touch',
    t.requireEcho(ECHO.segmentedEvents),
    '0'
  );
  // The selection has to be one the *finger* made, so the claim below cannot be the
  // fixture's default, and the middle of the box is the segment drawn '2'.
  await t.tapUntilValue(
    () => t.requireControl('Real-input segmented control'),
    ECHO.segmentedIndex,
    '1',
    'a real tap to register'
  );
  t.log.checkEquals(
    'one tap reports one change',
    t.requireEcho(ECHO.segmentedEvents),
    '1'
  );

  // Each of the three claims lives on a different entry, and that is Compose's doing:
  // a selectable item is published as the item itself — a node at the segment's box
  // carrying `checkable`/`checked`, which is what TalkBack reads as "selected" — with
  // the `Role` on its own `RadioButton` node at that same box and the label as a child
  // `TextView`. An assertion that one node carries all three describes a tree this row
  // does not have, so each claim is read where it is, and the note prints all three.
  const box = await t.requireControl('Real-input segmented control');
  const tree = t.dump();
  const insideBox = (node) =>
    node.bounds.x1 >= box.bounds.x1 - 1 &&
    node.bounds.x2 <= box.bounds.x2 + 1 &&
    node.bounds.y1 >= box.bounds.y1 - 1 &&
    node.bounds.y2 <= box.bounds.y2 + 1;
  const centreInside = (node, other) =>
    (node.bounds.x1 + node.bounds.x2) / 2 >= other.bounds.x1 - 1 &&
    (node.bounds.x1 + node.bounds.x2) / 2 <= other.bounds.x2 + 1 &&
    (node.bounds.y1 + node.bounds.y2) / 2 >= other.bounds.y1 - 1 &&
    (node.bounds.y1 + node.bounds.y2) / 2 <= other.bounds.y2 + 1;
  const boundsText = (node) =>
    `${String(node.bounds.x1)},${String(node.bounds.y1)} \u2192 ` +
    `${String(node.bounds.x2)},${String(node.bounds.y2)}`;
  const items = tree
    .filter((node) => node.checkable === 'true' && insideBox(node))
    .sort((a, b) => a.bounds.x1 - b.bounds.x1);
  const radios = tree
    .filter(
      (node) =>
        node.className === 'android.widget.RadioButton' && insideBox(node)
    )
    .sort((a, b) => a.bounds.x1 - b.bounds.x1);
  items.forEach((node, index) => {
    const radio = radios.find((candidate) => centreInside(candidate, node));
    const label = tree.find(
      (candidate) =>
        candidate.text === String(index + 1) && insideBox(candidate)
    );
    t.log.note(
      `segment ${String(index + 1)}: item ${node.className.split('.').pop()} ` +
        `[${boundsText(node)}] checked=${node.checked}; role ` +
        `${radio == null ? 'MISSING' : `[${boundsText(radio)}]`}; label ` +
        `${label == null ? 'MISSING' : `[${boundsText(label)}]`}`
    );
  });
  t.log.checkEquals('the group still has one node per option', items.length, 3);
  t.log.checkEquals(
    'the group publishes one radio node per option',
    radios.length,
    3
  );
  items.forEach((node, index) => {
    t.log.checkEquals(
      `segment ${String(index + 1)} of ${String(items.length)} is still a radio button`,
      radios.some((candidate) => centreInside(candidate, node)),
      true
    );
    t.log.checkEquals(
      `segment ${String(index + 1)} is announced with its own label`,
      tree.some(
        (candidate) =>
          candidate.text === String(index + 1) && centreInside(candidate, node)
      ),
      true
    );
    t.log.checkEquals(
      `segment ${String(index + 1)} reports the selection the control has (index 1)`,
      node.checked,
      index === 1 ? 'true' : 'false'
    );
  });
}

/**
 * What runs after the suite, in this order: each entry navigates to its control's own
 * screen, so one that leaves a window standing would take the next one's screen down.
 */
const TREE_CHECKS = [
  { id: 'context-menu', run: contextMenuChecks },
  { id: 'date-picker', run: datePickerChecks },
  { id: 'hosted-date-picker', run: hostedDatePickerChecks },
  { id: 'hosted-mixed', run: hostedMixedChecks },
  { id: 'hosted-picker', run: hostedPickerChecks },
  { id: 'hosted-switch', run: hostedSwitchChecks },
  { id: 'menu', run: menuChecks },
  { id: 'dialog', run: dialogChecks },
  { id: 'chip', run: chipChecks },
  { id: 'checkbox', run: checkboxChecks },
  { id: 'icon-button', run: iconButtonChecks },
  { id: 'button-group', run: buttonGroupChecks },
  { id: 'picker', run: pickerChecks },
  { id: 'list-item', run: listItemChecks },
  { id: 'popover', run: popoverChecks },
  { id: 'segmented-control', run: segmentedControlChecks },
];

/** The controls these checks cover, so a caller can tell an empty run from a covered one. */
export const TREE_CHECK_IDS = TREE_CHECKS.map((entry) => entry.id);

/**
 * @param {string} id a control id from `controls.mjs`
 */
function screenOf(id) {
  const control = REAL_INPUT_CONTROLS.find((entry) => entry.id === id);
  if (control == null) {
    throw new Error(
      `real-input: the tree check "${id}" names no control in controls.mjs.`
    );
  }
  return control.screen;
}

/**
 * Press Back until the app's own window is on top again.
 *
 * A check that ends with a dialog up leaves the next one tapping a tab through the
 * dialog's scrim, which reads that screen as unreachable.
 *
 * @param {SweepDevice} device
 */
async function returnToAppWindow(device) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const nodes = device.hierarchy();
    const tabStrip = nodes.some((node) => node.resourceId === 'example-tabs');
    const ownWindow = nodes.some(
      (node) => node.resourceId === 'android:id/content'
    );
    if (tabStrip && ownWindow) return;
    device.key(KEY_BACK);
    await sleep(700);
  }
}

/**
 * Run every tree check on the leased emulator, after the suite.
 *
 * The daemon has to be down for the dumps to answer at all, so this is called from the
 * same place the a11y sweep is, with the same `begin` the suite hands out: a phase-2
 * failure then lands on the run's one summary line, named for its control and the phase.
 *
 * @param {(id: string, title: string) => import('./report.mjs').CheckLog} begin
 * @param {object} device
 * @param {(command: string) => string} device.adbShell
 * @param {() => void} device.stopDaemon
 * @param {ReadonlyArray<{ id: string, label: string }>} device.tabs
 * @param {string} device.appId
 * @param {ReadonlyArray<string>} [device.only] the control ids to run, for a filtered run
 * @returns {Promise<{covered: string[]}>}
 */
export async function runTreeChecksOnDevice(begin, device) {
  const only = device.only;
  const harness = new SweepDevice(device);
  try {
    device.stopDaemon();
  } catch {
    // Already down, which is the state these checks need in any case.
  }
  await harness.startFromLaunch();
  if (only != null && TREE_CHECKS.every((entry) => !only.includes(entry.id))) {
    return { covered: [] };
  }
  const covered = [];
  for (const entry of TREE_CHECKS) {
    if (only != null && !only.includes(entry.id)) continue;
    const title = `uiautomator checks for ${entry.id}`;
    const log = begin(`${entry.id} (tree)`, title);
    await returnToAppWindow(harness);
    await harness.goToScreen(screenOf(entry.id), log);
    await runCheck(log, () => entry.run(makeContext(harness, log)));
    covered.push(entry.id);
  }
  return { covered };
}
