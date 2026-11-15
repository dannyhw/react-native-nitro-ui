/**
 * The Android accessibility tree, as the accessibility service serves it.
 *
 * e2e answers questions about nodes — this file answers questions about *flags*.
 * Its snapshot is normalised, so "is the node a reader stops on the node a finger
 * can act on", "does it say `selected`", and "what Android class does a screen
 * reader's role come from" have no answer there. A `uiautomator dump` is the same
 * tree with every flag still on it, which is what `scripts/real-input/a11y.mjs`
 * reads on the iOS-less half of the conformance suite, so the rule applied here is
 * that file's rule rather than a second opinion on it.
 *
 * Every read is a fresh dump rather than a cached one: the flags are the answer to
 * "what does the tree say *now*", and a check that asked once before a gesture and
 * again after it must not get the same tree twice.
 */
import {
  checkControlA11y,
  A11Y_CONTROLS,
  type A11yControl,
} from '../../../scripts/real-input/a11y.mjs';
import {
  findAllByDescription,
  findAllByText,
  parseHierarchy,
  type UiautomatorNode,
} from '../../../scripts/real-input/uiautomator.mjs';
import {
  nativeChecked,
  nativeEnabled,
  tightestFlaggedNode,
} from '../../../scripts/real-input/android-tree.mjs';
import { accessibilityDump } from './device-read';

/** A node of the dump, with its raw `true`/`false` flags. */
export type TreeNode = UiautomatorNode;

/** The tree right now. */
export function tree(): TreeNode[] {
  return parseHierarchy(accessibilityDump());
}

/** Every node with a box that carries exactly this `content-desc`. */
export function namedNodes(label: string): TreeNode[] {
  return tree()
    .filter((node) => node.contentDesc === label)
    .filter((node) => node.bounds.width > 0 && node.bounds.height > 0);
}

/** The a11y case for a label, which is what carries the rule's shape. */
export function caseForLabel(label: string): A11yControl | undefined {
  return A11Y_CONTROLS.find((control) => control.label === label);
}

/**
 * The rule, on the node a person acts on, right now.
 *
 * Returns the findings that are *new*: a problem matched by a row of
 * `A11Y_EXEMPTIONS` is recorded debt and travels back in `known` instead, which is
 * why a caller may not read an empty return as a clean pass — the exemption has to
 * be reported as an exemption.
 */
export function ruleFindings(label: string): {
  failures: string[];
  known: string[];
  control: A11yControl | undefined;
} {
  const control = caseForLabel(label);
  if (control == null) {
    // Nothing in the table names this label, so the rule runs on the shape every
    // control has to satisfy anyway: the name has to sit where a person can act.
    // An exemption can only be granted to a control the table knows.
    return {
      failures: namedNodes(label)
        .filter((node) => !isActable(node) && !hasActableHome(node, tree()))
        .map(
          (node) =>
            `"${label}" is named on a node nothing can act on (${describe(
              node
            )}), and no actionable node shares its box`
        ),
      known: [],
      control,
    };
  }
  const result = checkControlA11y(control, tree());
  return { ...result, control };
}

/** What the node a reader names says about itself, flags and all. */
export function nodeStateFacts(label: string): {
  count: number;
  className: string;
  checked: string;
  selected: string;
  enabled: string;
  checkable: string;
  clickable: string;
  detail: string;
} {
  const nodes = namedNodes(label);
  const node = nodes[0];
  return {
    count: nodes.length,
    className: node?.className ?? 'missing',
    checked: node?.checked ?? 'missing',
    selected: node?.selected ?? 'missing',
    enabled: node?.enabled ?? 'missing',
    checkable: node?.checkable ?? 'missing',
    clickable: node?.clickable ?? 'missing',
    detail: nodes.map((entry) => describe(entry)).join('; '),
  };
}

/** Mirrors `a11y.mjs`'s `isActable`: a state flag is not an action. */
function isActable(node: TreeNode): boolean {
  return (
    node.clickable === 'true' ||
    node.checkable === 'true' ||
    node.focusable === 'true'
  );
}

/**
 * Mirrors `a11y.mjs`'s `hasActableHome`: an actionable node that contains the
 * named box *and is roughly its size*, so a page-sized focusable container does
 * not qualify as the control's home.
 */
