import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { openScreen, reveal } from './support';
import { actsOnOneNamedNode } from './reader';

const NAME = 'Hosted picker';

test('a hosted Picker opens its menu under the box the Host drew, and a row reaches JS', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'host');
  const field = screen.getByLabel(NAME);
  const index = screen.getByTestId('host-picker-index');
  await reveal(screen, field);

  // X24 and X31 each got this wrong by anchoring on the wrong rectangle. The
  // popup's position against the Host's own box is asserted by the harness from
  // inside (`HostPopups` "anchors under the box the Host drew"), so what is left
  // for the device is the part only a real tap can do: open it and pick a row.
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(index).toHaveText('1');

  const anchor = await field.boundingBox();
  await field.tap();
  const row = screen.getByText('Alpha');
  await row.waitFor({ state: 'visible' });
  if (anchor != null) {
    const rowBox = await row.boundingBox();
    expect(
      rowBox != null && rowBox.y > anchor.y,
      `the hosted Picker's menu opened above the row the Host drew (` +
        `row at ${String(Math.round(anchor.y))} px, "Alpha" at ` +
        `${String(Math.round(rowBox?.y ?? 0))} px)`
    ).toBe(true);
  }
  await row.tap();
  await expect(index).toHaveText('0');
});
