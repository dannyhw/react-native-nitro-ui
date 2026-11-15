import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { openScreen, reveal } from './support';
import { fieldAboveKeyboard, focusAndExpectKeyboard } from './keyboard';

test('a real tap opens the popover and a Pressable inside it answers exactly once', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'popover');
  const anchor = screen.getByTestId('popover-short-anchor');
  const log = screen.getByTestId('popover-log');
  const presses = screen.getByTestId('popover-inner-presses');
  await reveal(screen, anchor);

  // The window is tagged `popover-short-popover`, so the press is tapped on the
  // popover's own content: a tap that reached the page behind it would count for
  // nothing here. Ten open/close cycles and the event bookkeeping are the
  // harness's (`Popover.harness` "cycles 10 more times").
  await expect(log).toHaveText('none');
  await expect(presses).toHaveText('inner presses: 0');
  await anchor.tap();
  const popover = screen.getByTestId('popover-short-popover');
  await popover.waitFor({ state: 'visible' });
  await popover.getByTestId('popover-short-inner-press').tap();
  await expect(presses).toHaveText('inner presses: 1');
  await expect(log).toHaveText('press:popover-short');
});

test('a TextInput inside a popover stays above the keyboard (G22)', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'popover');
  const anchor = screen.getByTestId('popover-field-anchor');
  await reveal(screen, anchor);

  // G22 Android: the popup was placed under the keyboard, and then 43 px past it.
  // The measurement is the app's own content view, which `adjustResize` shortens
  // by exactly the keyboard's height, so "the field is above the keyboard" is a
  // fact about the window rather than a guess about insets.
  await anchor.tap();
  const popover = screen.getByTestId('popover-field-popover');
  await popover.waitFor({ state: 'visible' });
  const field = popover.getByTestId('popover-inner-field');
  await focusAndExpectKeyboard(screen, field);
  await fieldAboveKeyboard(screen, field);
});
