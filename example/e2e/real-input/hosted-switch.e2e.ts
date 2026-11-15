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
  const flipper = screen.getByLabel('Hosted switch 0');
  await reveal(screen, flipper);
  await expect(value).toHaveText('off');
  await flipper.tap();
  await expect(value).toHaveText('on');
});
