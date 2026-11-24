import { expect } from 'e2e';

import { test } from './fixture';
import { tree } from './os-tree';
import { centreOf, openScreen, reveal } from './support';
import { actsOnOneNamedNode } from './reader';

const NAME = 'Hosted date picker';

test('a hosted DatePicker opens its dialog, and a day cell reaches JS', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'host');
  const field = screen.getByLabel(NAME);
  const value = screen.getByTestId('host-datepicker-value');
  await reveal(screen, field);

  // The day cells of a dialog presented by a hosted control are Compose nodes in
  // another window: nothing inside the React tree can see them, which is why this
  // row exists at all. The unmount-while-open leak is the harness's (`HostPopups`).
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(value).toHaveText('2026-05-17');

  await field.tap();
  // The Material dialog is a window of its own that the control does not stamp with its
  // testID: while it is up, the tree the driver reads is the dialog and nothing else.
  const day = screen.getByLabel('Friday, May 22, 2026');
  await day.waitFor({ state: 'visible' });
  // The cell's own box rather than the driver's tap: the day is one node whose
  // clickable part belongs to another, and a named node like this gets no touch
  // point of its own to press.
  await screen.tapAt(await centreOf(day));
  await screen.getByText(/^OK$/).tap();
  await expect(value).toHaveText('2026-05-22');
});

/** How long the dialog is given to open or to leave the tree. */
const DIALOG_MS = 8_000;

/**
 * The dialog's day cells on the unmerged tree: square boxes a finger can act on, named
 * with a date that carries its year.
 */
function dayCellCount(): number {
  return tree({ unmerged: true }).filter(
    (node) =>
      node.hittable === 'true' &&
      node.enabled === 'true' &&
      node.bounds.width >= 24 &&
      Math.abs(node.bounds.width - node.bounds.height) <= 4 &&
      /\d{4}/.test(`${node.text} ${node.contentDesc}`)
  ).length;
}

async function dayCellsReach(
  holds: (count: number) => boolean,
  what: string
): Promise<void> {
  await expect
    .poll(() => holds(dayCellCount()), {
      timeout: DIALOG_MS,
      interval: 250,
      message: what,
    })
    .toBe(true);
}

test('Back and Cancel each close the hosted dialog and report no day', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'host');
  const field = screen.getByLabel(NAME);
  const value = screen.getByTestId('host-datepicker-value');
  await reveal(screen, field);
  await expect(value).toHaveText('2026-05-17');
  expect(dayCellCount(), 'day cells are in the tree before the dialog').toBe(0);

  await field.tap();
  await dayCellsReach((count) => count >= 14, 'no month grid of day cells');
  await app.back();
  await dayCellsReach((count) => count === 0, 'Back left the dialog up');
  await expect(value).toHaveText('2026-05-17');

  await field.tap();
  await dayCellsReach((count) => count >= 14, 'no month grid of day cells');
  await screen.getByText(/^(Cancel|Close|Dismiss|Back)$/).tap();
  await dayCellsReach((count) => count === 0, 'Cancel left the dialog up');
  await expect(value).toHaveText('2026-05-17');
});
