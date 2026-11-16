import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { openScreen, reveal } from './support';

test('a real tap on a hosted Switch reaches Compose and JS sees the value', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'host');
  const value = screen.getByTestId('host-controlled-value');
  const changes = screen.getByTestId('host-events-count');
  const flipper = screen.getByLabel('Hosted switch 0');
  await reveal(screen, flipper);
  await expect(value).toHaveText('off');
  await expect(changes).toHaveText('0');
  await flipper.tap();
  await expect(value).toHaveText('on');
  await expect(changes).toHaveText('1');

  // The way back is the other half of a toggle: a value that only travels one way
  // leaves a person unable to turn the thing off, and both changes have to reach JS.
  await flipper.tap();
  await expect(value).toHaveText('off');
  await expect(changes).toHaveText('2');
});
