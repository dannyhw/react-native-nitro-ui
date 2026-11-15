import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { openScreen, reveal } from './support';
import { actsOnOneNamedNode } from './reader';

const NAME = 'Real-input menu';

test('a real tap opens the Menu, a row reaches JS, and a disabled row takes nothing', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'menu');
  const trigger = screen.getByLabel(NAME);
  const pick = screen.getByTestId('real-input-menu-pick');
  await reveal(screen, trigger);

  // Menu keeps more of its old check than the other controls: the open question
  // at FOLLOWUPS 62-63 (a popup that needed two dismissals after a disabled row
  // was tapped, and a disabled row that reported itself enabled) was never
  // located, so it may be the check's one catch. Substance kept means the
  // disabled row and the dismissal are both still here.
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(pick).toHaveText('-');

  await trigger.tap();
  const alpha = screen.getByText('Alpha');
  await alpha.waitFor({ state: 'visible' });
  await alpha.tap();
  await expect(pick).toHaveText('alpha');

  // The disabled row: the pick must not move. `Menu.harness` asserts the same
  // refusal from inside; what this adds is that a *real* tap on a real row that
  // Material draws as dimmed is swallowed by the row rather than by the popup.
  await trigger.tap();
  await screen.getByText('Locked row').waitFor({ state: 'visible' });
  await screen.getByText('Locked row').tap();
  await expect(pick).toHaveText('alpha');

  // And one Back has to be enough to get rid of the popup — the state FOLLOWUPS
  // 62-63 left open, asserted rather than assumed.
  await app.back();
  await expect(pick).toHaveText('alpha');
  await expect(screen.getByText('Locked row')).toBeHidden();
});
