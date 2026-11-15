/**
 * The reads of the device that `agent-device` will not make for this suite.
 *
 * Everything else here is e2e's: the gesture, the tree query, the box, the
 * assertion. These three are raw `adb` because the driver's own route cannot
 * answer them, and mostly for the same reason — the Android *automation helper*
 * that `agent-device` installs owns device automation, and it serialises what it
 * is asked to do:
 *
 * - **The keyboard's edge.** The helper installs a headless IME so text entry is
 *   deterministic, so the app is never given a keyboard to avoid, and the edge a
 *   keyboard check has to measure exists only in the window manager's own report.
 *   `keyboard.ts` puts the device's real IME back for the length of the gesture
 *   and reads that report. (The suite cannot even ask the helper for it: it is not
 *   one of the helper's commands.)
 * - **A frame while a finger is down.** The driver takes a screenshot through the
 *   same helper that injects the gesture, so a capture asked for during an
 *   in-flight gesture is served only once the gesture ends: measured on
 *   `list-item`, a capture asked for 500 ms into a 10 000 ms press came back
 *   10 240 ms after it, and the row in it was already unpressed. Pixels taken
 *   beside the helper, not through it, are the only way to see a held press.
 *   `press-feedback.ts` is that caller.
 * - **The tree as the accessibility service reads it.** e2e answers from its own
 *   normalised snapshot, which has no `clickable`/`checkable`/`selected` flag and
 *   no Android class, so the actionable-node rule and the state facts a screen
 *   reader is given are not questions it can be asked. `uiautomator dump` *is*
 *   that tree, unnormalised: `os-tree.ts` reads it and applies the same rule the
 *   a11y sweep applies from `scripts/real-input/a11y.mjs`.
 *
 * All three are reads. Nothing in this file drives a device: no `input`, no `am`.
 * Every call names the leased serial on the leased adb server, because another
 * task's emulator — and the human's `emulator-5560` — are visible on the default
 * server, and AGENTS.md is explicit about not reaching them.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import {
  decodePng,
  type DecodedPng,
} from '../../../scripts/real-input/png-pixel.mjs';

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
 * One frame of the leased device's screen, in device px.
 *
 * Deliberately not the driver's screenshot — see the file comment. The bytes come
 * back on stdout (`exec-out`, so no shell rewrites the `\n`s of a PNG) and are
 * decoded here rather than written to a file, because the caller compares two
 * frames and keeps neither unless the check goes red.
 */
export function screenCapture(): DecodedPng {
  let png: Buffer;
  try {
    png = execFileSync(
      adbBinary(),
      [...serverArgs(), '-s', leasedSerial(), 'exec-out', 'screencap', '-p'],
      { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 30_000 }
    );
  } catch (error) {
    throw new Error(
      'real-input: reading a frame from the leased device failed: ' +
        String((error as Error)?.message ?? error)
    );
  }
  try {
    return decodePng(png);
  } catch (error) {
    throw new Error(
      `real-input: the leased device answered with ${String(png.length)} bytes ` +
        'that are not a PNG this suite can read: ' +
        String((error as Error)?.message ?? error)
    );
  }
}

/**
 * One raw `uiautomator dump`, as the XML text the device wrote.
 *
 * Dumped to a file and read back rather than piped: `uiautomator dump` on a window
 * that is still animating answers `could not get idle state` and nothing on stdout,
 * so the retry has to be able to tell "empty" from "half a document", and a second
 * read of the same file is cheaper than a second dump.
 */
export function accessibilityDump(
  remoteFile = '/sdcard/nitro-ui-real-input-tree.xml',
  attempts = 4
): string {
  let last = '';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const dumped = execFileSync(
      adbBinary(),
      [
        ...serverArgs(),
        '-s',
        leasedSerial(),
        'shell',
        'uiautomator',
        'dump',
        remoteFile,
      ],
      { encoding: 'utf8', timeout: 30_000 }
    );
    const read = adbShell(['cat', remoteFile]);
    if (read.includes('<node') || dumped.includes('<node')) {
      return read;
    }
    last = read === '' ? dumped.trim() : read;
    // Blocking, because the caller is a synchronous read of "what does the tree
    // say right now" and a refused dump is a moving window, not an error.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  throw new Error(
    `real-input: \`uiautomator dump\` answered nothing usable after ` +
      `${String(attempts)} attempts on ${leasedSerial()}. It said: ` +
      `${last.slice(0, 300)}`
  );
}

/**
 * The density the app lays out at, as a multiple of 160 dpi.
 *
 * A check that judges a dp number the library drew has to compare it against px, and an
 * emulator's profile density is not the number its AVD was created with once
 * `wm density` has been overridden.
 */
/**
 * The screen's density, so a check can turn the library's dp numbers into the px
 * the device draws. `wm density` is the density the app lays out at, which an
 * emulator can have overridden from the profile's own number.
 */
export function displayDensity(): number {
  const reported = /Physical density:\s*(\d+)|Override density:\s*(\d+)/g;
  const dump = adbShell(['shell', 'wm', 'density']);
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
