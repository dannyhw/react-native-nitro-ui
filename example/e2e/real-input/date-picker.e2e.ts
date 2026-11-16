import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { centreOf, openScreen, reveal } from './support';
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

  // The day cells are named with the whole date, which is the only way to say which day
  // a person is pressing: the grid’s nodes carry no testID, so a tap by number could
  // land on any month’s 20th.
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(value).toHaveText('-');

  await field.tap();
  const day = screen.getByLabel(target.label);
  await day.waitFor({ state: 'visible' });
  // The cell's own box rather than the driver's tap: the day is one node whose
  // clickable part belongs to another, and a named node like this gets no touch
  // point of its own to press.
  await screen.tapAt(await centreOf(day));
  await screen.getByText(/^OK$/).tap();
  await expect(value).toHaveText(target.iso);
});
