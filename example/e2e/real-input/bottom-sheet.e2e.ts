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
 * The detent the app was told about, read inside the two-detent sheet's window. A report is
 * only made for a settle, so this naming a detent means the sheet has stopped: Back on a
 * sheet still on its way closes it wherever it got to.
 */
function settledDetent(screen: Screen): Locator {
  return screen.getByTestId('sheet-two-detent');
}

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

  // Material's Back steps down a detent before it closes, and only once the sheet has settled
  // where the drag sent it: the report is the sheet's own word that it has.
  await expect(settledDetent(screen)).toHaveText('Detent 1');
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
  await expect(settledDetent(screen)).toHaveText('Detent 1');
  expect(
    expanded.y,
    `the header was grabbed at y=${String(from.y)}, inside the box ` +
      `${String(held.y)}..${String(held.y + held.height)} read while its top was still at ` +
      `${String(rising.y)} of the ${String(window.y + window.height)} window; the header ` +
      `came to rest at ${String(expanded.y)}`
  ).toBeLessThan(rising.y / 2);
});

/** The box of a node that is still coming on screen, read as soon as it has one. */
async function boxOnceVisible(locator: Locator): Promise<Box | null> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const box = await boxOf(locator);
    if (box != null) return box;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

/**
 * The detent a drag asked for while the sheet was still rising is a change, so it is reported even
 * when that settle is the presentation's first. The sheet opened again afterwards was never
 * dragged: across both closes the log names the one detent it had, and no more.
 */
test('a detent dragged to during the rise is reported once, and the next open reports nothing', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'sheet');
  const log = screen.getByTestId('sheet-log');
  const window = await windowBox(screen);
  const header = screen.getByText(TWO);
  await expect(log).toHaveText('none');

  await reveal(screen, screen.getByTestId('sheet-open-two'));
  await screen.getByTestId('sheet-open-two').tap();
  await header.waitFor({ state: 'visible' });
  const rising = await boxOf(header);
  if (rising == null) {
    throw new Error(
      'real-input: the rising two-detent sheet has no header box to drag from.'
    );
  }
  const from = {
    x: Math.round(rising.x + rising.width / 2),
    y: Math.round(rising.y + Math.min(rising.height / 2, 40)),
  };
  await screen.swipe({
    from,
    to: { x: from.x, y: window.y + 2 },
    duration: 260,
  });
  // The drag is the only thing that asked for a detent in either presentation, and the log is
  // read once, after the last close: an open sheet's window hides the screen's own nodes.
  await restingBox(header);
  await expect(settledDetent(screen)).toHaveText('Detent 1');
  await app.back();
  await expect(settledDetent(screen)).toHaveText('Detent 0');
  expect(
    await screen.getByText(TWO).count(),
    'Back from the detent the drag asked for closed the sheet'
  ).toBe(1);
  await app.back();
  await screen.getByText(TWO).waitFor({ state: 'detached' });

  // Opened again with no drag at all: it rises to the detent it opened at and says nothing.
  await reveal(screen, screen.getByTestId('sheet-open-two'));
  await screen.getByTestId('sheet-open-two').tap();
  const reopened = await restingBox(screen.getByText(TWO));
  expect(
    reopened.y,
    `the sheet reopened above a third of the ` +
      `${String(window.y + window.height)} window: ${JSON.stringify(reopened)}`
  ).toBeGreaterThan(window.y + window.height / 3);
  await app.back();
  await screen.getByText(TWO).waitFor({ state: 'detached' });
  await expect(log).toHaveText(
    'detent:1 > detent:0 > presented:false > dismiss > presented:false > dismiss'
  );
});

/**
 * The sheet read after a drag ended, until it leaves the tree. Reads go through the session that
 * injected the drag, so they cannot be taken across it and expect to land where the drag was:
 * they answer after the gesture, at the pace of the tree. The sheet's own root outlives the title
 * it carries by the length of Material's exit spring, which is the moment this asks about: a rise
 * that was dismissed is still composed while that spring runs, and a sheet dropped in one frame
 * is not composed at all.
 */
async function readsBeforeItLeaves(sheet: Locator): Promise<Box[]> {
  const boxes: Box[] = [];
  const until = Date.now() + 6_000;
  while (Date.now() < until && (await sheet.count()) > 0) {
    const box = await boxOf(sheet);
    if (box == null) break;
    boxes.push(box);
  }
  return boxes;
}

