/**
 * Material 3's calendar grid, measured out of a `uiautomator dump`.
 *
 * The gate this proves is the one the README screenshot showed by hand: seven weekday
 * columns inside the calendar's own box, each at least Material's 40 dp day cell, none
 * narrower than its neighbours. Every failure mode here is silent in the app — a
 * `fillWidth` control reports its box's width whatever the grid fits, and the cells are
 * Compose nodes the in-app queries cannot reach — so the rule's only evidence is the
 * dump, and the rule itself has to be provable without booting a device.
 *
 * Both dumps below are real, taken from `emulator-5574` (density 2.625) with one inline
 * `DatePicker` in a 320 dp box:
 *
 * - **before the fix**, header columns `126, 126, 126, 126, 126, 126, 20`. Material's
 *   48 dp interactive minimum wants 7 × 48 + 2 × 12 = 360 dp, the box is 320, and
 *   `Modifier.size` enforces the incoming maximum, so Saturday was left 20 px = 7.6 dp.
 * - **after it**, `105, 105, 105, 105, 105, 105, 105` — exactly 40 dp each.
 *
 * The mutants are the point. Each one is a way the fix could be *nearly* right and the
 * grid still broken, and each names the line that refuses it.
 */

import { describe, expect, it } from '@jest/globals';

import { parseHierarchy } from '../real-input/uiautomator.mjs';
import {
  DAY_CELL_MIN_DP,
  calendarGridProblems,
  measureCalendarGrid,
} from '../real-input/android-calendar.mjs';

/** The lease device's density, from `adb shell wm density`. */
const DENSITY = 2.625;

/** The calendar's own box, as the dump reports the labelled node: 0,72 → 840,1416. */
const BOX = { x1: 0, y1: 72, x2: 840, y2: 1416 };

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/**
 * One header cell, shaped like the dump's: a non-clickable node naming a weekday.
 *
 * Built through `parseHierarchy` rather than by hand, so `bounds` is the real parsed
 * object — a fixture that got `width` wrong would test the rule against a shape the
 * code never sees.
 */
function headerCell(description, x1, width) {
  return parseHierarchy(
    `<hierarchy><node content-desc="${description}" clickable="false" ` +
      `enabled="true" class="android.view.View" ` +
      `bounds="[${x1},545][${x1 + width},650]" /></hierarchy>`
  )[0];
}

/**
 * A whole header row: seven cells starting at `first`, each `width` wide with `gap`
 * between them. Widths are given explicitly so a squeezed row is expressible.
 *
 * @param {number[]} widths
 * @param {number} [gap]
 */
function headerRow(widths, gap = 0) {
  let x = 32;
  return widths.map((width, index) => {
    const cell = headerCell(WEEKDAYS[index], x, width);
    x += width + gap;
    return cell;
  });
}

/** A day cell: clickable, and its own text is a whole date. */
function dayCell(text, x1, width) {
  return parseHierarchy(
    `<hierarchy><node text="${text}" clickable="true" enabled="true" ` +
      `class="android.view.View" bounds="[${x1},791][${x1 + width},914]" /></hierarchy>`
  )[0];
}

/** A section header's list of rows: seven same-row boxes that are not a week. */
function listRow(labels) {
  let x = 40;
  return labels.map((label) => {
    const node = parseHierarchy(
      `<hierarchy><node text="${label}" clickable="true" enabled="true" ` +
        `class="android.widget.TextView" bounds="[${x},1700][${x + 120},1760]" /></hierarchy>`
    )[0];
    x += 130;
    return node;
  });
}

/** What the real dumps measured, as a fixture pair. */
const BROKEN_320 = headerRow([126, 126, 126, 126, 126, 126, 20]);
const FIXED_320 = headerRow([105, 105, 105, 105, 105, 105, 105]);

/** The calendar's grid, with the app's other text and its day cells around it. */
function screen(cells) {
  return [
    parseHierarchy(
      '<hierarchy><node content-desc="" text="Select date" class="android.widget.TextView" ' +
        'bounds="[63,140][246,193]" /></hierarchy>'
    )[0],
    // The month toggle: clickable, and it names a year, which is what makes a
    // date-shaped filter alone the wrong filter.
    parseHierarchy(
      '<hierarchy><node text="October 2026" clickable="true" enabled="true" ' +
        'class="android.widget.TextView" bounds="[64,435][285,488]" /></hierarchy>'
    )[0],
    ...cells,
    dayCell('Sunday, October 4, 2026', 22, 105),
    dayCell('Monday, October 5, 2026', 137, 105),
  ];
}

