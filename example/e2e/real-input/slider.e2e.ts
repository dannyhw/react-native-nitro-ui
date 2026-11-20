import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { drag, isInBand, openScreen, reveal, textOf } from './support';
import { actsOnOneNamedNode } from './reader';

const NAME = 'Controlled slider';

test('a real drag moves the Slider and the value JS echoes follows it', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'slider');
  const track = screen.getByLabel(NAME);
  const value = screen.getByTestId('slider-controlled-value');
  const completes = screen.getByTestId('slider-controlled-complete-count');
  await reveal(screen, track);

  // A drag, not a tap: a Slider’s whole point is a gesture that is not a press, and the
  // value is a float the driver never reads off the tree — the echo is the only honest
  // report of what JS was told. The starting value is 0.250.
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(value).toHaveText('0.250');
  await expect(completes).toHaveText('controlledComplete=0');

  const box = await track.boundingBox();
  if (box == null || !(await isInBand(screen, box))) {
    throw new Error(
      `real-input: the Slider has no box to drag along; it reads ${JSON.stringify(box)}.`
    );
  }
  const y = box.y + box.height / 2;
  await drag(
    screen,
    { x: box.x + box.width * 0.25, y },
    { x: box.x + box.width * 0.8, y }
  );
  // A swipe returns when the finger lifts, while the samples it gathered are still on
  // their way to JS. `onSlidingComplete` is the library's own word that they have all
  // arrived, so the count it raises is read first and the echo only after it.
  await expect(completes).toHaveText('controlledComplete=1');
  const moved = await textOf(screen, 'slider-controlled-value');
  expect(
    Number(moved),
    `the dragged Slider echoed "${moved}" — a drag from 25% to 80% of the track ` +
      'has to raise a value that started at 0.250'
  ).toBeGreaterThan(0.5);

  // The same finger going back has to move the value back: a drag that only ever
  // raises leaves a person unable to undo the gesture they just made.
  await drag(
    screen,
    { x: box.x + box.width * 0.8, y },
    { x: box.x + box.width * 0.2, y }
  );
  await expect(completes).toHaveText('controlledComplete=2');
  const back = await textOf(screen, 'slider-controlled-value');
  expect(
    Number(back),
    `the drag back echoed "${back}" after the first drag left "${moved}" — the same ` +
      'finger travelling the other way has to lower the value it raised'
  ).toBeLessThan(Number(moved));
});
