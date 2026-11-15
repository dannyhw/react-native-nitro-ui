import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { flick, openScreen, reveal } from './support';
import { actsOnOneNamedNode } from './reader';
import { fieldAboveKeyboard, focusAndExpectKeyboard } from './keyboard';
import { pressPaintsFeedback } from './press-feedback';

const ROW = 'Row with onPress';

test('a real tap on a Form row presses it once', async ({ app, screen }) => {
  await app.open();
  await openScreen(screen, 'form');
  const row = screen.getByLabel(ROW);
  const presses = screen.getByTestId('form-row-presses');
  await reveal(screen, row);

  // The row's name is on the clickable node itself, which is the X24 iOS finding
  // (a row's name left on the RN wrapper) inverted: here the reader and the
  // finger have to agree about which node the row is.
  await actsOnOneNamedNode(screen, { name: ROW, state: 'enabled' });
  await expect(presses).toHaveText('0');

  await row.tap();
  await expect(presses).toHaveText('1');
});

test('a flick across a Form row scrolls the list and presses nothing (X32)', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'form');
  const row = screen.getByLabel(ROW);
  const presses = screen.getByTestId('form-row-presses');
  await reveal(screen, row);

  // X32: a row pressed when the list was scrolled over it. The regression guard is
  // a drag that starts on the row and ends 700 px above it, which is the gesture a
  // person makes when they mean "scroll" — and it has to be a *real* drag, so the
  // row's own box is read afterwards to prove the list moved. A flick that did
  // nothing would leave the press count alone for the wrong reason.
  const before = await row.boundingBox();
  if (before == null) {
    throw new Error('press-feedback: the Form row has no box to flick over.');
  }
  await flick(screen, { x: before.x + before.width / 2, y: before.y + before.height / 2 });

  const after = await row.boundingBox();
  const moved =
    after == null || Math.abs(after.y - before.y) > 40 || (await row.count()) === 0;
  expect(moved, 'the flick did not move the list at all').toBe(true);
  await expect(presses).toHaveText('0');
});

test('a field near the bottom of a Form stays above the keyboard (G24)', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'form');
  const field = screen.getByTestId('form-note-field');
  const focus = screen.getByTestId('form-field-focus');
  await reveal(screen, field);

  // G24 Android, twice in the excerpts: the focused field was left behind the
  // keyboard. The field sits at the bottom of the Form's own list on purpose, so
  // this is the shape the defect needed. `form-keyboard-inset` is an iOS-only echo
  // — the Android measurement is the window's content view, which `adjustResize`
  // shortens by the IME's own height.
  await expect(focus).toHaveText('no');
  await focusAndExpectKeyboard(screen, field);
  await fieldAboveKeyboard(screen, field);
  await expect(focus).toHaveText('yes');
});

test('a held press on a Form row draws its ink (G30)', async ({ app, screen, device }) => {
  await app.open();
  await openScreen(screen, 'form');
  const row = screen.getByLabel(ROW);
  await reveal(screen, row);

  // A-REG G30, twice in one round: Form section rows drew no ripple under a held
  // press, with G24's code already on main. Pixels are the only witness.
  await pressPaintsFeedback(device, row);
});
