import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { openScreen, reveal } from './support';
import { actsOnOneNamedNode } from './reader';

const NAME = 'Real-input checkbox';

test('a real tap on the Checkbox reaches JS, on one named node', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'checkbox');
  const box = screen.getByLabel(NAME);
  const value = screen.getByTestId('real-input-checkbox-value');
  await reveal(screen, box);

  // G15 Android: a labelled checkbox was two accessibility nodes and one of them
  // was inert, so a person heard the label and pressed something else. The
  // count-1 assertion is that defect's guard; the harness query cannot see the
  // tree a reader walks and did not prevent it.
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(value).toHaveText('off');

  await box.tap();
  await expect(value).toHaveText('on');
});
