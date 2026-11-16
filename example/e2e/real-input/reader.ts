/**
 * The screen-reader rule, on the node a person actually acts on.
 *
 * This is the one class of check no in-app query can make: a hosted Compose
 * control publishes its name on a `SemanticsNode`, not on a React Native view,
 * so `host-controlled-value` can be read from inside the app while "which node
 * does TalkBack stop on, and what does it say about it" cannot. e2e reads the
 * same tree a screen reader walks, so the assertion lives here.
 *
 * The rule per control: the name a person is given resolves to exactly one node; that
 * node has a box a finger can hit; and the state a reader is told — enabled or
 * unavailable, checked or not — sits on that node and not on a neighbour.
 *
 * Whether the named node is one a person can *act* on is not read here: the driver's
 * node map has `hittable`, which says a touch lands, not that the node answers. That
 * half is graded against `uiautomator dump` in `scripts/real-input/a11y-sweep-device.mjs`.
 */
import { expect, type Locator, type Screen } from 'e2e';

import { factsForItem, screenReaderFacts } from './os-tree';

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
        String((error as Error)?.message ?? error)
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
  }
): Promise<void> {
  const named = screen.getByLabel(options.name);
  const count = await named.count();
  expect(
    count,
    `"${options.name}" is announced on ${String(count)} node(s); a person gets ` +
      (count === 0
        ? 'no node at all, so there is nothing to act on'
        : 'more than one, so a person hears the control twice and one of them may be inert')
  ).toBe(1);
  const box = await named.boundingBox();
  expect(
    box,
    `"${options.name}" has no box: a reader can stop on it but a finger cannot ` +
      'reach it - the named element can be inset inside the box a finger lands on'
  ).not.toBeNull();
  if (box != null) {
    expect(
      box.width > 0 && box.height > 0,
      `"${options.name}" is drawn at ${String(box.width)}x${String(box.height)}`
    ).toBe(true);
  }
  if (options.state != null) {
    expect(
      await readState(named, options.state),
      `"${options.name}" does not report "${options.state}" on the node a person ` +
        'acts on — a name on one node and a state on another is the defect this ' +
        'rule exists for'
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
  state: NodeState
): Promise<void> {
  const named = screen.getByLabel(name);
  expect(
    await readState(named, state),
    `after the gesture, "${name}" does not report "${state}" on the node a person ` +
      'acts on: the value moved somewhere the screen reader is not looking'
  ).toBe(true);
}

export { expect };

/**
 * What the tree itself says about the node a person acts on.
 *
 * The reader-facing state above is read through the driver's normalised snapshot,
 * which has no `checked`, `selected` or role on it — and the node carrying a hosted
 * control's name is not the node carrying its state. So this is a second, separate
 * claim: not "the reader is told the box is checked" but "the node that would
 * receive the tap says checked", which is the half that caught a toggle whose value
 * lived on a decoration node nobody could reach.
 *
 * A fact the tree cannot answer at all (`null`) is a failure, not a pass: a control
 * that stopped publishing its state would otherwise answer "checked: on" with
 * silence and read as a control that never claimed to be checked.
 */
export function treeAnnounces(
  name: string,
  expected: {
    checked?: 'on' | 'off';
    enabled?: 'true' | 'false';
    role?: string;
  }
): void {
  const facts = screenReaderFacts(name);
  if (expected.checked != null) {
    expect(
      facts.checked,
      `"${name}" is not "${expected.checked}" on the node that holds its state: ${facts.detail}`
    ).toBe(expected.checked);
  }
  if (expected.enabled != null) {
    expect(
      facts.enabled,
      `"${name}" is not enabled="${expected.enabled}" on the node a person can ` +
        `press: ${facts.detail}`
    ).toBe(expected.enabled);
  }
  if (expected.role != null) {
    expect(
      facts.roles,
      `"${name}" offers ${JSON.stringify(facts.roles)} as its Android role, which ` +
        `has no "${expected.role}" in it — a screen reader announces whatever class ` +
        `the state landed on instead: ${facts.detail}`
    ).toContain(expected.role);
  }
}

/**
 * The same facts for one item inside a named group.
 *
 * A merged row draws the item's title as a node of its own that carries no state,
 * so the title is only the place the search starts.
 */
export function itemAnnounces(
  groupLabel: string,
  title: string,
  expected: { checked?: 'on' | 'off'; enabled?: 'true' | 'false' }
): void {
  const facts = factsForItem(groupLabel, title);
  const said = `the "${title}" item of "${groupLabel}"`;
  if (expected.checked != null) {
    expect(
      facts.checked,
      `${said} is not "${expected.checked}" on its own node — the echo can say ` +
        `anything while the tree says this: ${facts.detail}`
    ).toBe(expected.checked);
  }
  if (expected.enabled != null) {
    expect(
      facts.enabled,
      `${said} is not enabled="${expected.enabled}" on its own node: ${facts.detail}`
    ).toBe(expected.enabled);
  }
}
