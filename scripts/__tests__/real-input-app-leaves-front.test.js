import { describe, expect, it } from 'vitest';

import {
  LEAVE_FRONT_DEADLINE_MS,
  stopAndAwaitLeavingFront,
} from '../real-input/app-leaves-front.mjs';

const APP = 'nitroui.example';
const ACTIVITY = `${APP}/${APP}.MainActivity`;
const LAUNCHER =
  'com.google.android.apps.nexuslauncher/com.google.android.apps.nexuslauncher.NexusLauncherActivity';

/** The driver's own allowance for a closed app to leave the front. */
const DRIVER_CLOSE_MS = 2_000;

/** `dumpsys window displays` then `dumpsys window windows`, focused on `focused`. */
function windowDump(focused) {
  const hashes = { [ACTIVITY]: 'a1f0c2', [LAUNCHER]: 'd2d2d2' };
  const focus =
    focused == null ? 'null' : `Window{${hashes[focused]} u0 ${focused}}`;
  return [
    'WINDOW MANAGER DISPLAY CONTENTS (dumpsys window displays)',
    '  Display: mDisplayId=0 rootTasks=2',
    `  mCurrentFocus=${focus}`,
    `  mFocusedApp=ActivityRecord{9e1 u0 ${APP}/.MainActivity t12}`,
    'WINDOW MANAGER WINDOWS (dumpsys window windows)',
    `  Window #3 Window{a1f0c2 u0 ${ACTIVITY}}:`,
    `    mOwnerUid=10153 showForAllUsers=false package=${APP} appop=NONE`,
    '    mAttrs={(0,0)(fillxfill) sim={adjust=resize} ty=BASE_APPLICATION fmt=TRANSLUCENT',
    `  Window #2 Window{d2d2d2 u0 ${LAUNCHER}}:`,
    '    mOwnerUid=10100 showForAllUsers=false package=com.google.android.apps.nexuslauncher appop=NONE',
    '    mAttrs={(0,0)(fillxfill) ty=BASE_APPLICATION fmt=TRANSLUCENT',
  ].join('\n');
}

/**
 * A stand-in device whose process dies at once on a stop while the window manager keeps
 * the app's activity focused for `focusHoldMs` of wall-clock time after it, passing
 * through a moment with no focus on the way to the launcher.
 */
function slowWindowManager(focusHoldMs) {
  let stoppedAt = null;
  const device = {
    stops: 0,
    focused() {
      if (stoppedAt == null) return ACTIVITY;
      const since = Date.now() - stoppedAt;
      if (since < focusHoldMs) return ACTIVITY;
      if (since < focusHoldMs + 150) return null;
      return LAUNCHER;
    },
    forceStop() {
      device.stops += 1;
      stoppedAt = Date.now();
    },
    processIds: () => (stoppedAt == null ? '4321' : ''),
    windowDump: () => windowDump(device.focused()),
  };
  return device;
}

describe('stopAndAwaitLeavingFront', () => {
  it('waits out a window manager that keeps the app focused past the driver’s 2 s', async () => {
    const holdMs = DRIVER_CLOSE_MS + 500;
    const device = slowWindowManager(holdMs);
    const started = Date.now();

    await stopAndAwaitLeavingFront(device, APP);

    expect(device.stops).toBe(1);
    expect(device.focused()).toBe(LAUNCHER);
    expect(Date.now() - started).toBeGreaterThanOrEqual(holdMs);
    // Returns once the focus moves, not at the deadline.
    expect(Date.now() - started).toBeLessThan(holdMs + 2_000);
  });

  it('allows a slow runner far more than the driver’s 2 s', () => {
    expect(LEAVE_FRONT_DEADLINE_MS).toBeGreaterThanOrEqual(
      10 * DRIVER_CLOSE_MS
    );
  });

  it('waits for the process to exit as well as the focus to move', async () => {
    const device = slowWindowManager(0);
    device.focused = () => LAUNCHER;
    let polls = 0;
    device.processIds = () => (++polls < 5 ? '4321' : '');

    await stopAndAwaitLeavingFront(device, APP, { pollMs: 10 });

    expect(polls).toBe(5);
  });

  it('fails at the deadline naming the window still in front', async () => {
    const device = slowWindowManager(Number.POSITIVE_INFINITY);
    const started = Date.now();

    await expect(
      stopAndAwaitLeavingFront(device, APP, { deadlineMs: 400, pollMs: 20 })
    ).rejects.toThrow(
      `real-input: ${APP} was still in front 0.4 s after it was stopped: the window ` +
        `manager's focused window was "${ACTIVITY}" (activity).`
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(400);
  });

  it('names a process that outlived the stop', async () => {
    const device = slowWindowManager(0);
    device.processIds = () => '4321';

    await expect(
      stopAndAwaitLeavingFront(device, APP, { deadlineMs: 200, pollMs: 20 })
    ).rejects.toThrow(
      /focused window was ".*NexusLauncherActivity" \(other\), and process 4321 was still running/
    );
  });
});
