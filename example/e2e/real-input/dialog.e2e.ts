import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { openScreen, reveal } from './support';

test('a real tap opens the alert, and an action inside it reaches JS', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'dialog');
  const opener = screen.getByTestId('dialog-open-alert');
  const log = screen.getByTestId('dialog-log');
  await reveal(screen, opener);

  // The window the Dialog presents is tagged `<testID>-dialog`, so the action is tapped
  // on the dialog rather than on whatever row of the page behind it says the same word:
  // a tap that reached the page would count for nothing here.
  await expect(log).toHaveText('none');
  await opener.tap();
  const dialog = screen.getByTestId('dialog-alert-dialog');
  await dialog.waitFor({ state: 'visible' });
  await dialog.getByText('Delete draft').tap();
  await expect(log).toContainText('action:delete');
  await dialog.waitFor({ state: 'detached' });
});
