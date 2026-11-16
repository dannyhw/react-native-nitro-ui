import { test } from '@e2e-dev/mobile';
import { expect, type App, type Locator, type Screen } from 'e2e';

import { popupWindowCount } from './device-read';
import { openScreen, reveal } from './support';
import { actsOnOneNamedNode } from './reader';

const NAME = 'Real-input menu';
const SPLIT_ACTION = 'Real-input split menu';
const SPLIT_LIST = 'More options';

/** How long a popup window is given to reach the window manager, or to leave it. */
const WINDOW_SETTLES_MS = 8_000;

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
 * Dismiss whatever popup is up, without assuming how many Backs it takes; the ceiling is
 * what fails if the popup becomes undismisable. Each round asks with `waitFor`, not
 * `count` — `count` answers from the last observation, so a popup already down counts.
 */
async function dismissPopup(
  app: App,
  screen: Screen,
  row: RegExp,
  tries = 3
): Promise<void> {
  const gone = screen.getByText(row);
  for (let press = 0; press <= tries; press += 1) {
    const down = await gone
      .waitFor({ state: 'detached', timeout: DISMISS_SETTLE_MS })
      .then(
        () => true,
        () => false
      );
    if (down) return;
    if (press === tries) break;
    await app.back();
  }
  throw new Error(
    `real-input: the menu popup was still up after ${String(tries)} Backs.`
  );
}

/** How long one Back is given to bring the popup down, in ms. */
const DISMISS_SETTLE_MS = 2_500;

test('a real tap opens the Menu, a row reaches JS, and a disabled row takes nothing', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'menu');
  const trigger = screen.getByLabel(NAME);
  const pick = screen.getByTestId('real-input-menu-pick');
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

  // A real tap on a row Material draws as dimmed has to be swallowed by the row,
  // not by the test's own aim. `Menu.harness` asserts the refusal from inside
  // ("reports one onSelect per pick and nothing for a row that cannot be picked").
  await trigger.tap();
  const locked = screen.getByText('Locked row');
  await locked.waitFor({ state: 'visible' });
  await locked.tap();
  await dismissPopup(app, screen, /^Locked row$/);
  await expect(pick).toHaveText('alpha');
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
  expect(popupWindowCount(), 'the action half raised a window').toBe(0);
  await expect(echo).toHaveText('action');

  await list.tap();
  await popupsReach(1, 'a real tap on the list half opened no window');
  await app.back();
  await popupsReach(0, 'Back left the split list up');
  await expect(echo).toHaveText('action > open > close');
});
