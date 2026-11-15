/**
 * The screen-reader rule, on the node a person actually acts on.
 *
 * This is the one class of check no in-app query can make: a hosted Compose
 * control publishes its name on a `SemanticsNode`, not on a React Native view,
 * so `host-controlled-value` can be read from inside the app while "which node
 * does TalkBack stop on, and what does it say about it" cannot. e2e reads the
 * same tree a screen reader walks, so the assertion lives here.
 *
 * The rule per control: the name a person is given resolves to exactly one node;
 * that node has a box a finger can hit; and the state a reader is told — enabled
 * or unavailable, checked or not — sits on that node rather than on a neighbour.
 * Five of the real defects this suite ever caught came in through this rule
 * (audit A.1: G15, G16, G23, G24, G31), every one of them a name on one node and
 * a state on another, or a duplicate of the same control.
 *
 * What this file deliberately does *not* assert: whether the named node is
 * marked actionable. `A11Y_EXEMPTIONS` in `scripts/real-input/a11y.mjs` carries
 * five Android rows — slider, segmented-control, stepper, hosted-slider,
 * hosted-segmented — whose reason is that the merged control's `RangeInfo` node
 * is not marked clickable in a `uiautomator dump` while the control answers a
 * real touch. That is the table's own debt to renegotiate, and this brief does
 * not touch its contents. So the suite proves these five controls by *touching*
 * them (their own test file drags or taps them and reads the echo) and proves
 * their name, box and value here, and asks nothing of the actionable flag.
 */
import { expect, type Locator, type Screen } from 'e2e';

/** The state a reader is told about the node, read off that node. */
export type NodeState = 'enabled' | 'disabled' | 'checked' | 'unchecked';

/** Read one state, keeping the driver's own reason when the node has none. */
async function readState(node: Locator, state: NodeState): Promise<boolean> {
  try {
    switch (state) {
      case 'enabled':
        return await node.isEnabled();
      case 'disabled':
        return await node.isDisabled();
      case 'checked':
        return await node.isChecked();
      case 'unchecked':
        return !(await node.isChecked());
    }
  } catch (error) {
    throw new Error(
      `a reader is told the node is ${state}; reading it back failed: ` +
        String((error as Error)?.message ?? error),
    );
  }
}

/**
 * The node a person acts on, and the state they are told about it.
 *
 * @param options.name the accessible label the control publishes
 * @param options.state the state that node has to report, before the gesture
 * @param options.after the state the same node reports once the gesture landed
 */
export async function actsOnOneNamedNode(
  screen: Screen,
  options: {
    name: string;
    state?: NodeState;
  },
): Promise<void> {
  const named = screen.getByLabel(options.name);
  const count = await named.count();
  expect(
    count,
    `"${options.name}" is announced on ${String(count)} node(s); a person gets ` +
      (count === 0
        ? 'no node at all, so there is nothing to act on'
        : 'more than one, which is the duplicate-node defect (G15 Android: a labelled checkbox was two nodes, one inert)'),
  ).toBe(1);
  const box = await named.boundingBox();
  expect(
    box,
    `"${options.name}" has no box: a reader can stop on it but a finger cannot ` +
      'reach it (G23 iOS: a VoiceOver element inset inside its own target)',
  ).not.toBeNull();
  if (box != null) {
    expect(
      box.width > 0 && box.height > 0,
      `"${options.name}" is drawn at ${String(box.width)}x${String(box.height)}`,
    ).toBe(true);
  }
  if (options.state != null) {
    expect(
      await readState(named, options.state),
      `"${options.name}" does not report "${options.state}" on the node a person ` +
        'acts on — a name on one node and a state on another is the defect this ' +
        'rule exists for',
    ).toBe(true);
  }
}

/**
 * The same node, after the gesture: what the reader is told changed with it.
 *
 * Split out from {@link actsOnOneNamedNode} because a check that reads the state
 * once cannot tell "the tree says checked" from "the tree says checked *and says
 * it changed*", and only the second is the regression guard.
 */
export async function nodeReports(
  screen: Screen,
  name: string,
  state: NodeState,
): Promise<void> {
  const named = screen.getByLabel(name);
  expect(
    await readState(named, state),
    `after the gesture, "${name}" does not report "${state}" on the node a person ` +
      'acts on: the value moved somewhere the screen reader is not looking',
  ).toBe(true);
}

export { expect };
