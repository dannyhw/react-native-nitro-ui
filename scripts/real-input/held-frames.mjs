/**
 * Reading the screen while a finger is held, timed by the device's own clock.
 *
 * A frame is `screencap` without `-p`, written to a file on the device: a little-endian
 * header (width, height, pixel format, and from Android 10 a dataspace word) and then the
 * pixels unencoded. Only the rows a check samples cross adb, and `/proc/uptime` is read
 * on either side of the capture, so when a frame was taken does not depend on how long
 * the encoding, the transfer or the driver took.
 */

/** `HAL_PIXEL_FORMAT_RGBA_8888`, the one format an emulator's screen is read in. */
const RGBA_8888 = 1;

/** `/proc/uptime` prints hundredths of a second, rounded down. */
export const UPTIME_STEP_S = 0.01;

/**
 * @typedef {object} FrameGeometry
 * @property {number} width
 * @property {number} height
 * @property {number} headerBytes 12 or 16
 */

/**
 * The geometry of a raw frame, from its first 16 bytes and its length.
 *
 * @param {Uint8Array} head at least the first 12 bytes of the frame
 * @param {number} length the frame's size in bytes
 * @returns {FrameGeometry}
 */
export function frameGeometry(head, length) {
  if (head.byteLength < 12) {
    throw new Error(
      `held-frames: ${String(head.byteLength)} bytes is shorter than a frame header`
    );
  }
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const width = view.getUint32(0, true);
  const height = view.getUint32(4, true);
  const format = view.getUint32(8, true);
  if (format !== RGBA_8888) {
    throw new Error(
      `held-frames: pixel format ${String(format)} is not RGBA_8888 (${String(RGBA_8888)})`
    );
  }
  const headerBytes = length - width * height * 4;
  if (
    width === 0 ||
    height === 0 ||
    (headerBytes !== 12 && headerBytes !== 16)
  ) {
    throw new Error(
      `held-frames: a ${String(width)}x${String(height)} frame needs ` +
        `${String(width * height * 4)} pixel bytes after a 12 or 16 byte header, ` +
        `and the frame is ${String(length)} bytes`
    );
  }
  return { width, height, headerBytes };
}

/**
 * Rows `top` to `top + count - 1` of a frame, as an image `count` rows tall.
 *
 * @param {FrameGeometry} geometry
 * @param {number} top
 * @param {number} count
 * @param {Uint8Array} bytes exactly those rows, as the device sent them
 * @returns {import('./png-pixel.mjs').DecodedPng}
 */
export function frameRows(geometry, top, count, bytes) {
  const expected = geometry.width * count * 4;
  if (bytes.byteLength !== expected) {
    throw new Error(
      `held-frames: rows ${String(top)}-${String(top + count - 1)} of a ` +
        `${String(geometry.width)} px wide frame are ${String(expected)} bytes, ` +
        `and ${String(bytes.byteLength)} arrived`
    );
  }
  return { width: geometry.width, height: count, channels: 4, pixels: bytes };
}

/**
 * The device time, in seconds of uptime, of the newest touchscreen lift the input
 * dispatcher reports, or `null` when its recent events hold none.
 *
 * `eventTime` is nanoseconds on the monotonic clock, which never runs ahead of the
 * boot-time clock `/proc/uptime` reads, so comparing the two can only make a frame look
 * later than it was.
 *
 * @param {string} dump `dumpsys input`
 * @returns {number | null}
 */
export function lastTouchUpSeconds(dump) {
  let newest = null;
  for (const line of dump.split('\n')) {
    if (!/\bsource=TOUCHSCREEN\b/.test(line) || !/\baction=UP\b/.test(line)) {
      continue;
    }
    const match = /\beventTime=(\d+)\b/.exec(line);
    if (match == null) continue;
    const seconds = Number(match[1]) / 1e9;
    if (newest == null || seconds > newest) newest = seconds;
  }
  return newest;
}

/**
 * @typedef {object} HeldFrame
 * @property {number} askedAt ms after the press was issued, by the host's clock
 * @property {number} takenBy device uptime, in seconds, read once the capture had finished
 * @property {number} mean the sampled box's mean luminance
 */

/**
 * The most a frame darkened the box while the finger was certainly still down.
 *
 * A frame counts only if the device's clock, read after the capture finished and
 * rounded up a step, is earlier than the lift. A frame taken before the finger landed
 * shows the box at rest and counts for nothing, so the landing is not needed.
 *
 * @param {number} before mean luminance at rest
 * @param {readonly HeldFrame[]} frames
 * @param {number} liftedAt device uptime of the lift, in seconds
 * @returns {number} `-Infinity` when no frame was taken before the lift
 */
export function heldDrop(before, frames, liftedAt) {
  return frames
    .filter((frame) => frame.takenBy + UPTIME_STEP_S < liftedAt)
    .reduce((most, frame) => Math.max(most, before - frame.mean), -Infinity);
}
