import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { drag, openScreen, reveal, revealedBoxInBand } from './support';
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
  // Both echoes are real React Native rows *above* the composition, so they
  // are the first thing a scroll to this control pushes out of the tree.
  await reveal(screen, track, { reads: [value, gesture] });

  // The hosted Slider's track is the <Host>'s own width, which React Native
  // measures and not the child's style, so a drag proves both that the gesture
  // reached Compose and that the geometry it used is the box on screen. The
  // gesture echo is read as well because a drag that arrives as two taps, or
  // never completes, is the failure that was B-TIMING here three times (E5).
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(value).toHaveText('0.40');

  // The track's own box, re-revealed until the box agrees with the scroll
  // position: this control sits under two echoes and a section heading, and the
  // reads above can pull the page back up from the row this drag has to land on.
  const box = await revealedBoxInBand(screen, track);
  const y = box.y + box.height / 2;
  await drag(
    screen,
    { x: box.x + box.width * 0.2, y },
    { x: box.x + box.width * 0.75, y }
  );
  const moved = await value.textContent();
  expect(
    Number(moved),
    `the hosted Slider echoed "${moved}" after a drag from ` +
      `${String(Math.round(box.x + box.width * 0.2))} to ` +
      `${String(Math.round(box.x + box.width * 0.75))} px at y ` +
      `${String(Math.round(y))} (its named node's box is ` +
      `${String(Math.round(box.width))}x${String(Math.round(box.height))} at ` +
      `${String(Math.round(box.x))},${String(Math.round(box.y))})`
  ).toBeGreaterThan(0.5);
  await expect(gesture).toContainText('start=1');
  await expect(gesture).toContainText('complete=1');
});
