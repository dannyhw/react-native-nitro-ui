/**
 * Judging which side of its anchor a Material dropdown opened on, from boxes a run measured.
 *
 * `hosted-picker` claimed the menu "opens below the top of the box the Host drew". That is
 * half a claim, and the missing half is what flaked: Material measures the room under an
 * anchor and opens *above* it when there is none, so on a page that had come to rest with
 * the anchor on the lower fold the check went red over behaviour that was right
 * (`docs/tasks/X24/failures/2026-11-11T04-27-43Z--real-input+android--01.log`, and the same
 * run's merge round — anchor `42,2242 → 777,2410`, row "Gamma" at y 2241..2294, 14 px of
 * window left under the anchor).
 *
 * So the side is now part of the claim, and this grades the rule that decides it against the
 * boxes that run produced on the API 35 emulator: the healthy above-placement above, the
 * parked menu the check was written to catch, and the near-miss distances either side of the
 * band a menu of this anchor sits at. The failing fixtures sit one pixel past the tolerances,
 * not a mile past them — a rule that only rejects absurdity guards nothing.
 *
 * The pixel numbers are the lease's Pixel 9 profile: a 1 080 x 2 424 window at density
 * 2.625, which is what turns the two allowances below into dp.
 */

import { describe, expect, it } from '@jest/globals';

import { judgeMenuAnchoring } from '../real-input/menu-placement.mjs';

/** 20 dp and 48 dp at 2.625 — the two the Android check passes. */
const NEAR_GAP = Math.round(20 * 2.625);
const ROOM_SLOP = Math.round(48 * 2.625);

/** The window the lease's emulator reports. */
const WINDOW = 2424;

const judge = (menuBox, anchorBox, overrides = {}) =>
  judgeMenuAnchoring({
    menuBox,
    anchorBox,
    windowHeight: WINDOW,
    nearGapMaxPx: NEAR_GAP,
    roomSlopPx: ROOM_SLOP,
    ...overrides,
  });

/** A row of this menu as the device drew it: 53 px tall. */
const ROW = 53;

/** The three rows of the popup Host, stacked upward from `bottom` — an above-placement. */
const rowsAbove = (bottom) => ({
  y1: bottom - ROW * 3,
  y2: bottom,
  cy: bottom - (ROW * 3) / 2,
});

/** The same three rows, stacked downward from `top` — a below-placement. */
const rowsBelow = (top) => ({
  y1: top,
  y2: top + ROW * 3,
  cy: top + (ROW * 3) / 2,
});

/** The anchor mid-window, which is where the check now puts it before it taps. */
const CENTRED_ANCHOR = { y1: 1128, y2: 1296, cy: 1212 };

describe('the Android hosted Picker’s menu box', () => {
  it('accepts the menu opening above an anchor with no room below', () => {
    // The run that flaked, box for box: anchor 2 242..2 410 of a 2 424 px window, three
    // 53 px rows ending at the measured bottom of the "Gamma" row. Material was right to
    // open upward, and this is the case the old check called a failure.
    const seen = judge(rowsAbove(2294), { y1: 2242, y2: 2410, cy: 2326 });
    expect(seen.ok).toBe(true);
    expect(seen.branch).toBe('above');
    // …and it is accepted because the boxes overlap, not because a chosen edge happened to
    // line up: the rows' bottom sits 52 px *inside* the anchor, one pixel inside the 20 dp
    // allowance an edge-to-edge rule would have graded. Zero is the number that says
    // "anchored" without depending on which edge of a padded surface is measured.
    expect(seen.detail).toContain('0 px off its edge');
  });

  it('accepts the menu below its anchor when there is room below', () => {
    // The placement the check aims at now that it centres the anchor first: rows starting
    // 21 px (8 dp of surface padding) under the box the Host drew.
    const seen = judge(rowsBelow(1317), CENTRED_ANCHOR);
    expect(seen.ok).toBe(true);
    expect(seen.branch).toBe('below');
  });

  it('rejects a menu parked at the top of the window over an anchor at the bottom', () => {
    // H2b's bug — a menu drawn against the wrong box, here the top of the screen. The room
    // test agrees with it (14 px under the anchor is no room either), so this is the case
    // that proves the *distance* rule bites on its own and not only as a tiebreaker.
    const seen = judge(
      { y1: 142, y2: 301, cy: 221 },
      { y1: 2242, y2: 2410, cy: 2326 }
    );
    expect(seen.ok).toBe(false);
    expect(seen.branch).toBe('parked');
  });

  it('rejects a menu that flips up when there is room under the anchor', () => {
    // Sitting against the anchor, so the distance rule is satisfied — and wrong all the
    // same: 1 128 px of window under an anchor is room for a 159 px menu three times over,
    // and a menu that opens upward here is anchored to something other than the room.
    const seen = judge(
      { y1: 1128 - ROW * 3, y2: 1127, cy: 1127 - (ROW * 3) / 2 },
      CENTRED_ANCHOR
    );
    expect(seen.ok).toBe(false);
    expect(seen.branch).toBe('wrongSide');
  });

  it('rejects a menu a little way off the box it was opened from', () => {
    // One pixel past the band, and one pixel inside it: "roughly near the anchor" is not
    // the claim, and a tolerance nobody has touched is a tolerance nobody measured.
    expect(NEAR_GAP).toBe(53);
    expect(judge(rowsBelow(1296 + NEAR_GAP), CENTRED_ANCHOR).ok).toBe(true);
    expect(judge(rowsBelow(1296 + NEAR_GAP + 1), CENTRED_ANCHOR).ok).toBe(
      false
    );
    expect(judge(rowsBelow(1296 + NEAR_GAP + 1), CENTRED_ANCHOR).branch).toBe(
      'parked'
    );
  });

  it('rejects a menu that runs off the bottom of the window', () => {
    // The other half of the side rule: opening below an anchor with nothing under it is not
    // a placement, it is a clipped menu.
    const lowAnchor = { y1: 2242, y2: 2410, cy: 2326 };
    const seen = judge({ y1: 2411, y2: 2570, cy: 2490 }, lowAnchor);
    expect(seen.ok).toBe(false);
    expect(seen.branch).toBe('wrongSide');
  });

  it('fails when the anchor was never measured rather than guessing a side', () => {
    // The anchor has to be read before the tap: while a popup is up, the dump answers with
    // the popup’s window only, so a run that forgot to is not allowed to decide on the
    // menu’s own that it is in the right place.
    const seen = judge(rowsAbove(2294), null);
    expect(seen.ok).toBe(false);
    expect(seen.branch).toBe('missing');
  });

  it('fails when the menu is not in the dump at all', () => {
    expect(judge(null, CENTRED_ANCHOR).branch).toBe('missing');
  });
});
