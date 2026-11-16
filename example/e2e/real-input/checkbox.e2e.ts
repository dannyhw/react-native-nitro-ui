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

  // A labelled control can be two accessibility nodes with one of them inert, so a
  // person hears the label and presses something else. An in-app query cannot see the
  // tree a reader walks, so the count of named nodes is the guard.
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(value).toHaveText('off');

  await box.tap();
  await expect(value).toHaveText('on');
});
