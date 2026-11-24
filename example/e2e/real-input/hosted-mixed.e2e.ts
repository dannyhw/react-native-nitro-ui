import { expect } from 'e2e';

import { test } from './fixture';
import { tree } from './os-tree';
import { openScreen, reveal } from './support';
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

  // Four kinds in one composition: the switch, the slider and the button each have to be
  // named once and act on their own, or the composition has merged their semantics. The
  // echo is the one line all three write, so it proves which of them answered.
  await actsOnOneNamedNode(screen, { name: SWITCH, state: 'enabled' });
  await expect(state).toHaveText('off 0.50 0');

  await flipper.tap();
  await expect(state).toHaveText('on 0.50 0');

  // The line all four write carries which of them answered: the Button's own press has
  // to arrive, and the switch and slider have to stay where the last touch left them.
  await screen.getByLabel('Mixed button').tap();
  await expect(state).toHaveText('on 0.50 1');
});

test('in a Host of mixed controls the linear ones fill it and the intrinsic ones keep their own size', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'host');
  await reveal(screen, screen.getByLabel('Mixed button'));

  // The unmerged tree's boxes are the laid-out ones, clipped by nothing on screen.
  const nodes = tree({ unmerged: true });
  const boxOf = (name: string) => {
    const node = nodes.find(
      (candidate) =>
        candidate.contentDesc === name && candidate.bounds.width > 0
    );
    if (node == null) {
      throw new Error(`real-input: no node of the Host is named "${name}".`);
    }
    return node.bounds;
  };
  const slider = boxOf('Mixed slider');
  const linear = boxOf('Mixed linear progress');
  const circular = boxOf('Mixed circular progress');
  const flipper = boxOf(SWITCH);
  const widths = `slider ${String(slider.width)}, bar ${String(linear.width)}, indicator ${String(circular.width)}x${String(circular.height)}, switch ${String(flipper.width)} px`;

  expect(
    Math.abs(linear.width - slider.width) <= Math.max(8, linear.width * 0.05),
    `the bar is not as wide as the Slider: ${widths}`
  ).toBe(true);
  expect(
    circular.width * 3 < linear.width,
    `the indicator does not keep its own width: ${widths}`
  ).toBe(true);
  expect(
    Math.abs(circular.width - circular.height) <= 8,
    `the indicator is not drawn square: ${widths}`
  ).toBe(true);
  expect(
    flipper.width * 3 < linear.width,
    `the Switch does not keep its own width: ${widths}`
  ).toBe(true);
});
