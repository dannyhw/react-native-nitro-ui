import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { openScreen, reveal } from './support';
import { actsOnOneNamedNode, treeAnnounces } from './reader';
import { pressPaintsFeedback } from './press-feedback';

const NAME = 'Real-input item';
const LOCKED = 'Real-input disabled item';

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

  // G30 iOS: `minimumPressDuration` was 0.5 s, so the row never pressed under a
  // real finger at all; and the chevron was a second VoiceOver stop, which is the
  // count-1 half of this. The drawn highlight the same check made is
  // `list-item`'s second test, because pixels are the other thing this suite kept.
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(presses).toHaveText('0');
  await expect(last).toHaveText('none');

  await row.tap();
  await expect(presses).toHaveText('1');
  await expect(last).toHaveText('real');

  // The row that must not answer is only provable from the tree: a row that reads
  // enabled while taking nothing is indistinguishable from a working one until a
  // person tries it and wonders.
  const locked = screen.getByLabel(LOCKED);
  await reveal(screen, locked);
  treeAnnounces(LOCKED, { enabled: 'false' });
});

test('a held press on a ListItem draws its ink (G30)', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'listitem');
  const row = screen.getByLabel(NAME);
  await reveal(screen, row);

  // A-DEV G30 Android: no press feedback drawn. The harness can assert that the
  // row's state changed; it cannot see that Material painted anything.
  await pressPaintsFeedback(screen, row);
});

test('a held press on an item inside a Form row draws the Form ink (G30)', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'listitem');
  const inForm = screen.getByLabel('Item inside a Form row');
  await reveal(screen, inForm);

  // A-REG G30 Android, twice: Form section rows drew no ripple ink under a held
  // press while the library code that paints them was already on main. The leaf
  // installs no indication of its own inside a row — the section owns the shape —
  // so an item whose press never reaches the row presses in silence: the tap
  // arrives, the echo moves, and the screen says nothing. Pixels are the only
  // way to see that, and this is the row the defect was found on.
  await pressPaintsFeedback(screen, inForm);
});
