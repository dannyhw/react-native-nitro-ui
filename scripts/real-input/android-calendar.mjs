/**
 * Reading Material 3's calendar grid out of a `uiautomator dump`.
 *
 * The question this answers is the one the README's screenshot asked by hand: is the
 * seventh weekday column laid out *inside* the calendar, or did the six before it eat
 * its width? Nothing inside the app can answer it. `measureContent()` is the wrong
 * question — an `inline` picker is a `fillWidth` control, so Compose is asked "what
 * height do you want at 320 dp" and answers 320 wide whether or not the grid fits
 * (measured at boxes of 240, 320 and 361 dp: 240, 320 and 361 back, every one). And the
 * cells are Compose nodes, not `View`s, so the in-app queries cannot reach them at all —
 * the same gap `./a11y.mjs` records for a control's *name*. `uiautomator dump` is the
 * accessibility tree, and Material 3 publishes the calendar's weekday header into it, so
 * the grid's real column widths are readable from outside, on a device, in
 * `real-input:android`.
 *
 * ## Why the weekday header, and not the day cells
 *
 * Material composes both rows the same way — `Row(fillMaxWidth) { SpaceEvenly }` with
 * every child `sizeIn(min = 40.dp).size(LocalMinimumInteractiveComponentSize)` — but
 * only one of them reports what it was given. Measured on `emulator-5574` (density
 * 2.625) at a 320 dp box with the fix in place:
 *
 * | row                        | column widths (px)                            |
 * | -------------------------- | --------------------------------------------- |
 * | weekday header             | 105, 105, 105, 105, 105, 105, 105             |
 * | day cells                  | 110, 110, 111, 110, 110, 110, 126             |
 *
 * The header cells are exactly 40 dp each. The day cells are the `Surface`s under them,
 * and their accessibility box picks up Material's touch-target expansion on top of the
 * cell, which lands unevenly across the row (16 px = 6 dp between the widest and the
 * narrowest) even in a grid that is laid out perfectly. A width rule written against the
 * day cells would therefore call a healthy calendar broken, and a rule loosened enough
 * to tolerate that spread would not see the squeeze it exists to catch: the same dump
 * with the 48 dp default measured header columns `105, 105, 105, 105, 41` in a 240 dp box
 * — the sixth column at 15.6 dp, and the seventh absent from the tree entirely.
 *
 * ## What else in a dump a header row must not be mistaken for
 *
 * - The month toggle is clickable and names a year ("October 2026"), and a day cell is
 *   clickable and names a whole date. Neither is in the header row, which is the
 *   non-clickable group of exactly seven same-row names.
 * - A row scrolled outside the composition's clip keeps its names and gets
 *   `bounds=[0,0][0,0]`, so a zero box means "not on screen" and is skipped rather than
 *   counted as a zero-width column.
 *
 * The row is found **structurally** — seven non-clickable named boxes on one row inside
 * this calendar's own box — rather than by matching English weekday spellings, because
 * `scripts/app-launch-env.mjs`'s locale pin is an iOS launch argument and the emulator
 * takes no such thing (`example/rn-harness.config.mjs` says so in its own comment). A
 * rule that read "Sunday…Saturday" would go red on a device whose locale spells them
 * differently, and would say nothing about the calendar.
 *
 * Split from `android.mjs` for the reason `android-tree.mjs` and `a11y.mjs` both give:
 * `android.mjs` boots a device on import and this must not, so the rule's failure modes
 * are provable against measured dumps in
 * `scripts/__tests__/real-input-calendar.test.js`.
 */

/** The columns in a week, and the row count that means "a week's worth". */
export const DAYS_IN_WEEK = 7;

/**
 * Material 3's own day-cell width — `DatePickerModalTokens.DateContainerWidth` — which
 * is also the minimum its weekday header cells ask for. This is the floor a column may
 * not go under and still be the calendar the design system describes.
 */
export const DAY_CELL_MIN_DP = 40;

/**
 * How far a correct column may differ from its widest neighbour.
 *
 * Compose rounds each column's `SpaceEvenly` share to whole pixels, so the same grid can
 * report 105 and 106 across a row. The squeeze this rule exists for differs by tens: the
 * measured 240 dp reading was 105 beside 41.
 */
const COLUMN_ROUNDING_PX = 2;

/**
 * How few same-row boxes still count as "this calendar's header row".
 *
 * Seven is a week, and the rule below insists on seven. But the row has to be
 * *recognised* before it can be judged, and a clipped calendar is exactly the case
 * where the seventh box is gone: at a 240 dp box Material laid out six headers and
 * dropped the seventh from the tree. A rule that needed seven to recognise the row
 * would answer "no calendar here" for the broken one and go green, so recognition stops
 * at five — still more boxes than anything else in a date calendar's own box, which
 * holds the month toggle, one headline and a grid of clickable cells.
 */
const MIN_COLUMNS_TO_BE_A_WEEK = 5;

/** How far apart two boxes have to be to be the same row. */
const SAME_ROW_PX = 2;

