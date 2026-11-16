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

  // The tooltip is presented in a window of its own (`tooltip-rich-tooltip`), so the
  // action is tapped inside it: a tap that reached the page behind would count for
  // nothing here, and the log line is JS's own record of what the press did.
  await expect(log).toHaveText('none');
  await opener.tap();
  const tip = screen.getByTestId('tooltip-rich-tooltip');
  await tip.waitFor({ state: 'visible' });
  await tip.getByText('Got it').tap();
  await expect(log).toContainText('action:ok');
  await tip.waitFor({ state: 'detached' });
});
