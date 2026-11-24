import { expect, type Screen } from 'e2e';

import { test } from './fixture';
import { adbShell, displayDensity, popupWindowCount } from './device-read';
import { actionFlags } from './os-tree';
import { boxOf, openScreen, reveal, type Box, type Point } from './support';

test('a real long press opens the context menu at the finger and the view under it never fires', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'contextmenu');
  const target = screen.getByTestId('ctx-target');
  const order = screen.getByTestId('ctx-order');
  const echo = screen.getByTestId('ctx-echo');
  await reveal(screen, target);

  // Two claims, both gesture arbitration: the long press belongs to the ContextMenu
  // (`open`), and the Pressable underneath is left alone (`press=0`). The echoes are
  // read once the popup is gone — while it is up the page’s own text is not in the tree.
  await expect(order).toHaveText('order=');
  await target.longPress({ duration: 900 });
  const reply = screen.getByText('Reply');
  await reply.waitFor({ state: 'visible' });

  await reply.tap();
  await reply.waitFor({ state: 'detached' });
  await expect(order).toHaveText('order=open,select:reply,close');
  await expect(echo).toContainText('press=0;');
});

/** How long a finger stays down to open a menu: past the platform's long-press timeout. */
const HOLD_MS = 1000;

/** How long a window opened by mistake, or a press still on its way, takes to land. */
const SETTLE_MS = 800;

/** How long a closed menu's window is given to leave the window manager. */
const WINDOW_GONE_MS = 8_000;

const COUNTERS = [
  'press',
  'opens',
  'closes',
  'selects',
  'below',
  'inner',
  'outer',
  'bottom',
  'dPress',
  'dOpens',
  'scrollY',
  'hX',
] as const;

type Counts = Record<(typeof COUNTERS)[number], number>;

/** The screen's counters, read off its echo line (`press=1;opens=0;…`). */
async function counts(screen: Screen): Promise<Counts> {
  const text = (await screen.getByTestId('ctx-echo').textContent()) ?? '';
  const read = new Map<string, number>();
  for (const part of text.split(';')) {
    const [key, value] = part.split('=');
    if (key != null && value != null && /^-?\d+$/.test(value)) {
      read.set(key, Number(value));
    }
  }
  const out = {} as Counts;
  for (const key of COUNTERS) {
    const value = read.get(key);
    if (value == null) {
      throw new Error(
        `real-input: ctx-echo has no ${key}; it reads "${text}".`
      );
    }
    out[key] = value;
  }
  return out;
}

/** Wait until one counter reads `value`, and return every counter at that moment. */
async function countReaches(
  screen: Screen,
  key: keyof Counts,
  value: number
): Promise<Counts> {
  await expect
    .poll(async () => (await counts(screen))[key], {
      timeout: WINDOW_GONE_MS,
      message: `the echo's ${key} never reached ${String(value)}`,
    })
    .toBe(value);
  return counts(screen);
}

async function popupsReach(count: number): Promise<void> {
  await expect
    .poll(() => popupWindowCount(), {
      timeout: WINDOW_GONE_MS,
      interval: 250,
      message: `the app's popup windows never reached ${String(count)}`,
    })
    .toBe(count);
}

/**
 * The window manager's answer to "did the hold's menu come up", asked before the tree.
 *
 * A tree read straight after a hold can catch the window change itself: it has carried
 * the open menu's subtree twice, and a locator that expects one node calls that
 * ambiguous instead of waiting for the change to end.
 */
async function popupWindowUp(): Promise<void> {
  await expect
    .poll(() => popupWindowCount(), {
      timeout: WINDOW_GONE_MS,
      interval: 250,
      message:
        'the hold put no popup window up: the ContextMenu never opened, so no ' +
        'placement was ever asked for',
    })
    .toBeGreaterThan(0);
  const up = popupWindowCount();
  expect(
    up,
    `the hold put ${String(up)} popup windows up. One open ContextMenu owns exactly ` +
      'one: two windows is the menu drawn twice, not a slower read of one menu'
  ).toBe(1);
}

function pointIn(box: Box, fx: number, fy: number): Point {
  return {
    x: Math.round(box.x + box.width * fx),
    y: Math.round(box.y + box.height * fy),
  };
}

async function boxOfTestId(screen: Screen, testId: string): Promise<Box> {
  const box = await boxOf(screen.getByTestId(testId));
  if (box == null || box.width <= 0 || box.height <= 0) {
    throw new Error(
      `real-input: "${testId}" has no box on the ContextMenu screen; it reads ` +
        `${JSON.stringify(box)}.`
    );
  }
  return box;
}

