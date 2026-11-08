/**
 * Where the Android popover put its popup, judged from outside the process.
 *
 * `PopoverPlacement` (the Kotlin half) has three answers to "where does the popup go":
 * below the anchor, above the anchor, or — when the keyboard leaves room for neither — as
 * high as the frame allows, which puts the popup's bottom edge exactly one margin above the
 * keyboard. Every one of those is a claim about a box a device run can measure: the popup's
 * own box, the anchor's, and the keyboard's top edge. Without that check the keyboard claim
 * was half-blind, and it stayed half-blind through the bug this file exists for: the popup
 * was pinned to the top of the screen, 985 px above the edge it should have sat against,
 * and "the field is above the keyboard" was *true* — the field was above the keyboard
 * because the popup was nowhere near its anchor (G22).
 *
 * So this is the other half of the claim: the popup is where the placement model says it
 * must be, next to the anchor it belongs to or against the keyboard's edge. Anything else is
 * a popup that got parked.
 *
 * The tolerance is 2 px, not a finger's width: the placement answers in whole pixels and
 * uiautomator reports whole pixels, so a placement that worked lands on the number exactly
 * (measured on the API 35 emulator: asked for y 1085, popup drawn at y 1085).
 */

/** How far a box may be from where the placement asked for it, px. */
export const PLACEMENT_SLOP_PX = 2;

/**
 * Judge one presented popover's box.
 *
 * @param {object} input
 * @param {{ y1: number, y2: number } | null} input.popupBox the popup's box on screen
 * @param {{ y1: number, y2: number } | null} input.anchorBox the anchor's box, read before
 *   the popover opened: while a focusable popup is up the dump carries only the popup's own
 *   window, so the anchor is not in it.
 * @param {number | null} input.imeTopPx the keyboard's top edge, or null with no keyboard
 * @param {number} input.marginPx how far inside the frame the popup may not cross
 * @param {number} input.spacingPx the gap the placement keeps between anchor and popup
 * @returns {{ ok: boolean, branch: string, detail: string }}
 */
export function judgePopupPlacement({
  popupBox,
  anchorBox,
  imeTopPx,
  marginPx,
  spacingPx,
}) {
  if (popupBox == null) {
    return {
      ok: false,
      branch: 'missing',
      detail: 'the popup is not in the dump',
    };
  }
  if (anchorBox == null) {
    return {
      ok: false,
      branch: 'missing',
      detail:
        'the anchor was never measured, so "next to it" cannot be checked',
    };
  }
  const detail = `popup ${popupBox.y1}..${popupBox.y2}, anchor ${anchorBox.y1}..${anchorBox.y2}`;
  if (imeTopPx != null && popupBox.y2 > imeTopPx) {
    return {
      ok: false,
      branch: 'behind',
      detail: `${detail} sits behind the keyboard's edge at ${String(imeTopPx)}`,
    };
  }
  const below = Math.abs(popupBox.y1 - (anchorBox.y2 + spacingPx));
  const above = Math.abs(popupBox.y2 - (anchorBox.y1 - spacingPx));
  if (below <= PLACEMENT_SLOP_PX) {
    return {
      ok: true,
      branch: 'below',
      detail: `${detail}, ${String(below)} px off below`,
    };
  }
  if (above <= PLACEMENT_SLOP_PX) {
    return {
      ok: true,
      branch: 'above',
      detail: `${detail}, ${String(above)} px off above`,
    };
  }
  if (imeTopPx == null) {
    return {
      ok: false,
      branch: 'parked',
      detail: `${detail} is next to neither edge of its anchor with no keyboard to blame`,
    };
  }
  const againstKeyboard = Math.abs(popupBox.y2 - (imeTopPx - marginPx));
  if (againstKeyboard <= PLACEMENT_SLOP_PX) {
    return {
      ok: true,
      branch: 'aboveKeyboard',
      detail: `${detail}, ${String(againstKeyboard)} px off the keyboard's edge minus its margin`,
    };
  }
  return {
    ok: false,
    branch: 'parked',
    detail: `${detail} is ${String(Math.min(below, above))} px from its anchor and ${String(
      againstKeyboard
    )} px from the keyboard's edge, which is a popup that got parked`,
  };
}
