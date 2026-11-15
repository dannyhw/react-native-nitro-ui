import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import {
  judgePopupPlacement,
  PLACEMENT_SLOP_PX,
} from '../../../scripts/real-input/popover-placement.mjs';
import { displayDensity } from './device-read';
import { openScreen, reveal } from './support';
import {
  fieldAboveKeyboard,
  focusAndExpectKeyboard,
  keyboardTop,
  withRealKeyboard,
} from './keyboard';

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
  // Contains, not equals: the tap also takes the popover away, and its dismiss
  // lands in the same log line. Which events the popover announces in which order
  // is `Popover.harness`'s claim; what only a device can say is that the press
  // the finger made reached the control inside the window.
  await expect(log).toContainText('press:popover-short');
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
  // The measurement is the window's own `ime` inset — the number the popup has to
  // honour — read under a real keyboard, because the driver's headless IME shows
  // no keyboard to be placed under.
  await anchor.tap();
  const popover = screen.getByTestId('popover-field-popover');
  await popover.waitFor({ state: 'visible' });
  const field = popover.getByTestId('popover-inner-field');
  await withRealKeyboard(async () => {
    await focusAndExpectKeyboard(field);
    await fieldAboveKeyboard(field);
  });
});

test('the keyboard pushes the popover itself, not only the field inside it (G22)', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'popover');
  const anchor = screen.getByTestId('popover-field-anchor');
  await reveal(screen, anchor);

  // The anchor's box is read before the popup opens and never again: while a
  // focusable popup is up, the tree the reader walks is the popup's window, so the
  // anchor the popup was placed against is no longer in the read. The margin and
  // the spacing are the placement model's own numbers, in dp.
  const anchorBox = await anchor.boundingBox();
  if (anchorBox == null) {
    throw new Error(
      'real-input: the popover anchor has no box to place against.'
    );
  }
  await anchor.tap();
  const popover = screen.getByTestId('popover-field-popover');
  await popover.waitFor({ state: 'visible' });
  const field = popover.getByTestId('popover-inner-field');
  await withRealKeyboard(async () => {
    await focusAndExpectKeyboard(field);
    const density = displayDensity();
    const top = keyboardTop();
    const popupBox = await popover.boundingBox();
    // `fieldAboveKeyboard` alone is half-blind here, and G22 stayed hidden because
    // of it: a popup pinned to the top of the screen keeps the field above the
    // keyboard *better* than a placed one does. The popup has to be next to the
    // thing it points at, or against the keyboard's edge when there is no room for
    // either — the three branches `PopoverPlacement` answers with.
    const placement = judgePopupPlacement({
      popupBox:
        popupBox == null
          ? null
          : { y1: popupBox.y, y2: popupBox.y + popupBox.height },
      anchorBox: { y1: anchorBox.y, y2: anchorBox.y + anchorBox.height },
      imeTopPx: top,
      marginPx: Math.round(16 * density),
      spacingPx: Math.round(4 * density),
    });
    expect(
      placement.ok,
      `the popup is not placed (branch "${placement.branch}", tolerance ` +
        `${String(PLACEMENT_SLOP_PX)} px): ${placement.detail} — a popup that ` +
        'ignores the keyboard parks wherever it likes, and the field inside it is ' +
        'only visible by accident'
    ).toBe(true);
    await fieldAboveKeyboard(field);
  });
});
