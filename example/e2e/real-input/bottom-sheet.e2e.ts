import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { nodesForTestIds } from './os-tree';
import { openScreen, reveal } from './support';

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
});
