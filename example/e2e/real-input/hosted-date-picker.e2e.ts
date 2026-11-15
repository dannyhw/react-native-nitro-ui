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
  // The Material dialog is a window of its own and, unlike the library's own
  // `Dialog`, it is not a view the control stamps with its testID: while it is up,
  // the tree the driver reads is the dialog and nothing else — the app's rows are
  // gone from it. So the day is named the way a reader names it, and `OK` is the
  // button's own drawn text.
  const day = screen.getByLabel('Friday, May 22, 2026');
  await day.waitFor({ state: 'visible' });
  await day.tap();
  await screen.getByText(/^OK$/).tap();
  await expect(value).toHaveText('2026-05-22');

  // Getting out without choosing is two more gestures a person makes on a dialog
  // in another window: the Cancel button the dialog draws, and the system Back.
  // Neither is reachable from inside the React tree, and both have to leave the
  // value alone — a dialog that dismisses by writing is the one that surprises.
  await field.tap();
  const cancel = screen.getByText(/^Cancel$/);
  await cancel.waitFor({ state: 'visible' });
  await cancel.tap();
  await screen.getByLabel('Friday, May 22, 2026').waitFor({
    state: 'detached',
  });
  await expect(value).toHaveText('2026-05-22');

  await field.tap();
  await cancel.waitFor({ state: 'visible' });
  await app.back();
  await cancel.waitFor({ state: 'detached' });
  await expect(value).toHaveText('2026-05-22');
});
