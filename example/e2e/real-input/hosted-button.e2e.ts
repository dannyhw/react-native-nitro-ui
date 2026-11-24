import { expect } from 'e2e';

import { test } from './fixture';
import { openScreen, reveal } from './support';
import { actsOnOneNamedNode } from './reader';

const NAME = 'Hosted button';

test('a real tap on a hosted Button reaches Compose and JS counts it', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'host');
  const press = screen.getByLabel(NAME);
  const presses = screen.getByTestId('host-button-presses');
  await reveal(screen, press);

  // A <Host> child has no view of its own, so its own testID never reaches the
  // tree and the accessibility name is the only handle a person — or a test —
  // has. One tap, one report: this is the Host's delivery proof.
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(presses).toHaveText('0');

  await press.tap();
  await expect(presses).toHaveText('1');

  // A composition that delivered the first press can still swallow the next: a person
  // pressing a button twice expects two presses, not one.
  await press.tap();
  await expect(presses).toHaveText('2');
});
