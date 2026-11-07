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

/**
 * The keyboard's top edge from one `Window #` block for the IME window.
 *
 * `imeFrameTop` alone is not enough, and the difference is a whole release's worth of
 * wrong answers: the IME window exists whether or not a keyboard is on screen, and while
 * it is *not* being displayed it is laid out over the app - on the API 35 image,
 * `mViewVisibility=0x8`, `isReadyForDisplay()=false`, and `frame=[0,142][1080,2424]`. That
 * is a real parseable frame, and the top of it is the status bar. Read once, as the
 * keyboard's own `mInputShown` flips true but before the window is drawn, it turns into a
 * check that says the field is 1,400 px under a keyboard that is not there. So a block that
 * says it is not displayed is treated as saying nothing, and the caller waits for a block
 * that does.
 *
 * A block that carries neither marker is parsed anyway: the two are what this release
 * prints, not a contract, and a dump that stops printing them should fall through to the
 * frame rather than silently fail a rule.
 *
 * @param {string} block one `Window #` block, IME window expected
 * @returns {number | null}
 */
export function imeWindowTop(block) {
  const text = String(block);
  if (
    /isReadyForDisplay\(\)=false/.test(text) ||
    /mViewVisibility=0x[1-9a-f]/.test(text)
  ) {
    return null;
  }
  return imeFrameTop(text);
}
