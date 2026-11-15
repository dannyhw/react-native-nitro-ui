import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';

import { openScreen, reveal } from './support';
import { namedNodes } from './os-tree';
import { actsOnOneNamedNode } from './reader';

const SWITCH = 'Mixed switch';

test('one Host of mixed controls still gives each its own node and its own tap', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'host');
  const flipper = screen.getByLabel(SWITCH);
  const state = screen.getByTestId('host-mixed-state');
  await reveal(screen, flipper);

  // Four kinds in one composition: the switch, the slider and the button each
  // have to be named once and act on their own, or the composition has merged
  // their semantics. The echo is the one line all three write, so it proves
  // which of them answered.
  await actsOnOneNamedNode(screen, { name: SWITCH, state: 'enabled' });
  await expect(state).toHaveText('off 0.50 0');

  await flipper.tap();
  await expect(state).toHaveText('on 0.50 0');

  // How wide each child *is* cannot be asked inside the app: a `fillWidth` child
  // answers with the Host's width whether or not it was drawn that wide, and one run
  // measured a circular indicator 0 px wide with every in-app answer still green. The
  // tree is what a person sees, so the two intrinsic children have to keep their own
  // width and the bar has to agree with the Slider it fills beside.
  const widthOf = (name: string): number =>
    namedNodes(name)[0]?.bounds.width ?? 0;
  const linear = widthOf('Mixed linear progress');
  const circular = widthOf('Mixed circular progress');
  const slider = widthOf('Mixed slider');
  expect(
    Math.abs(linear - slider) <= Math.max(8, linear * 0.05),
    `the linear bar is not as wide as the Slider it fills beside (${String(
      linear
    )} vs ${String(slider)} px)`
  ).toBe(true);
  expect(
    circular > 0 && circular * 3 < linear,
    `the circular indicator does not keep its own width (${String(circular)} of a ` +
      `${String(linear)} px Host) — it is being stretched across the row`
  ).toBe(true);
  const indicator = namedNodes('Mixed circular progress')[0];
  expect(
    indicator != null &&
      Math.abs(indicator.bounds.width - indicator.bounds.height) <= 8,
    `the circular indicator is not drawn as a square: ${
      indicator == null
        ? 'no node carries its name'
        : `${String(indicator.bounds.width)} x ${String(
            indicator.bounds.height
          )} px`
    }`
  ).toBe(true);
});
