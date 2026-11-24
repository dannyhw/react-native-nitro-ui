import { expect } from 'e2e';

import { test } from './fixture';
import { drag, liftIntoBand, openScreen, reveal } from './support';
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
  // Both echoes are React Native rows above the composition, and they are the honest scroll
  // target: their boxes are React Native’s own, whereas the box Compose publishes for the
  // track describes the composition, not the pixel on screen.
  await reveal(screen, value, { reads: [track, gesture] });

  // The track is the <Host>'s own width, which React Native measures and not the
  // child's style, so a drag proves both that the gesture reached Compose and that it
  // used the box on screen. The gesture echo says a drag arrived as one gesture.
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(value).toHaveText('0.40');

  // The track is on screen by now but parked low, under its echoes: the page is
  // nudged back up in short drags until the track sits where a tap lands, with
  // both echoes kept in view so the drag's own echo can still be read.
  const box = await liftIntoBand(screen, track, [value, gesture]);
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

  // The other way, from wherever the drag above left the thumb. A control that only
  // ever reported one direction is fine until someone drags home.
  const back = await liftIntoBand(screen, track, [value, gesture]);
  await drag(
    screen,
    { x: back.x + back.width * 0.75, y: back.y + back.height / 2 },
    { x: back.x + back.width * 0.2, y: back.y + back.height / 2 }
  );
  await expect(value).toHaveText(/^0\.[0-4]\d$/);

  // A drag the machine stretches out: the samples reach Compose seconds apart, and
  // the thumb still has to be where the finger lifted, not where it happened to be
  // read mid-flight.
  const slow = await liftIntoBand(screen, track, [value, gesture]);
  await drag(
    screen,
    { x: slow.x + slow.width * 0.2, y: slow.y + slow.height / 2 },
    { x: slow.x + slow.width * 0.85, y: slow.y + slow.height / 2 },
    3000
  );
  await expect(value).toHaveText(/^(0\.[7-9]\d|1\.00)$/);
  await expect(gesture).toHaveText(/start=3 complete=3/);
});
