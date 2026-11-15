import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

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
  // The field and the list are read from the page rather than from under the
  // sheet's own node: the sheet hands its content to a window of its own, and the
  // driver's tree does not hang that content beneath the node the `testID` is on.
  // The premise below is what keeps the looser locator honest about where the field is.
  const input = screen.getByTestId('sheet-input');
  const drawn = await boxOf(input);
  const sheetBox = await boxOf(sheet);
  if (drawn == null || sheetBox == null) {
    throw new Error(
      `real-input: the open sheet draws no field to press (field ` +
        `${JSON.stringify(drawn)}, sheet ${JSON.stringify(sheetBox)}).`
    );
  }
  expect(
    drawn.y >= sheetBox.y - 1 &&
      drawn.y + drawn.height <= sheetBox.y + sheetBox.height + 1,
    `"Notes" is drawn at ${String(drawn.y)}-${String(
      drawn.y + drawn.height
    )}, outside the sheet's own ${String(sheetBox.y)}-${String(
      sheetBox.y + sheetBox.height
    )}, so the press would not land inside the sheet at all`
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
  const at = await boxOf(fit);
  if (at == null) {
    throw new Error('real-input: the fit sheet has no box to drag down.');
  }
  await drag(
    screen,
    { x: at.x + at.width / 2, y: at.y + 24 },
    { x: at.x + at.width / 2, y: at.y + 600 }
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
  const stickyBox = await boxOf(sticky);
  if (stickyBox == null) {
    throw new Error('real-input: the sticky sheet has no box to drag.');
  }
  await drag(
    screen,
    { x: stickyBox.x + stickyBox.width / 2, y: stickyBox.y + 24 },
    { x: stickyBox.x + stickyBox.width / 2, y: stickyBox.y + 600 }
  );
  await sticky.getByTestId('sheet-sticky-title').waitFor({ state: 'visible' });
  await sticky.getByTestId('sheet-sticky-close').tap();
  await sticky.waitFor({ state: 'detached' });
});
