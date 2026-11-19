/**
 * The accessibility tree the driver reads, with the state facts still on it: the
 * `checked` a toggle answers with, the `selected` a segment answers with, and whether
 * the node carrying a control’s name is the node carrying its state.
 */
import { execFileSync } from 'node:child_process';
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  findAllByText,
  type UiautomatorNode,
} from '../../../scripts/real-input/uiautomator.mjs';
import { tightestFlaggedNode } from '../../../scripts/real-input/android-tree.mjs';

/**
 * A node of the driver's capture, in the shape the shared readers understand, plus the
 * driver's `hittable`: clickable, focusable or focused, which a dump spells separately.
 */
export type TreeNode = UiautomatorNode & { hittable?: 'true' | 'false' };

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
  hittable?: boolean;
  rect?: { x: number; y: number; width: number; height: number };
  parentIndex?: number;
  depth?: number;
}

/**
 * The driver session this run holds the device with.
 *
 * `agent-device` refuses a second client (`DEVICE_IN_USE`), so this read rides along in
 * the session the worker opened. The name is the engine’s own recipe, `e2e-<target>-
 * <worker slot>`, and the suite runs one worker.
 */
const DRIVER_SESSION = 'e2e-android-0';

/** The driver's own binary, from the install this suite runs against. */
function driverBinary(): string {
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../node_modules/.bin/agent-device'
  );
}

/**
 * One fresh capture of the accessibility tree, as the flags-only shape the readers need.
 *
 * `--force-full` because a repeat of the same request is answered with an “unchanged”
 * acknowledgement that has no nodes in it, and the serial is passed rather than
 * inherited so another lease’s emulator cannot be read.
 *
 * `unmerged` asks for the tree as the accessibility service serves it. By default the
 * driver folds a childless role node (a Compose `RadioButton`, say) into its clickable
 * parent, which then reports the child's class with its own box. The unmerged tree also
 * keeps off-screen nodes, at their own boxes, and other apps' windows.
 *
 * `driver` is the driver script to run, the suite's own install unless a test passes
 * a stand-in.
 */
