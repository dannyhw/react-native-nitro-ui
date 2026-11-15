import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { openScreen, reveal } from './support';
import { actsOnOneNamedNode } from './reader';

const NAME = 'Real-input date picker';

test('a real tap opens the date dialog, a day cell reaches JS, OK closes it', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'datepicker');
  const field = screen.getByLabel(NAME);
  const value = screen.getByTestId('real-input-date-value');
  await reveal(screen, field);

  // The dialog is presented in its own window, and the library tags it with the
  // field's testID plus `-dialog`, which is the only way to know that the day
  // being tapped belongs to *this* dialog and not to a row of the page behind it.
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(value).toHaveText('-');

  await field.tap();
  const dialog = screen.getByTestId('real-input-date-dialog');
  await dialog.waitFor({ state: 'visible' });
  await dialog.getByText(/^15$/).tap();
  await dialog.getByText(/^OK$/i).tap();

  const picked = await value.textContent();
  expect(
    /^\d{4}-\d{2}-15$/.test(picked ?? ''),
    `picking day 15 and pressing OK left the echo reading "${picked}"`,
  ).toBe(true);
  await expect(value).not.toHaveText('-');
});
