import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { boxOf, drag, openScreen, reveal, textOf } from './support';

test('a real long press opens the context menu at the finger and the view under it never fires', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'contextmenu');
  const target = screen.getByTestId('ctx-target');
  const order = screen.getByTestId('ctx-order');
  const echo = screen.getByTestId('ctx-echo');
  await reveal(screen, target);

  // Two claims, both gesture arbitration: the long press belongs to the
  // ContextMenu (`open`), and the Pressable underneath is left alone (`press=0`).
  // The echoes are read once the popup is gone, because while it is up the popup
  // owns the window and the page's own text is not in the tree a reader gets —
  // which is itself the proof that the menu took the gesture.
  await expect(order).toHaveText('order=');
  await target.longPress({ duration: 900 });
  const reply = screen.getByText('Reply');
  await reply.waitFor({ state: 'visible' });

  await reply.tap();
  await reply.waitFor({ state: 'detached' });
  await expect(order).toHaveText('order=open,select:reply,close');
  await expect(echo).toContainText('press=0;');
});

/** The `ctx-echo` line, as the numbers the ContextMenu screen counts. */
async function contextCounts(
  screen: Parameters<typeof textOf>[0]
): Promise<(key: string) => number> {
  const echo = await textOf(screen, 'ctx-echo');
  const counts = new Map(
    echo
      .split(';')
      .filter((part) => part.includes('='))
      .map((part) => {
        const [key, value] = part.split('=');
        return [String(key), Number(value)] as [string, number];
      })
  );
  return (key: string): number => {
    const value = counts.get(key);
    if (value == null || !Number.isFinite(value)) {
      throw new Error(
        `real-input: the ContextMenu echo has no "${key}" counter; it reads ` +
          `"${echo}". The screen counts what a person made it do, so a renamed ` +
          'counter is a check that stopped checking.'
      );
    }
    return value;
  };
}

test('a drag that starts on the trigger scrolls the page and opens nothing', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'contextmenu');
  const target = screen.getByTestId('ctx-target');
  await reveal(screen, target);
  const box = await boxOf(target);
  if (box == null) {
    throw new Error(
      'real-input: the ContextMenu target has no box to start a drag on.'
    );
  }

  // Gesture arbitration in the other direction from the long press: a finger that
  // travels belongs to the list, and the menu must not treat the travel as a hold.
  // Both halves are asserted because either alone can look clean — a page that
  // never scrolled and a menu that opened on a scroll.
  const before = await contextCounts(screen);
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await drag(screen, at, { x: at.x, y: at.y - 500 });
  const after = await contextCounts(screen);

  expect(
    after('scrollY'),
    `a drag that started on the trigger left the page at scrollY=` +
      `${String(after('scrollY'))} (it was ${String(before('scrollY'))}): the ` +
      'check below would pass on a page that never moved, which is how a menu that ' +
      'swallows scrolls hides'
  ).not.toBe(before('scrollY'));
  await expect(screen.getByTestId('ctx-order')).toHaveText('order=');
  expect(
    after('opens'),
    `a drag that started on the trigger opened the menu (opens went ` +
      `${String(before('opens'))} → ${String(after('opens'))}); a person who meant ` +
      'to scroll got a popup'
  ).toBe(before('opens'));

  // The hold that does belong to the control, in the same test so the two readings
  // cannot be made on different pages: stillness is what makes it a menu.
  await target.longPress({ duration: 900 });
  const reply = screen.getByText('Reply');
  await reply.waitFor({ state: 'visible' });
  expect(
    (await contextCounts(screen))('opens'),
    'a still hold on the trigger did not open the menu, so the drag above was ' +
      'refused for no reason at all'
  ).toBe(after('opens') + 1);
  await app.back();
  await reply.waitFor({ state: 'detached' });
});
