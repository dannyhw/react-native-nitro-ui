import { expect } from 'e2e';

import { test } from './fixture';
import { tree } from './os-tree';
import { centreOf, openScreen, reveal } from './support';

test('a real tap opens the alert, and an action inside it reaches JS', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'dialog');
  const opener = screen.getByTestId('dialog-open-alert');
  const log = screen.getByTestId('dialog-log');
  await reveal(screen, opener);

  // The window the Dialog presents is tagged `<testID>-dialog`, so the action is tapped
  // on the dialog rather than on whatever row of the page behind it says the same word:
  // a tap that reached the page would count for nothing here.
  await expect(log).toHaveText('none');
  await opener.tap();
  const dialog = screen.getByTestId('dialog-alert-dialog');
  await dialog.waitFor({ state: 'visible' });
  await dialog.getByText('Delete draft').tap();
  await expect(log).toContainText('action:delete');
  await dialog.waitFor({ state: 'detached' });
});

/** The alert's title, which appears nowhere else on the screen. */
const ALERT = 'Delete the draft?';

/** How long a disabled action is given to take the alert down by mistake. */
const STAYS_UP_MS = 1_500;

/**
 * `enabled` on the node a finger lands on for an action: the tightest `hittable` box of
 * the unmerged tree around the label's centre. The label's own text node says `true`
 * whether or not its action is enabled.
 */
function actionEnabled(text: string): string | null {
  const nodes = tree({ unmerged: true });
  // The driver prints a plain text node's words as its label, not as its text.
  const label = nodes.find(
    (node) => node.text === text || node.contentDesc === text
  );
  if (label == null) return null;
  const { cx, cy } = label.bounds;
  const owner = nodes
    .filter(
      (node) =>
        node.hittable === 'true' &&
        node.bounds.x1 <= cx &&
        cx <= node.bounds.x2 &&
        node.bounds.y1 <= cy &&
        cy <= node.bounds.y2
    )
    .sort(
      (a, b) =>
        a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height
    )[0];
  return owner?.enabled ?? null;
}

test("the alert's disabled action is disabled where a finger lands and takes no tap, and an action is reported before the close", async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'dialog');
  const opener = screen.getByTestId('dialog-open-alert');
  const log = screen.getByTestId('dialog-log');
  await reveal(screen, opener);
  await expect(log).toHaveText('none');

  await opener.tap();
  const dialog = screen.getByTestId('dialog-alert-dialog');
  await dialog.waitFor({ state: 'visible' });
  expect(actionEnabled('Locked action'), 'the disabled action').toBe('false');
  expect(actionEnabled('Delete draft'), 'the ordinary action').toBe('true');

  await screen.tapAt(await centreOf(dialog.getByText('Locked action')));
  await new Promise((resolve) => setTimeout(resolve, STAYS_UP_MS));
  expect(
    await screen.getByText(ALERT).count(),
    'a tap on the disabled action took the alert down'
  ).toBe(1);

  await dialog.getByText('Delete draft').tap();
  await dialog.waitFor({ state: 'detached' });
  await expect(log).toHaveText('action:delete > presented:false');
});

test('Back and a tap outside each close the alert with one close and no action', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'dialog');
  const opener = screen.getByTestId('dialog-open-alert');
  const log = screen.getByTestId('dialog-log');
  await reveal(screen, opener);
  const window = await screen.getByTestId('android:id/content').boundingBox();
  if (window == null) {
    throw new Error(
      'real-input: the content view has no box to aim outside of.'
    );
  }
  // Low in the window: the alert is centred, so this is the scrim.
  const outside = {
    x: Math.round(window.x + window.width / 2),
    y: Math.round(window.y + window.height * 0.8),
  };
  const dialog = screen.getByTestId('dialog-alert-dialog');

  await opener.tap();
  await dialog.waitFor({ state: 'visible' });
  await app.back();
  await dialog.waitFor({ state: 'detached' });

  await opener.tap();
  await dialog.waitFor({ state: 'visible' });
  await screen.tapAt(outside);
  await dialog.waitFor({ state: 'detached' });
  await expect(log).toHaveText('presented:false > presented:false');
});
