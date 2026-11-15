import { describe, expect, it } from '@jest/globals';

import {
  PLACEMENT_SLOP_PX,
  judgePopupPlacement,
} from '../real-input/popover-placement.mjs';

// Boxes measured on an API 35 emulator, in px.
const ANCHOR = { y1: 1646, y2: 1752 };

// 16 dp and 4 dp at the measured density.
const MARGIN = 42;
const SPACING = 11;

// The keyboard's top edge.
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
    // Three px off: one past the tolerance.
    expect(PLACEMENT_SLOP_PX).toBe(2);
    expect(judge({ y1: 1085, y2: 1502 }).ok).toBe(false);
    expect(judge({ y1: 1766, y2: 2180 }, { imeTopPx: null }).ok).toBe(false);
  });

  it('fails when the anchor was never measured rather than guessing a branch', () => {
    const seen = judge({ y1: 1085, y2: 1499 }, { anchorBox: null });
    expect(seen.ok).toBe(false);
    expect(seen.branch).toBe('missing');
  });

  it('fails when the popup is not in the dump at all', () => {
    expect(judge(null).branch).toBe('missing');
  });
});
