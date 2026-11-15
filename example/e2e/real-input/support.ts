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
      'real-input: the tab strip or the content view has no box to measure against.'
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
  resetScrollCount();
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
          `${String(STRIP_SWIPES)} swipes.`
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

/** How far one content drag travels, as a fraction of the content view's height. */
const CONTENT_STEP = 0.54;

/**
 * Down-drags taken since the page last started at the top.
 *
 * A screen's list is composed lazily: a row that has been scrolled past is not
 * merely off screen, it is *out of the tree*, so its label matches no node at all
 * and there is nothing to aim at. The only reliable way back to a row is the way
 * a person takes — go up again — and the number of drags to undo is the number
 * this file took going down. `openScreen` zeroes it, because a freshly opened
 * screen starts at the top.
 */
let downDrags = 0;

/** Forget any scrolling this test has done (the next screen starts at the top). */
export function resetScrollCount(): void {
  downDrags = 0;
}

/**
 * A node's box, or `null` when it is not in the tree.
 *
 * The engine refuses a locator that matches nothing rather than answering `null`
 * for it, and for a virtualised list "matches nothing" is the ordinary answer for
 * a row that is off screen — so it is a state to act on, not an error. Anything
 * else still travels up with its own message.
 */
export async function boxOf(locator: Locator): Promise<Box | null> {
  try {
    return await locator.boundingBox();
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    if (message.includes('matched no nodes')) return null;
    throw error;
  }
}

/**
 * Scroll a control into the band a tap can reach.
 *
 * The mobile engine has no `scrollIntoView` — a node cannot be scrolled by
 * itself when it is a row of somebody else's list — so this drags the
 * viewport until the node sits in the band, and says so when it never does.
 *
 * It starts by going back to the top when this test has scrolled down, because
 * the alternative is to keep scrolling away from the row that is no longer in
 * the tree: with a lazy list, "not found" does not say which side of the
 * viewport the row is on, and only one of the two answers is to scroll down.
 *
 * Two things a box alone gets wrong, both measured on this bench:
 *
 * - **a box that is not the control on screen.** A hosted Compose node publishes
 *   its box whether or not the page has reached its composition, so a control far
 *   below the fold answers with a box that sits tidily inside the band. The
 *   engine's own visibility is the check on that: a node the screen reader cannot
 *   see — off screen, or behind a LogBox — reads hidden, and a hidden
 *   node has not been revealed however good its box looks.
 * - **a page with no scroll left.** Two drags that move the control nowhere mean
 *   the page has reached its end, and going on dragging is twelve reads of nothing
 *   — which is what it cost to learn that the control was never going to arrive.
 *   The band still has to be satisfied before that is accepted: a short list ends
 *   wherever it ends, and its last row can just as well end behind the LogBox a dev
 *   build docks against the bottom of the window, where a tap goes missing.
 *
 * `reads` names the nodes a test still has to read once the control is in
 * position — the echo row above a hosted control, say, which is a real React
 * Native node and leaves the tree when the scroll that raised the control pushes
 * it off the top. Those come back by nudging the page the other way, one drag at
 * a time, for as long as the control itself stays in the band.
 */
export async function reveal(
  screen: Screen,
  locator: Locator,
  options: { swipes?: number; reads?: Locator[] } = {}
): Promise<void> {
  const swipes = options.swipes ?? 12;
  const reads = options.reads ?? [];
  if (downDrags > 0) {
    await rewindToTop(screen);
  }
  /** Drags that moved the control not at all: two of those is the page's end. */
  let stuck = 0;
  for (let attempt = 0; attempt <= swipes; attempt += 1) {
    const box = await boxOf(locator);
    const shown = box != null && (await isShown(locator));
    const inBand = box != null && (await isInBand(screen, box));
    const inSafeBand = box != null && (await isInSafeBand(screen, box));
    const readsShown = inBand ? await allShown(reads) : false;
    if (shown && inSafeBand && readsShown) {
      if (await settleIntoBand(screen, locator)) return;
    }
    if (shown && inSafeBand && readsShown && stuck >= STUCK_DRAGS) {
      // Two drags that moved nothing: the page is done travelling. Accepting here
      // is not a lower bar — the control is already where the band says a tap
      // lands — it is only the refusal to spend the remaining drags on a page that
      // cannot move.
      return;
    }
    if (attempt === swipes) break;

    // Which way to travel: with the control already reachable but a read still
    // missing, it is the *other* end of the window that has to come into view. A
    // control parked in the top half of the band has the missing node above it —
    // below it there is a whole window of room the node could have occupied and
    // does not — so the page is nudged back down until the read returns.
    if (
      shown &&
      inBand &&
      !readsShown &&
      box != null &&
      (await isInUpperHalf(screen, box))
    ) {
      await dragContentDown(screen);
      downDrags = Math.max(0, downDrags - 1);
    } else {
      await dragContentUp(screen);
      downDrags += 1;
    }
    const after = await boxOf(locator);
    stuck =
      box != null && after != null && Math.abs(after.y - box.y) <= 2
        ? stuck + 1
        : 0;
  }
  const missing = await countUnshown(reads);
  throw new Error(
    `real-input: the control was never in the tappable band, from the top of ` +
      `the screen down through ${String(swipes)} drags; its box now reads ` +
      `${JSON.stringify(await boxOf(locator))}` +
      (reads.length > 0
        ? `, and ${String(missing)} of the ${String(reads.length)} nodes this ` +
          `test still has to read is off screen.`
        : '.')
  );
}

