import { expect } from 'e2e';

import { test } from './fixture';
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

  // A layout that moves when a value changes puts the finger somewhere else than the
  // reader's node, so the name, the box and the value are read on the one node a
  // person acts on, after a touch the operating system delivered.
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
