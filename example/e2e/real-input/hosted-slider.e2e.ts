import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { drag, isInBand, openScreen, reveal } from './support';
import { actsOnOneNamedNode } from './reader';

const NAME = 'Hosted slider';

test('a real drag moves a hosted Slider, whose track is the Host width', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'host');
  const track = screen.getByLabel(NAME);
  const value = screen.getByTestId('host-slider-value');
  const gesture = screen.getByTestId('host-slider-gesture');
  await reveal(screen, track);

  // The hosted Slider's track is the <Host>'s own width, which React Native
  // measures and not the child's style, so a drag proves both that the gesture
  // reached Compose and that the geometry it used is the box on screen. The
  // gesture echo is read as well because a drag that arrives as two taps, or
  // never completes, is the failure that was B-TIMING here three times (E5).
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(value).toHaveText('0.40');

  const box = await track.boundingBox();
  if (box == null || !(await isInBand(screen, box))) {
    throw new Error(
      `real-input: the hosted Slider has no box to drag along; it reads ${JSON.stringify(box)}.`,
    );
  }
  const y = box.y + box.height / 2;
  await drag(
    screen,
    { x: box.x + box.width * 0.2, y },
    { x: box.x + box.width * 0.75, y },
  );
  const moved = await value.textContent();
  expect(
    Number(moved),
    `the hosted Slider echoed "${moved}" after a drag to 75% of its own box`,
  ).toBeGreaterThan(0.5);
  await expect(gesture).toContainText('start=1');
  await expect(gesture).toContainText('complete=1');
});
