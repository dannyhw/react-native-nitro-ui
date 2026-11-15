import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { boxOf, drag, openScreen, reveal, textOf } from './support';
import { actsOnOneNamedNode } from './reader';

const NAME = 'Real-input picker';

test('a real tap opens the Picker and a real tap on a row reports it', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'picker');
  const trigger = screen.getByLabel(NAME);
  const index = screen.getByTestId('real-input-picker-index');
  await reveal(screen, trigger);

  // The menu is an Android popup with no resource-id of its own, so its rows are
  // reached by the text a person reads. The refused selection and the unmount
  // while open are the harness's: `Picker.harness` and `HostPopups`.
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(index).toHaveText('-');

  await trigger.tap();
  await screen.getByText('Quartz').tap();
  await expect(index).toHaveText('1');
});

test('a wheel drum inside a side-scroller keeps the drags it owns (G29)', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'picker');
  // The drum is a hosted node, and asking a hosted node where it is inside a
  // scroller asks the driver to scroll a composition into view, which never
  // settles. The two React Native nodes either side of it are honest, so the drum
  // is aimed at between them and its row's travel is read off the tail.
  const row = screen.getByTestId('real-input-wheel-scroller-row');
  const tail = screen.getByTestId('real-input-wheel-scroller-tail');
  const echo = screen.getByTestId('real-input-scroller-index');
  await reveal(screen, row);
  const rowBox = await boxOf(row);
  const atRest = await boxOf(tail);
  if (rowBox == null || atRest == null) {
    throw new Error(
      `real-input: the side-scroller row has no box to aim at; the row reads ` +
        `${JSON.stringify(rowBox)} and its tail ${JSON.stringify(atRest)}.`
    );
  }

  // The drum is the row's first child, so it runs from the row's left edge to the
  // tail's, and those two edges give a centre no hosted box has to be trusted for.
  const centre = {
    x: (rowBox.x + atRest.x) / 2,
    y: rowBox.y + rowBox.height / 2,
  };

  // G29, twice over. A vertical drag belongs to the drum even though a scroller
  // ancestor could take it: if the page eats the roll, the index never moves.
  await drag(screen, centre, { x: centre.x, y: centre.y - 220 });
  // A drum reports once it has settled on a row, not under the finger, so the roll
  // is awaited; reading the echo straight away races the snap.
  await expect(echo).not.toHaveText('-');
  const rolled = await textOf(screen, 'real-input-scroller-index');
  expect(
    rolled,
    'a vertical drag rolled nothing: the scroller above the drum kept the ' +
      'gesture, which is the G29 defect (a fling scrolled the page)'
  ).not.toBe('-');

  // And a sideways drag belongs to the *scroller* — the drum hands its
  // disallowIntercept back on the first sideways move (`nuiOwnVerticalDrags`) — so
  // the row has to slide while the drum stays put, which is the tail moving left.
  await drag(screen, centre, { x: centre.x - 260, y: centre.y });
  const afterSwipe = await boxOf(tail);
  expect(
    afterSwipe != null && atRest.x - afterSwipe.x > 20,
    `a sideways swipe left the scroller where it was: the drum kept a gesture ` +
      `that belongs to the row (the tail ran ${String(atRest.x)} → ` +
      `${String(afterSwipe?.x)} px)`
  ).toBe(true);
  // And it stays where it was: a sideways gesture the drum kept would land on
  // another row, and the report arrives late rather than not at all.
  await expect(echo).toHaveText(rolled);
});
