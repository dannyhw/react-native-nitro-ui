import { test } from '@e2e-dev/mobile';
import { expect, type Screen } from 'e2e';

import {
  CALENDAR_WIDE_MIN_DP,
  calendarGridProblems,
  expectedColumnDp,
  measureCalendarGrid,
} from '../../../scripts/real-input/android-calendar.mjs';
import { displayDensity } from './device-read';
import { tree, type TreeNode } from './os-tree';
import { centreOf, openScreen, reveal, tapBand } from './support';
import { actsOnOneNamedNode } from './reader';

const NAME = 'Real-input date picker';

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

  // The day cells are named with the whole date, which is the only way to say which day
  // a person is pressing: the grid’s nodes carry no testID, so a tap by number could
  // land on any month’s 20th.
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(value).toHaveText('-');

  await field.tap();
  const day = screen.getByLabel(target.label);
  await day.waitFor({ state: 'visible' });
  // The cell's own box rather than the driver's tap: the day is one node whose
  // clickable part belongs to another, and a named node like this gets no touch
  // point of its own to press.
  await screen.tapAt(await centreOf(day));
  await screen.getByText(/^OK$/).tap();
  await expect(value).toHaveText(target.iso);
});

/** The one node of the unmerged tree carrying this name, at its laid-out box. */
function namedNode(nodes: TreeNode[], label: string): TreeNode {
  const found = nodes.filter(
    (node) =>
      node.contentDesc === label &&
      node.bounds.width > 0 &&
      node.bounds.height > 0
  );
  if (found.length === 0) {
    throw new Error(`real-input: no node of the tree is named "${label}".`);
  }
  return found[0] as TreeNode;
}

test('each inline calendar lays a whole week out on the columns its box asks for', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'datepicker');
  await screen.getByLabel(NAME).waitFor();
  const density = displayDensity();

  // The unmerged tree keeps a node scrolled out of sight at its laid-out box, so both
  // calendars are measured where they are. The header row is told from the day cells by
  // being the seven named boxes a finger cannot act on: `hittable` is the dump's
  // clickable-or-focusable on this tree.
  const nodes = tree({ unmerged: true });
  const asDump = nodes.map((node) => ({
    ...node,
    clickable: node.hittable ?? 'false',
  }));
  for (const fixture of [
    { label: 'Wide inline calendar', wide: true },
    { label: 'Narrow inline calendar', wide: false },
  ]) {
    const box = namedNode(nodes, fixture.label).bounds;
    const widthDp = box.width / density;
    expect(
      fixture.wide
        ? widthDp >= CALENDAR_WIDE_MIN_DP
        : widthDp < CALENDAR_WIDE_MIN_DP,
      `"${fixture.label}" is laid out ${widthDp.toFixed(0)} dp wide, which is not ` +
        `${fixture.wide ? 'at' : 'under'} the ${String(CALENDAR_WIDE_MIN_DP)} dp the ` +
        'touch target depends on'
    ).toBe(true);
    const grid = measureCalendarGrid(asDump, box, density);
    expect(
      grid,
      `"${fixture.label}" draws no weekday header row inside its box`
    ).not.toBeNull();
    if (grid == null) continue;
    const problems = calendarGridProblems(grid, {
      minColumnDp: expectedColumnDp(widthDp),
    });
    expect(
      problems,
      `the ${widthDp.toFixed(0)} dp calendar's week: ${grid.detail}`
    ).toEqual([]);
  }

  // `mode="date"` has no Material drum, so its wheel variant stays a calendar.
  const time = namedNode(nodes, 'Real-input wheel time picker').bounds;
  const date = namedNode(nodes, 'Real-input wheel date picker').bounds;
  expect(
    date.height / density,
    `the date "wheel" is ${String(date.height)} px tall against the time drum's ` +
      `${String(time.height)} px, which is not a calendar`
  ).toBeGreaterThan(time.height / density + 100);
});

/** How long a drum is given to report a roll that came to rest. */
const ROLL_REPORTED_MS = 8_000;

/** How long a drum at rest is watched for a late event. */
const AT_REST_MS = 1_500;

/** The seeded time of both wheels, as the echo prints an instant. */
const SEEDED_DAY = '2024-06-15';

/**
 * Park a wheel and the echoes above it in the middle of the tap band, with slow drags
 * along the window's right-hand edge, where no drum or calendar lies under the finger.
 * Flicks reach the page's end first: the wheels are its last rows.
 */
