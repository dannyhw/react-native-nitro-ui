import { test } from '@e2e-dev/mobile';
import { expect, type Locator, type Screen } from 'e2e';

import { popupWindowCount } from './device-read';
import { openScreen, reveal, type Point } from './support';
import { actsOnOneNamedNode } from './reader';

const NAME = 'Real-input menu';
const SPLIT_ACTION = 'Real-input split menu';
const SPLIT_LIST = 'More options';

/** How long a popup window is given to reach the window manager, or to leave it. */
const WINDOW_SETTLES_MS = 8_000;

/** How long a window opened by mistake would take to come up. */
const NOTHING_OPENS_MS = 800;

/** How far outside the popup's own window an outside tap aims, in device px. */
const OUTSIDE_MARGIN_PX = 12;

async function popupsReach(count: number, why: string): Promise<void> {
  await expect
    .poll(() => popupWindowCount(), {
      timeout: WINDOW_SETTLES_MS,
      interval: 250,
      message: why,
    })
    .toBe(count);
}

/**
 * A point outside the open popup that lies on nothing: the page's own padding beside the
 * trigger, above the popup anchored under it. Read it before the popup goes up, because an
 * open popup owns the window and the page's nodes leave the tree until it is down.
 */
async function besideThePopup(trigger: Locator): Promise<Point> {
  const box = await trigger.boundingBox();
  if (box == null) {
    throw new Error(
      'real-input: the Menu trigger has no box to aim a tap beside.'
    );
  }
  return {
    x: Math.max(2, box.x - OUTSIDE_MARGIN_PX),
    y: box.y + box.height / 2,
  };
}

/**
 * The row a reader is told about, rather than the words drawn inside it: a row's own node
 * is the one that carries its state — `disabled` among them — and `getByText` resolves to
 * the text Material draws inside that node.
 */
async function rowOf(screen: Screen, title: string): Promise<Locator> {
  const words = await screen.getByText(title).boundingBox();
  if (words == null) {
    throw new Error(`real-input: the "${title}" row has no box to look for.`);
  }
  for (const row of await screen.getByRole('button').all()) {
    const box = await row.boundingBox();
    if (
      box != null &&
      box.x <= words.x &&
      box.y <= words.y &&
      box.x + box.width >= words.x + words.width &&
      box.y + box.height >= words.y + words.height
    ) {
      return row;
    }
  }
  throw new Error(
    `real-input: no button's box holds the "${title}" row, so its words are drawn ` +
      'somewhere a person cannot press as a row.'
  );
}

test('a real tap opens the Menu, a row reaches JS, and a disabled row takes nothing', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'menu');
  const trigger = screen.getByLabel(NAME);
  const pick = screen.getByTestId('real-input-menu-pick');
  const events = screen.getByTestId('real-input-menu-events');
  await reveal(screen, trigger);

  // Menu keeps more of its old check than the other controls, for the reason above.
  // The echoes are read with the popup down: while it is up, it owns the window and
  // the page's own text is not in the tree a reader gets.
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(pick).toHaveText('-');

  await trigger.tap();
  const alpha = screen.getByText('Alpha');
  await alpha.waitFor({ state: 'visible' });
  await alpha.tap();
  await alpha.waitFor({ state: 'detached' });
  await expect(pick).toHaveText('alpha');
  await expect(events).toHaveText('open > select alpha > close');

  await trigger.tap();
  const locked = screen.getByText('Locked row');
  await locked.waitFor({ state: 'visible' });
  // The tap below aims at a row the tree itself calls disabled, beside one it calls
  // enabled: a reader is told what a finger finds out by pressing.
  expect(
    await (await rowOf(screen, 'Alpha')).isEnabled(),
    'the enabled row of an open menu does not report itself enabled'
  ).toBe(true);
  expect(
    await (await rowOf(screen, 'Locked row')).isDisabled(),
    'the disabled row of an open menu does not report itself disabled: a person is ' +
      'offered a row that will not answer'
  ).toBe(true);
  // A row Material draws as dimmed swallows its own press and the menu stays up;
  // `Menu.harness` asserts the refusal from inside the control.
  await locked.tap();
  await new Promise((resolve) => setTimeout(resolve, NOTHING_OPENS_MS));
  expect(
    popupWindowCount(),
    'the tap on the disabled row took the popup down by itself'
  ).toBe(1);

  // One Back brings it down: the press that answered nothing leaves one dismissal owed.
  await app.back();
  await popupsReach(
    0,
    'the popup stood through the Back that followed a disabled-row tap'
  );
  await expect(pick).toHaveText('alpha');
  // One open, one close: the disabled row reported neither a pick nor a close.
  await expect(events).toHaveText('open > select alpha > close > open > close');
});

