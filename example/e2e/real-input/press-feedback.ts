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

import { expect, type Locator } from 'e2e';
import type { Device } from '@e2e-dev/mobile';

import { centreOf } from './support';
import { decodePng, pixelAt, type DecodedPng } from '../../../scripts/real-input/png-pixel.mjs';

/** How long the finger stays down, in ms. */
const HOLD_MS = 1500;

/** How long after the finger lands the capture happens, in ms. */
const CAPTURE_AT_MS = 450;

/** How far inside the row's box the sample grid starts, in device px. */
const INSET_PX = 12;

/** How far apart the sample points are, in device px. */
const STEP_PX = 8;

/** How far the sample window reaches around the finger, in device px. */
const REACH_PX = 150;

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
  const result = await device.unstable_raw.client.capture.screenshot({ path: file });
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

/** Mean relative luminance of a grid inside a box, clamped to the image. */
function meanLuma(image: DecodedPng, box: Box): number {
  const x1 = Math.max(0, Math.round(box.x) + INSET_PX);
  const x2 = Math.min(image.width - 1, Math.round(box.x + box.width) - INSET_PX);
  const y1 = Math.max(0, Math.round(box.y) + INSET_PX);
  const y2 = Math.min(image.height - 1, Math.round(box.y + box.height) - INSET_PX);
  let total = 0;
  let samples = 0;
  for (let y = y1; y <= y2; y += STEP_PX) {
    for (let x = x1; x <= x2; x += STEP_PX) {
      const pixel = pixelAt(image, x, y);
      total += (0.2126 * pixel[0] + 0.7152 * pixel[1] + 0.0722 * pixel[2]) / 255;
      samples += 1;
    }
  }
  // A box outside the image samples nothing, and a mean of nothing is 0 — which
  // would read as "the row went black". Refusing is the only honest answer.
  if (samples === 0) {
    throw new Error(
      `press-feedback: the box ${JSON.stringify(box)} is outside a ` +
        `${String(image.width)}x${String(image.height)} capture.`,
    );
  }
  return total / samples;
}

/** The part of a control's box around the finger, where its ink appears. */
function inkWindow(box: Box, point: { x: number; y: number }): Box {
  const x = Math.min(
    Math.max(box.x, point.x - REACH_PX),
    box.x + box.width - REACH_PX * 2,
  );
  const y = Math.min(
    Math.max(box.y, point.y - REACH_PX),
    box.y + box.height - REACH_PX * 2,
  );
  return {
    x: Math.max(0, x),
    y: Math.max(0, y),
    width: Math.min(box.width, REACH_PX * 2),
    height: Math.min(box.height, REACH_PX * 2),
  };
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
  device: Device,
  hold: Locator,
  options: { minimumDrop?: number } = {},
): Promise<void> {
  const minimumDrop = options.minimumDrop ?? 0.01;
  const box = await hold.boundingBox();
  if (box == null) {
    throw new Error('press-feedback: the control has no box to sample.');
  }

  const atRest = await capture(device, 'press-at-rest');
  const point = await centreOf(hold);
  // Start the gesture and do not await it: the whole check is what the screen
  // looks like *while* the finger is down.
  const held = device.unstable_raw.client.interactions.longPress({
    x: point.x,
    y: point.y,
    durationMs: HOLD_MS,
    settle: false,
  });
  await new Promise((resolve) => setTimeout(resolve, CAPTURE_AT_MS));
  const during = await capture(device, 'press-during-hold');
  await held;

  const sample = inkWindow(box, point);
  const before = meanLuma(atRest.png, sample);
  const duringMean = meanLuma(during.png, sample);
  expect(
    before - duringMean,
    `holding the control left its own box at mean luminance ` +
      `${duringMean.toFixed(4)}, against ${before.toFixed(4)} at rest: a press ` +
      `that paints nothing is what G30 Android shipped with ("no press feedback ` +
      `drawn"), and the captures are at ${atRest.path} and ${during.path}`,
  ).toBeGreaterThan(minimumDrop);
}