async function parkWheel(
  screen: Screen,
  label: string,
  echoIds: string[]
): Promise<{ wheel: TreeNode; hour: TreeNode; minutes: TreeNode | null }> {
  const band = await tapBand(screen);
  const window = await screen.getByTestId('android:id/content').boundingBox();
  if (window == null) {
    throw new Error('real-input: the content view has no box to drag along.');
  }
  const edge = window.x + window.width - 8;
  const middle = (band.top + band.bottom) / 2;
  const place = () => {
    const nodes = tree({ unmerged: true });
    const wheel = namedNode(nodes, label);
    const echoes = echoIds.map(
      (id) => nodes.find((node) => node.resourceId === id) ?? null
    );
    const drum = (name: string) =>
      nodes.find(
        (node) =>
          node.contentDesc === name &&
          node.bounds.cy >= wheel.bounds.y1 &&
          node.bounds.cy <= wheel.bounds.y2
      ) ?? null;
    const hour = drum('Select hour');
    const minutes = drum('Select minutes');
    const top = Math.min(
      wheel.bounds.y1,
      ...echoes.map((node) => node?.bounds.y1 ?? wheel.bounds.y1)
    );
    return { wheel, hour, minutes, echoes, top, bottom: wheel.bounds.y2 };
  };
  let at = place();
  for (let flick = 0; flick < 6 && at.bottom > band.bottom; flick += 1) {
    await screen.swipe({
      from: { x: edge, y: band.top + (band.bottom - band.top) * 0.85 },
      to: { x: edge, y: band.top + (band.bottom - band.top) * 0.15 },
      duration: 150,
    });
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    at = place();
  }
  for (let drag = 0; drag < 8; drag += 1) {
    const inBand = at.top >= band.top + 24 && at.bottom <= band.bottom - 24;
    if (inBand && at.hour != null && at.echoes.every((node) => node != null)) {
      return { wheel: at.wheel, hour: at.hour, minutes: at.minutes };
    }
    const off = Math.max(
      -700,
      Math.min(700, (at.top + at.bottom) / 2 - middle)
    );
    const from = off > 0 ? middle + 350 : middle - 350;
    await screen.swipe({
      from: { x: edge, y: from },
      to: { x: edge, y: from - off },
      duration: 900,
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    at = place();
  }
  throw new Error(
    `real-input: "${label}" never came to rest inside the band with its echoes; it ` +
      `spans ${String(at.top)}-${String(at.bottom)} in a band of ` +
      `${String(band.top)}-${String(band.bottom)}.`
  );
}

/**
 * Fling the hour drum downwards in 130 ms, inside its own box: into the hours before the
 * seeded 09:20, which cannot cross noon, so the day part never changes.
 */
async function rollHour(screen: Screen, hour: TreeNode): Promise<void> {
  const pad = Math.round(hour.bounds.height * 0.12);
  await screen.swipe({
    from: { x: hour.bounds.cx, y: hour.bounds.y1 + pad },
    to: { x: hour.bounds.cx, y: hour.bounds.y2 - pad },
    duration: 130,
  });
}

/** One roll is one event: it arrives, and nothing follows it once the drum is at rest. */
async function oneEvent(
  screen: Screen,
  echoId: string,
  expected: string
): Promise<void> {
  const echo = screen.getByTestId(echoId);
  await expect
    .poll(() => echo.textContent(), {
      timeout: ROLL_REPORTED_MS,
      message: `the drum never reported change ${expected}`,
    })
    .toBe(expected);
  await new Promise((resolve) => setTimeout(resolve, AT_REST_MS));
  expect(
    await echo.textContent(),
    'the drum reported again after it came to rest: one event per row crossed'
  ).toBe(expected);
}

test('one fling of the hour drum reports one change, and three in a row move the time and never the day', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'datepicker');
  const valueId = 'real-input-wheel-time-value';
  const eventsId = 'real-input-wheel-time-events';
  const { wheel, hour, minutes } = await parkWheel(
    screen,
    'Real-input wheel time picker',
    [valueId, eventsId]
  );
  const value = screen.getByTestId(valueId);

  // Uncontrolled: what the drums show is their own, and what was reported is the echo's.
  await expect(value).toHaveText('-');
  await expect(screen.getByTestId(eventsId)).toHaveText('0');
  expect(
    await screen.getByLabel('Real-input wheel time picker').count(),
    'the wheel is not named in the tree'
  ).toBeGreaterThanOrEqual(1);
  // Material's own names for the drums, inside the wheel: the fling's aim.
  for (const [name, node] of [
    ['hour', hour],
    ['minute', minutes],
  ] as const) {
    expect(
      node != null &&
        node.bounds.cx >= wheel.bounds.x1 &&
        node.bounds.cx <= wheel.bounds.x2,
      `the ${name} drum is not named inside the wheel`
    ).toBe(true);
  }

  let previous = '09';
  for (const roll of ['1', '2', '3']) {
    await rollHour(screen, hour);
    await oneEvent(screen, eventsId, roll);
    const reported = (await value.textContent()) ?? '';
    expect(reported.slice(0, 10), `roll ${roll} moved the day`).toBe(
      SEEDED_DAY
    );
    expect(
      reported.slice(11, 13),
      `roll ${roll} did not move the hour (${reported})`
    ).not.toBe(previous);
    previous = reported.slice(11, 13);
  }
});

test('a drum whose parent refuses reports each roll once, and its rollback is not an event', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'datepicker');
  const eventsId = 'real-input-wheel-refuse-events';
  const { hour } = await parkWheel(screen, 'Real-input wheel refusing picker', [
    eventsId,
  ]);
  await expect(screen.getByTestId(eventsId)).toHaveText('0');

  await rollHour(screen, hour);
  await oneEvent(screen, eventsId, '1');
  // With the drum back on the parent's hour, the same roll is a fresh pick again.
  await rollHour(screen, hour);
  await oneEvent(screen, eventsId, '2');
});
