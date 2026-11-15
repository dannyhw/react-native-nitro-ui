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

  // Two claims, and both are gesture arbitration: the long press belongs to the
  // ContextMenu (open), and the Pressable underneath must be left alone (press=0).
  // G16's recycled wrapper label and the red proof that a non-accessible wrapper
  // offered TalkBack a long-click are the a11y half of this row, kept in the same
  // shape the driver had: the echo is read, not inferred.
  await expect(order).toHaveText('order=');
  await target.longPress({ duration: 900 });
  const opened = screen.getByText('Reply');
  await opened.waitFor({ state: 'visible' });
  await expect(order).toHaveText('order=open');
  await expect(echo).toContainText('press=0;');

  await opened.tap();
  await expect(order).toHaveText('order=open,select:reply,close');
  await expect(echo).toContainText('press=0;');
});