test('one tap outside closes the menu after a tap on its disabled row', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'menu');
  const trigger = screen.getByLabel(NAME);
  const pick = screen.getByTestId('real-input-menu-pick');
  const events = screen.getByTestId('real-input-menu-events');
  await reveal(screen, trigger);
  await expect(pick).toHaveText('-');

  // Read while the page is still readable: the popup that is about to open owns the
  // window, and a point outside it has to be aimed before it is up.
  const outside = await besideThePopup(trigger);
  await trigger.tap();
  const locked = screen.getByText('Locked row');
  await locked.waitFor({ state: 'visible' });
  await locked.tap();
  await new Promise((resolve) => setTimeout(resolve, NOTHING_OPENS_MS));
  expect(
    popupWindowCount(),
    'the tap on the disabled row took the popup down by itself'
  ).toBe(1);

  await screen.tapAt(outside);
  await popupsReach(
    0,
    'the popup stood through the tap outside that followed a disabled-row tap'
  );
  await expect(pick).toHaveText('-');
  // The one dismissal the open owed, and no pick.
  await expect(events).toHaveText('open > close');
});

test("the trigger is one Spinner node showing its title, and the split trigger's halves are a press and a list", async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'menu');
  const trigger = screen.getByLabel(NAME);
  await reveal(screen, trigger);
  await expect(trigger).toHaveText('Actions');
  await expect(screen.getByRole('combobox', { name: NAME })).toHaveCount(1);

  // The halves of one control share a vertical band, so the band is what pairs the
  // list half with the action half: other split triggers on the page are named alike.
  const action = screen.getByLabel(SPLIT_ACTION);
  const echo = screen.getByTestId('real-input-menu-split-events');
  await reveal(screen, action, { reads: [echo] });
  const actionBox = await action.boundingBox();
  if (actionBox == null) {
    throw new Error(`real-input: "${SPLIT_ACTION}" has no box to aim at.`);
  }
  let list: Locator | null = null;
  for (const half of await screen.getByLabel(SPLIT_LIST).all()) {
    const box = await half.boundingBox();
    if (
      box != null &&
      Math.abs(box.y - actionBox.y) <= 1 &&
      Math.abs(box.y + box.height - (actionBox.y + actionBox.height)) <= 1 &&
      box.x + box.width > actionBox.x
    ) {
      list = half;
      break;
    }
  }
  if (list == null) {
    throw new Error(
      `real-input: no "${SPLIT_LIST}" half shares the band of "${SPLIT_ACTION}".`
    );
  }

  // The action half has no window to answer with: the echo is the only witness that
  // it is a press and not a second way to open the list.
  await expect(echo).toHaveText('none');
  await action.tap();
  await expect(echo).toHaveText('action');
  await new Promise((resolve) => setTimeout(resolve, NOTHING_OPENS_MS));
  expect(popupWindowCount(), 'the action half raised a window').toBe(0);
  await expect(echo).toHaveText('action');

  await list.tap();
  await popupsReach(1, 'a real tap on the list half opened no window');
  await app.back();
  await popupsReach(0, 'Back left the split list up');
  await expect(echo).toHaveText('action > open > close');
});
