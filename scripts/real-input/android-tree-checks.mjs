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
import {
  findAllByDescription,
  findAllByText,
  findByDescription,
  findByTestId,
} from './uiautomator.mjs';
import { nativeChecked, tightestFlaggedNode } from './android-tree.mjs';
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
  };
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
  { id: 'hosted-picker', run: hostedPickerChecks },
  { id: 'menu', run: menuChecks },
  { id: 'icon-button', run: iconButtonChecks },
  { id: 'button-group', run: buttonGroupChecks },
  { id: 'picker', run: pickerChecks },
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