/**
 * A drag down that started while the sheet was rising dismisses it, and the sheet is read on its
 * way out and reports the dismissal, rather than leaving the tree in one frame. The same drag on a
 * sheet that cannot be dismissed leaves it up.
 */
test('a drag down during the rise slides the sheet out and reports the dismissal, and a sticky sheet stays up', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'sheet');
  const log = screen.getByTestId('sheet-log');
  const window = await windowBox(screen);
  const title = screen.getByText('As tall as this');
  await expect(log).toHaveText('none');

  await reveal(screen, screen.getByTestId('sheet-open-fit'));
  await screen.getByTestId('sheet-open-fit').tap();
  await title.waitFor({ state: 'visible' });
  const rising = await boxOnceVisible(title);
  if (rising == null) {
    throw new Error(
      'real-input: the rising fit sheet has no box to drag from.'
    );
  }
  await dragDown(screen, rising, window);
  const wayOut = await readsBeforeItLeaves(
    screen.getByTestId('sheet-fit-sheet')
  );
  expect(
    wayOut.length,
    'the sheet was gone before it could be read once after the drag ended, so it left the tree ' +
      'in one frame instead of sliding down on its way out'
  ).toBeGreaterThan(0);
  await title.waitFor({ state: 'detached' });
  await expect(log).toHaveText('presented:false > dismiss');

  await reveal(screen, screen.getByTestId('sheet-open-sticky'));
  await screen.getByTestId('sheet-open-sticky').tap();
  const sticky = screen.getByText('Swipe, back and outside do nothing');
  await sticky.waitFor({ state: 'visible' });
  const stickyRising = await boxOnceVisible(sticky);
  if (stickyRising == null) {
    throw new Error(
      'real-input: the rising sticky sheet has no box to drag from.'
    );
  }
  await dragDown(screen, stickyRising, window);
  await staysUp(screen, STICKY, 'a drag down during the rise');

  await screen.getByText(STICKY).tap();
  await screen.getByText(STICKY).waitFor({ state: 'detached' });
  // The fit sheet's dismissal is here too, which is why it is not read under a window.
  await expect(log).toHaveText('presented:false > dismiss > close > dismiss');
});

/**
 * A fling along the sheet's own horizontal list belongs to that list, even one that starts while
 * the sheet is still rising and drifts down as a fast sideways throw does. It neither adds a
 * detent nor closes the sheet: the sheet was rising to its one detent and stays open.
 */
test('a sideways fling on the sheet list during the rise neither expands the sheet nor closes it', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'sheet');
  const log = screen.getByTestId('sheet-log');
  const window = await windowBox(screen);
  await expect(log).toHaveText('none');

  await reveal(screen, screen.getByTestId('sheet-open-fit'));
  await screen.getByTestId('sheet-open-fit').tap();
  const chip = screen.getByText('Chip 1');
  const held = await boxOnceVisible(chip);
  if (held == null) {
    throw new Error('real-input: the rising sheet has no list to fling along.');
  }
  const from = {
    x: Math.round(held.x + held.width / 2),
    y: Math.round(held.y + held.height / 2),
  };
  await screen.swipe({
    from,
    to: {
      x: Math.max(from.x - Math.round(650 * displayDensity()), window.x + 2),
      y: Math.min(
        from.y + Math.round(70 * displayDensity()),
        window.y + window.height - 2
      ),
    },
    duration: 250,
  });

  await restingBox(screen.getByText('Chip 1'));
  expect(
    await screen.getByText(FIT).count(),
    'the sideways fling closed the sheet'
  ).toBe(1);

  // The log sits behind the sheet's window: close the sheet the app's own way, then read it.
  await screen.getByText(FIT).tap();
  await expect(screen.getByTestId('sheet-presses')).toHaveText(
    'Pressed 1 times'
  );
  await app.back();
  await screen.getByText(FIT).waitFor({ state: 'detached' });
  await expect(log).toHaveText('press:1 > presented:false > dismiss');
});

/** How far a held press may drift, in px, and stay a press: well inside the touch slop. */
const STILL_PX = 3;

/**
 * The box of a node in a sheet that is still rising, read until `aimable` accepts it: the point a
 * case wants to touch has to be under the finger when the finger arrives, and a rising sheet is in
 * the right place for it only once.
 */
