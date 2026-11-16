import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { editableField, openScreen, reveal } from './support';
import {
  fieldAboveKeyboard,
  focusAndExpectKeyboard,
  withRealKeyboard,
} from './keyboard';

const TYPING = 'Typing field';
const FOCUS = 'Focus field';

test('real keystrokes reach the field and JS sees the text', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'textfield');
  const field = editableField(screen, TYPING);
  const echo = screen.getByTestId('text-typing-echo');
  await reveal(screen, field);

  // Typed one key at a time, through the IME, because the whole point is that the
  // keystrokes travel the input path: `fill` would set text and prove nothing.
  // The refused edit, maxLength, focus/blur bookkeeping and the keyboard type are
  // the harness's: `TextField.harness` "reverts an edit JS refuses…",
  // "holds maxLength in UTF-16 units…", "reports focus and blur, focuses on a
  // tap, and submits on Return".
  await expect(echo).toHaveText('typed:  (0)');
  await field.tap();
  await field.pressSequentially('abc');
  await expect(echo).toHaveText('typed: abc (3)');
});

test('a real tap on a field brings up the real keyboard, and the field stays above it', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'textfield');
  const field = editableField(screen, FOCUS);
  const field = editableField(screen, 'Focus field');
  const echo = screen.getByTestId('text-focus-echo');
  await reveal(screen, field);

  // No in-app test can show a keyboard, so this is the delivery proof for the
  // text controls on this platform: the tap focuses the field *and* the window
  // shrinks by the IME's height. The field's own position is read as well, so a
  // keyboard that arrived over the field — the G24 defect, in another screen —
  // cannot pass by simply being present.
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
  await openScreen(screen, 'textfield');
  const field = editableField(screen, 'Focus field');
  const echo = screen.getByTestId('text-focus-echo');
  await reveal(screen, field);
  await expect(echo).toHaveText('focus: 0 blur: 0 submitted: -');

  // A person meets an imperative focus as the keyboard appearing, and a blur as
  // their own tap-dismiss. Both directions come from a real button press here, so the
  // echo is a report of the handle's call, not of React's own bookkeeping.
  await withRealKeyboard(async () => {
    await screen.getByTestId('text-focus-js').tap();
    await expect(echo).toContainText('focus: 1');
    await screen.getByTestId('text-blur-js').tap();
    await expect(echo).toContainText('blur: 1');
  });
});
