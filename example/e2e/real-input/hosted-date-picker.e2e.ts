import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { openScreen, reveal } from './support';
import { actsOnOneNamedNode } from './reader';

const NAME = 'Hosted date picker';

test('a hosted DatePicker opens its dialog, and a day cell reaches JS', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'host');
  const field = screen.getByLabel(NAME);
  const value = screen.getByTestId('host-datepicker-value');
  await reveal(screen, field);

  // The day cells of a dialog presented by a hosted control are Compose nodes in
  // another window: nothing inside the React tree can see them, which is why this
  // row exists at all. The unmount-while-open leak is the harness's (`HostPopups`).
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(value).toHaveText('2026-05-17');

  await field.tap();
  const dialog = screen.getByTestId('host-datepicker-dialog');
  await dialog.waitFor({ state: 'visible' });
  await dialog.getByText(/^22$/).tap();
  await dialog.getByText(/^OK$/i).tap();
  await expect(value).toHaveText('2026-05-22');
});
