/**
 * Which side of its anchor a Material dropdown opened on, judged from outside the process.
 *
 * `hosted-picker`'s claim is H2b's: the menu belongs to the composition the Host drew, so it
 * opens against *that* box — not against the decorative React Native frame, and not parked at
 * the top of the screen. The check used to assert one half of that, `firstRow.y1 >= anchor.y1`,
 * and it was wrong in a way that only showed up on a page that had come to rest with the
 * anchor on the lower fold: Material measures the room under an anchor and opens *above* it
 * when there is none, which is correct behaviour and made the check depend on where an
 * earlier check had left the scroll (X24 fix round 1 and the X24 merge, 2026-11-11, both
 * with the anchor at y 2243-2411).
 *
 * So the side is now part of the claim rather than an assumption: the menu has to open on the
 * side that has room, and on either side its near edge has to be against the box it was
 * opened from. "Not at the top of the screen" is what the second half catches, and it catches
 * it with the room test as well — a menu parked at the top of the window is far from its
 * anchor *and* on the side that did not need it.
 *
 * The boxes handed in are the option rows, not the popup's surface: a Compose popup is a
 * window of its own and `uiautomator dump` answers with its accessibility tree, which carries
 * the rows and not the surface behind them (see `uiautomator.mjs`). That is why
 * `nearGapMaxPx` is a band rather than an exact number like the popover's placement judge
 * can use — the rows sit inside the surface's own padding, so the near edge is a few dp from
 * the anchor's wherever the surface's edge is exactly on it; and an open menu is allowed to
 * *overlap* its anchor, because Material 3 brings the selected row onto the field rather than
 * under it. The distance graded is therefore the one between the two boxes — zero when they
 * overlap — and not the gap between two chosen edges: on the measured above-placement
 * (anchor 2 242..2 410, rows down to 2 294, X24) an edge-to-edge rule lands 1 px inside a
 * 20 dp allowance, which is a flake with a new name. What the band has to be tighter than is
 * the failure: on the device this exists for, a parked menu is ~1 900 px from an anchor that
 * sits at the bottom of the window, against a 20 dp allowance.
 */

/**
 * Judge one opened dropdown.
 *
 * @param {object} input
 * @param {{ y1: number, y2: number, cy: number } | null} input.menuBox the option rows'
 *   combined box, read while the menu is open
 * @param {{ y1: number, y2: number, cy: number } | null} input.anchorBox the anchor's box,
 *   read before the tap: while a popup is up the dump carries only the popup's own window
 * @param {number} input.windowHeight the height of the window the menu is confined to
 * @param {number} input.nearGapMaxPx how far the menu's near edge may sit from the anchor's
 *   near edge and still count as anchored to it
 * @param {number} input.roomSlopPx how much narrower than the menu the room under the anchor
 *   may be and still count as room: Material places against its own measured surface, which
 *   is the rows plus their padding, so the rows' box alone understates what the platform
 *   needed. Generous on purpose — the room test decides which side is *wrong*, and the
 *   narrower the allowance, the closer a healthy run can sit to that line.
 * @returns {{ ok: boolean, branch: string, detail: string }}
 */
export function judgeMenuAnchoring({
  menuBox,
  anchorBox,
  windowHeight,
  nearGapMaxPx,
  roomSlopPx,
}) {
  if (menuBox == null) {
    return {
      ok: false,
      branch: 'missing',
      detail: 'the menu is not in the dump',
    };
  }
  if (anchorBox == null) {
    return {
      ok: false,
      branch: 'missing',
      detail:
        'the anchor was never measured, so "against it" cannot be checked',
    };
  }
  const detail = `menu ${String(menuBox.y1)}..${String(
    menuBox.y2
  )}, anchor ${String(anchorBox.y1)}..${String(anchorBox.y2)}, window ${String(
    windowHeight
  )}`;
  const menuHeight = menuBox.y2 - menuBox.y1;
  const roomBelow = windowHeight - anchorBox.y2;
  const roomAbove = anchorBox.y1;
  const side = menuBox.cy < anchorBox.cy ? 'above' : 'below';
  const wanted = roomBelow + roomSlopPx >= menuHeight ? 'below' : 'above';
  if (side !== wanted) {
    return {
      ok: false,
      branch: 'wrongSide',
      detail: `${detail}: opened ${side} with ${String(
        roomBelow
      )} px below an anchor of ${String(
        menuHeight
      )} px of menu, which is the side that did not need it`,
    };
  }
  // The vertical distance between the two boxes: zero when the menu overlaps its anchor —
  // which an open Material menu does, bringing the selected row onto the field — and the
  // separation when it does not. A menu drawn against the box has one or the other; a menu
  // parked across the window has neither.
  const gap = Math.max(0, anchorBox.y1 - menuBox.y2, menuBox.y1 - anchorBox.y2);
  if (gap > nearGapMaxPx) {
    return {
      ok: false,
      branch: 'parked',
      detail: `${detail}: its ${side} edge is ${String(
        gap
      )} px from the anchor's box, further than the ${String(
        nearGapMaxPx
      )} px a menu of this anchor sits at`,
    };
  }
  return {
    ok: true,
    branch: side,
    detail: `${detail}: ${side} of the anchor, ${String(
      gap
    )} px off its edge, with ${String(roomBelow)} px below and ${String(
      roomAbove
    )} px above`,
  };
}
