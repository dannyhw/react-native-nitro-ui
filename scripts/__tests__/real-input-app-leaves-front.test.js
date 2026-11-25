import { describe, expect, it } from 'vitest';

import {
  appActivityRecords,
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
    activityDump: () =>
      stoppedAt == null ? activityDump(true) : activityDump(false),
  };
  return device;
}

/** The app's record as `dumpsys activity activities` prints it while it closes. */
const RECORD = `ActivityRecord{23bfeb8 u0 ${APP}/.MainActivity t8 f}`;

/** `dumpsys activity activities`, with the app's record or with the launcher's alone. */
function activityDump(withApp) {
  return [
    'ACTIVITY MANAGER ACTIVITIES (dumpsys activity activities)',
    'Display #0 (activities from top to bottom):',
    ...(withApp
      ? [
          '  * Task{577b491 #8 type=standard A=10209:nitroui.example}',
          `    * Hist #0: ${RECORD}} isExiting`,
        ]
      : []),
    '  * Task{1a2b3c #7 type=home}',
    '    * Hist #0: ActivityRecord{8f8f8f u0 com.google.android.apps.nexuslauncher/.NexusLauncherActivity t7}',
    '  ResumedActivity: ActivityRecord{8f8f8f u0 com.google.android.apps.nexuslauncher/.NexusLauncherActivity t7}',
  ].join('\n');
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

  it('waits while the activity manager still lists the app after the focus has moved', async () => {
    // On a busy hosted emulator the focus reached the launcher and the process was gone,
    // and the app's activity record stayed for another 3 s, until the close transition
    // ended; the driver's close read the foreground app from it.
    const device = slowWindowManager(0);
    let polls = 0;
    device.activityDump = () => activityDump(++polls < 5);

    await stopAndAwaitLeavingFront(device, APP, { pollMs: 10 });

    expect(polls).toBe(5);
  });

  it('names a record that outlived the stop', async () => {
    const device = slowWindowManager(0);
    device.activityDump = () => activityDump(true);

    await expect(
      stopAndAwaitLeavingFront(device, APP, { deadlineMs: 200, pollMs: 20 })
    ).rejects.toThrow(`, and the activity manager still listed ${RECORD}.`);
  });
});

describe('appActivityRecords', () => {
  it("lists the app's records once each and no other app's", () => {
    expect(appActivityRecords(activityDump(true), APP)).toEqual([RECORD]);
    expect(appActivityRecords(activityDump(false), APP)).toEqual([]);
  });

  it('does not take another package that starts with the same name', () => {
    expect(
      appActivityRecords(`ActivityRecord{1 u0 ${APP}.helper/.Main t3}`, APP)
    ).toEqual([]);
  });
});
