/**
 * Types for `popover-placement.mjs`, the rule that decides where a popover was
 * allowed to put itself. JavaScript with unit tests, as the other rules are.
 */

/** How many px a placed popup may be off the edge it was placed against. */
export const PLACEMENT_SLOP_PX: number;

interface Box {
  y1: number;
  y2: number;
}

/**
 * `below`/`above` next to the anchor, `aboveKeyboard` pushed clear of a visible
 * IME, or `behind`/`parked`/`missing` with the measurement that says so.
 */
export function judgePopupPlacement(input: {
  popupBox: Box | null;
  anchorBox: Box | null;
  imeTopPx: number | null;
  marginPx: number;
  spacingPx: number;
}): { ok: boolean; branch: string; detail: string };
