import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseHierarchy } from '../real-input/uiautomator.mjs';
import {
  CALENDAR_WIDE_MIN_DP,
  DAY_CELL_MIN_DP,
  INTERACTIVE_DEFAULT_DP,
  calendarGridProblems,
  expectedColumnDp,
  measureCalendarGrid,
} from '../real-input/android-calendar.mjs';

/** The density the fixture widths were recorded at (420 dpi). */
const DENSITY = 2.625;

/** The calendar's own box: 320 dp wide at this density. */
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
 * One header cell, shaped like the dump's: a non-clickable node naming a weekday. Built
 * through the real parser so its `bounds` have the shape the code sees.
 */
function headerCell(description, x1, width) {
  return parseHierarchy(
    `<hierarchy><node content-desc="${description}" clickable="false" ` +
      `enabled="true" class="android.view.View" ` +
      `bounds="[${x1},545][${x1 + width},650]" /></hierarchy>`
  )[0];
}

/**
 * A header row: one cell per width, `gap` px apart.
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
 * A row of day cells. A real dump leaves its day cells unnamed; these are named and
 * clickable, so only the rule's `clickable` filter keeps it off them.
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

/**
 * Header and day-cell widths, in px, of two real dumps of a calendar in a 320 dp box: one
 * with Saturday squeezed, one laid out evenly.
 */
const DUMP_320 = {
  'g8-320-prefix': {
    header: [126, 126, 126, 126, 126, 126, 20],
    days: [126, 126, 126, 126, 126, 126, 73],
  },
  'g8-320-postfix': {
    header: [105, 105, 105, 105, 105, 105, 105],
    days: [105, 105, 105, 105, 105, 105, 105],
  },
};

