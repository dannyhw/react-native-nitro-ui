/**
 * Pressed-state feedback: the ink a person sees while their finger is down.
 *
 * This is the fourth class the audit kept (A.3: drawn press feedback — G30
 * Android, "no press feedback drawn", and the Form section rows that drew no
 * ripple ink under a held press). Nothing inside the React tree knows what was
 * painted, so the check reads the screen: a screenshot with the row at rest, a
 * screenshot with the same row held, and the mean luminance of a grid inside the
 * row's box, before and during.
 *
 * The grid, not one pixel: a bounded ripple is brightest near the touch point and
 * a single sample can land on the one spot it has not reached at the instant of
 * the capture. The inset keeps the sample on the row's own fill rather than on a
 * pixel of whatever is drawn around it, and the whole thing is in device pixels
 * because the capture is in device pixels — `boundingBox()` and the screenshot
 * share one space.
 *
 * Why this file reaches for `device.unstable_raw`: e2e has no "press and hold,
 * and look at the screen while it is held" step. `longPress` is the driver's own
 * gesture; the raw client call below only *starts* it, and the test takes the
 * capture while the finger is still down. Both halves stay inside e2e's engine —
 * the touch is agent-device's, the pixel read is e2e's, and no `adb input` is
 * anywhere near this.
 */
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { centreOf } from './support';
import { expect, type Locator, type Screen } from 'e2e';
import type { Device } from '@e2e-dev/mobile';

import {
  decodePng,
  pixelAt,
  type DecodedPng,
} from '../../../scripts/real-input/png-pixel.mjs';

/**
 * How long one press lasts, in ms — and the driver puts a ceiling on a gesture at
 * 10 000 ms, so this is that ceiling, not a choice.
 */
const HOLD_MS = 10_000;

/**
 * How many presses in a row, at the same point, make up "the finger is down".
 *
 * Two, because the capture is not instantaneous and its latency is not short: the
 * driver's own screenshot call is a daemon round trip measured at 4 830 ms and, on a
 * busy machine with a ripple still animating, 10 190 ms — longer than one press is
 * allowed to last. So the second press starts as the first reaches its ceiling, and
 * the picture is taken under a finger however long the round trip takes. Two presses
 * at one point are one continued interest to a person and one `Pressable`'s press
 * state twice; what the check needs is a frame in which a finger is down, and this is
 * the only way the driver's own surface can promise that.
 */
const PRESSES = 2;

/** How long after the first finger lands the capture is asked for, in ms. */
const CAPTURE_AFTER_MS = 500;

/** How far inside the control's box the sample starts, in device px. */
const INSET_PX = 12;

/** How far apart the sample points are, in device px. */
const STEP_PX = 8;

interface Image {
  path: string;
  png: DecodedPng;
}

async function capture(device: Device, label: string): Promise<Image> {
  // An absolute path of our own: a relative one lands wherever the daemon happens
  // to be standing, and a failure that names no file the reader can open is a
  // failure nobody can diagnose.
  const dir =
    process.env.NITRO_UI_PRESS_DIR ?? path.join(tmpdir(), 'nitro-ui-x35-press');
  const file = path.join(dir, `${label}.png`);
  const result = await device.unstable_raw.client.capture.screenshot({
    path: file,
  });
  return {
    path: result.path,
    png: decodePng(readFileSync(result.path)),
  };
}

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
        (0.2126 * pixel[0] + 0.7152 * pixel[1] + 0.0722 * pixel[2]) / 255;
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
 * @param device the running device, for the capture and the held press
 * @param hold the control to hold; its box is the region that must change
 * @param minimumDrop how much darker the row has to get, as mean luminance. Small
 *   on purpose: Material's state-layer ink over a light row is a few percent, and
 *   a threshold tuned to one theme hides a faint-but-present regression in another.
 */
export async function pressPaintsFeedback(
  screen: Screen,
  device: Device,
  hold: Locator,
  options: { minimumDrop?: number } = {}
): Promise<void> {
  const minimumDrop = options.minimumDrop ?? 0.005;
  const box = await hold.boundingBox();
  if (box == null) {
    throw new Error('press-feedback: the control has no box to sample.');
  }

  const atRest = await capture(device, 'press-at-rest');
  // A press-and-hold expressed as a drag that travels two px while the finger is
  // down. That shape is deliberate: it is one gesture stream that is genuinely *in
  // flight* — a `longPress` presses and holds too, but a row inside a scrolling
  // section settles it as its own gesture and paints nothing (measured: the
  // standalone item inked either way, the section row only as a hold in flight). Two
  // px is inside the touch slop, so the list does not scroll and nothing is
  // cancelled.
  const point = await centreOf(hold);
  const press = () =>
    screen.swipe({
      from: point,
      to: { x: point.x, y: point.y + 2 },
      duration: HOLD_MS,
    });

  let finger = press();
  // Timed from the finger, not from the call: the capture at rest is itself a round
  // trip, and the hold is short enough that counting from it would spend part of the
  // window before the pointer is even down.
  const startedAt = Date.now();
  await sleepUntil(startedAt + CAPTURE_AFTER_MS);
  const askedAt = Date.now() - startedAt;
  const capturing = capture(device, 'press-during-hold-0');
  await finger;
  if (PRESSES > 1) finger = press();
  const during = await capturing;
  const took = Date.now() - startedAt - askedAt;
  await finger;

  const before = meanLuma(atRest.png, inset(box));
  const duringMean = meanLuma(during.png, inset(box));
  expect(
    before - duringMean,
    `holding the control left its own box at mean luminance ` +
      `${duringMean.toFixed(4)} (capture asked for at +${String(askedAt)}ms, ` +
      `${String(took)}ms round trip across ${String(PRESSES)} presses of ` +
      `${String(HOLD_MS)}ms), against ${before.toFixed(4)} at rest: a press that ` +
      `paints nothing is what G30 Android shipped with ("no press feedback drawn"). ` +
      `The captures are ${atRest.path} and ${during.path}`
  ).toBeGreaterThan(minimumDrop);
}

/** Wait until the wall clock reaches `at`, or return at once if it has passed. */
async function sleepUntil(at: number): Promise<void> {
  const left = at - Date.now();
  if (left > 0) {
    await new Promise((resolve) => setTimeout(resolve, left));
  }
}
