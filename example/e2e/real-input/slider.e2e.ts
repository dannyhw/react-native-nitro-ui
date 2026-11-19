import { test } from '@e2e-dev/mobile';
import { expect, type Locator } from 'e2e';

import { drag, isInBand, openScreen, reveal, textOf } from './support';
import { actsOnOneNamedNode } from './reader';

const NAME = 'Controlled slider';

/** How long an echo is given to catch up with a drag: CI has taken seconds for a swipe. */
const ECHO_SETTLES_MS = 20_000;

/** Reads this far apart that agree are an echo that has stopped moving. */
const AT_REST_MS = 250;

/**
 * The echoed value once it has settled: it has moved off `before`, and two reads
 * `AT_REST_MS` apart agree. A swipe returns when the finger lifts while the samples it
 * gathered are still on their way to JS, so one read taken then says what the screen
 * held when the drag started.
 */
async function settledValue(
  value: Locator,
  before: string,
  why: string
): Promise<string> {
  const deadline = Date.now() + ECHO_SETTLES_MS;
  let previous = before;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, AT_REST_MS));
    const now = await value.textContent();
    if (now != null && now === previous && now !== before) return now;
    if (now != null) previous = now;
    if (Date.now() > deadline) {
      throw new Error(
        `real-input: ${why} - the echo never settled away from "${before}", it reads "${previous}".`
      );
    }
  }
}

test('a real drag moves the Slider and the value JS echoes follows it', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'slider');
  const track = screen.getByLabel(NAME);
  const value = screen.getByTestId('slider-controlled-value');
  await reveal(screen, track);

  // A drag, not a tap: a Slider’s whole point is a gesture that is not a press, and the
  // value is a float the driver never reads off the tree — the echo is the only honest
  // report of what JS was told. The starting value is 0.250.
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(value).toHaveText('0.250');
  const start = await textOf(screen, 'slider-controlled-value');

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
  const moved = await settledValue(
    value,
    start,
    'the drag from a quarter to four fifths of the track never moved the echo'
  );
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
  const back = await settledValue(
    value,
    moved,
    'the drag back down the track never moved the echo'
  );
  expect(
    Number(back),
    `the drag back echoed "${back}" after the first drag left "${moved}" — the same ` +
      'finger travelling the other way has to lower the value it raised'
  ).toBeLessThan(Number(moved));
});
