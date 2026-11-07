/**
 * The soft keyboard's frame, read out of the dumps that report it.
 *
 * `Popover`'s Android keyboard claim is "the content stays above the keyboard", which can
 * only be checked against the keyboard's own top edge: the keyboard is 306 px tall on one
 * system image and 420 on another, so a hardcoded number would pass on the shallow one
 * whatever the popover did. Two dumps know the frame, and they have never agreed on the
 * shape — the input method service and the older window dumps print
 * `mFrame=Rect(l, t - r, b)`, while the API 34+ window dump prints a single line,
 * `Frames: parent=[..][..] frame=[l,t][r,b] last=[..][..]`, with no `mFrame=` anywhere.
 * That second shape was measured in `dumpsys window windows` on the API 35 image the
 * harness runs on, after a check that knew only the first reported "no keyboard frame"
 * with the keyboard on screen: a scrape that silently stops matching reads exactly like a
 * control that never moved.
 *
 * A `null` means "this text never mentioned a frame", never "the keyboard is at the top".
 * Callers fail their own claim on `null`, so a parser that stops matching stays a red gate
 * rather than becoming a no-op.
 */

/** Every shape a frame has been printed in, most specific first. */
const SHAPES = [
  /(?:mInputBoundsOnScreen|mInputFrame|mFrame)=Rect\((-?\d+),\s*(-?\d+) - (-?\d+),\s*(-?\d+)\)/,
  // Anchored on a boundary so that a `parentFrame=` or `displayFrame=` cannot answer for
  // the window's own frame.
  /(?:^|[\s{])frame=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/,
];

/**
 * @param {string} text a whole dump, or one `Window #` block taken out of one
 * @returns {number | null} the frame's top edge in px, or `null` when this text says nothing
 */
export function imeFrameTop(text) {
  for (const shape of SHAPES) {
    const frame = String(text).match(shape);
    if (frame == null) {
      continue;
    }
    const top = Number(frame[2]);
    const bottom = Number(frame[4]);
    // A frame with no height is a window that is not on screen, which is not an answer
    // to "where does the keyboard start".
    if (bottom > top) {
      return top;
    }
  }
  return null;
}
