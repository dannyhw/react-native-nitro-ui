import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { popupWindowCount } from './device-read';
import { boxOf, drag, openScreen, reveal, textOf } from './support';
import { actsOnOneNamedNode, itemAnnounces } from './reader';

const NAME = 'Real-input picker';
const RADIO = 'Real-input radio picker';
const RADIO_LOCKED = 'Real-input disabled radio picker';

/** How long a window opened by mistake would take to come up. */
const NOTHING_OPENS_MS = 800;

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

test('a real tap opens the Picker and a real tap on a row reports it', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'picker');
  const trigger = screen.getByLabel(NAME);
  const index = screen.getByTestId('real-input-picker-index');
  await reveal(screen, trigger);

  // The menu is an Android popup with no resource-id of its own, so its rows are
  // reached by the text a person reads. The refused selection and the unmount
  // while open are the harness's: `Picker.harness` and `HostPopups`.
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(index).toHaveText('-');

  await trigger.tap();
  await screen.getByText('Quartz').tap();
  await expect(index).toHaveText('1');
});

test('a wheel drum inside a side-scroller keeps the drags it owns', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'picker');
  // Asking a hosted node where it is inside a scroller asks the driver to scroll a
  // composition into view, which never settles. The two React Native nodes either side
  // of it are honest, so the drum is aimed at between them and the tail says where.
  const row = screen.getByTestId('real-input-wheel-scroller-row');
  const tail = screen.getByTestId('real-input-wheel-scroller-tail');
  const echo = screen.getByTestId('real-input-scroller-index');
  await reveal(screen, row);
  const rowBox = await boxOf(row);
  const atRest = await boxOf(tail);
  if (rowBox == null || atRest == null) {
    throw new Error(
      `real-input: the side-scroller row has no box to aim at; the row reads ` +
        `${JSON.stringify(rowBox)} and its tail ${JSON.stringify(atRest)}.`
    );
  }

  // The drum is the row's first child, so it runs from the row's left edge to the
  // tail's, and those two edges give a centre no hosted box has to be trusted for.
  const centre = {
    x: (rowBox.x + atRest.x) / 2,
    y: rowBox.y + rowBox.height / 2,
  };

  // A vertical drag belongs to the drum even though a scroller ancestor could take
  // it: if the page eats the roll, the index never moves.
  await drag(screen, centre, { x: centre.x, y: centre.y - 220 });
  // A drum reports once it has settled on a row, not under the finger, so the roll
  // is awaited; reading the echo straight away races the snap.
  await expect(echo).not.toHaveText('-');
  const rolled = await textOf(screen, 'real-input-scroller-index');
  expect(
    rolled,
    'a vertical drag rolled nothing: the scroller above the drum kept the ' +
      'gesture, and a fling that only scrolled the page is the failure here'
  ).not.toBe('-');

  // A sideways drag belongs to the scroller: the drum hands its disallowIntercept
  // back on the first sideways move (`nuiOwnVerticalDrags`), so the row slides and the
  // drum stays put, which is the tail moving left.
  await drag(screen, centre, { x: centre.x - 260, y: centre.y });
  const afterSwipe = await boxOf(tail);
  expect(
    afterSwipe != null && atRest.x - afterSwipe.x > 20,
    `a sideways swipe left the scroller where it was: the drum kept a gesture ` +
      `that belongs to the row (the tail ran ${String(atRest.x)} → ` +
      `${String(afterSwipe?.x)} px)`
  ).toBe(true);
  // And it stays where it was: a sideways gesture the drum kept would land on
  // another row, and the report arrives late rather than not at all.
  await expect(echo).toHaveText(rolled);
});

test('the menu is a popup window: Back closes it, and the row already chosen closes it with no report', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'picker');
  const anchor = screen.getByLabel(NAME);
  const events = screen.getByTestId('real-input-picker-events');
  await reveal(screen, anchor);

  await anchor.tap();
  await popupsReach(1, 'a real tap on the anchor opened no popup window');
  await app.back();
  await popupsReach(0, 'Back left the popup window up');

  // While the popup is up it owns the tree, so the row is the only 'Onyx' there is.
  await anchor.tap();
  await popupsReach(1, 'a second tap on the anchor opened no popup window');
  const onyx = screen.getByText('Onyx');
  await onyx.waitFor({ state: 'visible' });
  await onyx.tap();
  await popupsReach(0, 'a tap on the row already chosen left the menu up');
  await expect(events).toHaveText('0');
});

test("the radio group's rows are the control: a real tap picks one, opens no window, and only that row says checked", async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'picker');
  const group = screen.getByLabel(RADIO);
  const index = screen.getByTestId('real-input-radio-index');
  const events = screen.getByTestId('real-input-radio-events');
  const locked = screen.getByLabel(RADIO_LOCKED);
  await reveal(screen, group, { reads: [index, events, locked] });
  await expect(index).toHaveText('-');
  expect(popupWindowCount(), 'a window is up before a touch').toBe(0);

  await group.getByText('Obsidian').tap();
  await expect(index).toHaveText('2');
  await expect(events).toHaveText('1');
  expect(popupWindowCount(), 'a tap on a radio row opened a window').toBe(0);
  for (const row of ['Basalt', 'Flint', 'Obsidian']) {
    itemAnnounces(RADIO, row, {
      checked: row === 'Obsidian' ? 'on' : 'off',
      enabled: 'true',
    });
  }

  for (const row of ['Gabbro', 'Peridot', 'Scoria']) {
    itemAnnounces(RADIO_LOCKED, row, { enabled: 'false' });
  }
  expect(
    await locked.getByText('Peridot').boundingBox(),
    'the disabled group draws no "Peridot" row to aim at'
  ).not.toBeNull();
});

test('a real tap on the disabled Picker opens nothing where the enabled one opens a window, and each is one node', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'picker');
  const lockedName = 'Real-input disabled picker';
  const enabledName = 'Real-input enabled picker';
  const locked = screen.getByLabel(lockedName);
  const enabled = screen.getByLabel(enabledName);
  await reveal(screen, locked, { reads: [enabled] });
  await actsOnOneNamedNode(screen, { name: lockedName, state: 'disabled' });

  await locked.tap();
  await new Promise((resolve) => setTimeout(resolve, NOTHING_OPENS_MS));
  expect(
    popupWindowCount(),
    'a tap on the disabled Picker opened a window'
  ).toBe(0);

  // The same tap on the enabled twin is what makes the line above a refusal.
  await enabled.tap();
  await popupsReach(1, 'a real tap on the enabled Picker opened no window');
  await app.back();
  await popupsReach(0, "Back left the enabled Picker's window up");

  // One node carries the name, the value it shows, and the role of a list of choices.
  await actsOnOneNamedNode(screen, { name: enabledName, state: 'enabled' });
  await expect(enabled).toHaveText('Mica');
  await expect(screen.getByRole('combobox', { name: enabledName })).toHaveCount(
    1
  );
});
