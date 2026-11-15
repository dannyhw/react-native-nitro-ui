import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

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

  // The name is on a node with nothing actionable at it — the row's own
  // `A11Y_EXEMPTIONS` debt (X4: nothing actionable at the named node) — so the
  // tap is placed by geometry at the middle of the control's box, which is where
  // the segment drawn "Two" is. A tap that picks the wrong segment is the failure
  // this is looking for, and it is why the index is read rather than "changed".
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(index).toHaveText('0');

  const box = await control.boundingBox();
  if (box == null || !(await isInBand(screen, box))) {
    throw new Error(
      `real-input: the hosted Segmented has no box to aim at; it reads ${JSON.stringify(box)}.`,
    );
  }
  await screen.tapAt({ x: box.x + box.width * 0.5, y: box.y + box.height / 2 });
  await expect(index).toHaveText('1');
});
