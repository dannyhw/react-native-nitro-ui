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
  CALENDAR_WIDE_MIN_DP,
  DAY_CELL_MIN_DP,
  INTERACTIVE_DEFAULT_DP,
  calendarGridProblems,
  expectedColumnDp,
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

/**
 * A whole row of day cells: clickable, same height, seven of them, and at a width no
 * header column has. This is the shape the real dump reports — the day `Surface`s pick
 * up Material's touch-target expansion, so they read 110-126 px beside a header's 105.
 *
 * They come *before* the header in the tree, as they do in a real dump of a calendar
 * that has been opened before: composition order is not the order these nodes are
 * reported in, so a rule that stopped filtering on `clickable` and simply took the
 * longest same-height row would land on this one — seven boxes with an 8 px spread —
 * and report a healthy calendar's columns as a squeeze.
 *
 * @param {number[]} widths
 */
function dayRow(widths) {
  let x = 22;
  return widths.map((width) => {
    const cell = dayCell('Sunday, October 4, 2026', x, width);
    x += width + 12;
    return cell;
  });
}

/** What the real dumps measured, as a fixture pair. */
const BROKEN_320 = headerRow([126, 126, 126, 126, 126, 126, 20]);
const FIXED_320 = headerRow([105, 105, 105, 105, 105, 105, 105]);

/** The app's and Material's own named nodes inside a calendar's box, no rows. */
function calendarChrome() {
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
  ];
}

/** The calendar's grid, with the app's other text and its day cells around it. */
function screen(cells) {
  return [
    ...calendarChrome(),
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

  it("refuses 40 dp columns in a box wide enough for Material's 48 dp", () => {
    // The regression this exists to catch: the first version of the fix provided 40 dp
    // at *every* width, so a full-width phone got 8 dp smaller day cells, prev/next
    // buttons and year toggles than Material would have drawn. The narrow dump above,
    // judged as the wide case it now is, has to be the failure - 40 dp is 105 px at this
    // density and 48 dp is 126, so the row is 21 px short of what the box asked for.
    const grid = measureCalendarGrid(screen(FIXED_320), BOX, DENSITY);
    expect(
      calendarGridProblems(grid, { minColumnDp: INTERACTIVE_DEFAULT_DP })
    ).toEqual([
      'the narrowest column is 40.0 dp, under the 48 dp touch target this box should ' +
        'have produced',
    ]);
  });

  it('accepts 48 dp columns in a wide box, and only those', () => {
    // A calendar laid out at Material's default in a box that fits it. At this density
    // 48 dp is 126 px, so a 393 dp box (1 031 px) has room for 7 × 126 plus the grid's
    // own 24 dp of edge padding. `BOX` is a 320 dp calendar's box and the rule filters to
    // the named calendar's box, so the wide row needs its own: seven 126 px columns do not
    // fit inside 840 px, and the columns that fall outside it are not this calendar's.
    const wideBox = { x1: 0, y1: 72, x2: 1031, y2: 1416 };
    const grid = measureCalendarGrid(
      screen(headerRow([126, 126, 126, 126, 126, 126, 126])),
      wideBox,
      DENSITY
    );
    expect(grid.columns).toHaveLength(7);
    expect(grid.minWidthDp).toBeCloseTo(48, 5);
    expect(
      calendarGridProblems(grid, { minColumnDp: INTERACTIVE_DEFAULT_DP })
    ).toEqual([]);
    // And the same row read as the narrow case is not a pass: it clears a 40 dp floor, so
    // the two readings are genuinely different rules rather than one loose one.
    expect(calendarGridProblems(grid)).toEqual([]);
  });

  it('picks the touch target from the measured box, at the boundary', () => {
    // The threshold is Material's own arithmetic - seven 48 dp columns plus the 12 dp the
    // grid keeps at each edge - and it is an exclusive test on the narrow side: at
    // exactly 360 dp the 48 dp grid fits, so the wide answer is the right one there.
    expect(expectedColumnDp(320)).toBe(DAY_CELL_MIN_DP);
    expect(expectedColumnDp(CALENDAR_WIDE_MIN_DP - 0.1)).toBe(DAY_CELL_MIN_DP);
    expect(expectedColumnDp(CALENDAR_WIDE_MIN_DP)).toBe(INTERACTIVE_DEFAULT_DP);
    expect(expectedColumnDp(393)).toBe(INTERACTIVE_DEFAULT_DP);
    // 360 is the fixture, not the answer: seven 48 dp columns plus the 12 dp the
    // calendar's grid keeps at each edge. If the library's constant and this arithmetic
    // ever drift apart, the check is measuring the wrong box.
    expect(CALENDAR_WIDE_MIN_DP).toBe(7 * INTERACTIVE_DEFAULT_DP + 2 * 12);
  });

  it('forgives the half pixel a non-integer density costs a 40 dp column', () => {
    // 213 dpi (density 1.331): a column asked for 40 dp is `round(40 x 1.331) = 53` px,
    // and 53 px divides back to 39.8 dp. A floor compared in dp with no allowance calls
    // that calendar broken on every device whose density is not 1, 2 or 3 - and the
    // fixture's own numbers (105 px = exactly 40.0 dp) would never show it, because this
    // host is at 420 dpi.
    const DENSITY_213 = 213 / 160;
    const grid = measureCalendarGrid(
      screen(headerRow([53, 53, 53, 53, 53, 53, 53])),
      BOX,
      DENSITY_213
    );
    expect(grid.minWidthDp.toFixed(1)).toBe('39.8');
    expect(calendarGridProblems(grid)).toEqual([]);
    // Half a pixel is the whole allowance: one px short of the floor is the shortfall
    // this rule exists to report, not a rounding artefact.
    const shortByOne = measureCalendarGrid(
      screen(headerRow([52, 52, 52, 52, 52, 52, 52])),
      BOX,
      DENSITY_213
    );
    expect(calendarGridProblems(shortByOne).length).toBe(1);
  });

  it('names the clipped calendar the dump showed before the fix', () => {
    const grid = measureCalendarGrid(screen(BROKEN_320), BOX, DENSITY);
    expect(grid).not.toBeNull();
    expect(grid.minWidthDp.toFixed(1)).toBe('7.6');
    expect(calendarGridProblems(grid)).toEqual([
      'the narrowest column is 7.6 dp, under the 40 dp touch target this box should ' +
        'have produced',
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

  it('calls a clipped header missing rather than measuring a week of day cells', () => {
    // The failure mode the `clickable` filter exists for. A calendar scrolled so its
    // header is clipped keeps naming its day cells, and a week of them looks exactly
    // like a header row structurally: seven boxes, one row, equal heights. Here they are
    // the real dump's day cells at a 320 dp box — 105 × 123 px each, an even spread — so
    // a rule that let clickable nodes in would answer "40 dp floor cleared, columns
    // equal" for a calendar whose header is off screen, which is the pass this check must
    // never give. With the filter the row is not found at all and the answer is null:
    // "not on screen", which the caller aborts on.
    const grid = measureCalendarGrid(
      [
        ...calendarChrome(),
        headerCell('Sunday', 0, 0),
        ...dayRow([105, 105, 105, 105, 105, 105, 105]),
      ],
      BOX,
      DENSITY
    );
    expect(grid).toBeNull();
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