/** A finger held still at a point: two px of travel stays inside the touch slop. */
async function holdAt(screen: Screen, at: Point): Promise<void> {
  await screen.swipe({
    from: at,
    to: { x: at.x, y: at.y + 2 },
    duration: HOLD_MS,
  });
}

/**
 * The open popup's own box. While a popup is up the tree is that window's alone, and its
 * `android:id/content` is the popup, not the page.
 */
async function popupBox(screen: Screen, row: string): Promise<Box> {
  await screen.getByText(row).waitFor({ state: 'visible' });
  return boxOfTestId(screen, 'android:id/content');
}

/**
 * Scroll `ctx-scroll` until the node sits wholly inside it, with slow drags along the
 * right-hand edge: no fling, and no ContextMenu under the finger.
 */
async function revealInScroll(screen: Screen, testId: string): Promise<Box> {
  const view = await boxOfTestId(screen, 'ctx-scroll');
  const edge = view.x + view.width - 8;
  const from = Math.round(view.y + view.height / 2);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const node = await boxOf(screen.getByTestId(testId));
    const top = view.y + 8;
    const bottom = view.y + view.height - 8;
    if (node != null && node.y >= top && node.y + node.height <= bottom) {
      return node;
    }
    // Out of the tree means scrolled out of sight, and everything here is below.
    const down = node == null || node.y + node.height > bottom;
    await screen.swipe({
      from: { x: edge, y: from },
      to: { x: edge, y: down ? from - 350 : from + 350 },
      duration: 900,
    });
  }
  throw new Error(
    `real-input: "${testId}" never came wholly inside ctx-scroll; it reads ` +
      `${JSON.stringify(await boxOf(screen.getByTestId(testId)))}.`
  );
}

/** Scroll `ctx-scroll` back to its top, along the same edge, until its echo says 0. */
async function scrollToTop(screen: Screen): Promise<void> {
  const view = await boxOfTestId(screen, 'ctx-scroll');
  const edge = view.x + view.width - 8;
  const from = Math.round(view.y + view.height * 0.3);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (((await counts(screen)).scrollY ?? 0) <= 0) return;
    await screen.swipe({
      from: { x: edge, y: from },
      to: { x: edge, y: from + 700 },
      duration: 300,
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `real-input: ctx-scroll did not return to its top; scrollY reads ` +
      `${String((await counts(screen)).scrollY)}.`
  );
}

test('quick taps belong to the child, and each of three still holds opens the menu at the finger, leaves the child alone and reports the pick before the close', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'contextmenu');
  await reveal(screen, screen.getByTestId('ctx-target'));
  const density = displayDensity();
  // Off-centre on purpose: the press point is the anchor, so a menu anchored to the
  // view's centre or corner reads tens of dp away from the finger.
  const at = pointIn(await boxOfTestId(screen, 'ctx-target'), 0.3, 0.4);

  for (let tap = 1; tap <= 3; tap += 1) {
    await screen.tapAt(at);
    await countReaches(screen, 'press', tap);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    const after = await counts(screen);
    expect(after.press, `quick tap ${String(tap)} pressed more than once`).toBe(
      tap
    );
    expect(after.opens, `quick tap ${String(tap)} opened the menu`).toBe(0);
  }
  expect(popupWindowCount(), 'a quick tap put a window up').toBe(0);

  for (let hold = 1; hold <= 3; hold += 1) {
    const before = await counts(screen);
    await holdAt(screen, at);
    const popup = await popupBox(screen, 'Copy text');
    expect(
      Math.abs(popup.x - at.x) <= density &&
        Math.abs(popup.y - at.y) <= density,
      `hold ${String(hold)}: the popup's top-start ${String(popup.x)},` +
        `${String(popup.y)} is more than 1 dp from the finger at ${String(at.x)},` +
        `${String(at.y)}`
    ).toBe(true);
    await screen.getByText('Copy text').tap();
    await popupsReach(0);
    const picked = await countReaches(screen, 'closes', before.closes + 1);
    // Every cycle, not only the first: a menu can open, pick or order its events
    // correctly once and differently the next time it is shown.
    expect(picked.press, `hold ${String(hold)} pressed the child`).toBe(
      before.press
    );
    expect(picked.selects, `hold ${String(hold)}'s pick was not reported`).toBe(
      before.selects + 1
    );
    const order = ((await screen.getByTestId('ctx-order').textContent()) ?? '')
      .replace('order=', '')
      .split(',')
      .slice(-3)
      .join(',');
    expect(order, `hold ${String(hold)}'s events are out of order`).toBe(
      'open,select:copy,close'
    );

    // After a menu, the next tap is an ordinary press again, and only one.
    await screen.tapAt(at);
    await countReaches(screen, 'press', before.press + 1);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    expect((await counts(screen)).press).toBe(before.press + 1);
  }
});