/** How many drags that move nothing prove the page has no scroll left. */
const STUCK_DRAGS = 2;

/**
 * Does the engine see this node — attached, on screen, not behind something?
 *
 * `visibleToUser` is the answer a screen reader is given, which is the answer a
 * touch has to agree with: a control the reader is told nothing about is one the
 * finger will not reach either.
 */
async function isShown(locator: Locator): Promise<boolean> {
  try {
    return await locator.isVisible();
  } catch (error) {
    // Off screen in a lazy list the node is not in the tree at all, and the
    // engine refuses the locator rather than answering `false` for it. Same
    // meaning, and the same state to act on as in `boxOf`.
    const message = String((error as Error)?.message ?? error);
    if (message.includes('matched no nodes')) return false;
    throw error;
  }
}

/** Does the engine see every one of these nodes? */
async function allShown(locators: Locator[]): Promise<boolean> {
  for (const locator of locators) {
    if (!(await isShown(locator))) return false;
  }
  return true;
}

/** How many of these nodes does the engine not see? */
async function countUnshown(locators: Locator[]): Promise<number> {
  let missing = 0;
  for (const locator of locators) {
    if (!(await isShown(locator))) missing += 1;
  }
  return missing;
}

/** Is a box's centre in the top half of the band? */
async function isInUpperHalf(screen: Screen, box: Box): Promise<boolean> {
  const { top, bottom } = await tapBand(screen);
  return box.y + box.height / 2 < (top + bottom) / 2;
}

/**
 * How far inside the band a revealed control has to sit, as a fraction of it.
 *
 * The band is "not the tab strip, not the system bars", which is the honest answer
 * to "can a tap land here" but not to "did this tap land on my control": a dev
 * build's LogBox notification docks at the bottom of the window and swallows
 * touches meant for the row behind it (seen on the Form screen, where the Note
 * field was revealed just above the navigation bar and under that box). Asking
 * for the middle of the band costs one more drag now and then, and keeps a
 * revealed control clear of anything that parks against an edge.
 */
const BAND_MARGIN = 0.12;

/**
 * Wait until the row has stopped moving, and is still in the band.
 *
 * A drag leaves a list coasting: the box read a moment later is the row's box
 * *now*, and the finger that follows it lands where the row was about to be. That
 * is what makes a check aim at a control and press nothing — the tap goes into
 * the space a still-travelling row will occupy in 200 ms, and the check then
 * reports a control that does not answer. Two reads 150 ms apart that agree is
 * the cheapest proof that the page is standing still, and the band is re-checked
 * afterwards because coasting can carry a row out of it.
 */
async function settleIntoBand(
  screen: Screen,
  locator: Locator
): Promise<boolean> {
  const deadline = Date.now() + 2_000;
  let last = await boxOf(locator);
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const now = await boxOf(locator);
    // Out of the tree again means the list is still travelling past it, and a box
    // that will not hold still is a box nothing may be aimed at.
    if (now == null || last == null) return false;
    if (Math.abs(now.y - last.y) <= 2) return isInSafeBand(screen, now);
    last = now;
  }
  return false;
}

/**
 * Drag back up to the top of the page.
 *
 * Generous on purpose: a drag can carry a list a little further than its own
 * stride through fling momentum, and arriving short means searching *away* from
 * the row again. Extra drags at the top of a page cost a second each and press
 * nothing.
 */
async function rewindToTop(screen: Screen): Promise<void> {
  const back = Math.ceil(downDrags * 1.5) + 2;
  for (let attempt = 0; attempt < back; attempt += 1) {
    await dragContentDown(screen);
  }
  downDrags = 0;
}

