/**
 * The two reads of the device that `agent-device` will not make: the window
 * manager's keyboard inset, and a frame taken while a finger is down. The
 * automation helper that drives the device is serialised and installs a headless
 * IME, so both exist only beside it. Nothing here drives a device: no `input`, no
 * `am`, and every call names the leased serial on the leased adb server.
 */ import { execFileSync } from 'node:child_process';
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
 * The screen's density, so a check can turn the library's dp numbers into the px
 * the device draws. `wm density` is the density the app lays out at, which an
 * emulator can have overridden from the profile's own number.
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
