import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { popupWindowCount } from './device-read';
import { openScreen, reveal } from './support';
import { actsOnOneNamedNode } from './reader';

const NAME = 'Hosted picker';

/** How long a popup window is given to reach the window manager, or to leave it. */
const WINDOW_SETTLES_MS = 8_000;

async function popupsReach(count: number, why: string): Promise<void> {
  await expect
    .poll(() => popupWindowCount(), {
      timeout: WINDOW_SETTLES_MS,
      interval: 250,
      message: why,
    })
    .toBe(count);
}

test('a hosted Picker opens its menu, and a row reaches JS', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'host');
  const field = screen.getByLabel(NAME);
  const index = screen.getByTestId('host-picker-index');
  await reveal(screen, field);

  // Where the popup sits against the Host's box is measured from inside React; what
  // is left for the device is the part only a real tap can do: open it and pick a
  // row, through the composition rather than through a view of its own.
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(index).toHaveText('1');

  // Where the opened menu sits against the Host's box is not asserted here: Material
  // measures the room under an anchor and opens above it when there is none, so a
  // "below" comparison is only true of the branch the layout happened to take.
  await field.tap();
  const row = screen.getByText('Alpha');
  await row.waitFor({ state: 'visible' });
  await row.tap();
  await expect(index).toHaveText('0');
});

test('the hosted menu is a popup window that Back takes down, and opening it is not a choice', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'host');
  const field = screen.getByLabel(NAME);
  const index = screen.getByTestId('host-picker-index');
  await reveal(screen, field, { reads: [index] });
  await expect(index).toHaveText('1');

  await field.tap();
  await popupsReach(1, 'a real tap on the hosted anchor opened no window');
  await app.back();
  await popupsReach(0, 'Back left the hosted popup window up');
  await expect(index).toHaveText('1');
});
