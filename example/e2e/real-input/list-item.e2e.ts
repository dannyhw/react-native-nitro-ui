import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { centreOf, openScreen, reveal } from './support';
import { actsOnOneNamedNode, treeAnnounces } from './reader';
import { pressPaintsFeedback } from './press-feedback';

const NAME = 'Real-input item';

test('a real tap on a ListItem fires its onPress once', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'listitem');
  const row = screen.getByLabel(NAME);
  const presses = screen.getByTestId('real-input-listitem-presses');
  const last = screen.getByTestId('real-input-listitem-last');
  await reveal(screen, row);

  // A row whose press needs longer than a held finger takes never presses for a
  // person, and a decorative chevron can be a second stop for a reader. Both are
  // properties of the tree, which an in-app query does not walk.
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(presses).toHaveText('0');
  await expect(last).toHaveText('none');

  await row.tap();
  await expect(presses).toHaveText('1');
  await expect(last).toHaveText('real');
});

test('a held press on a ListItem draws its ink', async ({ app, screen }) => {
  await app.open();
  await openScreen(screen, 'listitem');
  const row = screen.getByLabel(NAME);
  await reveal(screen, row);

  // The harness can assert that a row's state changed; only the screen can show
  // whether anything was painted.
  await pressPaintsFeedback(screen, row);
});

test('a held press on an item inside a Form row draws the Form ink', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'listitem');
  const inForm = screen.getByLabel('Item inside a Form row');
  await reveal(screen, inForm);

  // Inside a Form row the leaf installs no indication of its own: the row owns the
  // shape. An item whose press never reaches the row therefore presses in silence —
  // the echo moves and the screen says nothing — and pixels are the only witness.
  await pressPaintsFeedback(screen, inForm);
});

/** How long a disabled item is watched for a press that should never arrive. */
const NOTHING_ARRIVES_MS = 800;

test('a disabled ListItem is disabled where a finger lands and takes no tap, and the live one still presses', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'listitem');
  const disabled = screen.getByLabel('Real-input disabled item');
  const refused = screen.getByTestId('real-input-listitem-disabled-events');
  const presses = screen.getByTestId('real-input-listitem-presses');
  await reveal(screen, disabled, { reads: [refused, presses] });

  treeAnnounces('Real-input disabled item', { enabled: 'false' });
  const at = await centreOf(disabled);
  for (let tap = 1; tap <= 3; tap += 1) {
    await screen.tapAt(at);
  }
  await new Promise((resolve) => setTimeout(resolve, NOTHING_ARRIVES_MS));
  await expect(refused).toHaveText('0');

  // The barrier: the silence above was a refusal, not a screen that takes nothing.
  await expect(presses).toHaveText('0');
  await screen.getByLabel(NAME).tap();
  await expect(presses).toHaveText('1');
});
