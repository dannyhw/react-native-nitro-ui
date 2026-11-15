/**
 * The helpers the real-input suite shares: getting to a screen, getting a
 * control into the band a tap can land in, and reading what the app draws.
 *
 * Everything here drives the device through e2e locators. There is no `adb` in
 * this directory and none is being reintroduced: the suite's rule is that a
 * touch comes from the driver and an observation comes from the screen.
 */
import { expect, type Locator, type Screen } from 'e2e';

/** The example app's Android package. */
export const APP_PACKAGE = 'nitroui.example';

/** The sideways strip the example app navigates with (`example/src/App.tsx`). */
const TAB_STRIP = 'tab-strip';

/** The Android view React Native draws the app's content into. */
const CONTENT_ROOT = 'android:id/content';

/** How many swipes `openScreen` gives the strip before calling a tab missing. */
const STRIP_SWIPES = 12;

/** How far one strip swipe travels, as a fraction of the strip's own width. */
const STRIP_STEP = 0.45;

/** How long one strip swipe takes, in ms — slow enough not to become a fling. */
const SWIPE_DURATION = 400;

/** A node's box on screen, in the device's own pixels. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A viewport point, in the same space as `boundingBox()`. */
export interface Point {
  x: number;
  y: number;
}

/** The vertical span a tap may land in. */
export interface TapBand {
  top: number;
  bottom: number;
}

/** The band, measured once per test from the app's own layout. */
let band: TapBand | null = null;

/** Reset the measured band (the fixture calls it between tests). */
export function resetTapBand(): void {
  band = null;
}

/**
 * The band a tap can land in, measured rather than guessed.
 *
 * `boundingBox` reports device pixels, which differ per emulator profile, so
 * the bounds come from the app itself: under the tab strip, because a tap up
 * there selects another screen, and inside the content view, which excludes the
 * status bar, the system nav bar and the IME — the content view shrinks when the
 * keyboard is up, which is also what the keyboard checks read.
 */
export async function tapBand(screen: Screen): Promise<TapBand> {
  if (band != null) return band;
  const strip = await screen.getByTestId(TAB_STRIP).boundingBox();
  const content = await screen.getByTestId(CONTENT_ROOT).boundingBox();
  if (strip == null || content == null) {
    throw new Error(
      'real-input: the tab strip or the content view has no box to measure against.',
    );
  }
  band = { top: strip.y + strip.height, bottom: content.y + content.height };
  return band;
}

/**
 * Open one of the example app's screens by tapping its tab.
 *
 * The strip scrolls sideways — a 15-way row gave each tab 23 dp (X19) — so a tab
 * that is off screen is not in the tree at all: drag the strip until it is, then
 * tap it. Every test launches the app fresh, so the strip always starts at its
 * beginning and one direction of travel is enough.
 */
export async function openScreen(screen: Screen, tab: string): Promise<void> {
  resetTapBand();
  const tabId = `tab-${tab}`;
  const strip = screen.getByTestId(TAB_STRIP);
  await strip.waitFor({ timeout: 60_000 });
  for (let swipes = 0; swipes <= STRIP_SWIPES; swipes += 1) {
    if ((await screen.getByTestId(tabId).count()) > 0) {
      await screen.getByTestId(tabId).tap();
      return;
    }
    if (swipes === STRIP_SWIPES) {
      throw new Error(
        `real-input: the "${tab}" tab never appeared in the strip after ` +
          `${String(STRIP_SWIPES)} swipes.`,
      );
    }
    const box = await strip.boundingBox();
    if (box == null) {
      throw new Error('real-input: the tab strip has no box to scroll along.');
    }
    // The finger path is the strip's own centre line: a direction-only swipe
    // lands in the middle of the screen, where the vertical list owns the drag.
    // The step is short and slow on purpose — a fast path across the whole strip
    // is a fling, and a flung list is still moving when the next read happens,
    // so the tabs between the start and wherever it settles are never on screen
    // at the moment of the read and the loop walks past the tab it wants.
    const y = box.y + box.height / 2;
    await screen.swipe({
      from: { x: box.x + box.width * (0.5 + STRIP_STEP / 2), y },
      to: { x: box.x + box.width * (0.5 - STRIP_STEP / 2), y },
      duration: SWIPE_DURATION,
    });
  }
}

/**
 * Scroll a control into the band a tap can reach.
 *
 * The mobile engine has no `scrollIntoView` — a node cannot be scrolled by
 * itself when it is a row of somebody else's list — so this swipes the viewport
 * until the node sits in the band, and says so when it never does.
 */
