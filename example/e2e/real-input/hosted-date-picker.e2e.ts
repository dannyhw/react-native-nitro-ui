import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { centreOf, openScreen, reveal } from './support';
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
  // The cell's own box rather than the driver's tap: the day is one node whose
  // clickable part belongs to another, and a named node like this gets no touch
  // point of its own to press.
  await screen.tapAt(await centreOf(day));
  await screen.getByText(/^OK$/).tap();
  await expect(value).toHaveText('2026-05-22');
});
