import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { isInBand, openScreen, reveal } from './support';
import { actsOnOneNamedNode } from './reader';

const NAME = 'Real-input stepper';

test('a real tap on the Stepper\'s upper half steps it exactly once', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'stepper');
  const stepper = screen.getByLabel(NAME);
  const value = screen.getByTestId('real-input-stepper-value');
  const events = screen.getByTestId('real-input-stepper-events');
  await reveal(screen, stepper);

  // Android merges the Stepper into one node and each Material button clears its
  // own semantics (HybridNitroUiStepper.kt), so there is no plus node to tap: the
  // suite aims at the right half of the merged box, which is where the increment
  // is drawn. One tap has to be one step and one event — a step that fires twice
  // is what the harness cannot see and a real tap can.
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(value).toHaveText('1');
  await expect(events).toHaveText('0');

  const box = await stepper.boundingBox();
  if (box == null || !(await isInBand(screen, box))) {
    throw new Error(
      `real-input: the Stepper has no box to aim at; it reads ${JSON.stringify(box)}.`,
    );
  }
  await screen.tapAt({ x: box.x + box.width * 0.85, y: box.y + box.height / 2 });
  await expect(value).toHaveText('2');
  await expect(events).toHaveText('1');
});
