import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { openScreen, reveal } from './support';

test('a real tap opens the sheet, a Pressable inside it counts, and Back closes it', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'sheet');
  const opener = screen.getByTestId('sheet-open-fit');
  const log = screen.getByTestId('sheet-log');
  await reveal(screen, opener);

  // One review-found defect sat here: the sheet's root intercepted touches and a
  // `TextInput` underneath stopped answering. So the press that has to be counted
  // is inside the sheet, on content that rose from the window's bottom edge, and
  // the count is JS's own. The sticky sheet's "no gesture closes it" is the
  // harness's, as is the dismissal bookkeeping.
  await expect(log).toHaveText('none');
  await opener.tap();
  const sheet = screen.getByTestId('sheet-fit-sheet');
  await sheet.waitFor({ state: 'visible' });
  await sheet.getByTestId('sheet-press').tap();
  await expect(screen.getByTestId('sheet-presses')).toHaveText('Pressed 1 times');

  await app.back();
  await sheet.waitFor({ state: 'detached' });
});
