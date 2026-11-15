import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { openScreen, reveal } from './support';
import { actsOnOneNamedNode } from './reader';

const NAME = 'Real-input icon button';

test('a real tap on the icon Button reaches JS once', async ({ app, screen }) => {
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
});
