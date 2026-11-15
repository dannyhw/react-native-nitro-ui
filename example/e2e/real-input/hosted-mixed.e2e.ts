import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { openScreen, reveal } from './support';
import { actsOnOneNamedNode } from './reader';

const SWITCH = 'Mixed switch';

test('one Host of mixed controls still gives each its own node and its own tap', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'host');
  const flipper = screen.getByLabel(SWITCH);
  const state = screen.getByTestId('host-mixed-state');
  await reveal(screen, flipper);

  // Four kinds in one composition: the switch, the slider and the button each
  // have to be named once and act on their own, or the composition has merged
  // their semantics. The echo is the one line all three write, so it proves
  // which of them answered.
  await actsOnOneNamedNode(screen, { name: SWITCH, state: 'enabled' });
  await expect(state).toHaveText('off 0.50 0');

  await flipper.tap();
  await expect(state).toHaveText('on 0.50 0');
});
