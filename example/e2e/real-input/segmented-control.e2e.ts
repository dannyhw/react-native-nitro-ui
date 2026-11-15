import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { isInBand, openScreen, reveal } from './support';
import { actsOnOneNamedNode, groupAnnounces } from './reader';

const NAME = 'Real-input segmented control';

test('a real tap selects the segment under the finger', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'segmented');
  const control = screen.getByLabel(NAME);
  const index = screen.getByTestId('real-input-segmented-index');
  await reveal(screen, control);

  // Three options ('1', '2', '3'), so the middle of the control's box is the
  // segment drawn '2' and the index JS reports has to be 1, not merely "not 0":
  // a control that answered the tap at the wrong x is the failure here (E1 read
  // a corner probe late and passed for the wrong reason).
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(index).toHaveText('-');
  // One node per option, one radio role per option, one option holding the
  // selection: what a TalkBack swipe through the group is offered.
  groupAnnounces(NAME, { role: 'android.widget.RadioButton', options: 3 });

  const box = await control.boundingBox();
  if (box == null || !(await isInBand(screen, box))) {
    throw new Error(
      `real-input: the SegmentedControl has no box to aim at; it reads ${JSON.stringify(box)}.`
    );
  }
  await screen.tapAt({ x: box.x + box.width * 0.5, y: box.y + box.height / 2 });
  await expect(index).toHaveText('1');
  // The selection moved onto the segment the finger is on, and off the two it
  // was not — a group that left two rows claiming it tells nobody where they are.
  groupAnnounces(NAME, { role: 'android.widget.RadioButton', options: 3 });
});
