import { test } from '@e2e-dev/mobile';
import { expect, type Locator } from 'e2e';

import { boxOf, editableField, openScreen, reveal } from './support';
import {
  fieldAboveKeyboard,
  focusAndExpectKeyboard,
  withRealKeyboard,
} from './keyboard';

const TYPING = 'Typing search field';
const FOCUS = 'Focus search field';

test('real keystrokes reach the field, and the clear button reports the empty query', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'searchfield');
  const field = editableField(screen, TYPING);
  const echo = screen.getByTestId('search-typing-echo');
  await reveal(screen, field);

  // The clear button is Material's own `IconButton`, named by the framework
  // (`Clear query`) and present only while the query is non-empty. It exists in no
  // React tree, so the harness cannot press it, and the tap is placed by that name
  // rather than by a box that would say nothing about what a reader is told.
  await expect(echo).toHaveText('query:  (0)');
  await field.tap();
  await field.pressSequentially('abc');
  await expect(echo).toHaveText('query: abc (3)');

  // Every field with a query draws Material's own clear button, and two fields on
  // this screen hold a query at once, so the label names two nodes. Scoping by the
  // row they sit in does not work on Android: React Native lifts the children of a
  // view that carries nothing but a testID up to the nearest accessibility-
  // important ancestor, so the row's own node has no children for a locator to
  // look inside. The field's box is the window instead, and the button that
  // belongs to this field is the one on this field's own line — and the echo below
  // then says which of the two the finger actually pressed.
  const fieldBox = await boxOf(field);
  if (fieldBox == null) {
    throw new Error(
      'real-input: the typing field has no box to aim a clear at.'
    );
  }
  const line = fieldBox.y + fieldBox.height / 2;
  const onThisLine: Locator[] = [];
  for (const clear of await screen.getByLabel('Clear query').all()) {
    const box = await boxOf(clear);
    if (
      box != null &&
      Math.abs(box.y + box.height / 2 - line) < fieldBox.height
    ) {
      onThisLine.push(clear);
    }
  }
  const clear = onThisLine[0];
  if (clear == null || onThisLine.length > 1) {
    throw new Error(
      `real-input: exactly one "Clear query" node may sit on the typing ` +
        `field's own line (y ${String(Math.round(line))} px); ` +
        `${String(onThisLine.length)} do.`
    );
  }
  await clear.tap();
  await expect(echo).toHaveText('query:  (0)');
});

test('a real tap on a search field brings up the keyboard and keeps the field above it', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'searchfield');
  const field = editableField(screen, FOCUS);
  const echo = screen.getByTestId('search-focus-echo');
  await reveal(screen, field);

  // The keyboard-type-reaches-the-IME claim is the harness's ("gives the field the
  // keyboard the app asked for, Search key included"); what is left for the device
  // is that focusing really raises an IME and does not lose the field behind it.
  await expect(echo).toHaveText('focus: 0 blur: 0 submitted: -');
  await withRealKeyboard(async () => {
    await focusAndExpectKeyboard(field);
    await fieldAboveKeyboard(field);
  });
  await expect(echo).toContainText('focus: 1');
});

test('an app-side focus and blur button take the keyboard and give it back', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'searchfield');
  const field = editableField(screen, FOCUS);
  const echo = screen.getByTestId('search-focus-echo');
  await reveal(screen, field);
  await expect(echo).toHaveText('focus: 0 blur: 0 submitted: -');

  // The same two presses on SearchField's own handle: a search screen that closes its
  // own keyboard is an ordinary thing for an app to do, and the IME has to agree with
  // the echo.
  await withRealKeyboard(async () => {
    await screen.getByTestId('search-focus-js').tap();
    await expect(echo).toContainText('focus: 1');
    await screen.getByTestId('search-blur-js').tap();
    await expect(echo).toContainText('blur: 1');
  });
});
