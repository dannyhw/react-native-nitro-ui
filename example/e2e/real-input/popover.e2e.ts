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
  measureAtRest,
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

  // The window is tagged `popover-short-popover`, so the press is tapped on the popover’s
  // own content: a tap that reached the page behind it would count for nothing here.
  await expect(log).toHaveText('none');
  await expect(presses).toHaveText('inner presses: 0');
  await anchor.tap();
  const popover = screen.getByTestId('popover-short-popover');
  await popover.waitFor({ state: 'visible' });
  await popover.getByTestId('popover-short-inner-press').tap();
  await expect(presses).toHaveText('inner presses: 1');
  // Contains, not equals: the tap also takes the popover away, and its dismiss lands in the
  // same log line. What only a device can say is that the press reached the content.
  await expect(log).toContainText('press:popover-short');
});

test('a TextInput inside a popover stays above the keyboard', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'popover');
  const anchor = screen.getByTestId('popover-field-anchor');
  await reveal(screen, anchor);

  // The measurement is the window's own `ime` inset — the number the popup has to
  // honour — read under a real keyboard, because the driver's headless IME shows no
  // keyboard to be placed under.
  await anchor.tap();
  const popover = screen.getByTestId('popover-field-popover');
  await popover.waitFor({ state: 'visible' });
  const field = popover.getByTestId('popover-inner-field');
  await withRealKeyboard(async () => {
    const beforeFocus = await field.boundingBox();
    await focusAndExpectKeyboard(field);
    await fieldAboveKeyboard(field, beforeFocus);
  });
});

test('the keyboard pushes the popover itself, not only the field inside it', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'popover');
  const anchor = screen.getByTestId('popover-field-anchor');
  await reveal(screen, anchor);

  // The anchor's box is read before the popup opens and never again: while a focusable
  // popup is up, the tree is the popup's window, and the anchor is not in it. The
  // margin and the spacing are the placement model's own numbers, in dp.
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
    const beforeFocus = await field.boundingBox();
    await focusAndExpectKeyboard(field);
    // The popup's box is read once the keyboard's edge and the field's box have come to
    // rest, and judged against that same edge — the edge the popup was placed against.
    const { keyboardTop: top } = await measureAtRest(field, beforeFocus);
    const density = displayDensity();
    const popupBox = await popover.boundingBox();
    // A popup pinned to the top of the screen keeps a field above the keyboard better
    // than a placed one does, so the field alone is half-blind: the popup has to be
    // beside its anchor, or against the keyboard's edge when there is no room.
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
    await fieldAboveKeyboard(field, beforeFocus);
  });
});