function hasActableHome(named: TreeNode, nodes: TreeNode[]): boolean {
  const area = Math.max(1, named.bounds.width * named.bounds.height);
  return nodes.some((node) => {
    if (node === named || !isActable(node) || node.scrollable === 'true') {
      return false;
    }
    const covers =
      node.bounds.x1 <= named.bounds.x1 &&
      node.bounds.y1 <= named.bounds.y1 &&
      node.bounds.x2 >= named.bounds.x2 &&
      node.bounds.y2 >= named.bounds.y2;
    if (!covers) return false;
    const nodeArea = node.bounds.width * node.bounds.height;
    return nodeArea <= area * 4;
  });
}

function describe(node: TreeNode): string {
  return (
    `${node.className} clickable=${node.clickable} checkable=${node.checkable} ` +
    `focusable=${node.focusable} enabled=${node.enabled} checked=${node.checked} ` +
    `selected=${node.selected} at ${String(node.bounds.x1)},${String(
      node.bounds.y1
    )}-${String(node.bounds.x2)},${String(node.bounds.y2)}`
  );
}

export { findAllByDescription };

/**
 * The control node behind a name: the tightest node that can carry a state and
 * contains the node the name sits on.
 *
 * Compose publishes a hosted control's label on a child of the node holding its
 * state, so this is the node a screen reader's "checked", "selected" and "disabled"
 * belong to. `flag` picks which state the caller is after, because a Chip's touch
 * target is clickable and a Switch's is checkable, and asking for the wrong one
 * answers with the row around it.
 */
export function controlNodeFor(
  label: string,
  flag: 'checkable' | 'clickable'
): TreeNode | null {
  return tightestFlaggedNode(tree(), namedNodes(label)[0] ?? null, flag);
}

/** What a screen reader is told about a named control, read off the tree. */
export interface ScreenReaderFacts {
  /** `on`/`off` on the checkable node that *is* the control. */
  checked: 'on' | 'off' | null;
  /** `true`/`false` on the clickable node that *is* the control. */
  enabled: 'true' | 'false' | null;
  /** The Android classes inside the control's box — a screen reader's role. */
  roles: string[];
  /** Every node's own words, so a red line can be read without re-running. */
  detail: string;
}

/**
 * The state facts for a named control, in one read of the tree.
 *
 * A selection is read as a check: Compose maps a selectable item's selection onto
 * the toggleable state, which the dump spells `checked` on the item's node and
 * which TalkBack says out loud as "selected".
 */
export function screenReaderFacts(label: string): ScreenReaderFacts {
  const nodes = tree();
  const labelled = namedNodes(label)[0];
  const checkedNode = tightestFlaggedNode(nodes, labelled ?? null, 'checkable');
  const enabledNode = tightestFlaggedNode(nodes, labelled ?? null, 'clickable');
  const home = checkedNode ?? enabledNode ?? labelled ?? null;
  const inside = (node: TreeNode): boolean =>
    home == null ||
    (node.bounds.cx >= home.bounds.x1 - 1 &&
      node.bounds.cx <= home.bounds.x2 + 1 &&
      node.bounds.cy >= home.bounds.y1 - 1 &&
      node.bounds.cy <= home.bounds.y2 + 1);
  return {
    checked: nativeChecked(nodes, label),
    enabled: nativeEnabled(nodes, label),
    roles: [
      ...new Set(
        nodes
          .filter((node) => node.className.startsWith('android.widget.'))
          .filter((node) => inside(node) || node === home)
          .map((node) => node.className.split('.').pop() ?? node.className)
      ),
    ].sort(),
    detail: (labelled == null ? [] : [labelled])
      .concat(checkedNode == null ? [] : [checkedNode])
      .concat(enabledNode == null ? [] : [enabledNode])
      .map((node) => describe(node))
      .join('; '),
  };
}

/** The parts of a grouped control — its items, its roles, its selection. */
export interface GroupFacts {
  /** Nodes inside the group's box that carry a toggleable state: one per option. */
  items: TreeNode[];
  /** Nodes with the given Android class inside the group's box: the roles. */
  roles: TreeNode[];
  /** How many of the items say they hold the selection. */
  selected: number;
}

