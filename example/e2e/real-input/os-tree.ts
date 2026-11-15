/**
 * The accessibility tree the driver reads, with the state facts still on it.
 *
 * e2e answers questions about nodes — this file answers questions about *flags*: the
 * `checked` a toggle answers with, the `selected` a segment answers with, the Android
 * class a screen reader takes for the control's role, and whether the node carrying a
 * control's name is also the node carrying its state. Those are the facts five of this
 * suite's real defects came in through (G15, G16, G23, G24, G31), and no in-app query
 * can see them: a hosted Compose control publishes its name on a `SemanticsNode`, not
 * on a React Native view, so from inside the app the name and the state are simply not
 * two things that could be compared.
 *
 * The capture is the driver's own, taken again for every read: the facts answer "what
 * does the tree say *now*", and a check that looks once before a gesture and once after
 * it must not be handed the same capture twice.
 *
 * What this cannot answer is actionability. The driver's node map carries `hittable`,
 * which is geometric — a name slid onto a plain `View` is still hittable, which is
 * exactly the defect the actionable-node rule exists to catch — so that half of the
 * rule is graded by the a11y sweep against `uiautomator dump`, in
 * `scripts/real-input/a11y-sweep-device.mjs`, which also says why a dump cannot be read
 * while a session is open. Reading a geometric flag as though it were the real one would
 * turn that rule green for every control at once.
 */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  findAllByText,
  type UiautomatorNode,
} from '../../../scripts/real-input/uiautomator.mjs';
import { tightestFlaggedNode } from '../../../scripts/real-input/android-tree.mjs';

/** A node of the driver's capture, in the shape the shared readers understand. */
export type TreeNode = UiautomatorNode;

/** One node of the driver's snapshot, as its JSON prints it. */
interface DriverNode {
  index: number;
  type?: string;
  label?: string;
  value?: string;
  contentDescription?: string;
  identifier?: string;
  enabled?: boolean;
  selected?: boolean;
  checked?: boolean;
  rect?: { x: number; y: number; width: number; height: number };
  parentIndex?: number;
  depth?: number;
}

/** The driver's own binary, from the install this suite runs against. */
function driverBinary(): string {
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../node_modules/.bin/agent-device'
  );
}

/**
 * One fresh capture of the accessibility tree, as the flags-only shape the readers
 * below expect.
 *
 * `--force-full` because the driver answers a repeat of the same request with an
 * "unchanged" acknowledgement, and an acknowledgement has no nodes in it — a check
 * that read the tree twice around a gesture would be told nothing had changed, which is
 * the one answer it is not allowed to take on trust.
 *
 * The serial is passed rather than inherited: the same lease that scopes every other
 * device read scopes this one, and another task's emulator is visible to the daemon.
 */
export function tree(): TreeNode[] {
  const serial = process.env.ANDROID_SERIAL;
  if (serial == null || serial === '') {
    throw new Error(
      'real-input: ANDROID_SERIAL is unset, so this read has no device it may ask. ' +
        'Source the lease before running the suite.'
    );
  }
  let stdout = '';
  try {
    stdout = execFileSync(
      process.execPath,
      [driverBinary(), 'snapshot', '--json', '--force-full', '--serial', serial],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60_000 }
    );
  } catch (error) {
    throw new Error(
      `real-input: reading the accessibility tree from the driver failed: ` +
        String((error as Error)?.message ?? error)
    );
  }
  let nodes: unknown;
  try {
    const parsed: unknown = JSON.parse(stdout);
    nodes = (parsed as { data?: { nodes?: unknown } })?.data?.nodes;
  } catch (error) {
    throw new Error(
      `real-input: the driver answered with ${String(stdout.length)} bytes that are ` +
        `not a snapshot this suite can read: ${String(
          (error as Error)?.message ?? error
        )}`
    );
  }
  if (!Array.isArray(nodes)) {
    throw new Error(
      'real-input: the driver answered a snapshot with no nodes, which is not the ' +
        'same as answering that the screen is empty — the read is refused.'
    );
  }
  return nodes.map((entry) => asTreeNode(entry as DriverNode));
}

/**
 * The driver's node, in the shape `uiautomator.mjs`'s readers understand.
 *
 * The two trees name the same two things differently, and only one of them keeps them
 * apart: the driver prints `label` as *whatever a reader is told* — the text if the node
 * has text, its description otherwise — where a dump keeps `text` and `content-desc`
 * separate. Keeping them apart is what lets a reader tell a control's own name from the
 * words drawn inside it, so a node with text contributes text and nothing else, and a
 * node without it contributes its description.
 *
 * `clickable`, `focusable` and `longClickable` have no source here and stay empty;
 * nothing in this file may read them (see the file comment).
 */
