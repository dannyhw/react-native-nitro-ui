import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { openScreen, reveal } from './support';
import { actsOnOneNamedNode } from './reader';

const NAME = 'Real-input date picker';

/** A day in the currently visible month, far enough from today to be distinct. */
function targetDay(): { label: string; iso: string } {
  const now = new Date();
  const day = now.getDate() >= 20 ? now.getDate() - 5 : now.getDate() + 5;
  const date = new Date(now.getFullYear(), now.getMonth(), day);
  return {
    label: date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    iso: `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

test('a real tap opens the date dialog, a day cell reaches JS, OK closes it', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'datepicker');
  const field = screen.getByLabel(NAME);
  const value = screen.getByTestId('real-input-date-value');
  await reveal(screen, field);

  const target = targetDay();

  // The day cells are named with the whole date — "Friday, November 20, 2026" —
  // which is the screen-reader fact this suite keeps, and the only way to say
  // *which* day a person is pressing: the grid's own nodes carry no testID and the
  // dialog window carries none either, so a tap by number could land on any
  // month's 20th. Picking by the name the reader reads is the honest version —
  // and the name is the only handle: in the tree the driver reads, the day is one
  // node carrying the date as its label and an unnamed clickable node beside it,
  // so a role query for "button" answers a node with no name to aim at.
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(value).toHaveText('-');

  await field.tap();
  const day = screen.getByLabel(target.label);
  await day.waitFor({ state: 'visible' });
  await day.tap();
  await screen.getByText(/^OK$/).tap();
  await expect(value).toHaveText(target.iso);
});