test('a drag that starts on the ContextMenu, or inside its horizontal list, scrolls and opens nothing', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'contextmenu');
  await reveal(screen, screen.getByTestId('ctx-target'));

  for (let drag = 1; drag <= 3; drag += 1) {
    const from = pointIn(await boxOfTestId(screen, 'ctx-target'), 0.5, 0.5);
    const before = await counts(screen);
    await screen.swipe({
      from,
      to: { x: from.x, y: from.y - 500 },
      duration: 250,
    });
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    // The window first: while one is up, the page's echo is not in the tree to read.
    expect(popupWindowCount(), `drag ${String(drag)} put a window up`).toBe(0);
    const after = await counts(screen);
    expect(
      after.scrollY,
      `drag ${String(drag)} did not scroll the page`
    ).not.toBe(before.scrollY);
    expect(after.opens, `drag ${String(drag)} opened the menu`).toBe(0);
    await scrollToTop(screen);
  }

  const strip = await boxOfTestId(screen, 'ctx-hscroll');
  const before = await counts(screen);
  await screen.swipe({
    from: pointIn(strip, 0.8, 0.5),
    to: pointIn(strip, 0.2, 0.5),
    duration: 300,
  });
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  expect(popupWindowCount(), 'the pan put a window up').toBe(0);
  const after = await counts(screen);
  expect(after.hX, 'the inner horizontal ScrollView did not pan').not.toBe(
    before.hX
  );
  expect(after.opens, 'the pan opened the menu').toBe(0);
});

test('a tap outside closes the menu and the view under it never fires', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'contextmenu');
  await reveal(screen, screen.getByTestId('ctx-below'));
  const at = pointIn(await boxOfTestId(screen, 'ctx-target'), 0.3, 0.4);
  // Read before the hold: while the popup is up, the page is not in the tree.
  const below = pointIn(await boxOfTestId(screen, 'ctx-below'), 0.85, 0.5);
  const before = await counts(screen);

  await holdAt(screen, at);
  await screen.getByText('Copy text').waitFor({ state: 'visible' });
  await screen.tapAt(below);
  await popupsReach(0);
  await countReaches(screen, 'closes', before.closes + 1);
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  const after = await counts(screen);
  expect(after.closes - before.closes, 'the close was reported twice').toBe(1);
  expect(after.below, 'the outside tap also pressed the view under it').toBe(
    before.below
  );
});

test('an accessible menu is one named node, a hold opens only the innermost menu, and a disabled one leaves the hold to its child', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'contextmenu');
  await revealInScroll(screen, 'ctx-accessible');
  await expect(screen.getByLabel('Message from Grace')).toHaveCount(1);

  const before = await counts(screen);
  const inner = await revealInScroll(screen, 'ctx-inner');
  await holdAt(screen, pointIn(inner, 0.5, 0.5));
  await screen.getByText('Inner action').waitFor({ state: 'visible' });
  await expect(screen.getByText('Outer action')).toHaveCount(0);
  await app.back();
  await popupsReach(0);
  const afterNested = await countReaches(screen, 'inner', before.inner + 1);
  expect(afterNested.outer, 'the outer ContextMenu opened too').toBe(
    before.outer
  );

  // A Pressable with no onLongPress presses on release, so the hold is the child's.
  const child = await revealInScroll(screen, 'ctx-disabled-target');
  await holdAt(screen, pointIn(child, 0.5, 0.5));
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  expect(popupWindowCount(), 'a disabled ContextMenu put a window up').toBe(0);
  const afterDisabled = await countReaches(
    screen,
    'dPress',
    afterNested.dPress + 1
  );
  expect(afterDisabled.dOpens, 'a disabled ContextMenu reported an open').toBe(
    afterNested.dOpens
  );
});

test('an accessible menu is a stop TalkBack can double-tap and hold', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'contextmenu');
  await revealInScroll(screen, 'ctx-accessible');
  const named = actionFlags({ label: 'Message from Grace' });
  expect(
    { longClickable: named?.longClickable, focusable: named?.focusable },
    named?.detail ?? 'no node carries "Message from Grace"'
  ).toEqual({ longClickable: 'true', focusable: 'true' });
});

