import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { openScreen, reveal } from './support';
import { actsOnOneNamedNode, itemAnnounces } from './reader';

const GROUP = 'Real-input actions';
const TOGGLES = 'Real-input formatting toggles';

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

  // A group is `role: container`: the name sits on the wrapper and the actionable
  // nodes are the items inside it, so the tap goes to the item drawn "Copy" through
  // the named group and cannot silently become some other ‘Copy’ on the screen.
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

  // A toggle item's own node holds its selection. The title is a separate
  // `TextView` that reports the same thing whether the item is checked or not, and
  // the role decoration reports it never — so the item is read through its box.
  const toggleGroup = screen.getByLabel(TOGGLES);
  await reveal(screen, toggleGroup);
  const italic = toggleGroup.getByText('Italic');
  await reveal(screen, italic);
  const state = screen.getByTestId('button-group-toggle-state');
  await expect(state).not.toContainText('italic');
  itemAnnounces(TOGGLES, 'Italic', { checked: 'off' });
  await italic.tap();
  await expect(state).toContainText('italic');
  itemAnnounces(TOGGLES, 'Italic', { checked: 'on' });
});
