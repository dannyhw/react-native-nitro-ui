/**
 * Pressed-state feedback: the ink a person sees while their finger is down.
 *
 * Nothing inside the React tree knows what was painted, so this compares the mean
 * luminance of a grid inside the box at rest and while held. The grid, not one pixel:
 * a bounded ripple is brightest near the touch point.
 */
import { centreOf } from './support';
import { capturedRows, lastTouchUp, rawFrameGeometry } from './device-read';
import { expect, type Locator, type Screen } from 'e2e';

import {
  pixelAt,
  type DecodedPng,
} from '../../../scripts/real-input/png-pixel.mjs';
import {
  heldDrop,
  UPTIME_STEP_S,
  type FrameGeometry,
  type HeldFrame,
} from '../../../scripts/real-input/held-frames.mjs';

/**
 * How long the finger stays down, in ms.
 *
 * Long enough that Compose has composed and drawn the state layer by the time the frame
 * is read, and short enough that this is still the press a person makes.
 */
const HOLD_MS = 1_800;

/** How far inside the control's box the sample starts, in device px. */
const INSET_PX = 12;

/** How far apart the sample points are, in device px. */
const STEP_PX = 8;

/** A box: position and size, in device px. */
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The rows of the frame the sample grid reads, and its columns. */
interface Grid {
  top: number;
  count: number;
  left: number;
  right: number;
}

/** The sample grid inside a box, inset on every side and clamped to the frame. */
function gridIn(box: Box, frame: FrameGeometry): Grid {
  const inner = {
    x: box.x + INSET_PX * 2,
    y: box.y + INSET_PX * 2,
    right: box.x + box.width - INSET_PX * 2,
    bottom: box.y + box.height - INSET_PX * 2,
  };
  const top = Math.max(0, Math.round(inner.y));
  const bottom = Math.min(frame.height - 1, Math.round(inner.bottom));
  const left = Math.max(0, Math.round(inner.x));
  const right = Math.min(frame.width - 1, Math.round(inner.right));
  // A box outside the frame samples nothing, and a mean of nothing is 0, which would
  // read as "the row went black". Refusing is the only honest answer.
  if (bottom < top || right < left) {
    throw new Error(
      `press-feedback: the box ${JSON.stringify(box)} samples nothing of a ` +
        `${String(frame.width)}x${String(frame.height)} frame.`
    );
  }
  return { top, count: bottom - top + 1, left, right };
}

/** Mean relative luminance of the grid, over rows that start at the grid's top. */
function meanLuma(rows: DecodedPng, grid: Grid): number {
  let total = 0;
  let samples = 0;
  for (let y = 0; y < grid.count; y += STEP_PX) {
    for (let x = grid.left; x <= grid.right; x += STEP_PX) {
      const pixel = pixelAt(rows, x, y);
      total +=
        (0.2126 * pixel[0]! + 0.7152 * pixel[1]! + 0.0722 * pixel[2]!) / 255;
      samples += 1;
    }
  }
  return total / samples;
}

/** The frames, one per line, for a failure message. */
function describeFrames(
  frames: readonly HeldFrame[],
  liftedAt: number | null
): string {
  if (frames.length === 0) return 'no frame was read during the press';
  return frames
    .map((frame) => {
      const toLift =
        liftedAt == null
          ? 'lift unknown'
          : `${String(Math.round((liftedAt - frame.takenBy) * 1000))}ms before the lift`;
      const counted =
        liftedAt != null && frame.takenBy + UPTIME_STEP_S < liftedAt
          ? ''
          : ' (not counted)';
      return (
        `asked +${String(frame.askedAt)}ms, taken by ${toLift}, ` +
        `mean ${frame.mean.toFixed(4)}${counted}`
      );
    })
    .join('; ');
}

/**
 * A real press on this control paints a pressed state on it.
 *
 * Frames are read for as long as the press lasts and timed by the device's clock; a
 * frame counts only if the device had taken it before the finger lifted, so neither a
 * driver slow to put the finger down nor a slow transfer can stand in for the ink.
 *
 * @param screen only for the gesture: the press is e2e’s own swipe
 * @param hold the control to hold; its box is the region that must change
 * @param options.minimumDrop how much darker the row has to get, as mean luminance —
 *   small because Material’s state-layer ink over a light row is a few percent.
 */
export async function pressPaintsFeedback(
  screen: Screen,
  hold: Locator,
  options: { minimumDrop?: number } = {}
): Promise<void> {
  const minimumDrop = options.minimumDrop ?? 0.005;
  const box = await hold.boundingBox();
  if (box == null) {
    throw new Error('press-feedback: the control has no box to sample.');
  }
  const point = await centreOf(hold);
  const frame = rawFrameGeometry();
  const grid = gridIn(box, frame);
  const read = () => capturedRows(frame, grid.top, grid.count);

  const before = meanLuma(read().image, grid);

  // A press-and-hold expressed as a drag that travels two px while the finger is down: one
  // gesture stream that is genuinely in flight. A `longPress` presses and holds too, but a
  // row inside a scrolling section settles it as its own gesture and paints nothing. Two
  // px is inside the touch slop, so the list does not scroll and nothing is cancelled.
  const pressed = screen.swipe({
    from: point,
    to: { x: point.x, y: point.y + 2 },
    duration: HOLD_MS,
  });
  const issuedAt = Date.now();
  let lifted = false;
  pressed.then(
    () => (lifted = true),
    () => (lifted = true)
  );
  const frames: HeldFrame[] = [];
  while (!lifted) {
    const askedAt = Date.now() - issuedAt;
    const { image, takenBy } = read();
    frames.push({ askedAt, takenBy, mean: meanLuma(image, grid) });
    // The capture blocks; let the press's own completion be seen between frames.
    await new Promise((resolve) => setImmediate(resolve));
  }
  await pressed;
  const liftedAt = lastTouchUp();
  // A moment after the lift, so a highlight that is on its way out is not read as one
  // that has stopped.
  await new Promise((resolve) => setTimeout(resolve, 500));
  const afterMean = meanLuma(read().image, grid);

  expect(
    liftedAt == null ? -Infinity : heldDrop(before, frames, liftedAt),
    `holding the control never darkened its own box against ${before.toFixed(4)} at ` +
      `rest, inside a ${String(HOLD_MS)}ms press (frames: ` +
      `${describeFrames(frames, liftedAt)}): a press that paints nothing leaves a ` +
      `person with no answer to their press. The sampled grid is rows ` +
      `${String(grid.top)}-${String(grid.top + grid.count - 1)}, columns ` +
      `${String(grid.left)}-${String(grid.right)} of a ${String(frame.width)}x` +
      `${String(frame.height)} frame` +
      (liftedAt == null ? '; the device reported no touchscreen lift' : '')
  ).toBeGreaterThan(minimumDrop);

  // The other half of "feedback": the ink has to go when the finger does. A box that
  // stays darker after the lift is a state the control got stuck in, which the held
  // frames above would report as a working highlight.
  expect(
    Math.abs(afterMean - before),
    `the box was still at mean luminance ${afterMean.toFixed(4)} once the finger had ` +
      `lifted, against ${before.toFixed(4)} at rest: a highlight that never clears is ` +
      `not press feedback. The sampled grid is rows ${String(grid.top)}-` +
      `${String(grid.top + grid.count - 1)} of a ${String(frame.width)}x` +
      `${String(frame.height)} frame`
  ).toBeLessThan(0.01);
}
