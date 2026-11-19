import { test } from '@e2e-dev/mobile';
import { expect, type Locator, type Screen } from 'e2e';

import { displayDensity } from './device-read';
import { boxOf, openScreen, reveal, type Box, type Point } from './support';

test('a real tap opens the sheet, a Pressable inside it counts, and Back closes it', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'sheet');
  const opener = screen.getByTestId('sheet-open-fit');
  const log = screen.getByTestId('sheet-log');
  await reveal(screen, opener);

  // The sheet’s root can intercept touches, so the press that has to be counted is
  // inside the sheet, on content that rose from the window’s bottom edge, and the
  // count is JS’s own rather than a tree read.
  await expect(log).toHaveText('none');
  await opener.tap();
  const sheet = screen.getByTestId('sheet-fit-sheet');
  await sheet.waitFor({ state: 'visible' });
  await sheet.getByTestId('sheet-press').tap();
  await expect(screen.getByTestId('sheet-presses')).toHaveText(
    'Pressed 1 times'
  );

  await app.back();
  await sheet.waitFor({ state: 'detached' });
});

/** The fit sheet's Pressable, whose words appear nowhere else on the screen. */
const FIT = 'Press inside the sheet';
const STICKY = 'Close the sticky sheet';
const TWO = 'Drag this up for large';

/** How long a sheet that should stay up is watched for a close. */
const STAYS_UP_MS = 1200;

/**
 * A box that two reads 150 ms apart agree on, or `null` once the node has left the
 * tree: whatever carried it has finished moving.
 */
async function restingBoxOrGone(locator: Locator): Promise<Box | null> {
  const deadline = Date.now() + 5_000;
  let last = await boxOf(locator);
  for (;;) {
    if (last == null) return null;
    if (Date.now() > deadline) {
      throw new Error(
        `real-input: the node never came to rest; its box last read ${JSON.stringify(last)}.`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
    const now = await boxOf(locator);
    if (
      now != null &&
      Math.abs(now.x - last.x) <= 2 &&
      Math.abs(now.y - last.y) <= 2
    ) {
      return now;
    }
    last = now;
  }
}

async function restingBox(locator: Locator): Promise<Box> {
  const box = await restingBoxOrGone(locator);
  if (box == null) {
    throw new Error(
      'real-input: the node left the tree before it came to rest.'
    );
  }
  return box;
}

/** Open a sheet with a real tap and wait until it has finished rising. */
async function openSheet(
  screen: Screen,
  opener: string,
  witness: string
): Promise<Box> {
  await reveal(screen, screen.getByTestId(opener));
  await screen.getByTestId(opener).tap();
  await screen.getByText(witness).waitFor({ state: 'visible' });
  return restingBox(screen.getByText(witness));
}

/** The app's window, read while no sheet is up. */
async function windowBox(screen: Screen): Promise<Box> {
  const window = await boxOf(screen.getByTestId('android:id/content'));
  if (window == null) {
    throw new Error('real-input: the content view has no box to aim inside.');
  }
  return window;
}

/** A point on the scrim above any sheet: the top of the window, clear of the sheet. */
function outsidePoint(window: Box): Point {
  return {
    x: Math.round(window.x + window.width / 2),
    y: Math.round((window.y + window.height) * 0.12),
  };
}

/**
 * A drag down from the middle of a box by 600 dp in 250 ms, stopped just inside the
 * window: a swipe that dismisses a sheet.
 */
async function dragDown(screen: Screen, from: Box, window: Box): Promise<void> {
  const start = {
    x: Math.round(from.x + from.width / 2),
    y: Math.round(from.y + from.height / 2),
  };
  const end = Math.min(
    start.y + Math.round(600 * displayDensity()),
    window.y + window.height - 2
  );
  await screen.swipe({
    from: start,
    to: { x: start.x, y: end },
    duration: 250,
  });
}

async function staysUp(screen: Screen, text: string, after: string) {
  await new Promise((resolve) => setTimeout(resolve, STAYS_UP_MS));
  expect(
    await screen.getByText(text).count(),
    `${after} closed the sheet`
  ).toBe(1);
}

test("a tap on the sheet's TextInput reaches JS whole, and a sideways drag scrolls its list and costs no later tap", async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'sheet');
  const window = await windowBox(screen);
  await reveal(screen, screen.getByTestId('sheet-open-fit'));
  const log = screen.getByTestId('sheet-log');
  await expect(log).toHaveText('none');
  expect(
    await screen.getByText(FIT).count(),
    'the content is mounted before the sheet is presented'
  ).toBe(0);

  await openSheet(screen, 'sheet-open-fit', FIT);
  await screen.getByTestId('sheet-input').tap();
  await expect(screen.getByTestId('sheet-input-touches')).toHaveText(
    'Input touches: in 1 out 1'
  );

  // The path leaves the chip and the list: the drag is the list's from its first move.
  const chip = await boxOf(screen.getByText('Chip 1'));
  if (chip == null) {
    throw new Error('real-input: Chip 1 has no box to drag along.');
  }
  const row = Math.round(chip.y + chip.height / 2);
  await screen.swipe({
    from: { x: Math.round(window.x + window.width * 0.9), y: row },
    to: { x: Math.round(window.x + window.width * 0.1), y: row },
    duration: 400,
  });
  const moved = await restingBoxOrGone(screen.getByText('Chip 1'));
  expect(
    moved == null || moved.x < chip.x,
    `Chip 1 did not move left: it was at ${String(chip.x)} and is at ` +
      JSON.stringify(moved)
  ).toBe(true);
  expect(await screen.getByText(FIT).count(), 'the drag closed the sheet').toBe(
    1
  );

  await screen.getByText(FIT).tap();
  await expect(screen.getByTestId('sheet-presses')).toHaveText(
    'Pressed 1 times'
  );
  await app.back();
  await screen.getByText(FIT).waitFor({ state: 'detached' });
  await expect(log).toHaveText('press:1 > presented:false > dismiss');
});

