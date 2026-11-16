import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import {
  boxOf,
  centreOf,
  drag,
  editableField,
  flick,
  openScreen,
  reveal,
  tapBand,
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

test('a row that was not given a press stays unpressed, however it is touched', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'form');
  const row = screen.getByLabel(ROW);
  const plain = screen.getByLabel('Row with no onPress');
  const outside = screen.getByLabel('Outside the form');
  const presses = screen.getByTestId('form-row-presses');
  const outsidePresses = screen.getByTestId('form-outside-presses');
  await reveal(screen, row);
  await expect(presses).toHaveText('0');

  // A thumb that wanders along a row and lifts did not choose it. Nothing here is a
  // scrolling list that could cancel the touch — the finger never leaves the row — so
  // the only thing between this gesture and `onPress` is the row's own slop rule.
  const box = await boxOf(row);
  if (box == null) {
    throw new Error('real-input: the Form row has no box to drag along.');
  }
  await drag(
    screen,
    { x: box.x + box.width * 0.25, y: box.y + box.height / 2 },
    { x: box.x + box.width * 0.75, y: box.y + box.height / 2 }
  );
  await expect(presses).toHaveText('0');

  // A row with no handler is inert, and the controls beside it answer straight after:
  // the silence is that row's own, not an app that stopped listening. The taps are
  // aimed at the row's box because a row nobody can press has no touch point of its
  // own for a tap to be given to.
  await reveal(screen, plain);
  for (let tap = 1; tap <= 3; tap += 1) {
    await screen.tapAt(await centreOf(plain));
  }
  await expect(presses).toHaveText('0');
  await outside.tap();
  await expect(outsidePresses).toHaveText('1');
  await row.tap();
  await expect(presses).toHaveText('1');
});

test('a field the keyboard would cover is moved clear of it (G24)', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'form');
  const field = editableField(screen, 'Note');
  const focus = screen.getByTestId('form-field-focus');
  await revealLowInPage(screen, field);

  // G24 Android, twice in the excerpts: the focused field was left behind the
  // keyboard. The claim is only worth making about a field that had somewhere to be
  // covered, so the row is parked in the bottom of the page first and the premise is
  // asserted below: a check that measures avoidance where nothing was ever hidden
  // passes without measuring anything.
  //
  // `form-keyboard-inset` is an iOS-only echo. The Android measurement is the
  // window manager's own `ime` inset, which is why this runs under a real keyboard
  // rather than the driver's headless one, and why the witness that anything moved is
  // the field's own box rather than a number the Form reports.
  const beforeFocus = await boxOf(field);
  if (beforeFocus == null) {
    throw new Error(
      'real-input: the Note field has no box to place under a keyboard.'
    );
  }
  await expect(focus).toHaveText('no');
  await withRealKeyboard(async () => {
    await focusField(field);
    const focused = await textOf(screen, 'form-field-focus');
    expect(
      focused,
      'a real tap on the Note field did not focus it: the app still echoes ' +
        `"${focused}" (the field's box is ` +
        `${JSON.stringify(await boxOf(field))})`
    ).toBe('yes');
    const { keyboardTop } = await expectKeyboard();
    expect(
      beforeFocus.y + beforeFocus.height,
      `the premise of this check is missing: the field's bottom sat at ` +
        `${String(Math.round(beforeFocus.y + beforeFocus.height))} px, above the ` +
        `keyboard's top at ${String(Math.round(keyboardTop))} px, so nothing was ` +
        'ever covered and "it stayed above the keyboard" would be true of a Form ' +
        'that does nothing at all'
    ).toBeGreaterThan(keyboardTop);
    await fieldAboveKeyboard(field);
  });
});

/**
 * Park a control low in its page, where the keyboard will reach it.
 *
 * `reveal` puts a control in the middle of the tappable band, which is the right
 * answer for a tap and the wrong one for an avoidance check: the band reaches the
 * bottom of the content view, and a control parked near the middle of it is already
 * clear of a keyboard that only occupies the bottom of the screen.
 */
async function revealLowInPage(
  screen: Parameters<typeof reveal>[0],
  locator: Parameters<typeof reveal>[1]
): Promise<void> {
  await reveal(screen, locator);
  for (let nudge = 0; nudge < 6; nudge += 1) {
    const box = await boxOf(locator);
    const band = await tapBand(screen);
    if (box == null) return;
    if (box.y + box.height > band.top + (band.bottom - band.top) * 0.8) return;
    // The finger travels down, which is what carries the row down towards the
    // bottom edge; a fling would overshoot and lift it out of the band instead.
    await drag(
      screen,
      { x: box.x + box.width / 2, y: box.y },
      { x: box.x + box.width / 2, y: box.y + 160 }
    );
  }
}
