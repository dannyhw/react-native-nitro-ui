import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import {
  CALENDAR_WIDE_MIN_DP,
  calendarGridProblems,
  expectedColumnDp,
  measureCalendarGrid,
} from '../../../scripts/real-input/android-calendar.mjs';
import { displayDensity } from './device-read';
import { drag, openScreen, pageScroll, reveal, textOf } from './support';
import { namedNodes, tree, type TreeNode } from './os-tree';
import { actsOnOneNamedNode } from './reader';

const NAME = 'Real-input date picker';
const DRUM_LABEL = 'Real-input wheel time picker';

/** A day in the currently visible month, far enough from today to be distinct. */
function targetDay(): { label: string; iso: string } {
  const now = new Date();
  const day = now.getDate() >= 20 ? now.getDate() - 5 : now.getDate() + 5;
  const date = new Date(now.getFullYear(), now.getMonth(), day);
  return {
    label: date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    iso: `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

test('a real tap opens the date dialog, a day cell reaches JS, OK closes it', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'datepicker');
  const field = screen.getByLabel(NAME);
  const value = screen.getByTestId('real-input-date-value');
  await reveal(screen, field);

  const target = targetDay();

  // The day cells are named with the whole date — "Friday, November 20, 2026" —
  // which is the screen-reader fact this suite keeps, and the only way to say
  // *which* day a person is pressing: the grid's own nodes carry no testID and the
  // dialog window carries none either, so a tap by number could land on any
  // month's 20th. Picking by the name the reader reads is the honest version —
  // and the name is the only handle: in the tree the driver reads, the day is one
  // node carrying the date as its label and an unnamed clickable node beside it,
  // so a role query for "button" answers a node with no name to aim at.
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(value).toHaveText('-');

  await field.tap();
  const day = screen.getByLabel(target.label);
  await day.waitFor({ state: 'visible' });
  await day.tap();
  await screen.getByText(/^OK$/).tap();
  await expect(value).toHaveText(target.iso);
});

/**
 * The two-digit rows of one drum column, clustered by x.
 *
 * A 12-hour wheel keeps an AM/PM column to the right of the hour and minute drums and
 * the three columns are not symmetric inside the control's box, so dividing the box in
 * three aims at the wrong place. Rows of one column share an x exactly.
 */
interface DrumColumn {
  x: number;
  pitch: number;
  rows: TreeNode[];
}

function drumColumns(drum: TreeNode): DrumColumn[] {
  const rows = tree()
    .filter(
      (node) =>
        /^\d{1,2}$/.test(node.text) &&
        node.bounds.cx >= drum.bounds.x1 &&
        node.bounds.cx <= drum.bounds.x2 &&
        node.bounds.cy >= drum.bounds.y1 &&
        node.bounds.cy <= drum.bounds.y2
    )
    .sort((a, b) => a.bounds.x1 - b.bounds.x1 || a.bounds.y1 - b.bounds.y1);
  const columns: DrumColumn[] = [];
  for (const row of rows) {
    // Rows of one column share an x exactly.
    const column = columns.find(
      (entry) => Math.abs(entry.x - row.bounds.cx) < 2
    );
    if (column == null) {
      columns.push({ x: row.bounds.cx, pitch: 0, rows: [row] });
      continue;
    }
    column.rows.push(row);
  }
  for (const column of columns) {
    const ys = column.rows.map((node) => node.bounds.cy).sort((a, b) => a - b);
    const gaps = ys
      .slice(1)
      .map((y, i) => y - (ys[i] ?? y))
      .sort((a, b) => a - b);
    column.pitch = gaps[Math.floor(gaps.length / 2)] ?? 0;
  }
  return columns.sort((a, b) => a.x - b.x);
}

/** The row sitting on the drum's selection line in a column. */
function centreRow(column: DrumColumn, drum: TreeNode): TreeNode {
  return column.rows.reduce((best, node) =>
    Math.abs(node.bounds.cy - drum.bounds.cy) <
    Math.abs(best.bounds.cy - drum.bounds.cy)
      ? node
      : best
  );
}

test('a fling on the time drum rolls it, reports once, and settles where it stopped (G29)', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'datepicker');
  const drumId = 'real-input-wheel-time';
  const events = screen.getByTestId('real-input-wheel-time-events');
  await reveal(screen, screen.getByTestId(drumId));

  // A drum is not a row to tap, which is why this gesture is a fling and the
  // oracle is a count: one roll across several rows costs **one** change event.
  // Every harness test for this control taps a row, so a drum that reported one
  // event per row crossed — the defect this found the first time — is invisible
  // from inside the app.
  const drum = namedNodes(DRUM_LABEL)[0];
  if (drum == null) {
    throw new Error(
      `real-input: nothing is named "${DRUM_LABEL}" in the tree, so there is no ` +
        'drum to fling — the control is drawn without an accessibility node.'
    );
  }
  const columns = drumColumns(drum);
  const hour = columns[0];
  if (hour == null || hour.pitch <= 0 || hour.rows.length < 3) {
    throw new Error(
      `real-input: the time drum shows ${String(columns.length)} column(s) at ` +
        `${JSON.stringify(hour ?? null)}, which cannot be flung — a drum with no ` +
        'rows to cross cannot show what a roll costs.'
    );
  }

  await expect(events).toHaveText('0');
  const atRest = await textOf(screen, 'real-input-wheel-time-value');
  expect(
    atRest,
    'the uncontrolled drum has reported a value before anyone touched it'
  ).toBe('-');

  // Rolled downwards, into the hours *before* the one it opened on: that direction
  // cannot cross noon, so the half of the day stays put and the comparison below
  // stays about one field.
  const roll = async (): Promise<string> => {
    await drag(
      screen,
      { x: hour.x, y: drum.bounds.cy },
      { x: hour.x, y: drum.bounds.cy + hour.pitch * 3 },
      300
    );
    return await textOf(screen, 'real-input-wheel-time-value');
  };

  const first = await roll();
  await expect(events).toHaveText('1');
  expect(
    first,
    'a fling across three rows left the reported time where it was'
  ).not.toBe(atRest);

  // The row under the drum's centre line is the value JS was told. On a 12-hour
  // wheel the rows are the 12-hour form of the hour, hence the modulo.
  const settled = namedNodes(DRUM_LABEL)[0];
  if (settled == null) {
    throw new Error('real-input: the drum lost its node after a fling.');
  }
  const hourColumn = drumColumns(settled)[0];
  if (hourColumn == null) {
    throw new Error(
      'real-input: the hour drum lost its rows after the fling, so the row it ' +
        'settled on cannot be read.'
    );
  }
  const reported = Number(first.slice(-5, -3));
  const landedOn = centreRow(hourColumn, settled);
  expect(
    Number(landedOn.text) % 12,
    `the row under the drum's centre line is not the hour reported: the drum ` +
      `settled on "${landedOn.text}" while JS was told ${first}`
  ).toBe(reported % 12);

  const second = await roll();
  await expect(events).toHaveText('2');
  expect(
    second,
    'the second fling left the drum on the same time as the first'
  ).not.toBe(first);
});

