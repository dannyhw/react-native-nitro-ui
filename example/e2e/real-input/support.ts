/**
 * The helpers the real-input suite shares: getting to a screen, getting a
 * control into the band a tap can land in, and reading what the app draws.
 *
 * Everything here drives the device through e2e locators. There is no `adb` in
 * this directory and none is being reintroduced: the suite's rule is that a
 * touch comes from the driver and an observation comes from the screen.
 */
import { expect, type Locator, type Screen } from 'e2e';

/** The sideways strip the example app navigates with (`example/src/App.tsx`). */
const TAB_STRIP = 'example-tabs';

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
 * `boundingBox` reports device pixels, which differ per emulator profile, so the bounds
 * come from the app itself: under the tab strip, and inside the content view — which
 * excludes the status bar, the nav bar and the IME, and shrinks when the keyboard is up.
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
 * The strip scrolls sideways, so a tab that is off screen is not in the tree at all:
 * drag the strip until it is, then tap it. Every test launches the app fresh, so the
 * strip starts at its beginning and one direction of travel is enough.
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
 * Where across the window a content drag travels, as a fraction of its width.
 *
 * A hosted Compose `Slider` owns the horizontal gesture and is wide enough to lie across
 * the middle of the Host screen, so a drag there is answered by the slider and the page
 * never moves. A drag that moved nothing therefore travels the page’s own padding on
 * the next try, and the right-hand gutter gets the last attempt.
 */
const DRAG_COLUMNS = [0.5, 0.03, 0.97];

/** Which of those columns the next content drag will use. */
let dragColumn = 0;

/**
 * Down-drags taken since the page last started at the top.
 *
 * A screen’s list is composed lazily: a row that has been scrolled past is out of the
 * tree, so its label matches no node at all. The only reliable way back is the way a
 * person takes — go up again — and the drags to undo are the drags taken going down.
 */
let downDrags = 0;

/** Whether the page is known to be at its top: a fresh screen, or one just rewound. */
let atTop = true;