async function boxWhileRising(
  locator: Locator,
  aimable: (box: Box) => boolean
): Promise<Box | null> {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const box = await boxOf(locator);
    if (box != null && aimable(box)) return box;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

/**
 * How far above the window's bottom edge a rising sheet is aimed at. A sheet is only just into
 * view when its rise begins, so a gesture that is to be caught by a rising sheet has to begin low,
 * where a band of the sheet's own content passes under it on the way up.
 */
const RISE_AIM_LIFT_PX = 40;

/** How long a press that should outlast the opening animation is held, in ms. */
const HELD_MS = 2000;

/** A box read, short enough to sit inside the message of an assertion about something else. */
function describeBox(box: Box | null): string {
  return box == null
    ? 'no box'
    : `y=${String(Math.round(box.y))}, ${String(Math.round(box.height))} px tall`;
}

/** The middle of the window, low at its bottom edge: where a rising sheet is caught. */
function riseAim(window: Box): Point {
  return {
    x: Math.round(window.x + window.width / 2),
    y: window.y + window.height - RISE_AIM_LIFT_PX,
  };
}

/** The height `styles.row60` gives the 85% sheet's list, in dp. */
const LIST_ROW_DP = 60;

/**
 * A press that does not move is not a drag, however far the sheet rose under it. The travel and the
 * release velocity of a rising-sheet drag are the finger's own, read on the screen, so the opening
 * animation's travel belongs to no one: the sheet carries on to the detent it opened at and
 * reports nothing, because nothing was dragged to. The hold outlasts the rise, and the sheet's
 * tall header band is what is under the aim while it passes.
 */
test('a press held still on the header of a rising sheet is no drag at all', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'sheet');
  const log = screen.getByTestId('sheet-log');
  const header = screen.getByTestId('sheet-two-header');
  const window = await windowBox(screen);
  const held = riseAim(window);
  await expect(log).toHaveText('none');

  await reveal(screen, screen.getByTestId('sheet-open-two'));
  await screen.getByTestId('sheet-open-two').tap();
  // Where the sheet is at the two ends of the hold: the press is only a witness about a rising
  // sheet if the rise really was still ahead of it when the finger arrived.
  const rising = await boxOf(header);
  await screen.swipe({
    from: held,
    to: { x: held.x, y: held.y + STILL_PX },
    duration: HELD_MS,
  });
  const settled = await boxOf(header);

  await staysUp(
    screen,
    TWO,
    `a press held still on its header (its header at ` +
      `${describeBox(rising)} when the press arrived, ${describeBox(settled)} when it left)`
  );
  // Nothing was dragged, so no detent was ever asked for: the sheet rests where it opened.
  await expect(settledDetent(screen)).toHaveText('Detent none');
  await app.back();
  await screen.getByText(TWO).waitFor({ state: 'detached' });
  // The one close this sheet reports is the Back's own.
  await expect(log).toHaveText('presented:false > dismiss');
});

/**
 * The same held press on a control inside the rising sheet. A `Pressable` does not block the native
 * responder, so this is still the sheet's own gesture to measure, and it measures as nothing.
 * Whether the lift answers as a press is the button's business: what may not happen is that the
 * rise is read as a drag down and the sheet goes away.
 */
test('a press held still on a button inside a rising sheet closes nothing', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'sheet');
  const log = screen.getByTestId('sheet-log');
  const window = await windowBox(screen);
  const held = riseAim(window);
  await expect(log).toHaveText('none');

  await reveal(screen, screen.getByTestId('sheet-open-fit'));
  await screen.getByTestId('sheet-open-fit').tap();
  await screen.swipe({
    from: held,
    to: { x: held.x, y: held.y + STILL_PX },
    duration: HELD_MS,
  });

  await staysUp(screen, FIT, 'a press held still on its own button');
  await app.back();
  await screen.getByText(FIT).waitFor({ state: 'detached' });
  await expect(log).toHaveText(/^(press:1 > )?presented:false > dismiss$/);
});

/**
 * The 85% sheet's list is a child inset in the sheet's own padded content, so the strip of sheet
 * to the right of it is the sheet's and not the list's: a point in that strip is outside the list
 * by the list's own width. A drag started there is the sheet's own, and the sheet's rise is no
 * part of its measurement.
 */
