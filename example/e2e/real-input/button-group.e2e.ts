import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { openScreen, reveal } from './support';
import { actsOnOneNamedNode } from './reader';

const GROUP = 'Real-input actions';

test('a real tap presses one item of a ButtonGroup and reports its id', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'buttongroup');
  const group = screen.getByLabel(GROUP);
  const presses = screen.getByTestId('button-group-presses');
  const pressed = screen.getByTestId('button-group-pressed-id');
  await reveal(screen, group);

  // A group is `role: container`: the name is on the wrapper and the actionable
  // nodes are the items inside it, so the group's own assertion is that it is one
  // node with a box, and the tap has to go to the item drawn "Copy" — reached
  // through the named group, so it cannot silently become some other 'Copy' on
  // the screen. Which item answered is the echo, not a count.
  await actsOnOneNamedNode(screen, { name: GROUP, state: 'enabled' });
  const copy = group.getByText('Copy');
  expect(
    await copy.count(),
    'the "Copy" item is not inside the named group'
  ).toBe(1);
  await expect(presses).toHaveText('0');
  await expect(pressed).toHaveText('none');

  await reveal(screen, copy);
  await copy.tap();
  await expect(presses).toHaveText('1');
  await expect(pressed).toHaveText('copy');
});
