import { expect, type Locator, type Screen } from 'e2e';

import { test } from './fixture';
import { popupWindowCount } from './device-read';
import { centreOf, openScreen, reveal } from './support';

const MESSAGE = 'Tap the star to keep this search.';

/** How long a window opened by mistake would take to come up. */
const NOTHING_OPENS_MS = 800;

/** How long a closed tooltip's window is given to leave the window manager. */
const WINDOW_GONE_MS = 8_000;

async function popupsReach(count: number): Promise<void> {
  await expect
    .poll(() => popupWindowCount(), {
      timeout: WINDOW_GONE_MS,
      interval: 250,
      message: `the app's popup windows never reached ${String(count)}`,
    })
    .toBe(count);
}

/** A tap on the star, confirmed by its own count, that must open nothing. */
async function tapStarOpensNothing(
  screen: Screen,
  presses: string,
  log: Locator,
  logBefore: string
): Promise<void> {
  await screen.getByTestId('tooltip-anchor').tap();
  await expect(screen.getByTestId('tooltip-anchor-presses')).toHaveText(
    presses
  );
  await new Promise((resolve) => setTimeout(resolve, NOTHING_OPENS_MS));
  expect(popupWindowCount(), 'a tap on the anchor opened a window').toBe(0);
  await expect(screen.getByText(MESSAGE)).toHaveCount(0);
  await expect(log).toHaveText(logBefore);
}

test('a real tap opens the tooltip, its action is reported before the close, and the anchor stays its own', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'tooltip');
  const opener = screen.getByTestId('tooltip-open-rich');
  const log = screen.getByTestId('tooltip-log');
  await reveal(screen, opener);

  // The tooltip is presented in a window of its own (`tooltip-rich-tooltip`), so the
  // action is tapped inside it: a tap that reached the page behind would count for
  // nothing here, and the log line is JS's own record of what the press did.
  await expect(log).toHaveText('none');
  await opener.tap();
  const tip = screen.getByTestId('tooltip-rich-tooltip');
  await tip.waitFor({ state: 'visible' });
  expect(popupWindowCount()).toBe(1);
  await expect(tip.getByText('Saved searches')).toHaveCount(1);
  await expect(tip.getByText('Got it')).toHaveCount(1);
  await tip.getByText('Got it').tap();
  await tip.waitFor({ state: 'detached' });
  await popupsReach(0);
  await expect(log).toHaveText('action:ok > presented:false');

  // Once it is closed, the star under it is an ordinary Pressable again.
  await tapStarOpensNothing(
    screen,
    'star presses: 1',
    log,
    'action:ok > presented:false'
  );
});

test('a tap on the anchor of a closed tooltip opens nothing, and a tap outside or Back closes it once', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'tooltip');
  const opener = screen.getByTestId('tooltip-open-rich');
  const log = screen.getByTestId('tooltip-log');
  const tip = screen.getByTestId('tooltip-rich-tooltip');
  await reveal(screen, opener);

  await expect(log).toHaveText('none');
  expect(popupWindowCount(), 'a tooltip is up before a touch').toBe(0);
  await tapStarOpensNothing(screen, 'star presses: 1', log, 'none');

  // Outside is the log line, a `Text` with no press of its own, aimed at where it was
  // before the tooltip took the tree: a fixed point on the screen could land on a tab.
  const outside = await centreOf(log);
  await opener.tap();
  await tip.waitFor({ state: 'visible' });
  await screen.tapAt(outside);
  await tip.waitFor({ state: 'detached' });
  await popupsReach(0);
  await expect(log).toHaveText('presented:false');

  // Back closes a tooltip with an action: Material makes that one focusable.
  await opener.tap();
  await tip.waitFor({ state: 'visible' });
  await app.back();
  await tip.waitFor({ state: 'detached' });
  await popupsReach(0);
  await expect(log).toHaveText('presented:false > presented:false');
});
