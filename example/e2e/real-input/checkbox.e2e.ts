import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { openScreen, reveal } from './support';
import { actsOnOneNamedNode, treeAnnounces } from './reader';

const NAME = 'Real-input checkbox';

test('a real tap on the Checkbox reaches JS, on one named node', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'checkbox');
  const box = screen.getByLabel(NAME);
  const value = screen.getByTestId('real-input-checkbox-value');
  await reveal(screen, box);

  // A labelled control can be two accessibility nodes with one of them inert, so a
  // person hears the label and presses something else. An in-app query cannot see the
  // tree a reader walks, so the count of named nodes is the guard.
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(value).toHaveText('off');

  await box.tap();
  await expect(value).toHaveText('on');
});

test("a second tap unchecks the Checkbox, one change per tap, and the box's own node follows both ways", async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'checkbox');
  const box = screen.getByLabel(NAME);
  const value = screen.getByTestId('real-input-checkbox-value');
  const events = screen.getByTestId('real-input-checkbox-events');
  await reveal(screen, box);

  await expect(value).toHaveText('off');
  await expect(events).toHaveText('0');
  await expect(
    screen.getByTestId('real-input-checkbox-disabled-events')
  ).toHaveText('0');
  treeAnnounces(NAME, { checked: 'off' });

  await box.tap();
  await expect(value).toHaveText('on');
  await expect(events).toHaveText('1');
  treeAnnounces(NAME, { checked: 'on' });

  // A box that only ever asks for `true` passes everything above.
  await box.tap();
  await expect(value).toHaveText('off');
  await expect(events).toHaveText('2');
  treeAnnounces(NAME, { checked: 'off' });
});