test('Back, a tap outside and a drag down each close the fit sheet and report the close, then the dismissal', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'sheet');
  const log = screen.getByTestId('sheet-log');
  const window = await windowBox(screen);
  const outside = outsidePoint(window);

  await openSheet(screen, 'sheet-open-fit', FIT);
  await app.back();
  await screen.getByText(FIT).waitFor({ state: 'detached' });

  await openSheet(screen, 'sheet-open-fit', FIT);
  await screen.tapAt(outside);
  await screen.getByText(FIT).waitFor({ state: 'detached' });

  await openSheet(screen, 'sheet-open-fit', FIT);
  await dragDown(
    screen,
    await restingBox(screen.getByText('As tall as this')),
    window
  );
  await screen.getByText(FIT).waitFor({ state: 'detached' });
  await expect(log).toHaveText(
    'presented:false > dismiss > presented:false > dismiss > presented:false > dismiss'
  );
});

test('a sticky sheet stays up for Back, a tap outside and a drag down, and only its own button closes it', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'sheet');
  const log = screen.getByTestId('sheet-log');
  const window = await windowBox(screen);
  const outside = outsidePoint(window);

  await openSheet(screen, 'sheet-open-sticky', STICKY);
  await app.back();
  await staysUp(screen, STICKY, 'Back');
  await screen.tapAt(outside);
  await staysUp(screen, STICKY, 'a tap outside');
  await dragDown(
    screen,
    await restingBox(screen.getByText('Swipe, back and outside do nothing')),
    window
  );
  await staysUp(screen, STICKY, 'a drag down');

  await screen.getByText(STICKY).tap();
  await screen.getByText(STICKY).waitFor({ state: 'detached' });
  await expect(log).toHaveText('close > dismiss');
});

test('a drag up on the two-detent header expands the sheet, Back steps down a detent, and a second Back closes it', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'sheet');
  const log = screen.getByTestId('sheet-log');

  const half = await openSheet(screen, 'sheet-open-two', TWO);
  const from = {
    x: Math.round(half.x + half.width / 2),
    y: Math.round(half.y + half.height / 2),
  };
  await screen.swipe({
    from,
    to: { x: from.x, y: from.y - Math.round(half.y * 0.8) },
    duration: 400,
  });
  const expanded = await restingBox(screen.getByText(TWO));
  expect(
    half.y - expanded.y,
    `the header's top moved from ${String(half.y)} to ${String(expanded.y)}`
  ).toBeGreaterThan(half.y / 3);

  // Material's Back steps down a detent before it closes.
  await app.back();
  await staysUp(screen, TWO, 'Back from the expanded detent');
  await app.back();
  await screen.getByText(TWO).waitFor({ state: 'detached' });
  await expect(log).toHaveText(
    'detent:1 > detent:0 > presented:false > dismiss'
  );
});

/**
 * The header is also grabbed *before* the sheet has finished rising, which is what a person who
 * keeps dragging as it opens does. The sheet may finish rising first, but the drag has to be
 * followed rather than dropped. The box is read once, where the header is now and not where it
 * will come to rest, and aimed at the middle of the header rather than an edge of it: the sheet
 * only travels a little further from here, so the point stays on the header.
 */
test('a drag that starts while the two-detent sheet is rising expands it', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'sheet');
  const window = await windowBox(screen);
  const header = screen.getByText(TWO);

  await reveal(screen, screen.getByTestId('sheet-open-two'));
  await screen.getByTestId('sheet-open-two').tap();
  await header.waitFor({ state: 'visible' });

  const grab = screen.getByTestId('sheet-two-header');
  const rising = await boxOf(header);
  const held = await boxOf(grab);
  if (rising == null || held == null) {
    throw new Error(
      `real-input: the rising sheet has no box to drag from (header ${JSON.stringify(
        rising
      )}, grab ${JSON.stringify(held)}).`
    );
  }
  const from = {
    x: Math.round(held.x + held.width / 2),
    y: Math.round(held.y + held.height / 2),
  };
  await screen.swipe({
    from,
    to: { x: from.x, y: window.y + 2 },
    duration: 900,
  });

  const expanded = await restingBox(header);
  expect(
    expanded.y,
    `the header was grabbed at y=${String(from.y)}, inside the box ` +
      `${String(held.y)}..${String(held.y + held.height)} read while its top was still at ` +
      `${String(rising.y)} of the ${String(window.y + window.height)} window; the header ` +
      `came to rest at ${String(expanded.y)}`
  ).toBeLessThan(rising.y / 2);
});
