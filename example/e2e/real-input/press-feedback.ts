/**
 * Pressed-state feedback: the ink a person sees while their finger is down.
 *
 * Nothing inside the React tree knows what was painted, so this compares the mean
 * luminance of a grid inside the box at rest and while held. The grid, not one pixel:
 * a bounded ripple is brightest near the touch point.
 */
import { centreOf } from './support';
import { screenCapture } from './device-read';
import { expect, type Locator, type Screen } from 'e2e';

import {
  pixelAt,
  type DecodedPng,
} from '../../../scripts/real-input/png-pixel.mjs';

/**
 * How long the finger stays down, in ms.
 *
 * Long enough that Compose has composed and drawn the state layer by the time the frame
 * is read, and short enough that this is still the press a person makes.
 */
const HOLD_MS = 1_800;

/**
 * How long after the press is issued the first frame is asked for, in ms. Measured
 * from the call rather than from the finger, because the driver’s own round trip to
 * put the finger down is not visible from here and varies from run to run.
 */
const CAPTURE_AFTER_MS = 450;

/** One frame read while the press was in flight, timed from when it was issued. */
export interface HeldFrame {
  askedAt: number;
  doneAt: number;
  mean: number;
}

/**
 * The most a frame darkened the box while the finger was certainly still down.
 *
 * The finger goes down no earlier than the press is issued and stays down `holdMs`,
 * so a frame whose read finished before `holdMs` from the issue was taken before the
 * lift. A frame finished later may show ink fading after the lift and is not counted.
 * Frames taken before the finger landed show the box at rest and count for nothing.
 */
export function heldDrop(
  before: number,
  frames: readonly HeldFrame[],
  holdMs: number
): number {
  return frames
    .filter((frame) => frame.doneAt < holdMs)
    .reduce((most, frame) => Math.max(most, before - frame.mean), -Infinity);
}

/** The frames, one per line, for a failure message. */
function describeFrames(frames: readonly HeldFrame[], holdMs: number): string {
  if (frames.length === 0) return 'no frame was read before the press ended';
  return frames
    .map(
      (frame) =>
        `asked +${String(frame.askedAt)}ms, read by +${String(frame.doneAt)}ms, ` +
        `mean ${frame.mean.toFixed(4)}` +
        (frame.doneAt < holdMs
          ? ''
          : ' (finished after the press, not counted)')
    )
    .join('; ');
}

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

/** The control's own box, pulled in by `INSET_PX` on every side. */
function inset(box: Box): Box {
  return {
    x: box.x + INSET_PX,
    y: box.y + INSET_PX,
    width: Math.max(1, box.width - INSET_PX * 2),
    height: Math.max(1, box.height - INSET_PX * 2),
  };
}

/** Mean relative luminance of a grid inside a box, clamped to the image. */
function meanLuma(image: DecodedPng, box: Box): number {
  const x1 = Math.max(0, Math.round(box.x) + INSET_PX);
  const x2 = Math.min(
    image.width - 1,
    Math.round(box.x + box.width) - INSET_PX
  );
  const y1 = Math.max(0, Math.round(box.y) + INSET_PX);
  const y2 = Math.min(
    image.height - 1,
    Math.round(box.y + box.height) - INSET_PX
  );
  let total = 0;
  let samples = 0;
  for (let y = y1; y <= y2; y += STEP_PX) {
    for (let x = x1; x <= x2; x += STEP_PX) {
      const pixel = pixelAt(image, x, y);
      total +=
        (0.2126 * pixel[0]! + 0.7152 * pixel[1]! + 0.0722 * pixel[2]!) / 255;
      samples += 1;
    }
  }
  // A box outside the image samples nothing, and a mean of nothing is 0 — which
  // would read as "the row went black". Refusing is the only honest answer.
  if (samples === 0) {
    throw new Error(
      `press-feedback: the box ${JSON.stringify(box)} is outside a ` +
        `${String(image.width)}x${String(image.height)} capture.`
    );
  }
  return total / samples;
}

/**
 * A real press on this control paints a pressed state on it.
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
  const region = inset(box);
  const point = await centreOf(hold);

  const atRest = screenCapture();
  const before = meanLuma(atRest, region);

  // A press-and-hold expressed as a drag that travels two px while the finger is down: one
  // gesture stream that is genuinely in flight. A `longPress` presses and holds too, but a
  // row inside a scrolling section settles it as its own gesture and paints nothing. Two
  // px is inside the touch slop, so the list does not scroll and nothing is cancelled.
  const pressed = screen.swipe({
    from: point,
    to: { x: point.x, y: point.y + 2 },
    duration: HOLD_MS,
  });
  const downAt = Date.now();
  let lifted = false;
  pressed.then(
    () => (lifted = true),
    () => (lifted = true)
  );
  // Frames until one shows ink or the press is over: a single frame at a fixed offset
  // lands before the touch whenever the driver is slow to put the finger down.
  const frames: HeldFrame[] = [];
  await sleepUntil(downAt + CAPTURE_AFTER_MS);
  while (!lifted && Date.now() - downAt < HOLD_MS) {
    const askedAt = Date.now() - downAt;
    const held = screenCapture();
    const doneAt = Date.now() - downAt;
    const mean = meanLuma(held, region);
    frames.push({ askedAt, doneAt, mean });
    if (heldDrop(before, frames, HOLD_MS) > minimumDrop) break;
    // The capture blocks; let the press's own completion be seen between frames.
    await new Promise((resolve) => setImmediate(resolve));
  }
  await pressed;
  // A moment after the lift, so a highlight that is on its way out is not read as one
  // that has stopped.
  await sleepUntil(Date.now() + 500);
  const afterGesture = screenCapture();
  const afterMean = meanLuma(afterGesture, region);

  expect(
    heldDrop(before, frames, HOLD_MS),
    `holding the control never darkened its own box against ${before.toFixed(4)} at ` +
      `rest, inside a ${String(HOLD_MS)}ms press (frames: ` +
      `${describeFrames(frames, HOLD_MS)}): a press that paints nothing leaves a ` +
      `person with no answer to their press. The sampled region is ` +
      `${JSON.stringify(region)} of a ${String(atRest.width)}x` +
      `${String(atRest.height)} frame`
  ).toBeGreaterThan(minimumDrop);

  // The other half of "feedback": the ink has to go when the finger does. A box that
  // stays darker after the lift is a state the control got stuck in, which the held
  // frame above would report as a working highlight.
  expect(
    Math.abs(afterMean - before),
    `the box was still at mean luminance ${afterMean.toFixed(4)} once the finger had ` +
      `lifted, against ${before.toFixed(4)} at rest: a highlight that never clears is ` +
      `not press feedback. The sampled region is ${JSON.stringify(region)} of a ` +
      `${String(afterGesture.width)}x${String(afterGesture.height)} frame`
  ).toBeLessThan(0.01);
}

/** Wait until the wall clock reaches `at`, or return at once if it has passed. */
async function sleepUntil(at: number): Promise<void> {
  const left = at - Date.now();
  if (left > 0) {
    await new Promise((resolve) => setTimeout(resolve, left));
  }
}
