/**
 * The screen-reader rule, on the node a person actually acts on: the name they are
 * given resolves to exactly one node, that node has a box a finger can hit, and the
 * state a reader is told sits on that node rather than on a neighbour.
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
        'acts on. A name on one node and a state on another is what this rule exists ' +
        'to catch'
    ).toBe(true);
  }
}

export { expect };

/**
 * What the tree itself says about the node a person acts on, as a claim separate from
 * what the reader is told: the driver’s normalised snapshot carries no `checked`,
 * `selected` or role, and a hosted control’s name is not on the node holding its state.
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
 * A merged row draws the item’s title as a node of its own that carries no state, so the
 * title is only the place the search starts.
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
