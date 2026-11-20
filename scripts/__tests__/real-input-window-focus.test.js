import { describe, expect, it } from 'vitest';

import { SweepDevice } from '../real-input/a11y-sweep-device.mjs';
import { returnToAppWindow } from '../real-input/android-tree-checks.mjs';
import { readWindowFocus } from '../real-input/window-focus.mjs';

const APP = 'com.nitroui.example';
const LAUNCHER =
  'com.google.android.apps.nexuslauncher/com.google.android.apps.nexuslauncher.NexusLauncherActivity';

/** One window in `dumpsys window`'s window list, shaped as the window manager prints it. */
function windowEntry(index, hash, title, pkg, type) {
  return [
    `  Window #${String(index)} Window{${hash} u0 ${title}}:`,
    `    mDisplayId=0 rootTaskId=12 mSession=Session{5a1 4321:u0a10153} mClient=android.os.BinderProxy@7c2`,
    `    mOwnerUid=10153 showForAllUsers=false package=${pkg} appop=NONE`,
    `    mAttrs={(0,0)(fillxfill) sim={adjust=resize} ty=${type} fmt=TRANSLUCENT`,
    `      fl=LAYOUT_IN_SCREEN LAYOUT_INSET_DECOR SPLIT_TOUCH HARDWARE_ACCELERATED}`,
  ].join('\n');
}

const WINDOWS = {
  activity: windowEntry(
    3,
    'a1f0c2',
    `${APP}/${APP}.MainActivity`,
    APP,
    'BASE_APPLICATION'
  ),
  popup: windowEntry(
    4,
    'b7e911',
    'PopupWindow:4f2a1c3',
    APP,
    'APPLICATION_PANEL'
  ),
  splash: windowEntry(
    5,
    'c0ffee',
    `Splash Screen ${APP}`,
    APP,
    'APPLICATION_STARTING'
  ),
  launcher: windowEntry(
    2,
    'd2d2d2',
    LAUNCHER,
    'com.google.android.apps.nexuslauncher',
    'BASE_APPLICATION'
  ),
  shade: windowEntry(
    1,
    'e3e3e3',
    'NotificationShade',
    'com.android.systemui',
    'NOTIFICATION_SHADE'
  ),
};

/** The title and hash of one of `WINDOWS`, as `mCurrentFocus` names it. */
function focusOf(focused) {
  if (focused == null) return 'null';
  const [, hash, title] = WINDOWS[focused].match(
    /Window\{(\S+) u0 ([^\n]*)\}:/
  );
  return `Window{${hash} u0 ${title}}`;
}

/** `dumpsys window displays`, focused on one of `WINDOWS` (or on nothing). */
function displaysSection(focused) {
  return [
    'WINDOW MANAGER DISPLAY CONTENTS (dumpsys window displays)',
    '  Display: mDisplayId=0 rootTasks=2',
    '    init=1080x2400 420dpi base=1080x2400 420dpi cur=1080x2400 app=1080x2337 rng=1080x1017-2337x2337',
    `  mCurrentFocus=${focusOf(focused)}`,
    `  mFocusedApp=ActivityRecord{9e1 u0 ${APP}/.MainActivity t12}`,
  ].join('\n');
}

/** `dumpsys window windows`: every window in `WINDOWS`. */
function windowsSection() {
  return [
    'WINDOW MANAGER WINDOWS (dumpsys window windows)',
    ...Object.values(WINDOWS),
  ].join('\n');
}

/** What the gate reads for focus: the display contents, then the window list. */
function dumpsysWindow(focused) {
  return `${displaysSection(focused)}\n${windowsSection()}`;
}

const SEPARATOR = '-'.repeat(79);

/**
 * A whole `dumpsys window` on a device that saved an ANR: the copy of the display
 * contents and window list taken at the ANR comes first, focused on `stale`, and the
 * live sections, focused on `live`, come later in their own order.
 */
function fullDumpAfterAnr(stale, live) {
  return [
    'WINDOW MANAGER LAST ANR (dumpsys window lastanr)',
    '  ANR time: 11/20/26 01:12:44.031',
    `  Application at fault: ActivityRecord{9e1 u0 ${APP}/.MainActivity t12}`,
    '  Reason: Application does not have a focused window',
    '',
    '  Last ANR continued',
    displaysSection(stale),
    '',
    windowsSection(),
    SEPARATOR,
    'WINDOW MANAGER POLICY STATE (dumpsys window policy)',
    '    mSafeMode=false mSystemReady=true mSystemBooted=true',
    SEPARATOR,
    displaysSection(live),
    SEPARATOR,
    'WINDOW MANAGER TOKENS (dumpsys window tokens)',
    '  All tokens:',
    SEPARATOR,
    windowsSection(),
  ].join('\n');
}

