import { test } from '@e2e-dev/mobile';
import { expect, type App, type Screen } from 'e2e';

import { openScreen, reveal } from './support';
import { actsOnOneNamedNode } from './reader';

const NAME = 'Real-input menu';

/**
 * Dismiss whatever popup is up, without assuming how many Backs it takes.
 *
 * FOLLOWUPS 62-63 is still open on exactly this: an Android menu that once needed
 * two dismissals after a disabled row was tapped. The count is not what this suite
 * is for and asserting one number would turn an unresolved question into a gate, so
 * the dismissal is a loop with a ceiling, and the ceiling is what fails if the
 * popup has become undismisable. Each round asks with `waitFor`, not `count`:
 * `count` answers from the observation the last step left behind and never
 * re-observes, so a popup that has already come down still counts, and the loop
 * spends its Backs on the page beneath and reports a popup that is not there.
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
