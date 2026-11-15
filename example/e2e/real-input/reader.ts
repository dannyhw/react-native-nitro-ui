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
 * The actionable flag is part of the rule, and the five controls whose Android
 * node is not marked actionable (the `RangeInfo` and plain-`View` rows of
 * `A11Y_EXEMPTIONS` in `scripts/real-input/a11y.mjs`) are exempted *by that table*,
 * one row at a time, so every other control keeps the claim and a row that stops
 * matching goes red. The exemption is reported as a printed finding rather than
 * silently dropped: an exempted control passes, and the line says it passes on the
 * debt row, not on the tree.
 *
 * That is the rule the a11y sweep runs, read here at the moment a person is about
 * to act — `ruleFindings` calls into `a11y.mjs` rather than restating it — so a
 * slid or duplicated name is caught before the gesture that would otherwise have
 * looked like the control's problem.
 */
import { expect, type Locator, type Screen } from 'e2e';

import {
  factsForItem,
  factsForText,
  groupFacts,
  ruleFindings,
  screenReaderFacts,
} from './os-tree';

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
        : 'more than one, which is the duplicate-node defect (G15 Android: a labelled checkbox was two nodes, one inert)')
  ).toBe(1);
  const box = await named.boundingBox();
  expect(
    box,
    `"${options.name}" has no box: a reader can stop on it but a finger cannot ` +
      'reach it (G23 iOS: a VoiceOver element inset inside its own target)'
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

  // The tree's own answer, which the driver's normalised snapshot cannot give: is
  // the node carrying the name one a person can act on. Recorded debt prints;
  // anything the exemption table does not name is a failure, which is what keeps
  // the table from becoming a place findings move to.
  const findings = ruleFindings(options.name);
  for (const problem of findings.known) {
    console.log(`    WARN recorded debt: ${problem}`);
  }
  expect(
    findings.failures,
    'the accessibility tree does not put this control where a person can act on it'
  ).toEqual([]);
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
 * A control that is a group of options, read one node per option.
 *
 * `role` is the Android class the option's role has to reach the tree as, and the
 * counts are the claim: one node per option carrying the selection, one role node
 * per option, and exactly one option holding it.
 */
export function groupAnnounces(
  name: string,
  options: { role: string; options: number }
): void {
  const facts = groupFacts(name, options.role);
  expect(
    facts.items.length,
    `"${name}" publishes ${String(facts.items.length)} node(s) that carry a ` +
      `selection for ${String(options.options)} options — a person who asks for ` +
      'the next option gets an option that is not there'
  ).toBe(options.options);
  expect(
    facts.roles.length,
    `"${name}" publishes ${String(facts.roles.length)} "${options.role}" node(s) ` +
      `for ${String(options.options)} options — the rest are announced as whatever ` +
      'class they happen to be'
  ).toBe(options.options);
  expect(
    facts.selected,
    `"${name}" has ${String(facts.selected)} option(s) claiming the selection; ` +
      'exactly one may, or a screen reader cannot say where the finger is'
  ).toBe(1);
}

/**
 * The same facts, for a control the tree names with words instead of a label.
 *
 * A dialog action and a radio row are Compose rows: the words are a child of the
 * node holding the state, and that child reports the same thing whether the row is
 * disabled or not. `flag` says which node is the row's — the clickable one for an
 * action, the checkable one for a selectable row.
 */
export function textAnnounces(
  text: string,
  expected: {
    checked?: 'on' | 'off';
    enabled?: 'true' | 'false';
    role?: string;
    flag?: 'checkable' | 'clickable';
  }
): void {
  const facts = factsForText(text, expected.flag ?? 'clickable');
  const said = `the node behind "${text}"`;
  if (expected.checked != null) {
    expect(
      facts.checked,
      `${said} is not "${expected.checked}": ${facts.detail}`
    ).toBe(expected.checked);
  }
  if (expected.enabled != null) {
    expect(
      facts.enabled,
      `${said} is not enabled="${expected.enabled}" — a person is offered a ` +
        `press here either way: ${facts.detail}`
    ).toBe(expected.enabled);
  }
  if (expected.role != null) {
    expect(
      facts.role,
      `${said} reaches the tree as "${String(facts.role)}", not as ` +
        `"${expected.role}" — a screen reader announces the wrong kind of control ` +
        `here: ${facts.detail}`
    ).toBe(expected.role);
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
