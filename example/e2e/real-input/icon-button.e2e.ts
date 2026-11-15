import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { openScreen, reveal } from './support';
import { actsOnOneNamedNode, treeAnnounces } from './reader';

const NAME = 'Real-input icon button';
const TOGGLE = 'Real-input toggle icon button';

test('a real tap on the icon Button reaches JS once', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'iconbutton');
  const press = screen.getByLabel(NAME);
  const presses = screen.getByTestId('real-input-icon-button-presses');
  await reveal(screen, press);

  // G23 iOS: the VoiceOver element sat inset inside the 44 pt target, so a
  // reader's target and a finger's target were different boxes. Name plus box
  // plus the report is that class, on the node both actors use.
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(presses).toHaveText('0');

  await press.tap();
  await expect(presses).toHaveText('1');

  // The toggle is the same node shape one row over, and it is the one a reader is
  // handed a state for: the bookmark is filled from the node's own `checked`, not
  // from the artwork the tap swapped.
  const toggle = screen.getByLabel(TOGGLE);
  const saved = screen.getByTestId('real-input-icon-button-value');
  await reveal(screen, toggle);
  await expect(saved).toHaveText('off');
  treeAnnounces(TOGGLE, { checked: 'off' });
  await toggle.tap();
  await expect(saved).toHaveText('on');
  treeAnnounces(TOGGLE, { checked: 'on' });
});
