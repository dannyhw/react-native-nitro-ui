import { expect } from 'e2e';

import { test } from './fixture';
import { tree } from './os-tree';
import { openScreen, reveal } from './support';

test('a real tap on a hosted Switch reaches Compose and JS sees the value', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'host');
  const value = screen.getByTestId('host-controlled-value');
  const changes = screen.getByTestId('host-events-count');
  const flipper = screen.getByLabel('Hosted switch 0');
  await reveal(screen, flipper);
  await expect(value).toHaveText('off');
  await expect(changes).toHaveText('0');
  await flipper.tap();
  await expect(value).toHaveText('on');
  await expect(changes).toHaveText('1');

  // The way back is the other half of a toggle: a value that only travels one way
  // leaves a person unable to turn the thing off, and both changes have to reach JS.
  await flipper.tap();
  await expect(value).toHaveText('off');
  await expect(changes).toHaveText('2');
});

test('a screen reader meets the hosted Switches in mount order, between the React Native text around their Host', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'host');
  await reveal(screen, screen.getByLabel('Hosted switch 0'));

  // The tree's node order is the order TalkBack reads in. A plain text node's words are
  // its label in the driver's print, and the section heading is drawn upper-case.
  const nodes = tree({ unmerged: true });
  const textAt = (needle: string): number =>
    nodes.findIndex((node) =>
      `${node.text} ${node.contentDesc}`
        .toLowerCase()
        .includes(needle.toLowerCase())
    );
  const above = textAt('Three Switches, one composition');
  const below = textAt('The Host has a height');
  const hosted = [0, 1, 2].map((index) =>
    nodes.findIndex(
      (node) => node.contentDesc === `Hosted switch ${String(index)}`
    )
  );
  const where = `text above at ${String(above)}, switches at ${hosted.join('/')}, note below at ${String(below)}`;

  expect(above, `no RN text above the Host: ${where}`).toBeGreaterThanOrEqual(
    0
  );
  expect(below, `no RN note below the Host: ${where}`).toBeGreaterThanOrEqual(
    0
  );
  expect(
    hosted.every((at) => at >= 0),
    `a hosted Switch has no node: ${where}`
  ).toBe(true);
  expect(
    hosted,
    `the hosted Switches are not in mount order: ${where}`
  ).toEqual([...hosted].sort((left, right) => left - right));
  expect(
    hosted.every((at) => at > above && at < below),
    `a hosted Switch is read outside the RN text around its Host: ${where}`
  ).toBe(true);
});
