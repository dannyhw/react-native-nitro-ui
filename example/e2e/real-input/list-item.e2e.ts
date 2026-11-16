import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { boxOf, flick, openScreen, reveal } from './support';
import { actsOnOneNamedNode } from './reader';
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

test('a drag that starts on a ListItem row is the list asking for the page', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'listitem');
  const row = screen.getByLabel(NAME);
  const presses = screen.getByTestId('real-input-listitem-presses');
  await reveal(screen, row);
  await expect(presses).toHaveText('0');

  // Compose’s own press cancels a touch that travels past the slop, so this is a guard — a
  // row that fires on a scroll takes a person to a screen they meant to scroll past. The
  // list moving is the witness that the gesture was a scroll.
  const before = await boxOf(row);
  if (before == null) {
    throw new Error('real-input: the ListItem row has no box to flick over.');
  }
  await flick(screen, {
    x: before.x + before.width / 2,
    y: before.y + before.height / 2,
  });
  const after = await boxOf(row);
  const moved =
    after == null ||
    Math.abs(after.y - before.y) > 40 ||
    (await row.count()) === 0;
  expect(moved, 'the flick did not move the list at all').toBe(true);
  // The flick can carry the echo off screen, which is not the echo refusing to move: scroll
  // it back into the band before reading it, so the read is of a node on screen.
  await reveal(screen, presses);
  await expect(presses).toHaveText('0');
});
