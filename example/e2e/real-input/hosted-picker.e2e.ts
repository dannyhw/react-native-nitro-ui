import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { openScreen, reveal } from './support';
import { actsOnOneNamedNode } from './reader';

const NAME = 'Hosted picker';

test('a hosted Picker opens its menu, and a row reaches JS', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'host');
  const field = screen.getByLabel(NAME);
  const index = screen.getByTestId('host-picker-index');
  await reveal(screen, field);

  // Where the popup sits against the Host's box is measured from inside React; what
  // is left for the device is the part only a real tap can do: open it and pick a
  // row, through the composition rather than through a view of its own.
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(index).toHaveText('1');

  // Where the opened menu sits against the Host's box is not asserted here: Material
  // measures the room under an anchor and opens above it when there is none, so a
  // "below" comparison is only true of the branch the layout happened to take.
  await field.tap();
  const row = screen.getByText('Alpha');
  await row.waitFor({ state: 'visible' });
  await row.tap();
  await expect(index).toHaveText('0');
});
