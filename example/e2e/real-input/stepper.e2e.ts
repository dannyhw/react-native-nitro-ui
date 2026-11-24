import { expect } from 'e2e';

import { test } from './fixture';
import { isInBand, openScreen, reveal } from './support';
import { actsOnOneNamedNode } from './reader';

const NAME = 'Real-input stepper';

test("a real tap on the Stepper's upper half steps it exactly once", async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'stepper');
  const stepper = screen.getByLabel(NAME);
  const value = screen.getByTestId('real-input-stepper-value');
  const events = screen.getByTestId('real-input-stepper-events');
  await reveal(screen, stepper);

  // Android merges the Stepper into one node and each Material button clears its own
  // semantics (HybridNitroUiStepper.kt), so there is no plus node to tap: the suite aims
  // at the right half of the merged box. One tap has to be one step and one event.
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(value).toHaveText('1');
  await expect(events).toHaveText('0');

  const box = await stepper.boundingBox();
  if (box == null || !(await isInBand(screen, box))) {
    throw new Error(
      `real-input: the Stepper has no box to aim at; it reads ${JSON.stringify(box)}.`
    );
  }
  await screen.tapAt({
    x: box.x + box.width * 0.85,
    y: box.y + box.height / 2,
  });
  await expect(value).toHaveText('2');
  await expect(events).toHaveText('1');
});

/** How long the plus half is held: well past any long-press or repeat threshold. */
const HOLD_MS = 1400;

/** How long after the lift a step that was still on its way would have landed. */
const AFTER_LIFT_MS = 400;

test("a 1.4 s hold on the Stepper's plus half steps once, with no repeat", async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'stepper');
  const stepper = screen.getByLabel('Real-input hold stepper');
  const value = screen.getByTestId('real-input-stepper-hold-value');
  const events = screen.getByTestId('real-input-stepper-hold-events');
  await reveal(screen, stepper);
  await expect(value).toHaveText('5');
  await expect(events).toHaveText('0');

  const box = await stepper.boundingBox();
  if (box == null || !(await isInBand(screen, box))) {
    throw new Error(
      `real-input: the hold Stepper has no box to aim at; it reads ${JSON.stringify(box)}.`
    );
  }
  // A finger that stays down: two px of travel is inside the touch slop, so it reads as
  // one held press. 0.8 of the merged box is the plus button's glyph, clear of the gap.
  const plus = { x: box.x + box.width * 0.8, y: box.y + box.height / 2 };
  await screen.swipe({
    from: plus,
    to: { x: plus.x, y: plus.y + 2 },
    duration: HOLD_MS,
  });
  await expect(value).toHaveText('6');
  await new Promise((resolve) => setTimeout(resolve, AFTER_LIFT_MS));
  expect(await value.textContent()).toBe('6');
  expect(await events.textContent()).toBe('1');
});