describe('real-input Android calendar grid', () => {
  it('reads the seven weekday columns out of a laid-out calendar', () => {
    const grid = measureCalendarGrid(screen(FIXED_320), BOX, DENSITY);
    expect(grid).not.toBeNull();
    expect(grid.columns).toHaveLength(7);
    expect(grid.minWidthDp).toBeCloseTo(40, 5);
    expect(calendarGridProblems(grid)).toEqual([]);
  });

  it('names the clipped calendar the dump showed before the fix', () => {
    const grid = measureCalendarGrid(screen(BROKEN_320), BOX, DENSITY);
    expect(grid).not.toBeNull();
    expect(grid.minWidthDp.toFixed(1)).toBe('7.6');
    expect(calendarGridProblems(grid)).toEqual([
      "the narrowest column is 7.6 dp, under Material's 40 dp day cell",
      'columns differ by 106 px wide, so they are not sharing the width out evenly',
    ]);
  });

  it('refuses a grid that lost its last column rather than only shrinking it', () => {
    // At a 240 dp box Material's own layout dropped the seventh header from the tree
    // entirely: six 126 px columns and no Saturday at all. A rule that only read the
    // widths of whatever is there would have been handed six 48 dp columns to praise.
    const six = headerRow([126, 126, 126, 126, 126, 126]);
    const grid = measureCalendarGrid(screen(six), BOX, DENSITY);
    expect(grid).not.toBeNull();
    expect(calendarGridProblems(grid)).toEqual([
      'only 6 of 7 weekday columns are laid out',
    ]);
  });

  it('catches a squeeze that never reaches the 40 dp floor', () => {
    // The arithmetic floor alone is not enough: a grid can hand its leftover to one
    // column and stay above 40 dp everywhere. Every column here clears the 105 px that
    // 40 dp is at this density, and an 8 px spread is not rounding.
    const grid = measureCalendarGrid(
      screen(headerRow([118, 118, 118, 118, 118, 118, 110])),
      BOX,
      DENSITY
    );
    expect(grid.minWidthDp).toBeGreaterThan(DAY_CELL_MIN_DP);
    expect(calendarGridProblems(grid)).toEqual([
      'columns differ by 8 px wide, so they are not sharing the width out evenly',
    ]);
  });

  it('tolerates the pixel rounding a real seven-column grid reports', () => {
    // Measured at a 361 dp box: `110, 110, 111, 110, 110, 110, 110`. Compose rounds
    // each column's `SpaceEvenly` share to whole pixels, so 1 px apart is the same
    // column, and a rule that demanded equality would call a healthy calendar broken.
    const grid = measureCalendarGrid(
      screen(headerRow([110, 110, 111, 110, 110, 110, 110])),
      BOX,
      DENSITY
    );
    expect(calendarGridProblems(grid)).toEqual([]);
  });

  it('ignores day cells, the month toggle and a scroll-clipped header', () => {
    // Day cells are clickable; the toggle names a year and is clickable; a header
    // scrolled out of the composition's clip is named with `[0,0][0,0]`. None of them
    // is a column, and a rule that let them in would report an eighth column of
    // somebody else's width and call the calendar fine.
    const grid = measureCalendarGrid(
      [
        ...screen(FIXED_320),
        headerCell('Sunday', 0, 0),
        ...listRow([
          'Alpha',
          'Bravo',
          'Charlie',
          'Delta',
          'Echo',
          'Foxtrot',
          'Golf',
        ]),
      ],
      BOX,
      DENSITY
    );
    expect(grid.columns).toHaveLength(7);
    expect(grid.columns[0].x1).toBe(32);
    expect(calendarGridProblems(grid)).toEqual([]);
  });

  it('says so when this calendar is not on screen at all', () => {
    // Not a pass: a check that read "no header row" as "no problems" would go green on
    // a calendar that never rendered.
    expect(measureCalendarGrid(screen([]), BOX, DENSITY)).toBeNull();
  });

  it('only measures the calendar it was pointed at', () => {
    // The DatePicker screen has several inline calendars. Read across the whole tree
    // the rule would mix their rows and could not say which calendar it judged, so a
    // second calendar's header, outside this box, must not join the count.
    const other = headerRow([200, 200, 200, 200, 200, 200, 200]).map(
      (node) => ({
        ...node,
        bounds: {
          ...node.bounds,
          y1: 2000,
          y2: 2105,
          cy: 2052,
        },
      })
    );
    const grid = measureCalendarGrid(
      [...screen(FIXED_320), ...other],
      BOX,
      DENSITY
    );
    expect(grid.columns).toHaveLength(7);
    expect(grid.columns.every((column) => column.width === 105)).toBe(true);
  });
});
