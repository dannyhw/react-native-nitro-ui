/**
 * Stopping the app under test and waiting until the window manager has let it go, so
 * the driver's fresh launch that follows finds nothing to close.
 *
 * @file
 */

import { readWindowFocus } from './window-focus.mjs';

/**
 * How long the app is given to leave the front after it is stopped.
 *
 * The driver's own close allows 2 s for the focus to move, and a slow GitHub-hosted
 * emulator overruns that. 30 s is fifteen times as long and an eighth of a test's
 * 240 s budget: room for a slow window manager, and a stuck one still fails here,
 * with the window it is stuck on named, long before the test's own timeout.
 */
export const LEAVE_FRONT_DEADLINE_MS = 30_000;

/** How often the process list and the focus are read while waiting. */
const POLL_MS = 100;

/**
 * @typedef {object} FrontDevice
 * @property {() => void} forceStop stops the app (`am force-stop <app>`)
 * @property {() => string} processIds the output of `pidof <app>`: empty once no
 *   process of the app is left
 * @property {() => string} windowDump the stdout of `dumpsys window displays` followed by
 *   `dumpsys window windows`, never a bare `dumpsys window`, which opens with the copy
 *   saved at the last ANR
 */

/**
 * Stop the app, then wait until it has no process and the focused window belongs to
 * something else (the launcher, another app, a system window).
 *
 * A focus that names no window at all is a transition between two windows, so it is
 * waited out like the app's own.
 *
 * @param {FrontDevice} device
 * @param {string} appId the app's package
 * @param {{ deadlineMs?: number, pollMs?: number }} [options]
 * @returns {Promise<void>}
 * @throws {Error} naming the focused window and the process left, at the deadline
 */
export async function stopAndAwaitLeavingFront(device, appId, options = {}) {
  const deadlineMs = options.deadlineMs ?? LEAVE_FRONT_DEADLINE_MS;
  const pollMs = options.pollMs ?? POLL_MS;
  const deadline = Date.now() + deadlineMs;
  device.forceStop();
  for (;;) {
    const pids = device.processIds().trim();
    const focus = readWindowFocus(device.windowDump(), appId);
    if (pids === '' && focus.owner === 'other') return;
    if (Date.now() >= deadline) {
      const window =
        focus.title == null ? 'no window' : `"${focus.title}" (${focus.owner})`;
      throw new Error(
        `real-input: ${appId} was still in front ${String(deadlineMs / 1000)} s ` +
          `after it was stopped: the window manager's focused window was ${window}` +
          (pids === '' ? '' : `, and process ${pids} was still running`) +
          '. A fresh launch cannot start from there.'
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