// A long-clickable node is an actionable stop, so a menu that is not `accessible` offers
// none: its own Text would otherwise be read as a stop the app never asked for.
test('a menu that is not accessible offers TalkBack no long-click and no stop', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'contextmenu');
  await screen.getByTestId('ctx-bottom').waitFor({ state: 'visible' });
  const plain = actionFlags({ testId: 'ctx-bottom' });
  expect(
    { longClickable: plain?.longClickable, focusable: plain?.focusable },
    plain?.detail ?? 'no node carries the testID "ctx-bottom"'
  ).toEqual({ longClickable: 'false', focusable: 'false' });
});

/** How far above the system's bottom strip the finger sits, in dp. */
const CLEAR_OF_STRIP_DP = 12;

/** One visible `navigationBars` or `mandatorySystemGestures` source, with its frame. */
const SYSTEM_BOTTOM_INSET =
  /\bInsetsSource\b[^\n]*?\btype=(?:navigationBars|mandatorySystemGestures)\b[^\n]*?\bframe=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\][^\n]*?\bvisible=(true|false)/g;

/**
 * The top edge of the strip the system keeps along the bottom of the screen, which takes
 * a touch that starts inside it.
 *
 * This is the app's own inset, read out of its window's `InsetsState` the way the
 * keyboard's edge is read: the strip is one height in button navigation and another in
 * gesture navigation, so a hardcoded line would be a guess about the system image.
 */
function systemStripTopPx(contentBottom: number): number {
  const dump = adbShell(['dumpsys', 'activity', 'top']);
  const seen: string[] = [];
  let top = Number.POSITIVE_INFINITY;
  for (const match of dump.matchAll(SYSTEM_BOTTOM_INSET)) {
    seen.push((match[0] ?? '').trim().slice(0, 160));
    const sourceTop = Number(match[2]);
    const bottom = Number(match[4]);
    if (match[5] !== 'true' || bottom < contentBottom) continue;
    // A source over the whole window is the insets host, not a strip at an edge.
    if (sourceTop <= 0 || bottom - sourceTop > contentBottom / 2) continue;
    top = Math.min(top, sourceTop);
  }
  if (!Number.isFinite(top)) {
    throw new Error(
      'real-input: the device named no bottom system strip, so this case has no line to ' +
        `hold clear of. Its own strip lines: ${seen.length > 0 ? seen.join(' ~ ') : 'none at all'}.`
    );
  }
  return top;
}

/**
 * The lowest point inside `row` that a touch reaches the app with: at `stripTop` the
 * system's strip begins, and a hold there is the gesture handle's, not the app's.
 */
function lowestHoldInRow(row: Box, stripTop: number, density: number): Point {
  const at = {
    x: Math.round(row.x + row.width * 0.3),
    y: stripTop - Math.round(CLEAR_OF_STRIP_DP * density),
  };
  expect(
    at.y > row.y && at.y < row.y + row.height,
    `"ctx-bottom" spans ${String(row.y)}..${String(row.y + row.height)} and the system's ` +
      `bottom strip starts at ${String(stripTop)}, so a hold clear of the handle never ` +
      `lands inside the row: it would sit at ${String(at.y)}. The row has to reach above ` +
      'the strip for anything to be held at the bottom edge.'
  ).toBe(true);
  return at;
}

test('at the bottom edge the menu opens above the finger', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'contextmenu');
  const row = await boxOfTestId(screen, 'ctx-bottom');
  // Read before the hold: while the popup is up the tree is its window's alone, and the
  // content view's bottom is the edge the menu has to fit its whole height above.
  const content = await boxOfTestId(screen, 'android:id/content');
  const low = lowestHoldInRow(
    row,
    systemStripTopPx(content.y + content.height),
    displayDensity()
  );
  const before = await counts(screen);

  await holdAt(screen, low);
  await popupWindowUp();
  // The popup's box, from the one read that cannot catch the window change: a tree taken
  // during it holds the menu's subtree twice, and only a settled one answers one.
  await expect(screen.getByText('Bottom one')).toHaveCount(1);
  const popup = await boxOfTestId(screen, 'android:id/content');
  expect(
    popup.y + popup.height,
    `the popup ${JSON.stringify(popup)} reaches below the finger at ${String(low.y)}`
  ).toBeLessThanOrEqual(low.y);
  const below = content.y + content.height - low.y;
  expect(
    popup.height,
    `the menu is ${String(popup.height)} px tall with ${String(below)} px below the ` +
      'finger, so it could have opened downwards: this hold is no longer at an edge that ' +
      'leaves the menu one way to go'
  ).toBeGreaterThan(below);
  await app.back();
  await popupsReach(0);
  await countReaches(screen, 'bottom', before.bottom + 1);
});