const BROKEN_320 = headerRow(DUMP_320['g8-320-prefix'].header);
const FIXED_320 = headerRow(DUMP_320['g8-320-postfix'].header);

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
  it("quotes the real dumps' widths in the module's own table", () => {
    // The module's header comment carries a table of these widths; this pins the table to
    // the fixtures.
    const source = readFileSync(
      join(__dirname, '..', 'real-input', 'android-calendar.mjs'),
      'utf8'
    );
    const widths = (cell) =>
      cell
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value) && value > 0);
    const table = Object.fromEntries(
      [
        ...source.matchAll(
          /^ \* \| `(g8-320-\w+)\.xml`\s*\|([^|]+)\|([^|]+)\|/gm
        ),
      ].map((match) => [
        match[1],
        { header: widths(match[2]), days: widths(match[3]) },
      ])
    );
    expect(table).toEqual(DUMP_320);
  });

  it('reads the seven weekday columns out of a laid-out calendar', () => {
    const grid = measureCalendarGrid(screen(FIXED_320), BOX, DENSITY);
    expect(grid).not.toBeNull();
    expect(grid.columns).toHaveLength(7);
    expect(grid.minWidthDp).toBeCloseTo(40, 5);
    expect(calendarGridProblems(grid)).toEqual([]);
  });

  it("refuses 40 dp columns in a box wide enough for Material's 48 dp", () => {
    // The narrow dump judged as the wide case: 40 dp is 105 px at this density and 48 dp
    // is 126.
    const grid = measureCalendarGrid(screen(FIXED_320), BOX, DENSITY);
    expect(
      calendarGridProblems(grid, { minColumnDp: INTERACTIVE_DEFAULT_DP })
    ).toEqual([
      'the narrowest column is 40.0 dp, under the 48 dp touch target this box should ' +
        'have produced',
    ]);
  });

  it('accepts 48 dp columns in a wide box, and only those', () => {
    // The rule only reads columns inside the calendar's box, and seven 126 px (48 dp)
    // columns do not fit in `BOX`, so the wide row gets a 393 dp box of its own.
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
    expect(calendarGridProblems(grid)).toEqual([]);
  });

  it('picks the touch target from the measured box, at the boundary', () => {
    // The threshold is seven 48 dp columns plus the 12 dp the grid keeps at each edge. At
    // exactly that width the 48 dp grid fits, so the wide answer is the right one there.
    expect(expectedColumnDp(320)).toBe(DAY_CELL_MIN_DP);
    expect(expectedColumnDp(CALENDAR_WIDE_MIN_DP - 0.1)).toBe(DAY_CELL_MIN_DP);
    expect(expectedColumnDp(CALENDAR_WIDE_MIN_DP)).toBe(INTERACTIVE_DEFAULT_DP);
    expect(expectedColumnDp(393)).toBe(INTERACTIVE_DEFAULT_DP);
    expect(CALENDAR_WIDE_MIN_DP).toBe(7 * INTERACTIVE_DEFAULT_DP + 2 * 12);
  });

  it('forgives the half pixel a non-integer density costs a 40 dp column', () => {
    // 213 dpi (density 1.331): a column asked for 40 dp is `round(40 x 1.331) = 53` px,
    // and 53 px divides back to 39.8 dp.
    const DENSITY_213 = 213 / 160;
    const grid = measureCalendarGrid(
      screen(headerRow([53, 53, 53, 53, 53, 53, 53])),
      BOX,
      DENSITY_213
    );
    expect(grid.minWidthDp.toFixed(1)).toBe('39.8');
    expect(calendarGridProblems(grid)).toEqual([]);
    // Half a pixel is the whole allowance: one px short of the floor is a shortfall.
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
    // A real dump of a 240 dp box: the seventh header is absent from the tree entirely.
    const grid = measureCalendarGrid(
      screen(headerRow([105, 105, 105, 105, 105, 41])),
      BOX,
      DENSITY
    );
    expect(grid).not.toBeNull();
    expect(grid.columns).toHaveLength(6);
    expect(calendarGridProblems(grid)).toEqual([
      'only 6 of 7 weekday columns are laid out',
      'the narrowest column is 15.6 dp, under the 40 dp touch target this box should ' +
        'have produced',
      'columns differ by 64 px wide, so they are not sharing the width out evenly',
    ]);
    // Six equal 40 dp columns: a missing day that only the column count can see.
    expect(
      calendarGridProblems(
        measureCalendarGrid(
          screen(headerRow([105, 105, 105, 105, 105, 105])),
          BOX,
          DENSITY
        )
      )
    ).toEqual(['only 6 of 7 weekday columns are laid out']);
  });

  it('catches a squeeze that never reaches the 40 dp floor', () => {
    // Every column here clears the 105 px that 40 dp is at this density, and an 8 px
    // spread is not rounding.
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
    // `SpaceEvenly` divides a box's leftover among the gaps and Compose rounds each share
    // to whole pixels, so equal dp requests can report widths one px apart.
    const grid = measureCalendarGrid(
      screen(headerRow([110, 110, 111, 110, 110, 110, 110])),
      BOX,
      DENSITY
    );
    expect(calendarGridProblems(grid)).toEqual([]);
  });

  it('ignores day cells, the month toggle and a scroll-clipped header', () => {
    // Day cells are clickable; the toggle names a year and is clickable; a header
    // scrolled out of the composition's clip is named with `[0,0][0,0]`.
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
    // A calendar scrolled so its header is clipped keeps its day cells in the tree, and a
    // week of them looks like a header row: seven boxes, one row, equal heights. The cells
    // are named here so the label filter cannot be what makes this pass.
    const grid = measureCalendarGrid(
      [
        ...calendarChrome(),
        headerCell('Sunday', 0, 0),
        ...dayRow(DUMP_320['g8-320-postfix'].days),
      ],
      BOX,
      DENSITY
    );
    expect(grid).toBeNull();
  });

  it('says so when this calendar is not on screen at all', () => {
    expect(measureCalendarGrid(screen([]), BOX, DENSITY)).toBeNull();
  });

  it('only measures the calendar it was pointed at', () => {
    // A second calendar's header, outside this box.
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
