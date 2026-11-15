import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { drag, isInBand, openScreen, reveal } from './support';
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
  const drum = screen.getByLabel('Real-input wheel in a scroller');
  const index = screen.getByTestId('real-input-wheel-index');
  await reveal(screen, drum);

  const box = await drum.boundingBox();
  if (box == null || !(await isInBand(screen, box))) {
    throw new Error(
      `real-input: the wheel in the scroller has no box to drag; it reads ${JSON.stringify(box)}.`
    );
  }
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  // G29, twice over. A vertical drag belongs to the drum even though a scroller
  // ancestor could take it: if the page eats the roll, the index never moves.
  // And a sideways drag belongs to the *scroller* — the drum hands its
  // disallowIntercept back on the first sideways move (`nuiOwnVerticalDrags`), so
  // the row has to slide while the drum stays put. Both halves are the same
  // arbitration, read from the two things only geometry can tell apart.
  await drag(screen, centre, { x: centre.x, y: centre.y - 220 });
  const rolled = await index.textContent();
  expect(
    rolled,
    'a vertical drag rolled nothing: the scroller above the drum kept the ' +
      'gesture, which is the G29 defect (a fling scrolled the page)'
  ).not.toBe('-');

  const afterRoll = await drum.boundingBox();
  expect(
    afterRoll,
    'the drum has no box to compare after the roll'
  ).not.toBeNull();
  await drag(screen, centre, { x: centre.x - 260, y: centre.y });
  const afterSwipe = await drum.boundingBox();
  expect(
    afterSwipe != null &&
      afterRoll != null &&
      Math.abs(afterSwipe.x - afterRoll.x) > 20,
    `a sideways swipe left the scroller where it was: the drum kept a gesture ` +
      `that belongs to the row (box ${String(afterRoll?.x)} → ` +
      `${String(afterSwipe?.x)} px)`
  ).toBe(true);
  const stillRolled = await index.textContent();
  expect(
    stillRolled,
    "the sideways swipe also rolled the drum: it took the row's gesture"
  ).toBe(rolled);
});
