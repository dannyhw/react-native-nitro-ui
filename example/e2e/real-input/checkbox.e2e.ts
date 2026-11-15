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

  // G15 Android: a labelled checkbox was two accessibility nodes and one of them
  // was inert, so a person heard the label and pressed something else. The
  // count-1 assertion is that defect's guard; the harness query cannot see the
  // tree a reader walks and did not prevent it.
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(value).toHaveText('off');
  treeAnnounces(NAME, { checked: 'off' });

  await box.tap();
  await expect(value).toHaveText('on');
  treeAnnounces(NAME, { checked: 'on' });

  // The tap that unchecks is the one that matters: a box that only ever asked for
  // `true` lights the "on" echo all the same, and only the node back at `off` says
  // a second press asked for `false`.
  await box.tap();
  await expect(value).toHaveText('off');
  treeAnnounces(NAME, { checked: 'off' });
});
