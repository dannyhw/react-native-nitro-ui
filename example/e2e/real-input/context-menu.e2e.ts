import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { openScreen, reveal } from './support';

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
