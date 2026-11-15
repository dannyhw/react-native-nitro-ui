import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import {
  boxOf,
  editableField,
  flick,
  openScreen,
  reveal,
  textOf,
} from './support';
import { actsOnOneNamedNode } from './reader';
import {
  expectKeyboard,
  fieldAboveKeyboard,
  focusField,
  withRealKeyboard,
} from './keyboard';

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
  const before = await boxOf(row);
  if (before == null) {
    throw new Error('real-input: the Form row has no box to flick over.');
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
  await expect(presses).toHaveText('0');
});

test('a field near the bottom of a Form stays above the keyboard (G24)', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'form');
  const field = editableField(screen, 'Note');
  const focus = screen.getByTestId('form-field-focus');
  await reveal(screen, field);

  // G24 Android, twice in the excerpts: the focused field was left behind the
  // keyboard. The field sits at the bottom of the Form's own list on purpose, so
  // this is the shape the defect needed. `form-keyboard-inset` is an iOS-only echo
  // — the Android measurement is the window's own `ime` inset, which is why this
  // test runs under a real keyboard rather than the driver's headless one.
  await expect(focus).toHaveText('no');
  await withRealKeyboard(async () => {
    await focusField(field);
    // Read between the tap and the keyboard: a field the tap never focused
    // explains a missing keyboard, and the two failures need different fixes.
    const focused = await textOf(screen, 'form-field-focus');
    expect(
      focused,
      'a real tap on the Note field did not focus it: the app still echoes ' +
        `"${focused}" (the field's box is ` +
        `${JSON.stringify(await boxOf(field))})`
    ).toBe('yes');
    await expectKeyboard();
    await fieldAboveKeyboard(field);
  });
});