/** One page-relative finger drag, `up` scrolling towards the bottom of the list. */
async function dragContent(screen: Screen, up: boolean): Promise<void> {
  const content = await boxOf(screen.getByTestId(CONTENT_ROOT));
  if (content == null) {
    throw new Error('real-input: the content view has no box to scroll along.');
  }
  const x = content.x + content.width / 2;
  const half = CONTENT_STEP / 2;
  const from = content.y + content.height * (up ? 0.5 + half : 0.5 - half);
  const to = content.y + content.height * (up ? 0.5 - half : 0.5 + half);
  // Slow enough that the list settles under the finger: a fling is still moving
  // when the next tree read happens, and a row can only be stopped inside the
  // band if no single drag can cross the whole band unseen.
  await screen.swipe({
    from: { x, y: from },
    to: { x, y: to },
    duration: SWIPE_DURATION + 150,
  });
}

/** Scroll towards the bottom of the list. */
async function dragContentUp(screen: Screen): Promise<void> {
  await dragContent(screen, true);
}

/** Scroll back towards the top of the list. */
async function dragContentDown(screen: Screen): Promise<void> {
  await dragContent(screen, false);
}

/**
 * Is a box's centre inside the band a revealed control is parked in?
 *
 * `isInBand` with a margin: the same measurement, narrowed on both sides, so the
 * one definition of "a tap lands here" is not forked.
 */
async function isInSafeBand(screen: Screen, box: Box): Promise<boolean> {
  const { top, bottom } = await tapBand(screen);
  return isInBand(screen, box, (bottom - top) * BAND_MARGIN);
}

/** Does a tap on this box's centre land on the control rather than on chrome? */
export async function isInBand(
  screen: Screen,
  box: Box,
  within = 0
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

/**
 * The editable node of the field a person is told about as `label`.
 *
 * The library publishes a field's accessibility label on a node *inside* its
 * `EditText` (a Compose semantics node, not the view that takes the caret), and
 * a driver types only into an editable node: `getByLabel(label).tap()` lands,
 * while `pressSequentially` refuses the group with "can only focus editable
 * fields". Asking for the editable node that *contains* the labelled one is the
 * honest reading of the tree — it names the caret owner and the announcement at
 * once, and it breaks loudly if the library ever moves the label off the field.
 */
export function editableField(screen: Screen, label: string): Locator {
  return screen
    .getByRole('textbox')
    .or(screen.getByRole('searchbox'))
    .filter({ has: screen.getByLabel(label) });
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
      `real-input: no box to aim at; the node reads ${JSON.stringify(box)}.`
    );
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The centre of a node's box, refused if a tap there would hit chrome. */
export async function tappableCentreOf(
  screen: Screen,
  locator: Locator
): Promise<Point> {
  const point = await centreOf(locator);
  const { top, bottom } = await tapBand(screen);
  if (point.y <= top || point.y >= bottom) {
    throw new Error(
      `real-input: the point to aim at (${String(Math.round(point.y))} px) is ` +
        `outside the tappable band (${String(Math.round(top))}–` +
        `${String(Math.round(bottom))} px): scroll it in first.`
    );
  }
  return point;
}

/** Drag from one viewport point to another, slowly enough to read as a drag. */
export async function drag(
  screen: Screen,
  from: Point,
  to: Point,
  duration = 700
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
  distance = 700
): Promise<void> {
  await screen.swipe({
    from,
    to: { x: from.x, y: from.y - distance },
    duration: 180,
  });
}

export { expect };

/**
 * The box of a control that has been revealed, checked against the band.
 *
 * A hosted control's box is published by Compose for a node that is not on
 * screen at all — the composition keeps its children whether the page has
 * reached them or not — so a box read once can describe a control a thousand px
 * below the fold while still landing inside the band. Scrolling once is not
 * enough for that: reading another node (an echo above the control, which every
 * one of these tests does) can pull the page back up again. So the rule is
 * reveal → read → believe the box only if it is where the band says it is, and
 * reveal again when it is not. Three rounds, because a third disagreement is a
 * bug worth an error rather than another drag.
 */
export async function revealedBoxInBand(
  screen: Screen,
  locator: Locator
): Promise<Box> {
  for (let round = 0; round < 3; round += 1) {
    await reveal(screen, locator);
    const box = await boxOf(locator);
    if (box != null && (await isInSafeBand(screen, box))) {
      return box;
    }
    // The box moved out from under the reveal: forget what this test scrolled
    // and let the next round drive from the top again.
    downDrags = 0;
  }
  throw new Error(
    `real-input: the control's box left the tappable band three times after ` +
      `being revealed; its box now reads ${JSON.stringify(await boxOf(locator))}.`
  );
}
