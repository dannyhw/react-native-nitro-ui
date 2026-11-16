/**
 * The Android real-input checks the e2e driver cannot make, run after the e2e suite with
 * its daemon down: a `uiautomator` dump cannot be asked while the driver holds the
 * device's one accessibility connection. They read `clickable`, `focusable` and
 * `long-clickable` each on its own, where the driver's node map folds the first two into
 * one flag and has no third, and they hold a finger down and then drag it without
 * lifting, a gesture the driver has no form for. The device is the caller's: one
 * `adb shell` at a time, at the leased serial only.
 *
 * @file
 */
import { blockMs, runCheck, sleep } from './support.mjs';
import { REAL_INPUT_CONTROLS } from './controls.mjs';
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

/** Each item's title sits inside a clickable node of its own group. */
async function buttonGroupChecks(t) {
  // Material draws each item as its own box, a separate title and a role decoration,
  // so the title is only where the search starts; the press lands on the item's box.
  for (const [groupLabel, title] of [
    ['Real-input formatting toggles', 'Bold'],
    ['Real-input formatting toggles', 'Italic'],
    ['Real-input group with a disabled item', 'Cut'],
    ['Real-input disabled group', 'Copy'],
  ]) {
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
      t.log.abort(
        `group "${groupLabel}" draws no item titled "${title}" in its own box`
      );
    }
    const control = tightestFlaggedNode(tree, named[0], 'clickable');
    t.log.check(
      `"${title}" in "${groupLabel}" sits inside a clickable node`,
      control != null
    );
    if (control == null) {
      const { bounds } = named[0];
      t.log.note(
        `the name is on [${named[0].className}] at ` +
          `[${String(bounds.x1)},${String(bounds.y1)}]` +
          `[${String(bounds.x2)},${String(bounds.y2)}], so nothing here can be ` +
          'pressed, checked or disabled by a reader'
      );
    }
  }
}

/** The enabled Picker's name sits on the node a tap is aimed at. */
async function pickerChecks(t) {
  await t.requireControlOnScreen('Real-input enabled picker');
  const pickerNode = t.nodesNamed('Real-input enabled picker');
  t.log.checkEquals(
    'it is the node a tap is aimed at, too (the name is not parked on a container)',
    pickerNode[0]?.clickable,
    'true'
  );
}

/** What a screen reader is offered around a `<Host>`: its own text, in order. */
/**
 * What runs after the suite, in this order: each entry navigates to its control's own
 * screen, so one that leaves a window standing would take the next one's screen down.
 */
const TREE_CHECKS = [
  { id: 'context-menu', run: contextMenuChecks },
  { id: 'button-group', run: buttonGroupChecks },
  { id: 'picker', run: pickerChecks },
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
