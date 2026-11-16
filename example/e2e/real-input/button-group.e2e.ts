import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { openScreen, reveal } from './support';
import { factsForItem } from './os-tree';
import { actsOnOneNamedNode, itemAnnounces } from './reader';

const GROUP = 'Real-input actions';
const TOGGLES = 'Real-input formatting toggles';
const DISABLED_ITEM = 'Real-input group with a disabled item';
const DISABLED_GROUP = 'Real-input disabled group';

test('a real tap presses one item of a ButtonGroup and reports its id', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'buttongroup');
  const group = screen.getByLabel(GROUP);
  const presses = screen.getByTestId('button-group-presses');
  const pressed = screen.getByTestId('button-group-pressed-id');
  await reveal(screen, group);

  // A group is `role: container`: the name sits on the wrapper and the actionable
  // nodes are the items inside it, so the tap goes to the item drawn "Copy" through
  // the named group and cannot silently become some other ‘Copy’ on the screen.
  await actsOnOneNamedNode(screen, { name: GROUP, state: 'enabled' });
  const copy = group.getByText('Copy');
  expect(
    await copy.count(),
    'the "Copy" item is not inside the named group'
  ).toBe(1);
  await expect(presses).toHaveText('0');
  await expect(pressed).toHaveText('none');

  await reveal(screen, copy);
  await copy.tap();
  await expect(presses).toHaveText('1');
  await expect(pressed).toHaveText('copy');
});

/** How long an item's own node is given to follow a tap the echo already shows. */
const NODE_FOLLOWS_MS = 5_000;

async function itemSays(
  title: string,
  state: 'on' | 'off',
  why: string
): Promise<void> {
  await expect
    .poll(() => factsForItem(TOGGLES, title).checked, {
      timeout: NODE_FOLLOWS_MS,
      interval: 250,
      message: why,
    })
    .toBe(state);
}

test("one real tap per direction toggles one item once, and the item's own node says so", async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'buttongroup');
  const presses = screen.getByTestId('button-group-presses');
  const events = screen.getByTestId('button-group-toggle-events');
  const state = screen.getByTestId('button-group-toggle-state');

  // Each title is reached through its own named group: the disabled groups draw the
  // same titles as the live ones.
  for (const [label, title] of [
    [DISABLED_GROUP, 'Copy'],
    [DISABLED_ITEM, 'Cut'],
    [TOGGLES, 'Italic'],
    [TOGGLES, 'Bold'],
  ] as const) {
    const group = screen.getByLabel(label);
    await reveal(screen, group);
    expect(await group.boundingBox(), `"${label}" has no box`).not.toBeNull();
    expect(
      await group.getByText(title).count(),
      `"${label}" draws no item titled "${title}" inside its own box`
    ).toBe(1);
  }

  await expect(state).toHaveText('bold');
  await expect(events).toHaveText('0');
  await expect(screen.getByTestId('button-group-refused-last')).toHaveText(
    'none'
  );
  await expect(screen.getByTestId('button-group-refused-events')).toHaveText(
    '0'
  );
  await expect(screen.getByTestId('button-group-disabled-events')).toHaveText(
    '0'
  );
  itemAnnounces(TOGGLES, 'Bold', { checked: 'on' });
  itemAnnounces(TOGGLES, 'Italic', { checked: 'off' });

  const italic = screen.getByLabel(TOGGLES).getByText('Italic');
  await italic.tap();
  await expect(state).toHaveText('bold,italic');
  await expect(events).toHaveText('1');
  await itemSays('Italic', 'on', 'the "Italic" item never said it is checked');

  await italic.tap();
  await expect(state).toHaveText('bold');
  await expect(events).toHaveText('2');
  await itemSays(
    'Italic',
    'off',
    'the "Italic" item never followed the second tap'
  );
  await expect(presses).toHaveText('0');
});