function asTreeNode(node: DriverNode): TreeNode {
  const hasText = node.value !== undefined;
  const rect = node.rect ?? { x: 0, y: 0, width: 0, height: 0 };
  return {
    text: hasText ? (node.value ?? '') : '',
    resourceId: node.identifier ?? '',
    className: node.type ?? '',
    contentDesc: hasText
      ? (node.contentDescription ?? '')
      : (node.label ?? ''),
    enabled: node.enabled === false ? 'false' : 'true',
    clickable: '',
    longClickable: '',
    focusable: '',
    // The driver prints `checked` only for a node that offers the state, so its
    // presence is the flag a dump spells `checkable="true"`.
    checkable: node.checked === undefined ? 'false' : 'true',
    checked:
      node.checked === undefined ? '' : node.checked ? 'true' : 'false',
    selected: node.selected === true ? 'true' : 'false',
    // No flag, but a class that cannot be anything else: the rule this serves is the
    // one that refuses a control's name sitting on the page's own scroller.
    scrollable: /scroll|recycler|listview|gridview|collection/i.test(
      node.type ?? ''
    )
      ? 'true'
      : 'false',
    bounds: {
      x1: rect.x,
      y1: rect.y,
      x2: rect.x + rect.width,
      y2: rect.y + rect.height,
      cx: rect.x + Math.round(rect.width / 2),
      cy: rect.y + Math.round(rect.height / 2),
      width: rect.width,
      height: rect.height,
    },
  };
}

/** Every node with a box that carries exactly this description. */
function namedNodesIn(nodes: TreeNode[], label: string): TreeNode[] {
  return nodes
    .filter((node) => node.contentDesc === label)
    .filter((node) => node.bounds.width > 0 && node.bounds.height > 0);
}

/** Every node with a box that carries exactly this `content-desc`. */
export function namedNodes(label: string): TreeNode[] {
  return namedNodesIn(tree(), label);
}

/**
 * The box that owns a node: the tightest other box that contains it and is roughly its
 * size, and is not the page's own scroller.
 *
 * This is what a press reaches for a piece of on-screen words, and it is the node whose
 * `enabled` a screen reader is told. The size guard is what keeps a screen-sized
 * container from being read as the owner, which is how a name that had slid onto the
 * page would otherwise pass for the control's own box.
 */
function ownerNode(nodes: TreeNode[], node: TreeNode): TreeNode | null {
  const area = Math.max(1, node.bounds.width * node.bounds.height);
  let owner: TreeNode | null = null;
  for (const candidate of nodes) {
    if (candidate === node || candidate.scrollable === 'true') continue;
    const covers =
      candidate.bounds.x1 <= node.bounds.x1 &&
      candidate.bounds.y1 <= node.bounds.y1 &&
      candidate.bounds.x2 >= node.bounds.x2 &&
      candidate.bounds.y2 >= node.bounds.y2;
    if (!covers) continue;
    const size = candidate.bounds.width * candidate.bounds.height;
    if (size > area * 4) continue;
    if (owner == null || size < owner.bounds.width * owner.bounds.height) {
      owner = candidate;
    }
  }
  return owner;
}

function describe(node: TreeNode): string {
  return (
    `${node.className} enabled=${node.enabled} checked=${node.checked} ` +
    `checkable=${node.checkable} selected=${node.selected} at ${String(
      node.bounds.x1
    )},${String(node.bounds.y1)}-${String(node.bounds.x2)},${String(
      node.bounds.y2
    )}`
  );
}

/** What a screen reader is told about a named control, read off the tree. */
export interface ScreenReaderFacts {
  /** `on`/`off` on the checkable node that *is* the control. */
  checked: 'on' | 'off' | null;
  /** `true`/`false` on the box that owns the control. */
  enabled: 'true' | 'false' | null;
  /** The Android classes inside the control's box — a screen reader's role. */
  roles: string[];
  /** Every node's own words, so a red line can be read without re-running. */
  detail: string;
}

/**
 * The state facts for a named control, in one capture of the tree.
 *
 * A selection is read as a check: Compose maps a selectable item's selection onto the
 * toggleable state, which TalkBack says out loud as "selected".
 */
