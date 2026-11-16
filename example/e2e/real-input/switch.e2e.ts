import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { openScreen, reveal } from './support';
import { actsOnOneNamedNode, treeAnnounces } from './reader';

const NAME = 'Controlled switch';

test('a real tap on the Switch reaches JS, and the node says so too', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'switch');
  const flipper = screen.getByLabel(NAME);
  const value = screen.getByTestId('switch-controlled-value');
  await reveal(screen, flipper);

  // A-REG / T15: a controlled Switch whose value moved pushed the hosted Toggle
  // out of its row, which only a real tap on a real layout showed. The name, the
  // box and the value all have to be on the one node a person acts on.
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(value).toHaveText('off');
  // The state a reader is told sits on the toggle's own node, not on a neighbour —
  // and it has to be read on both sides of the tap, because a node that always says
  // the same thing would pass this test whatever the Switch did.
  await treeAnnounces(NAME, { checked: 'off' });

  await flipper.tap();
  await expect(value).toHaveText('on');
  await treeAnnounces(NAME, { checked: 'on' });
});