test("a drag that starts beside the sheet's list during the rise is the sheet's own and slides it out", async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'sheet');
  const log = screen.getByTestId('sheet-log');
  const window = await windowBox(screen);
  const list = screen.getByTestId('sheet-fraction-list');
  const detent = screen.getByTestId('sheet-fraction-detent');
  await expect(log).toHaveText('none');

  await reveal(screen, screen.getByTestId('sheet-open-fraction'));
  await screen.getByTestId('sheet-open-fraction').tap();
  // The point is asked of the list as it passes, at the height of the list itself: only a list
  // that far up the screen leaves the strip beside it under the finger.
  const rowPx = Math.round(LIST_ROW_DP * displayDensity());
  const rising = await boxWhileRising(
    list,
    (box) => box.y + rowPx < window.y + window.height - rowPx
  );
  if (rising == null) {
    throw new Error(
      'real-input: the rising 85% sheet never showed its list with the strip beside it on screen.'
    );
  }
  const from = {
    x: window.x + window.width - Math.round(8 * displayDensity()),
    y: Math.round(rising.y + rowPx / 2),
  };
  await screen.swipe({
    from,
    to: { x: from.x, y: window.y + window.height - 2 },
    duration: 250,
  });

  await detent.waitFor({ state: 'detached' });
  // This sheet's detents were never asked for, and the rise that was dismissed says nothing else.
  await expect(log).toHaveText('none');
});

/**
 * How far below the top of a read the press lands, clear of the edge it is aimed at.
 */
const AIM_INSET_PX = 8;

/**
 * How far short of its destination a read has to find the field for its aim to be trusted. A read
 * taken nearer than this may be of a field that has come to rest by the time the press lands, and
 * a drag on a settled field asks nothing of a sheet that is still rising.
 */
const AIM_MIN_RISING_PX = 100;

/**
 * Whether a press aimed a little below the top of this read lands inside the field whenever it
 * lands.
 *
 * A box read names where the field was when the read walked past it, and the sheet carries on
 * rising while the press is on its way, so the field is always higher than the read says, never
 * lower. It never rises past the place its sheet settles at either, so the travel left at the read
 * bounds how far behind the aim can have fallen: read within one field-height of the destination
 * and the press is inside the field whatever the lag turns out to be. A read taken while the field
 * is coming into view reports the part of it that is visible, so the height it can miss by is the
 * height of the settled field, and a read shorter than that is not an aimable one.
 */
function aimableWhileRising(box: Box, rest: Box): boolean {
  const travelLeft = box.y - rest.y;
  return (
    box.height >= rest.height &&
    travelLeft >= AIM_MIN_RISING_PX &&
    travelLeft + AIM_INSET_PX <= rest.height
  );
}

/**
 * The field's box at the first read an aim can trust, and every read it looked at: the reads are
 * the evidence that a drag aimed from one of them was aimed at a sheet that still had travel left.
 */
