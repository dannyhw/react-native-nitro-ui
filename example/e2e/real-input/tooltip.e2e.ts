import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { openScreen, reveal } from './support';

test('a real tap opens the tooltip, its action is reported, and the tip goes away', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'tooltip');
  const opener = screen.getByTestId('tooltip-open-rich');
  const log = screen.getByTestId('tooltip-log');
  await reveal(screen, opener);

  // Eight failures in the evidence were all mutation catches: the tooltip check
  // itself has never hidden a defect. What is kept is the delivery proof through a
  // window of its own (`tooltip-rich-tooltip`) and the action inside it.
  await expect(log).toHaveText('none');
  await opener.tap();
  const tip = screen.getByTestId('tooltip-rich-tooltip');
  await tip.waitFor({ state: 'visible' });
  await tip.getByText('Got it').tap();
  await expect(log).toContainText('action:ok');
  await tip.waitFor({ state: 'detached' });
});