export function screenReaderFacts(label: string): ScreenReaderFacts {
  const nodes = tree();
  const labelled = namedNodesIn(nodes, label)[0];
  const checkedNode =
    labelled == null
      ? null
      : (tightestFlaggedNode(nodes, labelled, 'checkable') ?? labelled);
  const enabledNode =
    labelled == null ? null : (ownerNode(nodes, labelled) ?? labelled);
  const home = checkedNode ?? enabledNode ?? null;
  const inside = (node: TreeNode): boolean =>
    home == null ||
    (node.bounds.cx >= home.bounds.x1 - 1 &&
      node.bounds.cx <= home.bounds.x2 + 1 &&
      node.bounds.cy >= home.bounds.y1 - 1 &&
      node.bounds.cy <= home.bounds.y2 + 1);
  return {
    checked:
      checkedNode == null || checkedNode.checkable !== 'true'
        ? null
        : stateOf(checkedNode.checked),
    enabled: triState(enabledNode?.enabled),
    roles: [
      ...new Set(
        nodes
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
  const group = namedNodesIn(nodes, label)[0];
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
 * `state` names the state the caller is after, because the two live on different
 * nodes: a row's selection is on the node that offers the toggle, an action's
 * enabled-ness is on the box that owns the words. The driver reports no clickable
 * flag, so the second half is resolved by box rather than by flag — the tightest
 * box around the words, which is the node a press reaches.
 */
export function nodeForText(
  text: string,
  state: 'checkable' | 'clickable'
): TreeNode | null {
  const nodes = tree();
  const titled =
    findAllByText(nodes, text).find((node) => node.bounds.height > 0) ?? null;
  if (titled == null) return null;
  return state === 'checkable'
    ? tightestFlaggedNode(nodes, titled, 'checkable')
    : ownerNode(nodes, titled);
}

/** What the node behind a piece of text says about itself. */
export interface TextFacts {
  checked: 'on' | 'off' | null;
  /** The tree's own `enabled`, kept as the string it wrote. */
  enabled: string | null;
  /** The Android class of the node holding the state — the role a reader gets. */
  role: string | null;
  detail: string;
}

/**
 * The state facts for a control named by its words rather than its label.
 *
 * Compose merges a row or an action into one node and leaves the words a node of their
 * own, and that words-node reports the same thing whether the control is disabled or
 * not. The state lives one box out.
 */
export function factsForText(
  text: string,
  state: 'checkable' | 'clickable'
): TextFacts {
  const nodes = tree();
  const titled =
    findAllByText(nodes, text).find((node) => node.bounds.height > 0) ?? null;
  if (titled == null) {
    return {
      checked: null,
      enabled: null,
      role: null,
      detail: `no node with a box carries the words "${text}"`,
    };
  }
  const node =
    state === 'checkable'
      ? tightestFlaggedNode(nodes, titled, 'checkable')
      : ownerNode(nodes, titled);
  if (node == null) {
    return {
      checked: null,
      enabled: null,
      role: null,
      detail: `no ${state} node owns the words "${text}" (${describe(titled)})`,
    };
  }
  return {
    checked: node.checkable === 'true' ? stateOf(node.checked) : null,
    enabled: node.enabled,
    role: node.className,
    detail: `${describe(titled)} owned by ${describe(node)}`,
  };
}

/**
 * The state facts for one item of a group, named by its title.
 *
 * A merged Material row draws each item as the item's own box, a separate title, and a
 * role decoration that carries no state, so the title has to be resolved through the
 * group's box before any flag can be read.
 */
export function factsForItem(groupLabel: string, title: string): TextFacts {
  const nodes = tree();
  const group = namedNodesIn(nodes, groupLabel)[0];
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
  const item =
    tightestFlaggedNode(nodes, titled, 'checkable') ?? ownerNode(nodes, titled);
  if (item == null) {
    return {
      checked: null,
      enabled: null,
      role: null,
      detail: `no box owns the item "${title}" inside "${groupLabel}"`,
    };
  }
  return {
    checked: item.checkable === 'true' ? stateOf(item.checked) : null,
    enabled: item.enabled,
    role: item.className,
    detail: describe(item),
  };
}

function stateOf(value: string): 'on' | 'off' {
  return value === 'true' ? 'on' : 'off';
}

/** The tree's `true`/`false`, or `null` when the node had none to give. */
function triState(value: string | undefined): 'true' | 'false' | null {
  return value === 'true' || value === 'false' ? value : null;
}