async function risingAim(
  input: Locator,
  rest: Box
): Promise<{ box: Box | null; reads: string[] }> {
  const reads: string[] = [];
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const box = await boxOf(input);
    if (box == null) {
      reads.push('no box');
    } else {
      reads.push(
        `y=${String(Math.round(box.y))} h=${String(Math.round(box.height))}`
      );
      if (aimableWhileRising(box, rest)) return { box, reads };
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return { box: null, reads };
}

/**
 * A `TextInput` takes the gesture from its touch-down, so a drag that starts on one is the
 * field's own even while the sheet is rising: it is not asked of the sheet, and the sheet carries
 * on rising. The drag is aimed from the first read whose aim cannot miss, the earliest press the
 * aim can be trusted with and so the one that finds the sheet with the most travel left; the
 * field's own press-in witnesses that the drag started inside it, and a field still short of its
 * rest once the drag ended witnesses that the sheet had not stopped yet.
 */
test('a drag down that starts on the sheet TextInput during the rise is the field’s, and the sheet stays up', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'sheet');
  const log = screen.getByTestId('sheet-log');
  const window = await windowBox(screen);
  const input = screen.getByTestId('sheet-input');
  const touches = screen.getByTestId('sheet-input-touches');
  await expect(log).toHaveText('none');
  await reveal(screen, screen.getByTestId('sheet-open-fit'));

  // An opening allowed to finish, for the one number the aim needs: where this field comes to
  // rest. A presentation with no history rests in the same place every time.
  await screen.getByTestId('sheet-open-fit').tap();
  const rest = await restingBox(input);
  await app.back();
  await screen.getByText(FIT).waitFor({ state: 'detached' });
  await expect(log).toHaveText('presented:false > dismiss');

  const room = Math.round(80 * displayDensity());
  await screen.getByTestId('sheet-open-fit').tap();
  const { box: rising, reads } = await risingAim(input, rest);
  if (rising == null) {
    throw new Error(
      `real-input: no read of the rising fit sheet caught its TextInput between ` +
        `${String(AIM_MIN_RISING_PX)} px and its own height ` +
        `${String(Math.round(rest.height))} px short of the resting ` +
        `y=${String(Math.round(rest.y))} it settles at, so this drag has no aim to trust. ` +
        `Reads: ${reads.join(' ')}.`
    );
  }
  const from = {
    x: Math.round(rising.x + rising.width / 2),
    y: Math.round(rising.y + AIM_INSET_PX),
  };
  await screen.swipe({
    from,
    to: { x: from.x, y: Math.min(from.y + room, window.y + window.height - 2) },
    duration: 250,
  });

  // A sheet rises in one direction only and stops at its destination, so a field still short of
  // its rest after the drag was short of it when the drag began: the drag is a rising sheet's own.
  const dragged = await boxOf(input);
  const witness =
    `drag aimed at y=${String(from.y)} from a read of the field at ` +
    `y=${String(Math.round(rising.y))}, ${String(Math.round(rest.y - rising.y))} px short of its ` +
    `rest at y=${String(Math.round(rest.y))}, ` +
    (dragged == null
      ? 'and the field was gone once the drag ended'
      : `the field at y=${String(Math.round(dragged.y))} once it ended`);
  const pressed =
    (await touches.count()) === 1
      ? ((await touches.textContent()) ?? 'no text')
      : 'the field left the tree with its sheet';
  expect(pressed, `${witness}: the field was never pressed`).toContain('in 1');
  await staysUp(
    screen,
    FIT,
    `a drag down that started on the sheet’s TextInput (${witness})`
  );
  await screen.getByText(FIT).tap();
  await expect(screen.getByTestId('sheet-presses')).toHaveText(
    'Pressed 1 times'
  );
  await app.back();
  await screen.getByText(FIT).waitFor({ state: 'detached' });
  await expect(log).toHaveText(
    /^presented:false > dismiss > press:1 > presented:false > dismiss$/
  );
});

/**
 * A fling that travels mostly sideways belongs to the gesture it crossed, not to the sheet, even
 * one that drops far enough to pass the slop. Along the sheet's list the child takes that gesture;
 * along the sheet's own title nothing claims it, and it is the sheet's to refuse by direction.
 */
test('a sideways fling that drifts down past the slop does not close a rising sheet', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'sheet');
  const log = screen.getByTestId('sheet-log');
  const window = await windowBox(screen);
  const title = screen.getByTestId('sheet-fit-title');
  await expect(log).toHaveText('none');

  await reveal(screen, screen.getByTestId('sheet-open-fit'));
  await screen.getByTestId('sheet-open-fit').tap();
  const rising = await boxOnceVisible(title);
  if (rising == null) {
    throw new Error(
      'real-input: the rising fit sheet has no title to fling along.'
    );
  }
  const from = {
    x: Math.round(rising.x + rising.width / 2),
    y: Math.round(rising.y + Math.min(rising.height / 2, 40)),
  };
  await screen.swipe({
    from,
    to: {
      x: Math.max(from.x - Math.round(650 * displayDensity()), window.x + 2),
      y: Math.min(
        from.y + Math.round(70 * displayDensity()),
        window.y + window.height - 2
      ),
    },
    duration: 250,
  });

  await staysUp(screen, FIT, 'a sideways fling along the rising sheet');
  await screen.getByText(FIT).tap();
  await expect(screen.getByTestId('sheet-presses')).toHaveText(
    'Pressed 1 times'
  );
  await app.back();
  await screen.getByText(FIT).waitFor({ state: 'detached' });
  await expect(log).toHaveText('press:1 > presented:false > dismiss');
});
