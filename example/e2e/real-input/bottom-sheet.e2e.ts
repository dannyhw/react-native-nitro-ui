import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { nodesForTestIds } from './os-tree';
import { boxOf, drag, openScreen, reveal } from './support';

test('a real tap opens the sheet, a Pressable inside it counts, and Back closes it', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'sheet');
  const opener = screen.getByTestId('sheet-open-fit');
  const log = screen.getByTestId('sheet-log');
  await reveal(screen, opener);

  // A sheet's root intercepts touches to move itself, and a `TextInput` underneath
  // it stopped answering for exactly that reason. So the press that has to be
  // counted is inside the sheet, on content that rose from the window's bottom
  // edge, and the count is JS's own. The dismissal bookkeeping is the harness's.
  await expect(log).toHaveText('none');
  await opener.tap();
  const sheet = screen.getByTestId('sheet-fit-sheet');
  await sheet.waitFor({ state: 'visible' });
  await sheet.getByTestId('sheet-press').tap();
  await expect(screen.getByTestId('sheet-presses')).toHaveText(
    'Pressed 1 times'
  );

  await app.back();
  await sheet.waitFor({ state: 'detached' });
});

test('a real tap on a TextInput inside the sheet is a whole press', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'sheet');
  await reveal(screen, screen.getByTestId('sheet-open-fit'));
  await screen.getByTestId('sheet-open-fit').tap();
  const sheet = screen.getByTestId('sheet-fit-sheet');
  await sheet.waitFor({ state: 'visible' });

  // React Native's `ReactEditText` disallows its parents' interception from the
  // first touch-down, so the lift of a tap only reaches JS if the sheet's root keeps
  // intercepting regardless. A field that takes the press in and never gives it out
  // is the defect this taps for, and it is invisible from inside the app.
  // The field is read from the page rather than from under the sheet's own node: the
  // sheet hands its content to a window of its own, and the driver's tree does not hang
  // that content beneath the node the `testID` is on. What keeps the looser locator
  // honest is the sheet's own title, drawn in that same window: a field that is not the
  // one the open sheet drew is not beneath it. Both boxes come from one capture, and the
  // node carrying `sheet-fit-sheet` is the scrim, whose box stops short of the content.
  const input = screen.getByTestId('sheet-input');
  const read = nodesForTestIds(['sheet-fit-title', 'sheet-input']);
  const chrome = read.get('sheet-fit-title');
  const field = read.get('sheet-input');
  if (chrome == null || field == null) {
    throw new Error(
      `real-input: the open sheet draws no field to press (title ` +
        `${JSON.stringify(chrome?.bounds ?? null)}, field ` +
        `${JSON.stringify(field?.bounds ?? null)}).`
    );
  }
  expect(
    field.bounds.y1 >= chrome.bounds.y1 &&
      field.bounds.x1 >= chrome.bounds.x1 - 1 &&
      field.bounds.x2 <= chrome.bounds.x2 + 1,
    `"Notes" is drawn at ${String(field.bounds.y1)}-${String(
      field.bounds.y2
    )}, which is not inside the column the open sheet's own title draws at ` +
      `${String(chrome.bounds.y1)}-${String(chrome.bounds.y2)}, so the field this ` +
      'press is aimed at is not the one the sheet drew'
  ).toBe(true);

  await expect(screen.getByTestId('sheet-input-touches')).toHaveText(
    'Input touches: in 0 out 0'
  );
  await input.tap();
  await expect(screen.getByTestId('sheet-input-touches')).toHaveText(
    'Input touches: in 1 out 1'
  );

  // A horizontal scroll inside the sheet hands its parents the gesture for the
  // length of the drag; the press after it still has to end.
  const strip = await boxOf(screen.getByTestId('sheet-hscroll'));
  if (strip == null) {
    throw new Error('real-input: the sheet has no horizontal list to drag.');
  }
  await drag(
    screen,
    { x: strip.x + strip.width - 20, y: strip.y + strip.height / 2 },
    { x: strip.x + 20, y: strip.y + strip.height / 2 }
  );
  await sheet.getByTestId('sheet-press').tap();
  await expect(screen.getByTestId('sheet-presses')).toHaveText(
    'Pressed 1 times'
  );
});

