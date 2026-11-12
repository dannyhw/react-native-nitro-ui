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
 * with the anchor at y 2242-2410 of a 2 424 px window).
 *
 * So the side is now part of the claim rather than an assumption: the menu has to open on the
 * side that has room, and on either side it has to be against the box it was opened from.
 * "Not at the top of the screen" is what the second half catches, and the room test catches it
 * too — a menu parked at the top of the window is far from its anchor *and* on the side that
 * did not need it.
 *
 * The boxes handed in are the option rows, not the popup's surface: a Compose popup is a
 * window of its own and `uiautomator dump` answers with its accessibility tree, which carries
 * the rows and not the surface behind them (see `uiautomator.mjs`). That is why the near
 * distance is a band (`MENU_NEAR_GAP_DP`) rather than an exact number like the popover's
 * placement judge can use — the rows sit inside the surface's padding, so their box starts a
 * few dp away from the surface's edge wherever that edge is on the anchor.
 *
 * The distance graded is between the two *boxes* — zero when they overlap — and not between
 * two chosen edges. An open Material menu is allowed to overlap its anchor, bringing the
 * selected row onto the field: on the measured above-placement (anchor 2 242..2 410, rows down
 * to 2 294, X24) an edge-to-edge rule grades 52 px against a 20 dp allowance and passes with
 * one pixel to spare, which is a flake with a new name; between the boxes that same menu is 0
 * px away. What the band has to stay tighter than is the failure it exists for: a parked menu
 * measured ~1 900 px from the anchor above it.
 */

/**
 * How far a menu's near edge may sit from the box it was opened from, in dp.
 *
 * Measured, not guessed: on the lease's API 35 emulator a hosted Picker centred in the window
 * opens its first row 58 px (22 dp at 2.625) under the box the Host drew — the surface's own
 * padding plus Material's stand-off from the anchor. 32 dp is that measurement with half
 * again on it, and still less than a twentieth of the ~1 900 px the check is looking for.
 */
export const MENU_NEAR_GAP_DP = 32;

/**
 * How much narrower than the menu the room on a side may be and still count as room, in dp.
 * The room test decides which side is *wrong*, and the rows' box understates the surface the
 * platform measured — its padding and shadow are outside it. Generous on purpose: the
 * narrower this is, the closer a healthy run can sit to that line.
 */
export const MENU_ROOM_SLOP_DP = 48;

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
