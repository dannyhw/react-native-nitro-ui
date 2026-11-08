/**
 * Judging the Android popover's popup box from outside the process.
 *
 * "The field stays above the keyboard" was the whole Android keyboard claim, and it passed
 * while the popup was pinned to the top of the screen: a popup 985 px above the edge it
 * should have sat against keeps its field above the keyboard *better* than a correct one
 * does. These fixtures are the boxes that run measured on the API 35 emulator, both the
 * healthy placement and the parked one it produced, so the rule that decides the difference
 * is checked against the numbers rather than against invention.
 *
 * The tolerance matters twice over: a popup drawn 3 px away from the edge is not the same
 * claim as one drawn on it, so the far fixture is 3 px and not 300.
 */

import { describe, expect, it } from '@jest/globals';

import {
  PLACEMENT_SLOP_PX,
  judgePopupPlacement,
} from '../real-input/popover-placement.mjs';

/** The popover's anchor: the wrapper around the button that opened it. */
const ANCHOR = { y1: 1646, y2: 1752 };

/** 16 dp and 4 dp at the measured density. */
const MARGIN = 42;
const SPACING = 11;

/** The keyboard's top edge, from the `ime` InsetsSource of the same run. */
const IME_TOP = 1541;

const judge = (popupBox, overrides = {}) =>
  judgePopupPlacement({
    popupBox,
    anchorBox: ANCHOR,
    imeTopPx: IME_TOP,
    marginPx: MARGIN,
    spacingPx: SPACING,
    ...overrides,
  });

describe('the Android popover’s popup box', () => {
  it('accepts the popup sitting against the keyboard, as the device placed it', () => {
    // Asked for y 1085, drawn at 1085: the fallback branch, one margin above the keys.
    const seen = judge({ y1: 1085, y2: 1499 });
    expect(seen.ok).toBe(true);
    expect(seen.branch).toBe('aboveKeyboard');
  });

  it('accepts the popup below its anchor when there is no keyboard', () => {
    const seen = judge({ y1: 1763, y2: 2177 }, { imeTopPx: null });
    expect(seen.ok).toBe(true);
    expect(seen.branch).toBe('below');
  });

  it('accepts the popup flipped above an anchor with no room below', () => {
    const seen = judge(
      { y1: 1475, y2: 1889 },
      { anchorBox: { y1: 1900, y2: 2006 }, imeTopPx: null }
    );
    expect(seen.ok).toBe(true);
    expect(seen.branch).toBe('above');
  });

  it('rejects the popup pinned to the top of the screen', () => {
    // What the double-counted keyboard inset produced: the field was clear of the keyboard,
    // so the old claim passed, and the popup was nowhere near its anchor.
    const seen = judge({ y1: 142, y2: 556 });
    expect(seen.ok).toBe(false);
    expect(seen.branch).toBe('parked');
  });

  it('rejects a popup whose own bottom is behind the keyboard', () => {
    const seen = judge({ y1: 1136, y2: 1550 });
    expect(seen.ok).toBe(false);
    expect(seen.branch).toBe('behind');
  });

  it('rejects a popup a little way off every edge it could be placed against', () => {
    // Three px, one past the tolerance: "roughly where the model said" is not the claim.
    expect(PLACEMENT_SLOP_PX).toBe(2);
    expect(judge({ y1: 1085, y2: 1502 }).ok).toBe(false);
    expect(judge({ y1: 1766, y2: 2180 }, { imeTopPx: null }).ok).toBe(false);
  });

  it('fails when the anchor was never measured rather than guessing a branch', () => {
    // A focusable popup hides the app’s own window from the dump, so the anchor has to be
    // read before the open: nothing here may decide "next to the anchor" without it.
    const seen = judge({ y1: 1085, y2: 1499 }, { anchorBox: null });
    expect(seen.ok).toBe(false);
    expect(seen.branch).toBe('missing');
  });

  it('fails when the popup is not in the dump at all', () => {
    expect(judge(null).branch).toBe('missing');
  });
});
