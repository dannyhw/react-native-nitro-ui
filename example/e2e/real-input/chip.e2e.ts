import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { openScreen, reveal } from './support';
import { actsOnOneNamedNode, treeAnnounces } from './reader';

const NAME = 'Real-input chip';

test('a real tap on a filter Chip reaches JS', async ({ app, screen }) => {
  await app.open();
  await openScreen(screen, 'chip');
  const chip = screen.getByLabel(NAME);
  const value = screen.getByTestId('real-input-chip-value');
  await reveal(screen, chip);

  // Compose puts a Chip’s name on a node inside the 48 dp clickable one, so “the tap
  // landed on the thing a reader named” is the part only a device can check.
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(value).toHaveText('off');
  treeAnnounces(NAME, { checked: 'off' });

  await chip.tap();
  await expect(value).toHaveText('on');
  treeAnnounces(NAME, { checked: 'on' });
});

test('a second tap deselects the Chip and its node follows, the assist Chip presses once, and a disabled Chip is disabled where a finger lands', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'chip');
  const chip = screen.getByLabel(NAME);
  const value = screen.getByTestId('real-input-chip-value');
  const events = screen.getByTestId('real-input-chip-events');
  await reveal(screen, chip);
  await expect(value).toHaveText('off');

  await chip.tap();
  await expect(value).toHaveText('on');
  await chip.tap();
  await expect(value).toHaveText('off');
  await expect(events).toHaveText('2');
  treeAnnounces(NAME, { checked: 'off' });

  const assist = screen.getByLabel('Real-input assist chip');
  await assist.tap();
  await expect(screen.getByTestId('real-input-chip-presses')).toHaveText('1');

  // The name sits on a node inside the 48 dp touch target, and only the target says
  // `enabled="false"`: the enabled twin is read the same way, so the reads can say true.
  treeAnnounces('Real-input disabled chip', { enabled: 'false' });
  treeAnnounces('Real-input disabled assist chip', { enabled: 'false' });
  treeAnnounces('Real-input assist chip', { enabled: 'true' });
});