export function tree(
  options: { unmerged?: boolean } = {},
  driver: string = driverBinary()
): TreeNode[] {
  const serial = process.env.ANDROID_SERIAL;
  if (serial == null || serial === '') {
    throw new Error(
      'real-input: ANDROID_SERIAL is unset, so this read has no device it may ask. ' +
        'Source the lease before running the suite.'
    );
  }
  // The driver exits at most 2 s after writing, drained or not, so a large answer
  // on a pipe can be cut short. Its writes to a file are synchronous and complete.
  const dir = mkdtempSync(join(tmpdir(), 'nitro-ui-tree-'));
  let answer: Buffer;
  try {
    const file = join(dir, 'snapshot.json');
    const fd = openSync(file, 'w');
    try {
      execFileSync(
        process.execPath,
        [
          driver,
          'snapshot',
          '--json',
          '--force-full',
          '--serial',
          serial,
          '--session',
          DRIVER_SESSION,
          ...(options.unmerged === true ? ['--raw'] : []),
        ],
        {
          stdio: ['pipe', fd, 'pipe'],
          maxBuffer: 64 * 1024 * 1024,
          timeout: 60_000,
        }
      );
    } catch (error) {
      throw new Error(
        `real-input: reading the accessibility tree from the driver failed: ` +
          String((error as Error)?.message ?? error)
      );
    } finally {
      closeSync(fd);
    }
    answer = readFileSync(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const stdout = answer.toString('utf8');
  let nodes: unknown;
  try {
    const parsed: unknown = JSON.parse(stdout);
    nodes = (parsed as { data?: { nodes?: unknown } })?.data?.nodes;
  } catch (error) {
    throw new Error(
      `real-input: the driver answered with ${String(answer.length)} bytes that are ` +
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
 * The driver’s node, in the shape `uiautomator.mjs`’s readers understand.
 *
 * The driver prints `label` as whatever a reader is told, where a dump keeps `text` and
 * `content-desc` apart; keeping them apart is what lets a reader tell a control’s own
 * name from the words drawn inside it. `clickable` and friends have no source here.
 */
function asTreeNode(node: DriverNode): TreeNode {
  const hasText = node.value !== undefined;
  const rect = node.rect ?? { x: 0, y: 0, width: 0, height: 0 };
  return {
    text: hasText ? (node.value ?? '') : '',
    resourceId: node.identifier ?? '',
    className: node.type ?? '',
    contentDesc: hasText ? (node.contentDescription ?? '') : (node.label ?? ''),
    enabled: node.enabled === false ? 'false' : 'true',
    hittable: node.hittable === true ? 'true' : 'false',
    clickable: '',
    longClickable: '',
    focusable: '',
    // The driver prints `checked` only for a node that offers the state, so its
    // presence is the flag a dump spells `checkable="true"`.
    checkable: node.checked === undefined ? 'false' : 'true',
    checked: node.checked === undefined ? '' : node.checked ? 'true' : 'false',
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

/**
 * The box a press on a node reaches, and the node whose `enabled` a screen reader is
 * told: the tightest `hittable` box that contains it, itself included, roughly its size
 * and not the page's own scroller. Read on the unmerged tree, where `hittable` is the
 * dump's clickable-or-focusable node for node; a disabled Material chip or list item
 * says `enabled="false"` only there, and `true` on the labelled node and its wrappers.
 */
function ownerNode(nodes: TreeNode[], node: TreeNode): TreeNode | null {
  const area = Math.max(1, node.bounds.width * node.bounds.height);
  let owner: TreeNode | null = null;
  for (const candidate of nodes) {
    if (candidate.hittable !== 'true' || candidate.scrollable === 'true') {
      continue;
    }
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
    `${node.className} enabled=${node.enabled} hittable=${node.hittable} ` +
    `checked=${node.checked} ` +
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
  /** `true`/`false` on the box a press on the control reaches. */
  enabled: 'true' | 'false' | null;
  /** The Android classes inside the control's box — a screen reader's role. */
  roles: string[];
  /** Every node's own words, so a red line can be read without re-running. */
  detail: string;
}

/**
 * The state facts for a named control, in one capture of the tree.
 *
 * A selection is read as a check: Compose maps a selectable item’s selection onto the
 * toggleable state, which TalkBack says out loud as “selected”. `enabled` is only
 * worth reading on the unmerged tree (see `ownerNode`).
 */
export function screenReaderFacts(
  label: string,
  options: { unmerged?: boolean } = {}
): ScreenReaderFacts {
  const nodes = tree(options);
  const labelled = namedNodesIn(nodes, label)[0];
  const checkedNode =
    labelled == null
      ? null
      : (tightestFlaggedNode(nodes, labelled, 'checkable') ?? labelled);
  const enabledNode = labelled == null ? null : ownerNode(nodes, labelled);
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
 * The state facts for one item of a group, named by its title.
 *
 * A merged Material row draws the item’s box, a separate title, and a role decoration
 * that carries no state, so the title is resolved through the group’s box first. The
 * tree is the unmerged one, so the item is the node the platform itself publishes.
 */
export function factsForItem(groupLabel: string, title: string): TextFacts {
  const nodes = tree({ unmerged: true });
  const group = namedNodesIn(nodes, groupLabel)[0];
  if (group == null) {
    return {
      checked: null,
      enabled: null,
      role: null,
      detail: `no node carries the group name "${groupLabel}"`,
    };
  }
  const insideGroup = (node: TreeNode): boolean =>
    node.bounds.x1 >= group.bounds.x1 - 1 &&
    node.bounds.y1 >= group.bounds.y1 - 1 &&
    node.bounds.x2 <= group.bounds.x2 + 1 &&
    node.bounds.cy >= group.bounds.y1 - 1 &&
    node.bounds.cy <= group.bounds.y2 + 1;
  // A Compose row that merges its descendants is named by its title and draws no separate
  // text node, so the words are either a node’s text or the name a reader is told — the
  // two places the driver’s own `getByText` looks.
  const titled =
    findAllByText(nodes, title).find(insideGroup) ??
    namedNodesIn(nodes, title).find(insideGroup);
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
