import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { isInBand, openScreen, reveal } from './support';
import { actsOnOneNamedNode } from './reader';

const NAME = 'Real-input segmented control';

test('a real tap selects the segment under the finger', async ({ app, screen }) => {
  await app.open();
  await openScreen(screen, 'segmented');
  const control = screen.getByLabel(NAME);
  const index = screen.getByTestId('real-input-segmented-index');
  await reveal(screen, control);

  // Three options ('1', '2', '3'), so the middle of the control's box is the
  // segment drawn '2' and the index JS reports has to be 1, not merely "not 0":
  // a control that answered the tap at the wrong x is the failure here (E1 read
  // a corner probe late and passed for the wrong reason).
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(index).toHaveText('-');

  const box = await control.boundingBox();
  if (box == null || !(await isInBand(screen, box))) {
    throw new Error(
      `real-input: the SegmentedControl has no box to aim at; it reads ${JSON.stringify(box)}.`,
    );
  }
  await screen.tapAt({ x: box.x + box.width * 0.5, y: box.y + box.height / 2 });
  await expect(index).toHaveText('1');
});