const quietLog = { note: () => {} };

const TABS_XML =
  '<hierarchy><node resource-id="android:id/content" bounds="[0,0][1080,2400]" />' +
  '<node resource-id="example-tabs" bounds="[0,150][1080,260]" /></hierarchy>';
const NO_TABS_XML =
  '<hierarchy><node resource-id="android:id/content" bounds="[0,0][1080,2400]" />' +
  '<node text="Loading" bounds="[0,1100][1080,1300]" /></hierarchy>';
const LAUNCHER_XML =
  '<hierarchy><node resource-id="com.google.android.apps.nexuslauncher:id/workspace" ' +
  'bounds="[0,0][1080,2400]" /></hierarchy>';

/**
 * A device whose focus and screen follow a script: each focus read takes the next step,
 * and the last step stays. Every command it is sent is recorded.
 *
 * @param {Array<{ focus: keyof typeof WINDOWS | null, xml: string, ime?: boolean, gone?: boolean }>} steps
 *   `gone`: the app has no process, so `pidof` finds none
 */
function scriptedDevice(steps) {
  const sent = [];
  let step = 0;
  // The state the last focus read saw, and the first one before any read.
  const shown = () => steps[Math.min(Math.max(step - 1, 0), steps.length - 1)];
  const adbShell = (command) => {
    sent.push(command);
    if (command === 'wm size') return 'Physical size: 1080x2400\n';
    if (command === 'dumpsys window displays') {
      step += 1;
      return displaysSection(shown().focus);
    }
    if (command === 'dumpsys window windows') return windowsSection();
    if (command === `pidof ${APP}`) {
      if (shown().gone === true)
        throw Object.assign(new Error('exit 1'), { status: 1 });
      return '4321\n';
    }
    if (command.startsWith('uiautomator dump'))
      return 'UI hierchary dumped to: /sdcard/x.xml\n';
    if (command.startsWith('cat ')) return shown().xml;
    if (command === 'dumpsys input_method') {
      return shown().ime === true
        ? 'mInputShown=true\n'
        : 'mInputShown=false\n';
    }
    return '';
  };
  const device = new SweepDevice({ adbShell, tabs: [], appId: APP });
  return {
    device,
    sent,
    backs: () => sent.filter((c) => c === 'input keyevent 4').length,
  };
}

describe('readWindowFocus', () => {
  it('names the app activity, its own popup, its splash, and windows that are not its own', () => {
    expect(readWindowFocus(dumpsysWindow('activity'), APP)).toEqual({
      title: `${APP}/${APP}.MainActivity`,
      owner: 'activity',
    });
    expect(readWindowFocus(dumpsysWindow('popup'), APP).owner).toBe(
      'app-window'
    );
    expect(readWindowFocus(dumpsysWindow('splash'), APP).owner).toBe(
      'starting'
    );
    expect(readWindowFocus(dumpsysWindow('launcher'), APP)).toEqual({
      title: LAUNCHER,
      owner: 'other',
    });
    expect(readWindowFocus(dumpsysWindow('shade'), APP)).toEqual({
      title: 'NotificationShade',
      owner: 'other',
    });
    expect(readWindowFocus(dumpsysWindow(null), APP)).toEqual({
      title: null,
      owner: 'none',
    });
  });
});

describe('readWindowFocus after a saved ANR', () => {
  it('reads the live focus, not the null focus saved at the ANR', () => {
    expect(readWindowFocus(fullDumpAfterAnr(null, 'activity'), APP).owner).toBe(
      'activity'
    );
  });

  it('reads the live focus, not the launcher focus saved at the ANR', () => {
    expect(
      readWindowFocus(fullDumpAfterAnr('launcher', 'activity'), APP).owner
    ).toBe('activity');
  });

  it("reads the live focus, not the app's activity saved at the ANR", () => {
    expect(
      readWindowFocus(fullDumpAfterAnr('activity', 'launcher'), APP)
    ).toEqual({ title: LAUNCHER, owner: 'other' });
  });
});