test('a drag down dismisses an ordinary sheet and moves nothing else', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'sheet');
  const log = screen.getByTestId('sheet-log');
  await reveal(screen, screen.getByTestId('sheet-open-fit'));

  // The three gestures a person uses to get rid of a sheet. None of them is a
  // harness test: the suites ask native to *report* a dismissal
  // ("closes as a user dismissal does"), which is the callback's half. Whether a
  // drag a finger makes is recognised as one at all — and whether a sheet the app
  // declared sticky refuses it — is only answerable with a real drag.
  await expect(log).toHaveText('none');
  await screen.getByTestId('sheet-open-fit').tap();
  const fit = screen.getByTestId('sheet-fit-sheet');
  await fit.waitFor({ state: 'visible' });
  const chrome = await boxOf(screen.getByTestId('sheet-fit-title'));
  if (chrome == null) {
    throw new Error(
      'real-input: the fit sheet draws no title to start a drag on.'
    );
  }
  // A drag that starts above the sheet's own chrome is taken by the system as the
  // gesture that pulls down the notification shade, and the shade takes the screen with
  // it: every later read of the tree then sees SystemUI instead of the app.
  await drag(
    screen,
    { x: chrome.x + chrome.width / 2, y: chrome.y + 12 },
    { x: chrome.x + chrome.width / 2, y: chrome.y + 600 }
  );
  await fit.waitFor({ state: 'detached' });
  await expect(log).toContainText('dismiss');

  // The header of a two-detent sheet is not a scroll view, so a drag on it belongs
  // to the sheet: up has to reach the second detent rather than scroll a list.
  await reveal(screen, screen.getByTestId('sheet-open-two'));
  await screen.getByTestId('sheet-open-two').tap();
  const two = screen.getByTestId('sheet-two-sheet');
  await two.waitFor({ state: 'visible' });
  const header = screen.getByTestId('sheet-two-header');
  const headerBox = await boxOf(header);
  if (headerBox == null) {
    throw new Error(
      'real-input: the two-detent sheet draws no header to drag.'
    );
  }
  const twoAt = await boxOf(two);
  await drag(
    screen,
    { x: headerBox.x + headerBox.width / 2, y: headerBox.y + 12 },
    { x: headerBox.x + headerBox.width / 2, y: headerBox.y - 400 }
  );
  const lifted = await boxOf(two);
  console.log(
    `    header drag: sheet ${JSON.stringify(twoAt)} -> ${JSON.stringify(lifted)}`
  );
  await expect(log).toContainText('detent:1');
  await app.back();
  await two.waitFor({ state: 'detached' });

  // The sticky one takes none of it. A sheet that eats drags also eats the one that
  // should have dismissed a screen later, so this half is read on the same page.
  await reveal(screen, screen.getByTestId('sheet-open-sticky'));
  await screen.getByTestId('sheet-open-sticky').tap();
  const sticky = screen.getByTestId('sheet-sticky-sheet');
  await sticky.waitFor({ state: 'visible' });
  const stickyTitle = await boxOf(screen.getByTestId('sheet-sticky-title'));
  if (stickyTitle == null) {
    throw new Error(
      'real-input: the sticky sheet draws no title to drag from.'
    );
  }
  await drag(
    screen,
    { x: stickyTitle.x + stickyTitle.width / 2, y: stickyTitle.y + 12 },
    { x: stickyTitle.x + stickyTitle.width / 2, y: stickyTitle.y + 600 }
  );
  await sticky.getByTestId('sheet-sticky-title').waitFor({ state: 'visible' });
  await sticky.getByTestId('sheet-sticky-close').tap();
  await sticky.waitFor({ state: 'detached' });
});