/**
 * The same control read as a group rather than as a toggle.
 *
 * A segmented control, a radio Picker and a button group each publish one node per
 * option, and the claim worth making is a count: one node per option, one role node
 * per option, and exactly one of them selected.
 */
export function groupFacts(label: string, role: string): GroupFacts {
  const nodes = tree();
  const group = namedNodes(label)[0];
  const inside = (node: TreeNode): boolean =>
    group != null &&
    node !== group &&
    node.bounds.cx >= group.bounds.x1 - 1 &&
    node.bounds.cx <= group.bounds.x2 + 1 &&
    node.bounds.cy >= group.bounds.y1 - 1 &&
    node.bounds.cy <= group.bounds.y2 + 1;
  const items = nodes
    .filter((node) => node.checkable === 'true' && inside(node))
    .sort((a, b) => a.bounds.x1 - b.bounds.x1);
  return {
    items,
    roles: nodes
      .filter((node) => node.className === role && inside(node))
      .sort((a, b) => a.bounds.x1 - b.bounds.x1),
    selected: items.filter((node) => node.checked === 'true').length,
  };
}

/**
 * The control node behind a piece of on-screen text.
 *
 * Compose merges a row or an action into a clickable node and leaves the words a
 * `TextView` of their own, so the node carrying the words reports the same state
 * whether the control is disabled or not. The state lives one level out.
 */
export function nodeForText(
  text: string,
  flag: 'checkable' | 'clickable'
): TreeNode | null {
  const nodes = tree();
  return tightestFlaggedNode(
    nodes,
    findAllByText(nodes, text).find((node) => node.bounds.height > 0) ?? null,
    flag
  );
}

/** What the node behind a piece of text says about itself. */
export interface TextFacts {
  checked: 'on' | 'off' | null;
  /** The dump's own `enabled` attribute, kept as the string it wrote. */
  enabled: string | null;
  /** The Android class of the node holding the state — the role a reader gets. */
  role: string | null;
  detail: string;
}

/**
 * The state facts for a control named by its words rather than its label.
 *
 * `flag` names the state the caller is after: an action's enabled flag is on its
 * clickable node, a radio row's selection on its checkable one.
 */
export function factsForText(
  text: string,
  flag: 'checkable' | 'clickable'
): TextFacts {
  const node = nodeForText(text, flag);
  if (node == null) {
    return {
      checked: null,
      enabled: null,
      role: null,
      detail: `no ${flag} node contains the words "${text}"`,
    };
  }
  return {
    checked: node.checkable === 'true' ? stateOf(node.checked) : null,
    enabled: node.enabled,
    role: node.className,
    detail: describe(node),
  };
}

/**
 * The state facts for one item of a group, named by its title.
 *
 * A merged Material row draws each item as the item's own box, a separate title, and
 * a role decoration that carries no state, so the title has to be resolved through
 * the group's box before any flag can be read.
 */
export function factsForItem(groupLabel: string, title: string): TextFacts {
  const nodes = tree();
  const group = namedNodes(groupLabel)[0];
  if (group == null) {
    return {
      checked: null,
      enabled: null,
      role: null,
      detail: `no node carries the group name "${groupLabel}"`,
    };
  }
  const titled = findAllByText(nodes, title).find(
    (node) =>
      node.bounds.x1 >= group.bounds.x1 - 1 &&
      node.bounds.y1 >= group.bounds.y1 - 1 &&
      node.bounds.x2 <= group.bounds.x2 + 1 &&
      node.bounds.cy >= group.bounds.y1 - 1 &&
      node.bounds.cy <= group.bounds.y2 + 1
  );
  if (titled == null) {
    return {
      checked: null,
      enabled: null,
      role: null,
      detail: `"${groupLabel}" draws no item titled "${title}" inside its own box`,
    };
  }
  const facts = factsForText(title, 'clickable');
  const item = tightestFlaggedNode(nodes, titled, 'clickable');
  return {
    checked:
      item == null || item.checkable !== 'true' ? null : stateOf(item.checked),
    enabled: facts.enabled,
    role: item?.className ?? null,
    detail: item == null ? facts.detail : describe(item),
  };
}

function stateOf(value: string): 'on' | 'off' {
  return value === 'true' ? 'on' : 'off';
}