/**
 * How much a row's boxes may differ in height and still be one row of a grid.
 *
 * The seven header cells are laid out by one `Row`, so they are the same height to the
 * pixel. A calendar's box also contains the app's own text and Material's own header,
 * which are not seven-equal-height rows of boxes; this is what keeps a row of, say,
 * five unrelated labels out of the count.
 */
const ROW_HEIGHT_TOLERANCE = 1.5;

/**
 * A calendar's weekday header row, measured.
 *
 * @typedef {object} CalendarGrid
 * @property {Array<{x1: number, width: number}>} columns the seven header boxes, in
 *   reading order; fewer than seven when columns are missing
 * @property {number} minWidthDp the narrowest column, in dp
 * @property {number} spreadPx `max(width) − min(width)`, in pixels
 * @property {string} detail a one-line rendering for the log and the failure message
 */

/**
 * Find one calendar's weekday header row and measure its columns.
 *
 * @param {ReadonlyArray<import('./uiautomator.mjs').UiautomatorNode>} tree
 * @param {{x1: number, y1: number, x2: number, y2: number}} box the calendar's own box,
 *   as the dump reports it for the control's labelled node
 * @param {number} density the device's density (1 dp = this many px)
 * @returns {CalendarGrid | null} null when no row inside this box looks like a header
 *   row at all, which the caller reports as "the calendar is not on screen"
 */
export function measureCalendarGrid(tree, box, density) {
  /** @type {Map<number, Array<{x1: number, width: number, height: number}>>} */
  const rows = new Map();
  for (const node of tree) {
    const { x1, y1, cx, cy, width, height } = node.bounds;
    if (width <= 0 || height <= 0) {
      continue;
    }
    // The header is not something you press, and its names are on the node itself.
    // Clickable is what separates it from a row of day cells, which are `View`s whose
    // own text is a whole date.
    if (node.clickable === 'true') {
      continue;
    }
    const label = `${node.text}${node.contentDesc}`;
    if (label === '') {
      continue;
    }
    if (cx < box.x1 || cx > box.x2 || cy < box.y1 || cy > box.y2) {
      continue;
    }
    const key = [...rows.keys()].find((y) => Math.abs(y - y1) <= SAME_ROW_PX);
    const row = rows.get(key ?? y1);
    if (row == null) {
      rows.set(y1, [{ x1, width, height }]);
    } else {
      row.push({ x1, width, height });
    }
  }

  // A week, in one row, inside this calendar. Anything else in the tree — a section's
  // list of rows, a legend, the app's own text — is not a run of same-height,
  // non-clickable, named boxes.
  const candidates = [...rows.values()]
    .filter((row) => row.length >= MIN_COLUMNS_TO_BE_A_WEEK)
    .filter((row) => {
      const heights = row.map((cell) => cell.height);
      return (
        Math.max(...heights) - Math.min(...heights) <= ROW_HEIGHT_TOLERANCE
      );
    })
    .sort((a, b) => b.length - a.length);
  const week = candidates[0];
  if (week == null) {
    return null;
  }

  const columns = week.sort((a, b) => a.x1 - b.x1);
  const widths = columns.map((column) => column.width);
  const minWidth = Math.min(...widths);
  const maxWidth = Math.max(...widths);
  return {
    columns,
    minWidthDp: minWidth / density,
    spreadPx: maxWidth - minWidth,
    detail:
      `${String(columns.length)} columns of ` +
      widths.map((width) => `${String(width)}px`).join(', '),
  };
}

/**
 * Every problem with a calendar grid, as sentences.
 *
 * Three separate claims, because the bug shows up as each of them alone:
 *
 * - **the columns do not add up.** Seven is a week. At a 240 dp box the seventh header
 *   was not merely narrow, it was *gone* from the tree, and a rule that only measured
 *   widths would have been handed six fine columns to congratulate.
 * - **a column is below Material's own 40 dp day cell.** The squeeze itself: the grid
 *   wants 7 × 40 + 2 × 12 = 304 dp and a box narrower than that takes it out of whatever
 *   is left over, from the right.
 * - **the columns are not each other's width.** What catches the squeeze by its shape
 *   rather than its arithmetic, and what makes a mutant that hands one column the
 *   leftover say so.
 *
 * @param {CalendarGrid} grid
 * @returns {string[]} empty when the grid is laid out
 */
export function calendarGridProblems(grid) {
  /** @type {string[]} */
  const problems = [];
  if (grid.columns.length < DAYS_IN_WEEK) {
    problems.push(
      `only ${String(grid.columns.length)} of ${String(DAYS_IN_WEEK)} weekday ` +
        'columns are laid out'
    );
  }
  if (grid.minWidthDp < DAY_CELL_MIN_DP) {
    problems.push(
      `the narrowest column is ${grid.minWidthDp.toFixed(1)} dp, under Material's ` +
        `${String(DAY_CELL_MIN_DP)} dp day cell`
    );
  }
  if (grid.columns.length > 1 && grid.spreadPx > COLUMN_ROUNDING_PX) {
    problems.push(
      `columns differ by ${String(grid.spreadPx)} px wide, so they are not sharing ` +
        'the width out evenly'
    );
  }
  return problems;
}