/** Forget any scrolling this test has done (the next screen starts at the top). */
export function resetScrollCount(): void {
  downDrags = 0;
  atTop = true;
  dragColumn = 0;
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
 * A node's box now, or `null` at once when it is not in the tree.
 *
 * `boundingBox` waits the whole action timeout for a node to appear before it gives
 * up, and an off-screen row never appears on its own: a scroll search that read it
 * that way waited 30 s per read. A count answers from one snapshot.
 */
async function boxNow(locator: Locator): Promise<Box | null> {
  if ((await locator.count()) === 0) return null;
  return boxOf(locator);
}

/**
 * Scroll a control into the band a tap can reach, by dragging the viewport: the mobile
 * engine has no `scrollIntoView` for a node inside somebody else’s list. A hosted node
 * answers with a box whether or not the page reached it, so the engine’s own
 * visibility is the witness. `reads` names nodes a test still has to read.
 *
 * The search starts from wherever the page is and travels towards the control when
 * its box says which way that is. A control out of the tree on a page that has left
 * its top could be either way, so only then is the page rewound and searched down.
 */
export async function reveal(
  screen: Screen,
  locator: Locator,
  options: { swipes?: number; reads?: Locator[] } = {}
): Promise<void> {
  const swipes = options.swipes ?? 12;
  const reads = options.reads ?? [];
  let rewound = false;
  /** Drags that moved the control not at all: two of those is the page's end. */
  let stuck = 0;
  for (let attempt = 0; attempt <= swipes; attempt += 1) {
    const box = await boxNow(locator);
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

    if (box == null && !atTop && !rewound) {
      await rewindToTop(screen);
      rewound = true;
      stuck = 0;
      attempt -= 1;
      continue;
    }

    // Which way to travel: with the control already reachable but a read still
    // missing, it is the *other* end of the window that has to come into view. A
    // control parked in the top half of the band has the missing node above it —
    // below it there is a whole window of room the node could have occupied and
    // does not — so the page is nudged back down until the read returns.
    const readsAbove =
      box != null &&
      shown &&
      inBand &&
      !readsShown &&
      (await isInUpperHalf(screen, box));
    // A box above the band means the control lies towards the top, unless the page
    // is already there.
    const passed =
      box != null &&
      !(shown && inBand && !readsShown) &&
      !atTop &&
      (await isAboveSafeBand(screen, box));
    if (readsAbove) {
      await dragContentDown(screen);
      downDrags = Math.max(0, downDrags - 1);
    } else if (passed) {
      await dragContentFraction(screen, -(await stepBackTo(screen, box)));
      downDrags = Math.max(0, downDrags - 1);
    } else {
      await dragContentUp(screen);
      downDrags += 1;
      atTop = false;
    }
    const after = await boxNow(locator);
    if (box != null && after != null && Math.abs(after.y - box.y) <= 2) {
      stuck += 1;
      // Something between the finger and the list took that drag, so the next one
      // travels a column that control does not own.
      if (stuck === 1 && dragColumn === 0) dragColumn = 1;
      else if (stuck === 3 && dragColumn === 1) dragColumn = 2;
    } else {
      stuck = 0;
    }
  }
  const missing = await countUnshown(reads);
  throw new Error(
    `real-input: the control was never in the tappable band after ` +
      `${String(swipes)} drags${rewound ? ' and a rewind to the top' : ''} along content column ` +
      `${String(Math.round((DRAG_COLUMNS[dragColumn] ?? 0.5) * 100))}%; its box ` +
      `now reads ${JSON.stringify(await boxNow(locator))}` +
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
  if ((await locator.count()) === 0) return false;
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
 * A dev build’s LogBox notification docks at the bottom of the window and swallows
 * touches meant for the row behind it, so the safe band asks for the middle of the band
 * and keeps a revealed control clear of anything that parks against an edge.
 */
const BAND_MARGIN = 0.12;

/**
 * The row’s box once it has stopped moving, or `null` for “not parked in the band”.
 *
 * A drag leaves a list coasting, and a finger aimed at the box read a moment later lands
 * where the row was about to be. Two reads 150 ms apart that agree is the cheapest proof
 * the page is standing still; the band is re-checked after, since coasting can carry a
 * row out of it.
 */
async function settleIntoBand(
  screen: Screen,
  locator: Locator
): Promise<Box | null> {
  const deadline = Date.now() + 2_000;
  let last = await boxNow(locator);
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const now = await boxNow(locator);
    // Out of the tree again means the list is still travelling past it, and a box
    // that will not hold still is a box nothing may be aimed at.
    if (now == null || last == null) return null;
    if (Math.abs(now.y - last.y) <= 2) {
      return (await isInSafeBand(screen, now)) ? now : null;
    }
    last = now;
  }
  return null;
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
  atTop = true;
}

/** One page-relative finger drag, `up` scrolling towards the bottom of the list. */
async function dragContent(screen: Screen, up: boolean): Promise<void> {
  await dragContentFraction(screen, up ? CONTENT_STEP : -CONTENT_STEP);
}

/**
 * A finger drag of a stated size: a positive fraction scrolls towards the bottom
 * of the list, a negative one back towards its top.
 */
async function dragContentFraction(
  screen: Screen,
  fraction: number
): Promise<void> {
  const content = await boxOf(screen.getByTestId(CONTENT_ROOT));
  if (content == null) {
    throw new Error('real-input: the content view has no box to scroll along.');
  }
  const column = DRAG_COLUMNS[dragColumn] ?? 0.5;
  const x = content.x + content.width * column;
  const half = Math.abs(fraction) / 2;
  const centre = content.y + content.height * 0.5;
  const from = centre + (fraction > 0 ? half : -half) * content.height;
  const to = centre - (fraction > 0 ? half : -half) * content.height;
  // Slow enough that the list settles under the finger: a fling is still moving
  // when the next tree read happens, and a row can only be stopped inside the
  // band if no single drag can cross the whole band unseen.
  await screen.swipe({
    from: { x, y: from },
    to: { x, y: to },
    duration: SWIPE_DURATION + 150,
  });
}

/** How far one lift nudges, as a fraction of the content view's height. */
const LIFT_STEP = 0.12;

/**
 * How far to drag back towards the top for a control above the band, as a fraction
 * of the content view: the distance to the band's middle, no more than one stride.
 *
 * A full stride for a control just above the band flings it past the band, and its
 * finger starts high on the page, where it lands on whatever control sits there.
 */
async function stepBackTo(screen: Screen, box: Box): Promise<number> {
  const { top, bottom } = await tapBand(screen);
  const content = await boxOf(screen.getByTestId(CONTENT_ROOT));
  if (content == null) {
    throw new Error('real-input: the content view has no box to scroll along.');
  }
  const distance = (top + bottom) / 2 - (box.y + box.height / 2);
  return Math.min(CONTENT_STEP, Math.max(LIFT_STEP, distance / content.height));
}

/**
 * Bring a control into the band by short drags towards the bottom of the list.
 *
 * A hosted control’s box is a fact about the Compose composition rather than about the
 * pixel the finger will hit, so a test that reveals the echo above it can be left with
 * the echo in the band and the control under it. A full `CONTENT_STEP` drag is too coarse
 * there — it lifts the rows above out of the tree — so the drags are short.
 */
export async function liftIntoBand(
  screen: Screen,
  control: Locator,
  reads: Locator[] = []
): Promise<Box> {
  const nudges = 4;
  for (let nudge = 0; nudge <= nudges; nudge += 1) {
    const box = await boxNow(control);
    const parked =
      box != null &&
      (await isShown(control)) &&
      (await isInSafeBand(screen, box)) &&
      (await allShown(reads));
    if (parked) {
      // The box a coasting list reports is where the control was, not where the
      // finger will land, so the lift returns the box from after the last drag.
      const settled = await settleIntoBand(screen, control);
      if (settled != null) return settled;
    }
    if (nudge === nudges) break;
    const tooHigh = box != null && (await isAboveSafeBand(screen, box));
    await dragContentFraction(screen, tooHigh ? -LIFT_STEP : LIFT_STEP);
    downDrags = tooHigh ? Math.max(0, downDrags - 1) : downDrags + 1;
    if (!tooHigh) atTop = false;
  }
  throw new Error(
    `real-input: ${String(nudges)} short drags towards the bottom of the page did ` +
      `not lift the control into the band; its box now reads ` +
      `${JSON.stringify(await boxNow(control))}, and ${String(
        await countUnshown(reads)
      )} of the rows this test reads with it are off screen.`
  );
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

/**
 * Is a box's centre in the strip above the safe band, where no reveal parks
 * anything?
 *
 * Only a lift that overshoots gets a control there, and the answer sends its next
 * nudge the other way instead of taking the control further out of reach.
 */
async function isAboveSafeBand(screen: Screen, box: Box): Promise<boolean> {
  const { top, bottom } = await tapBand(screen);
  return box.y + box.height / 2 < top + (bottom - top) * BAND_MARGIN;
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
 * The library publishes a field’s accessibility label on a node inside its `EditText`,
 * and a driver types only into an editable node: `getByLabel(label).tap()` lands while
 * `pressSequentially` refuses the group. The editable node containing the labelled one
 * names the caret owner and the announcement at once.
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
