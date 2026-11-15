import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { openScreen, reveal } from './support';
import { actsOnOneNamedNode, treeAnnounces } from './reader';

const NAME = 'Real-input chip';

test('a real tap on a filter Chip reaches JS', async ({ app, screen }) => {
  await app.open();
  await openScreen(screen, 'chip');
  const chip = screen.getByLabel(NAME);
  const value = screen.getByTestId('real-input-chip-value');
  await reveal(screen, chip);

  // The Compose Chip puts its name on a node inside the 48 dp clickable one, so
  // "the tap landed on the thing a reader named" is the part no harness test
  // makes. The refused toggle and the disabled chip are the harness's
  // ("reverts a toggle JS refused", "takes no toggle while disabled").
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(value).toHaveText('off');
  treeAnnounces(NAME, { checked: 'off' });

  await chip.tap();
  await expect(value).toHaveText('on');
  treeAnnounces(NAME, { checked: 'on' });
});
