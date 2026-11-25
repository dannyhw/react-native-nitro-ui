/**
 * The reads of the device that `agent-device` will not make: the window manager’s
 * keyboard inset and popup windows, a frame taken while a finger is down, and the
 * density. They exist only beside it, because it is serialised and installs a headless
 * IME. Nothing here taps or types: the one change made to the device is stopping the
 * app before a test's fresh launch.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { type DecodedPng } from '../../../scripts/real-input/png-pixel.mjs';
import {
  frameGeometry,
  frameRows,
  lastTouchUpSeconds,
  type FrameGeometry,
} from '../../../scripts/real-input/held-frames.mjs';
import { countAppPopupWindows } from '../../../scripts/real-input/popup-windows.mjs';
import { stopAndAwaitLeavingFront } from '../../../scripts/real-input/app-leaves-front.mjs';

/** The example app's package: a popup it owns is one a control of it put up. */
const APP_ID = 'nitroui.example';

/** The leased device, or nothing: an unleased shell must fail here, loudly. */
function leasedSerial(): string {
  const serial = process.env.ANDROID_SERIAL;
  if (serial == null || serial === '') {
    throw new Error(
      'real-input: ANDROID_SERIAL is unset, so this check has no device it may ' +
        'read. Source the lease before running the suite.'
    );
  }
  return serial;
}

/** The lease's own `adb`, on the lease's own server. */
function adbBinary(): string {
  const env = process.env;
  const home = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
  const sdkAdb = home != null ? `${home}/platform-tools/adb` : undefined;
  return sdkAdb != null && existsSync(sdkAdb) ? sdkAdb : (env.ADB_BIN ?? 'adb');
}

/** The lease's adb server port, as the `-P` flag adb understands. */
function serverArgs(): string[] {
  const port = process.env.ANDROID_ADB_SERVER_PORT;
  return port != null && port !== '' ? ['-P', port] : [];
}

/** `adb shell …` against the leased device, trimmed. */
export function adbShell(args: readonly string[]): string {
  try {
    return execFileSync(
      adbBinary(),
      [...serverArgs(), '-s', leasedSerial(), 'shell', ...args],
      { encoding: 'utf8', timeout: 30_000 }
    ).trim();
  } catch (error) {
    throw new Error(
      `real-input: adb ${args.join(' ')} failed: ` +
        String((error as Error)?.message ?? error)
    );
  }
}

/**
 * How many popup windows the app has up right now. A menu, a tooltip or a picker's list
 * is a window of its own, so this answers "did the control's window come down" without
 * reading the tree, which shows only the topmost window while one is up.
 */
export function popupWindowCount(): number {
  return countAppPopupWindows(
    adbShell(['dumpsys', 'window', 'windows']),
    APP_ID
  );
}

/**
 * Stop the app and wait until the window manager has moved the focus off it and the
 * activity manager has let its activities go, so the driver's fresh launch finds nothing
 * to close: the driver gives a closing app 2 s to leave the front, which a slow emulator
 * overruns.
 */
export async function stopAppUntilOutOfFront(): Promise<void> {
  await stopAndAwaitLeavingFront(
    {
      forceStop: () => {
        adbShell(['am', 'force-stop', APP_ID]);
      },
      // `pidof` exits 1 when there is no process, which is the answer waited for.
      processIds: () => adbShell([`pidof ${APP_ID} || true`]),
      windowDump: () =>
        adbShell(['dumpsys', 'window', 'displays']) +
        '\n' +
        adbShell(['dumpsys', 'window', 'windows']),
      activityDump: () => adbShell(['dumpsys', 'activity', 'activities']),
    },
    APP_ID
  );
}

/** Where a raw frame is written on the device; one at a time, overwritten. */
const RAW_FRAME = '/data/local/tmp/nitro-ui-held-frame.raw';

/** `adb exec-out sh -c …` against the leased device, as bytes. */
function adbExecOut(script: string): Buffer {
  try {
    return execFileSync(
      adbBinary(),
      [...serverArgs(), '-s', leasedSerial(), 'exec-out', 'sh', '-c', script],
      { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 30_000 }
    );
  } catch (error) {
    throw new Error(
      'real-input: reading a frame from the leased device failed: ' +
        String((error as Error)?.message ?? error)
    );
  }
}

/** The leased device's raw frame size and header, read once before a press. */
export function rawFrameGeometry(): FrameGeometry {
  const out = adbExecOut(
    `screencap ${RAW_FRAME} && stat -c %s ${RAW_FRAME} && head -c 16 ${RAW_FRAME}`
  );
  const newline = out.indexOf(10);
  return frameGeometry(
    new Uint8Array(out.subarray(newline + 1)),
    Number(out.subarray(0, newline).toString('utf8'))
  );
}

/**
 * Rows `top` to `top + count - 1` of a frame, and the device's uptime once the frame had
 * been taken. The pixels are unencoded and only those rows cross adb.
 */
export function capturedRows(
  geometry: FrameGeometry,
  top: number,
  count: number
): { image: DecodedPng; takenBy: number } {
  const offset = geometry.headerBytes + top * geometry.width * 4;
  const length = count * geometry.width * 4;
  const out = adbExecOut(
    `screencap ${RAW_FRAME} && cut -d' ' -f1 /proc/uptime && ` +
      `tail -c +${String(offset + 1)} ${RAW_FRAME} | head -c ${String(length)}`
  );
  const newline = out.indexOf(10);
  const takenBy = Number(out.subarray(0, newline).toString('utf8'));
  if (!Number.isFinite(takenBy)) {
    throw new Error(
      `real-input: the device's uptime came back as ` +
        `${JSON.stringify(out.subarray(0, Math.min(newline, 40)).toString('utf8'))}`
    );
  }
  return {
    image: frameRows(
      geometry,
      top,
      count,
      new Uint8Array(out.subarray(newline + 1))
    ),
    takenBy,
  };
}

/** The device uptime, in seconds, of the newest touchscreen lift, or `null`. */
export function lastTouchUp(): number | null {
  return lastTouchUpSeconds(adbShell(['dumpsys', 'input']));
}

/**
 * The screen’s density, so a check can turn the library’s dp numbers into the px the
 * device draws. `wm density` is the density the app lays out at, which an emulator can
 * have overridden from the profile’s own number.
 */
export function displayDensity(): number {
  const reported = /Physical density:\s*(\d+)|Override density:\s*(\d+)/g;
  const dump = adbShell(['wm', 'density']);
  const dpi = [...dump.matchAll(reported)].map((match) =>
    Number(match[1] ?? match[2])
  );
  const used = dpi.at(-1);
  if (used == null || !Number.isFinite(used) || used <= 0) {
    throw new Error(
      `real-input: \`wm density\` did not name a density, so dp numbers cannot be ` +
        `turned into the px the device draws. It said: ${dump.trim()}`
    );
  }
  return used / 160;
}
