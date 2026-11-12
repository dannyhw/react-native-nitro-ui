/**
 * Judging which side of its anchor a Material dropdown opened on, from boxes a run measured.
 *
 * `hosted-picker` claimed the menu "opens below the top of the box the Host drew". That is
 * half a claim, and the missing half is what flaked: Material measures the room under an
 * anchor and opens *above* it when there is none, so on a page that had come to rest with the
 * anchor on the lower fold the check went red over behaviour that was right
 * (`docs/tasks/X24/failures/2026-11-11T04-27-43Z--real-input+android--01.log`, and the same
 * run's merge round — anchor `42,2242 → 777,2410`, row "Gamma" at y 2241..2294, 14 px of
 * window left under the anchor).
 *
 * The fixtures below are boxes the API 35 emulator answered with, not sketches: the healthy
 * placement from X31's own run (anchor `42,1051 → 777,1219`, three rows at 1 277..1 582), and
 * the failing one from X24 with the same measured row stack hung from the row that log named.
 * The failing fixtures then sit one pixel past the tolerances rather than a mile past them —
 * a rule that only rejects absurdity guards nothing, and the first draft of this band was 5
 * px too tight and went red on a correct menu, which is how the 32 dp got measured.
 *
 * All of it is in the lease's Pixel 9 profile: a 1 080 x 2 424 window at density 2.625, which
 * is what turns the two dp allowances into the pixels below.
 */

import { describe, expect, it } from '@jest/globals';

import {
  MENU_NEAR_GAP_DP,
  MENU_ROOM_SLOP_DP,
  judgeMenuAnchoring,
} from '../real-input/menu-placement.mjs';

/** 32 dp and 48 dp at 2.625 — the two the Android check passes. */
const NEAR_GAP = Math.round(MENU_NEAR_GAP_DP * 2.625);
const ROOM_SLOP = Math.round(MENU_ROOM_SLOP_DP * 2.625);

/** The window the lease's emulator reports. */
const WINDOW = 2424;

/** The three rows of the popup Host, as one run measured them stacked downward. */
const MENU_HEIGHT = 1582 - 1277;

const judge = (menuBox, anchorBox, overrides = {}) =>
  judgeMenuAnchoring({
    menuBox,
    anchorBox,
    windowHeight: WINDOW,
    nearGapMaxPx: NEAR_GAP,
    roomSlopPx: ROOM_SLOP,
    ...overrides,
  });

const box = (y1, y2) => ({ y1, y2, cy: (y1 + y2) / 2 });

/** The three rows, opening downward from `top`. */
const rowsBelow = (top) => box(top, top + MENU_HEIGHT);

/**
 * The anchor and menu of the run this rule was written against: the check had centred the
 * anchor, and the menu opened below it, 58 px under the box the Host drew.
 */
const ANCHOR_CENTRED = box(1051, 1219);
const MENU_BELOW = box(1277, 1582);

describe('the Android hosted Picker’s menu box', () => {
  it('accepts the menu below its anchor, as the device placed it', () => {
    const seen = judge(MENU_BELOW, ANCHOR_CENTRED);
    expect(seen.ok).toBe(true);
    expect(seen.branch).toBe('below');
    // The number the allowance is sized against: 58 px of surface padding and stand-off,
    // printed on every run so a band that stops fitting is visible in the log.
    expect(seen.detail).toContain('58 px off its edge');
  });

  it('accepts the menu opening above an anchor with no room below', () => {
    // The run that flaked: anchor 2 242..2 410 of a 2 424 px window with 14 px under it, and
    // the same three rows ending at the measured bottom of the "Gamma" row, 2 294. Material
    // was right to open upward, and this is the case the old check called a failure.
    const seen = judge(box(2294 - MENU_HEIGHT, 2294), box(2242, 2410));
    expect(seen.ok).toBe(true);
    expect(seen.branch).toBe('above');
    // …accepted because the boxes overlap, not because a chosen edge lined up: the rows'
    // bottom is 52 px *inside* the anchor, and an edge-to-edge rule grades that as 52 px
    // against this same band and passes with one pixel to spare.
    expect(seen.detail).toContain('0 px off its edge');
  });

  it('rejects a menu parked at the top of the window over an anchor at the bottom', () => {
    // H2b's bug — a menu drawn against the wrong box, here the top of the screen. The room
    // test agrees with it (14 px under that anchor is no room either), so this is the case
    // that proves the *distance* rule bites on its own and not only as a tiebreaker.
    const seen = judge(box(142, 301), box(2242, 2410));
    expect(seen.ok).toBe(false);
    expect(seen.branch).toBe('parked');
  });

  it('rejects a menu that flips up when there is room under the anchor', () => {
    // Sitting against the anchor, so the distance rule is satisfied — and wrong all the
    // same: 1 205 px of window under that anchor is room for this menu four times over, so
    // a menu that opens upward from there is anchored to something other than the room.
    const seen = judge(
      box(ANCHOR_CENTRED.y1 - MENU_HEIGHT - 1, ANCHOR_CENTRED.y1 - 1),
      ANCHOR_CENTRED
    );
    expect(seen.ok).toBe(false);
    expect(seen.branch).toBe('wrongSide');
  });

  it('rejects a menu a little way off the box it was opened from', () => {
    // One pixel past the band, and one pixel inside it: "roughly near the anchor" is not
    // the claim, and a tolerance nobody has touched is a tolerance nobody measured.
    expect(NEAR_GAP).toBe(84);
    expect(judge(rowsBelow(1219 + NEAR_GAP), ANCHOR_CENTRED).ok).toBe(true);
    const past = judge(rowsBelow(1219 + NEAR_GAP + 1), ANCHOR_CENTRED);
    expect(past.ok).toBe(false);
    expect(past.branch).toBe('parked');
  });

  it('rejects a menu that runs off the bottom of the window', () => {
    // The other half of the side rule: opening below an anchor with nothing under it is not
    // a placement, it is a clipped menu.
    const seen = judge(box(2411, 2411 + MENU_HEIGHT), box(2242, 2410));
    expect(seen.ok).toBe(false);
    expect(seen.branch).toBe('wrongSide');
  });

  it('fails when the anchor was never measured rather than guessing a side', () => {
    // The anchor has to be read before the tap: while a popup is up the dump answers with
    // the popup’s window only, so a run that forgot to is not allowed to decide on the
    // menu’s own that it is in the right place.
    const seen = judge(MENU_BELOW, null);
    expect(seen.ok).toBe(false);
    expect(seen.branch).toBe('missing');
  });

  it('fails when the menu is not in the dump at all', () => {
    expect(judge(null, ANCHOR_CENTRED).branch).toBe('missing');
  });
});