export async function reveal(
  screen: Screen,
  locator: Locator,
  options: { swipes?: number } = {},
): Promise<void> {
  const swipes = options.swipes ?? 8;
  let stalled = 0;
  for (let attempt = 0; attempt <= swipes; attempt += 1) {
    const box = await locator.boundingBox();
    if (box != null && (await isInBand(screen, box))) return;
    if (attempt === swipes) break;
    const before = box?.y ?? null;
    // One engine-level scroll per attempt, and once the page has twice refused
    // to answer it, a finger path down the middle of the content instead: what a
    // person who cannot see a row does. Counting the stalls is also what stops a
    // page that cannot scroll at all from burning eight gestures.
    if (stalled >= 2) {
      await pathScrollUp(screen);
    } else {
      await screen.swipe({ direction: 'up' });
    }
    const after = box == null ? null : (await locator.boundingBox())?.y ?? null;
    stalled = before != null && after === before ? stalled + 1 : 0;
  }
  throw new Error(
    `real-input: the control never reached the tappable band; its box reads ` +
      `${JSON.stringify(await locator.boundingBox())}.`,
  );
}

/** A finger drag up the middle of the app's content area. */
async function pathScrollUp(screen: Screen): Promise<void> {
  const content = await screen.getByTestId(CONTENT_ROOT).boundingBox();
  if (content == null) {
    throw new Error('real-input: the content view has no box to scroll along.');
  }
  const x = content.x + content.width / 2;
  await screen.swipe({
    from: { x, y: content.y + content.height * 0.72 },
    to: { x, y: content.y + content.height * 0.34 },
    duration: SWIPE_DURATION,
  });
}

/** Does a tap on this box's centre land on the control rather than on chrome? */
export async function isInBand(
  screen: Screen,
  box: Box,
  within = 0,
): Promise<boolean> {
  const { top, bottom } = await tapBand(screen);
  const centerY = box.y + box.height / 2;
  return (
    box.width > 0 &&
    box.height > 0 &&
    centerY > top + within &&
    centerY < bottom - within
  );
}

/** Read the text a node draws, or fail with a message that names the node. */
export async function textOf(screen: Screen, testId: string): Promise<string> {
  const text = await screen.getByTestId(testId).textContent();
  if (text == null) {
    throw new Error(`real-input: nothing to read at testID "${testId}".`);
  }
  return text;
}

/**
 * The centre of a node's box: the point to aim a geometry tap or drag at.
 *
 * Some controls have no actionable node a tap can land on — a `Slider` publishes
 * a `RangeInfo` node a reader can read but a tap cannot act on, and a `Stepper`
 * merges its two halves into one node — so those are pressed at a point of their
 * own box. The box is measured now, so a control that moved also moves the point.
 */
export async function centreOf(locator: Locator): Promise<Point> {
  const box = await locator.boundingBox();
  if (box == null || box.width <= 0 || box.height <= 0) {
    throw new Error(
      `real-input: no box to aim at; the node reads ${JSON.stringify(box)}.`,
    );
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The centre of a node's box, refused if a tap there would hit chrome. */
export async function tappableCentreOf(
  screen: Screen,
  locator: Locator,
): Promise<Point> {
  const point = await centreOf(locator);
  const { top, bottom } = await tapBand(screen);
  if (point.y <= top || point.y >= bottom) {
    throw new Error(
      `real-input: the point to aim at (${String(Math.round(point.y))} px) is ` +
        `outside the tappable band (${String(Math.round(top))}–` +
        `${String(Math.round(bottom))} px): scroll it in first.`,
    );
  }
  return point;
}

/** Drag from one viewport point to another, slowly enough to read as a drag. */
export async function drag(
  screen: Screen,
  from: Point,
  to: Point,
  duration = 700,
): Promise<void> {
  await screen.swipe({ from, to, duration });
}

/**
 * A vertical flick over a point: a drag, not a press.
 *
 * Deliberately short in time and long in distance — a slow short drag is what a
 * press with a slipped finger looks like to a gesture recogniser, and the check
 * that needs a drag to *not* press wants no ambiguity about which it was.
 */
export async function flick(
  screen: Screen,
  from: Point,
  distance = 700,
): Promise<void> {
  await screen.swipe({
    from,
    to: { x: from.x, y: from.y - distance },
    duration: 180,
  });
}

export { expect };
