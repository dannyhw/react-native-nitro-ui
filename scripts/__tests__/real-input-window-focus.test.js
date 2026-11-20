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

/** A whole `dumpsys window`, focused on one of `WINDOWS` (or on nothing). */
function dumpsysWindow(focused) {
  const hash =
    focused == null ? null : WINDOWS[focused].match(/Window\{(\S+) /)[1];
  const title =
    focused == null
      ? null
      : WINDOWS[focused].match(/Window\{\S+ u0 ([^\n]*)\}:/)[1];
  return [
    'WINDOW MANAGER WINDOWS (dumpsys window windows)',
    ...Object.values(WINDOWS),
    '',
    'WINDOW MANAGER DISPLAY CONTENTS (dumpsys window displays)',
    `  mCurrentFocus=${hash == null ? 'null' : `Window{${hash} u0 ${title}}`}`,
    `  mFocusedApp=ActivityRecord{9e1 u0 ${APP}/.MainActivity t12}`,
  ].join('\n');
}

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
 * A device whose focus and screen follow a script: each `dumpsys window` read takes the
 * next step, and the last step stays. Every command it is sent is recorded.
 *
 * @param {Array<{ focus: keyof typeof WINDOWS | null, xml: string, ime?: boolean }>} steps
 */
function scriptedDevice(steps) {
  const sent = [];
  let step = 0;
  const now = () => steps[Math.min(step, steps.length - 1)];
  const adbShell = (command) => {
    sent.push(command);
    if (command === 'wm size') return 'Physical size: 1080x2400\n';
    if (command === 'dumpsys window') {
      const shown = now();
      step += 1;
      return dumpsysWindow(shown.focus);
    }
    if (command.startsWith('uiautomator dump'))
      return 'UI hierchary dumped to: /sdcard/x.xml\n';
    if (command.startsWith('cat '))
      return steps[Math.min(step - 1, steps.length - 1)].xml;
    if (command === 'dumpsys input_method') {
      return steps[Math.min(step - 1, steps.length - 1)].ime === true
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

describe('returning to the app window after a relaunch', () => {
  it('sends no Back while the launcher holds focus, and returns once the app does', async () => {
    const { device, sent, backs } = scriptedDevice([
      { focus: 'launcher', xml: LAUNCHER_XML },
      { focus: null, xml: LAUNCHER_XML },
      { focus: 'activity', xml: TABS_XML },
    ]);
    await returnToAppWindow(device, 10_000);
    expect(backs()).toBe(0);
    expect(sent).toContain(`am start -n ${APP}/.MainActivity`);
    expect(sent.filter((c) => c === 'dumpsys window')).toHaveLength(3);
  });

  it('sends no Back while the app activity is focused but its tab bar is not drawn yet', async () => {
    const { device, backs } = scriptedDevice([
      { focus: 'splash', xml: NO_TABS_XML },
      { focus: 'activity', xml: NO_TABS_XML },
      { focus: 'activity', xml: NO_TABS_XML },
      { focus: 'activity', xml: TABS_XML },
    ]);
    await returnToAppWindow(device, 10_000);
    expect(backs()).toBe(0);
  });

  it('collapses the shade instead of pressing Back on it', async () => {
    const { device, sent, backs } = scriptedDevice([
      { focus: 'shade', xml: LAUNCHER_XML },
      { focus: 'activity', xml: TABS_XML },
    ]);
    await returnToAppWindow(device, 10_000);
    expect(backs()).toBe(0);
    expect(sent).toContain('cmd statusbar collapse');
  });

  it("still presses Back on the app's own popup and keyboard", async () => {
    const { device, backs } = scriptedDevice([
      { focus: 'popup', xml: NO_TABS_XML },
      { focus: 'activity', xml: NO_TABS_XML, ime: true },
      { focus: 'activity', xml: TABS_XML },
    ]);
    await returnToAppWindow(device, 10_000);
    expect(backs()).toBe(2);
  });

  it('fails naming the focused window when the app does not come back', async () => {
    const { device, backs } = scriptedDevice([
      { focus: 'launcher', xml: LAUNCHER_XML },
    ]);
    await expect(returnToAppWindow(device, 1200)).rejects.toThrow(
      `did not come back to its tab bar within 1 s. The focused window was "${LAUNCHER}" (other)`
    );
    expect(backs()).toBe(0);
  });
});
