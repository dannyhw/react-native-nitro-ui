import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { nativeChecked } from '../../../scripts/real-input/android-tree.mjs';
import { tree } from './os-tree';
import { openScreen, reveal } from './support';
import { actsOnOneNamedNode } from './reader';

const NAME = 'Real-input icon button';
const TOGGLE = 'Real-input toggle icon button';

/** How long the toggle's own node is given to follow a tap the echo already shows. */
const NODE_FOLLOWS_MS = 5_000;

/**
 * `checked` on the tightest checkable node around the toggle's name, in the tree the
 * platform serves: the merged read can fold the role node into its parent.
 */
function toggleChecked(): 'on' | 'off' | null {
  return nativeChecked(tree({ unmerged: true }), TOGGLE);
}

async function toggleNodeSays(state: 'on' | 'off', why: string): Promise<void> {
  await expect
    .poll(toggleChecked, {
      timeout: NODE_FOLLOWS_MS,
      interval: 250,
      message: why,
    })
    .toBe(state);
}

test('a real tap on the icon Button reaches JS once', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'iconbutton');
  const press = screen.getByLabel(NAME);
  const presses = screen.getByTestId('real-input-icon-button-presses');
  await reveal(screen, press);

  // A reader's element can sit inset inside the box a finger lands on, so the name,
  // the box and the report are read on the one node both actors use.
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(presses).toHaveText('0');

  await press.tap();
  await expect(presses).toHaveText('1');
});

test('two real taps on the press button are two presses, and move no toggle and no disabled form', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'iconbutton');
  const press = screen.getByLabel(NAME);
  const presses = screen.getByTestId('real-input-icon-button-presses');
  const value = screen.getByTestId('real-input-icon-button-value');
  const events = screen.getByTestId('real-input-icon-button-events');
  const refusedLast = screen.getByTestId('real-input-icon-button-refused-last');
  const refusedEvents = screen.getByTestId(
    'real-input-icon-button-refused-events'
  );
  const disabledEvents = screen.getByTestId(
    'real-input-icon-button-disabled-events'
  );

  for (const form of [
    'Real-input disabled icon button',
    'Real-input disabled toggle icon button',
  ]) {
    await reveal(screen, screen.getByLabel(form));
  }
  await reveal(screen, press);
  await expect(value).toHaveText('off');
  await expect(events).toHaveText('0');
  await expect(refusedLast).toHaveText('none');
  await expect(refusedEvents).toHaveText('0');
  await expect(disabledEvents).toHaveText('0');

  // Exact counts, not "at least": a press that fires twice per tap is the failure.
  await press.tap();
  await expect(presses).toHaveText('1');
  await press.tap();
  await expect(presses).toHaveText('2');
  await expect(value).toHaveText('off');
  await expect(events).toHaveText('0');
});

test('one real tap per direction checks and unchecks the toggle, its own node says so, and it is not a press', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'iconbutton');
  const toggle = screen.getByLabel(TOGGLE);
  const presses = screen.getByTestId('real-input-icon-button-presses');
  const value = screen.getByTestId('real-input-icon-button-value');
  const events = screen.getByTestId('real-input-icon-button-events');
  await reveal(screen, toggle);
  await actsOnOneNamedNode(screen, { name: TOGGLE });
  await expect(value).toHaveText('off');
  expect(toggleChecked(), 'the toggle is checked before a touch').toBe('off');

  await toggle.tap();
  await expect(value).toHaveText('on');
  await expect(events).toHaveText('1');
  await toggleNodeSays(
    'on',
    "the toggle's own node never said what the echo says"
  );

  await toggle.tap();
  await expect(value).toHaveText('off');
  await expect(events).toHaveText('2');
  await toggleNodeSays(
    'off',
    "the toggle's own node never followed the second tap"
  );
  await expect(presses).toHaveText('0');
});
