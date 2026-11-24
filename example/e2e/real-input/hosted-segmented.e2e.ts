import { expect } from 'e2e';

import { test } from './fixture';
import { openScreen, reveal, isInBand } from './support';
import { actsOnOneNamedNode } from './reader';

const NAME = 'Hosted segmented';

test('a real tap on a hosted SegmentedControl picks the segment under the finger', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'host');
  const control = screen.getByLabel(NAME);
  const index = screen.getByTestId('host-segmented-index');
  await reveal(screen, control);

  // The name sits on a node with nothing actionable at it, so the tap is placed by
  // geometry at the middle of the control's box. Which index the app was told is read
  // rather than "something changed": a tap on the wrong segment must not pass.
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(index).toHaveText('0');

  const box = await control.boundingBox();
  if (box == null || !(await isInBand(screen, box))) {
    throw new Error(
      `real-input: the hosted Segmented has no box to aim at; it reads ${JSON.stringify(box)}.`
    );
  }
  await screen.tapAt({ x: box.x + box.width * 0.5, y: box.y + box.height / 2 });
  await expect(index).toHaveText('1');

  // The middle alone would pass for a control that answers at one point only: the last
  // segment is a different point and a different index.
  await screen.tapAt({ x: box.x + box.width * 0.9, y: box.y + box.height / 2 });
  await expect(index).toHaveText('2');
});
