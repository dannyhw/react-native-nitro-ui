import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { drag, isInBand, openScreen, reveal } from './support';
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
  await reveal(screen, track);

  // A drag, not a tap: a Slider is the one control whose whole point is a gesture
  // that is not a press, and the value is a float the driver never reads off the
  // tree — the echo is the only honest report of what JS was told. The starting
  // value is 0.250, so a drag to 80% of the track has to move it up.
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(value).toHaveText('0.250');

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
  const moved = await value.textContent();
  expect(
    Number(moved),
    `the dragged Slider echoed "${moved}" — a drag from 25% to 80% of the track ` +
      'has to raise a value that started at 0.250'
  ).toBeGreaterThan(0.5);
});