describe('readWindowFocus with another package that starts with the app id', () => {
  it('does not take a focused activity of `<app id>.dev` as the app', () => {
    const dev = `${APP}.dev`;
    const title = `${dev}/${dev}.MainActivity`;
    const listed = [
      'WINDOW MANAGER DISPLAY CONTENTS (dumpsys window displays)',
      `  mCurrentFocus=Window{f00d u0 ${title}}`,
      'WINDOW MANAGER WINDOWS (dumpsys window windows)',
      windowEntry(3, 'f00d', title, dev, 'BASE_APPLICATION'),
    ].join('\n');
    expect(readWindowFocus(listed, APP)).toEqual({ title, owner: 'other' });
    const unlisted = listed.split('WINDOW MANAGER WINDOWS')[0];
    expect(readWindowFocus(unlisted, APP)).toEqual({ title, owner: 'other' });
  });
});

describe('returning to the app window after a relaunch', () => {
  it('sends no Back while the launcher holds focus, and returns once the app does', async () => {
    const { device, sent, backs } = scriptedDevice([
      { focus: 'launcher', xml: LAUNCHER_XML },
      { focus: null, xml: LAUNCHER_XML },
      { focus: 'activity', xml: TABS_XML },
    ]);
    await returnToAppWindow(device, quietLog, 10_000);
    expect(backs()).toBe(0);
    expect(sent).toContain(`am start -n ${APP}/.MainActivity`);
    expect(sent.filter((c) => c === 'dumpsys window displays')).toHaveLength(3);
  });

  it('sends no Back while the app activity is focused but its tab bar is not drawn yet', async () => {
    const { device, backs } = scriptedDevice([
      { focus: 'splash', xml: NO_TABS_XML },
      { focus: 'activity', xml: NO_TABS_XML },
      { focus: 'activity', xml: NO_TABS_XML },
      { focus: 'activity', xml: TABS_XML },
    ]);
    await returnToAppWindow(device, quietLog, 10_000);
    expect(backs()).toBe(0);
  });

  it('says so in the check log when the app had no process and is launched again', async () => {
    const { device, sent } = scriptedDevice([
      { focus: 'launcher', xml: LAUNCHER_XML, gone: true },
      { focus: 'activity', xml: TABS_XML },
    ]);
    const notes = [];
    await returnToAppWindow(
      device,
      { note: (line) => notes.push(line) },
      10_000
    );
    expect(sent).toContain(`am start -n ${APP}/.MainActivity`);
    expect(notes).toEqual([
      `${APP} was not running and "${LAUNCHER}" held focus, so the app was launched again`,
    ]);
  });

  it('logs nothing when the app is only brought to the front', async () => {
    const { device } = scriptedDevice([
      { focus: 'launcher', xml: LAUNCHER_XML },
      { focus: 'activity', xml: TABS_XML },
    ]);
    const notes = [];
    await returnToAppWindow(
      device,
      { note: (line) => notes.push(line) },
      10_000
    );
    expect(notes).toEqual([]);
  });

  it('collapses the shade instead of pressing Back on it', async () => {
    const { device, sent, backs } = scriptedDevice([
      { focus: 'shade', xml: LAUNCHER_XML },
      { focus: 'activity', xml: TABS_XML },
    ]);
    await returnToAppWindow(device, quietLog, 10_000);
    expect(backs()).toBe(0);
    expect(sent).toContain('cmd statusbar collapse');
  });

  it("still presses Back on the app's own popup and keyboard", async () => {
    const { device, backs } = scriptedDevice([
      { focus: 'popup', xml: NO_TABS_XML },
      { focus: 'activity', xml: NO_TABS_XML, ime: true },
      { focus: 'activity', xml: TABS_XML },
    ]);
    await returnToAppWindow(device, quietLog, 10_000);
    expect(backs()).toBe(2);
  });

  it('fails naming the focused window when the app does not come back', async () => {
    const { device, backs } = scriptedDevice([
      { focus: 'launcher', xml: LAUNCHER_XML },
    ]);
    await expect(returnToAppWindow(device, quietLog, 1200)).rejects.toThrow(
      `did not come back to its tab bar within 1 s. The focused window was "${LAUNCHER}" (other)`
    );
    expect(backs()).toBe(0);
  });
});

describe('launching the app for the a11y sweep and the tree checks', () => {
  it('waits for the app to hold focus, though the closing task still shows a tab bar', async () => {
    const { device, sent, backs } = scriptedDevice([
      { focus: 'launcher', xml: TABS_XML },
      { focus: null, xml: TABS_XML },
      { focus: 'activity', xml: TABS_XML },
    ]);
    await device.startFromLaunch();
    expect(sent).toContain(`am start -W -n ${APP}/.MainActivity`);
    expect(sent.filter((c) => c === 'dumpsys window displays')).toHaveLength(3);
    expect(backs()).toBe(0);
  });
});
