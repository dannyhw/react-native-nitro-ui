import { expect } from 'e2e';

import { test } from './fixture';
import { tree, type TreeNode } from './os-tree';
import { isInBand, openScreen, reveal } from './support';
import { actsOnOneNamedNode } from './reader';

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
  // a control that answered the tap at the wrong x is the failure here.
  await actsOnOneNamedNode(screen, { name: NAME, state: 'enabled' });
  await expect(index).toHaveText('-');

  const box = await control.boundingBox();
  if (box == null || !(await isInBand(screen, box))) {
    throw new Error(
      `real-input: the SegmentedControl has no box to aim at; it reads ${JSON.stringify(box)}.`
    );
  }
  await screen.tapAt({ x: box.x + box.width * 0.5, y: box.y + box.height / 2 });
  await expect(index).toHaveText('1');
});

/** Whether a node's centre lies inside another's box, to a pixel. */
function centreInside(node: TreeNode, other: TreeNode): boolean {
  return (
    node.bounds.cx >= other.bounds.x1 - 1 &&
    node.bounds.cx <= other.bounds.x2 + 1 &&
    node.bounds.cy >= other.bounds.y1 - 1 &&
    node.bounds.cy <= other.bounds.y2 + 1
  );
}

function boundsText(node: TreeNode): string {
  const { x1, y1, x2, y2 } = node.bounds;
  return `${String(x1)},${String(y1)}-${String(x2)},${String(y2)}`;
}

/** How long the segments' own nodes are given to follow a tap the echo already shows. */
const NODE_FOLLOWS_MS = 5_000;

function segmentsIn(
  nodes: TreeNode[]
): { items: TreeNode[]; radios: TreeNode[] } | null {
  const group = nodes.find(
    (node) => node.contentDesc === NAME && node.bounds.height > 0
  );
  if (group == null) return null;
  const insideGroup = (node: TreeNode): boolean =>
    node.bounds.x1 >= group.bounds.x1 - 1 &&
    node.bounds.x2 <= group.bounds.x2 + 1 &&
    node.bounds.y1 >= group.bounds.y1 - 1 &&
    node.bounds.y2 <= group.bounds.y2 + 1;
  const items = nodes
    .filter((node) => node.checkable === 'true' && insideGroup(node))
    .sort((a, b) => a.bounds.x1 - b.bounds.x1);
  const radios = nodes.filter(
    (node) =>
      node.className === 'android.widget.RadioButton' && insideGroup(node)
  );
  return { items, radios };
}

test('one real tap is one change, and each segment is a checkable item with a radio role and its own label', async ({
  app,
  screen,
}) => {
  await app.open();
  await openScreen(screen, 'segmented');
  const control = screen.getByLabel(NAME);
  const index = screen.getByTestId('real-input-segmented-index');
  const events = screen.getByTestId('real-input-segmented-events');
  await reveal(screen, control, { reads: [index, events] });
  await expect(events).toHaveText('0');

  const box = await control.boundingBox();
  if (box == null || !(await isInBand(screen, box))) {
    throw new Error(
      `real-input: the SegmentedControl has no box to aim at; it reads ${JSON.stringify(box)}.`
    );
  }
  await screen.tapAt({ x: box.x + box.width * 0.5, y: box.y + box.height / 2 });
  await expect(index).toHaveText('1');
  await expect(events).toHaveText('1');

  // Compose publishes a selectable segment as three entries at one box: the item,
  // checkable, which TalkBack reads as "selected"; the role, on its own RadioButton
  // node; and the label, a child TextView. Only the unmerged tree keeps all three.
  let nodes: TreeNode[] = [];
  await expect
    .poll(
      () => {
        nodes = tree({ unmerged: true });
        const read = segmentsIn(nodes);
        return read == null
          ? `no node named "${NAME}"`
          : read.items.map((item) => item.checked).join(',');
      },
      {
        timeout: NODE_FOLLOWS_MS,
        interval: 250,
        message: 'the segments never reported the selection the control has',
      }
    )
    .toBe('false,true,false');
  const read = segmentsIn(nodes);
  if (read == null) {
    throw new Error(
      `real-input: no node in the unmerged tree is named "${NAME}".`
    );
  }
  const { items, radios } = read;
  const seen =
    `items ${items.map(boundsText).join(' ')}; ` +
    `radios ${radios.map(boundsText).join(' ')}`;
  expect(items.length, `one checkable item per option: ${seen}`).toBe(3);
  expect(radios.length, `one radio node per option: ${seen}`).toBe(3);
  items.forEach((item, at) => {
    const label = String(at + 1);
    expect(
      radios.some((radio) => centreInside(radio, item)),
      `segment ${label} has no radio role at its box: ${seen}`
    ).toBe(true);
    // The driver prints a TextView's words as its label when it has no value, and the
    // tree read keeps a label as the description.
    expect(
      nodes.some(
        (node) =>
          (node.text === label || node.contentDesc === label) &&
          centreInside(node, item)
      ),
      `segment ${label} is not announced with its own label: ${seen}`
    ).toBe(true);
    expect(
      item.checked,
      `segment ${label} does not report the selection the control has (index 1)`
    ).toBe(at === 1 ? 'true' : 'false');
  });
});