test('an inline calendar lays a week out on targets its own box can hold (G8)', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'datepicker');

  // The rule cannot be asked inside the app twice over: an `inline` picker is a
  // `fillWidth` control, so an in-app measure answers the box's width whether or not
  // the week fits inside it, and the weekday cells are Compose nodes no in-app query
  // reaches. The dump is the only thing that can see the columns.
  //
  // Two fixtures, because the control decides a size rather than applying one: the
  // 320 dp box the README story uses, which is too narrow for Material's 48 dp grid
  // and has to come out at the 40 dp day cell, and a calendar stretched past 360 dp
  // by the page's own edges, which has to stay at 48 dp. One asks for the small cell
  // everywhere and is caught by the wide row; never asking at all is caught by the
  // narrow one.
  const density = displayDensity();
  const wanted: Array<{
    label: string;
    wide: boolean;
    grid: ReturnType<typeof measureCalendarGrid>;
    box: TreeNode['bounds'] | null;
  }> = [
    { label: 'Wide inline calendar', wide: true, grid: null, box: null },
    { label: 'Narrow inline calendar', wide: false, grid: null, box: null },
  ];
  let namedWithNoBox = 0;

  // A *measurable* grid is the target, not the name: these rows are only reachable
  // by scrolling, and Compose keeps naming a scrolled-past calendar with
  // bounds=[0,0][0,0]. The wide row sits above the narrow one, so one downward pass
  // collects both.
  for (
    let attempt = 0;
    attempt < 12 && wanted.some((want) => want.grid == null);
    attempt += 1
  ) {
    const nodes = tree();
    for (const want of wanted) {
      if (want.grid != null) continue;
      const node = nodes.find(
        (candidate) => candidate.contentDesc === want.label
      );
      if (node == null) continue;
      if (node.bounds.width <= 0 || node.bounds.height <= 0) {
        namedWithNoBox += 1;
        continue;
      }
      const grid = measureCalendarGrid(nodes, node.bounds, density);
      if (grid != null) {
        want.grid = grid;
        want.box = node.bounds;
      }
    }
    if (wanted.some((want) => want.grid == null)) {
      await pageScroll(screen, 600);
    }
  }

  for (const want of wanted) {
    if (want.grid == null || want.box == null) {
      throw new Error(
        `real-input: "${want.label}" never showed a weekday header row, scrolling ` +
          'to the end of the page — the calendar is either not laid out at all or is ' +
          `drawn without one (${String(namedWithNoBox)} zero-sized boxes passed).`
      );
    }
    const widthDp = (want.box.x2 - want.box.x1) / density;
    const expectedDp = expectedColumnDp(widthDp);
    // The premise of each row, asserted rather than assumed: a fixture that quietly
    // stopped being wide would still be measurable, and the rule below would measure
    // it against the other row's floor and agree with whatever the control did.
    expect(
      want.wide
        ? widthDp >= CALENDAR_WIDE_MIN_DP
        : widthDp < CALENDAR_WIDE_MIN_DP,
      `"${want.label}" is laid out in a ${widthDp.toFixed(0)} dp box, which is not ` +
        `${want.wide ? 'at' : 'under'} the ${String(CALENDAR_WIDE_MIN_DP)} dp width ` +
        'that decides the touch target'
    ).toBe(true);
    expect(
      calendarGridProblems(want.grid, { minColumnDp: expectedDp }),
      `the ${widthDp.toFixed(0)} dp inline calendar does not lay a whole week out ` +
        `on ${String(expectedDp)} dp targets: ${want.grid.detail} (narrowest ` +
        `${want.grid.minWidthDp.toFixed(1)} dp)`
    ).toEqual([]);
  }
});
