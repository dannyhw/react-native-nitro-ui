/**
 * Pressed-state feedback: the ink a person sees while their finger is down.
 *
 * This is the fourth class the audit kept (A.3: drawn press feedback — G30
 * Android, "no press feedback drawn", and the Form section rows that drew no
 * ripple ink under a held press). Nothing inside the React tree knows what was
 * painted, so the check reads the screen: a frame with the row at rest, a frame
 * with the same row held, and the mean luminance of a grid inside the row's box,
 * before and during.
 *
 * The grid, not one pixel: a bounded ripple is brightest near the touch point and
 * a single sample can land on the one spot it has not reached at the instant of
 * the capture. The inset keeps the sample on the row's own fill rather than on a
 * pixel of whatever is drawn around it, and the whole thing is in device pixels
 * because the capture is in device pixels — `boundingBox()` and the frame share
 * one space.
 *
 * Why the frame comes from `device-read.ts` and not from e2e's own screenshot: the
 * driver takes a screenshot through the same on-device automation helper that
 * injects the gesture, and that helper serves one thing at a time. Measured on
 * `list-item`, a capture asked for 500 ms into a 10 000 ms press came back 10 240
 * ms later and showed the row *unpressed*, because by the time the helper got to
 * it the finger was up. That made this check unable to pass on a Form row however
 * well the library painted: the standalone item happened to still be fading its
 * ripple at the boundary, and the Form row was not. Asking for the frame beside
 * the helper — a read, one `adb exec-out screencap` on the leased serial — returns
 * in a few hundred ms, so the frame is genuinely taken under the finger, the press
 * can be a person's length rather than the driver's ceiling, and both rows are
 * measured the same way. The gesture itself is still e2e's.
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
 * Long enough that Compose has composed and drawn the state layer by the time the
 * frame is read (the frame is asked for at {@link CAPTURE_AFTER_MS} and takes a few
 * hundred ms), and short enough that this is still the press a person makes. The
 * driver's own ceiling on a gesture is 10 000 ms, which the previous shape of this
 * check had to sit at for want of a frame that arrived in time.
 */
const HOLD_MS = 1_800;

/**
 * How long after the press is *issued* the frame is asked for, in ms. Measured from
 * the call rather than from the finger, because the driver's own round trip to put
 * the finger down is not visible from here; the press is `HOLD_MS` long from the
 * same moment, so both ends of the window are counted the same way.
 */
const CAPTURE_AFTER_MS = 450;

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
 * @param screen only for the gesture: the press is e2e's own swipe
 * @param hold the control to hold; its box is the region that must change
 * @param options.minimumDrop how much darker the row has to get, as mean luminance.
 *   Small on purpose: Material's state-layer ink over a light row is a few percent,
 *   and a threshold tuned to one theme hides a faint-but-present regression in
 *   another. It is the number the adb driver measured G30 with, and it has not moved.
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

  // A press-and-hold expressed as a drag that travels two px while the finger is
  // down. That shape is deliberate: it is one gesture stream that is genuinely *in
  // flight* — a `longPress` presses and holds too, but a row inside a scrolling
  // section settles it as its own gesture and paints nothing (measured: the
  // standalone item inked either way, the section row only as a hold in flight). Two
  // px is inside the touch slop, so the list does not scroll and nothing is
  // cancelled.
  const pressed = screen.swipe({
    from: point,
    to: { x: point.x, y: point.y + 2 },
    duration: HOLD_MS,
  });
  const downAt = Date.now();
  await sleepUntil(downAt + CAPTURE_AFTER_MS);
  const askedAt = Date.now() - downAt;
  const held = screenCapture();
  const took = Date.now() - downAt - askedAt;
  await pressed;
  // A moment after the lift, so a highlight that is on its way out is not read as one
  // that has stopped.
  await sleepUntil(Date.now() + 500);
  const afterGesture = screenCapture();
  const afterMean = meanLuma(afterGesture, region);

  const duringMean = meanLuma(held, region);
  expect(
    before - duringMean,
    `holding the control left its own box at mean luminance ` +
      `${duringMean.toFixed(4)} (frame asked for +${String(askedAt)}ms after the ` +
      `press was issued and read ${String(took)}ms later, inside a ` +
      `${String(HOLD_MS)}ms press), against ${before.toFixed(4)} at rest: a press ` +
      `that paints nothing is what G30 Android shipped with ("no press feedback ` +
      `drawn"). The sampled region is ${JSON.stringify(region)} of a ` +
      `${String(held.width)}x${String(held.height)} frame`
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
