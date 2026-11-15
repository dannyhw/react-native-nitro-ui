import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { openScreen, reveal } from './support';
import { actsOnOneNamedNode } from './reader';

const NAME = 'Real-input button';

test('a real tap on the Button reaches JS and reports one press', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'button');
  const press = screen.getByLabel(NAME);
  const count = screen.getByTestId('real-input-count');
  await reveal(screen, press);

  // T15b concluded the press this check was written for was a harness limitation,
  // not a defect, and the check has never been red. It stays as the delivery
  // proof for a Compose-drawn Button: the touch arrives, JS counts it.
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(count).toHaveText('0');

  await press.tap();
  await expect(count).toHaveText('1');
});
