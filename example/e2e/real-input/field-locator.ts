/**
 * The editable node of a field named by a node the driver may report inside it or
 * beside it.
 *
 * Android publishes a text field's name on a child of its `EditText`, and the driver
 * usually reports that child under the field. Under load it can report the two as
 * siblings at one depth, with the named node's box still inside the field's box. A
 * locator filter (`has`) sees only the first shape, and the locator language has no
 * geometry, so the handle here re-resolves the field on every call: first by
 * nesting, then by the named node's box lying inside the field's box.
 */
import type { Locator } from 'e2e';

/** A node's box, in the device pixels `boundingBox()` reports. */
export interface FieldBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Which box holds the name: an index into the editable boxes, none, or several. */
export type BoxChoice =
  | { kind: 'one'; index: number }
  | { kind: 'none' }
  | { kind: 'ambiguous'; indexes: number[] };

/** Box edges a pixel apart are one edge: the driver reports fractional boxes. */
const EDGE_SLACK = 1;

function holds(outer: FieldBox, inner: FieldBox): boolean {
  return (
    inner.width > 0 &&
    inner.height > 0 &&
    inner.x >= outer.x - EDGE_SLACK &&
    inner.y >= outer.y - EDGE_SLACK &&
    inner.x + inner.width <= outer.x + outer.width + EDGE_SLACK &&
    inner.y + inner.height <= outer.y + outer.height + EDGE_SLACK
  );
}

/**
 * The editable node whose box holds the box of a node carrying the name. Two such
 * nodes are ambiguous rather than a guess.
 */
export function chooseByBox(
  editables: readonly (FieldBox | null)[],
  named: readonly (FieldBox | null)[]
): BoxChoice {
  const boxes = named.filter((box): box is FieldBox => box != null);
  const holding = editables.flatMap((outer, index) =>
    outer != null && boxes.some((inner) => holds(outer, inner)) ? [index] : []
  );
  if (holding.length > 1) return { kind: 'ambiguous', indexes: holding };
  const [held] = holding;
  return held == null ? { kind: 'none' } : { kind: 'one', index: held };
}

/** A box, or `null` for a node that left the tree since the read that listed it. */
async function boxOrNull(locator: Locator): Promise<FieldBox | null> {
  try {
    return await locator.boundingBox();
  } catch (error) {
    if (
      String((error as Error)?.message ?? error).includes('matched no nodes')
    ) {
      return null;
    }
    throw error;
  }
}

/** The methods that act on or read one node, waiting for it as the engine does. */
const ONE_NODE_METHODS = [
  'tap',
  'click',
  'doubleTap',
  'dblclick',
  'secondaryTap',
  'longPress',
  'fill',
  'pressSequentially',
  'clear',
  'press',
  'focus',
  'hover',
  'scrollIntoView',
  'swipe',
  'textContent',
  'inputValue',
  'getAttribute',
  'isEnabled',
  'isDisabled',
  'isChecked',
  'boundingBox',
] as const;

type OneNodeMethod = (typeof ONE_NODE_METHODS)[number];

/** The locator methods that build another locator, which this handle cannot. */
const CHAINING = /^(filter|or|and|first|last|nth|locator|getBy\w+)$/;

/** How often a wait for the field reads the screen again, in ms. */
const POLL_MS = 250;

/**
 * How long an action may act through the locator the last resolve chose, in ms. The
 * locator still finds its node afresh; only the choice of it is reused, so a count
 * followed by a read costs one resolve and a caller that wants two box reads within a
 * couple of seconds gets them.
 */
const REUSE_MS = 1_000;

/**
 * A locator for the editable node of the field named `name`: `editables` are every
 * node that takes text, `named` every node carrying the name, `groups` the containers
 * a field and its name can sit in side by side.
 *
 * Every call resolves the field again before it acts, by nesting first and by box
 * second, so a field whose named node moves from inside it to beside it between two
 * reads is still the same field. An action within a second of a resolve acts through
 * the locator that resolve chose, which still finds its node afresh. A call that needs the node waits up to `waitMs` for it, as the
 * engine waits for any node, then fails with the engine's "matched no nodes" wording.
 * `count`, `all`, `isVisible` and `isHidden` read once, without waiting. It cannot be
 * chained (`filter`, `nth`, `getBy…`) or handed to `expect`.
 */
export function fieldLocator(
  editables: Locator,
  named: Locator,
  groups: Locator,
  description: string,
  waitMs: number
): Locator {
  const nested = editables.filter({ has: named });
  // Beside the field, the name shares the innermost container that holds both, so the
  // editable nodes in that container are the only ones whose boxes need reading.
  const shared = groups.filter({ has: named }).filter({ has: editables });
  const innermost = shared.filter({ hasNot: shared });
  const near = innermost
    .getByRole('textbox')
    .or(innermost.getByRole('searchbox'));
  let chosen: { target: Locator; at: number } | null = null;

  /**
   * The field now, as a locator for one node; `null` when nothing holds the name and a
   * count of the candidates when more than one does. Each read is a fresh snapshot, so
   * the common shapes cost two reads: a caller that waits for a box to hold still reads
   * twice within a couple of seconds.
   */
  async function resolveNow(): Promise<
    | { kind: 'one'; target: Locator }
    | { kind: 'none'; editableCount: number; namedCount: number }
    | { kind: 'ambiguous'; count: number; by: string }
  > {
    const found = await resolveFresh();
    chosen =
      found.kind === 'one' ? { target: found.target, at: Date.now() } : null;
    return found;
  }

  async function resolveFresh(): Promise<
    | { kind: 'one'; target: Locator }
    | { kind: 'none'; editableCount: number; namedCount: number }
    | { kind: 'ambiguous'; count: number; by: string }
  > {
    const nesting = await nested.count();
    if (nesting > 1) {
      return { kind: 'ambiguous', count: nesting, by: 'nest' };
    }
    if (nesting === 1) {
      // The only editable node is the field whatever its child does next, so a name
      // that moves beside it between this read and the action still finds it.
      const alone = (await editables.count()) === 1;
      return { kind: 'one', target: alone ? editables.nth(0) : nested };
    }
    const namedNodes = await named.all();
    const namedBoxes: (FieldBox | null)[] = [];
    for (const node of namedNodes) namedBoxes.push(await boxOrNull(node));
    let base = near;
    let candidates: Locator[] = [];
    if (namedBoxes.some((box) => box != null)) {
      candidates = await near.all();
      if (candidates.length === 0) {
        base = editables;
        candidates = await editables.all();
      }
    }
    const editableBoxes: (FieldBox | null)[] = [];
    for (const node of candidates) editableBoxes.push(await boxOrNull(node));
    const choice = chooseByBox(editableBoxes, namedBoxes);
    if (choice.kind === 'one') {
      return { kind: 'one', target: base.nth(choice.index) };
    }
    if (choice.kind === 'ambiguous') {
      return {
        kind: 'ambiguous',
        count: choice.indexes.length,
        by: 'hold the box of',
      };
    }
    return {
      kind: 'none',
      editableCount: candidates.length,
      namedCount: namedNodes.length,
    };
  }

  function ambiguity(count: number, by: string): Error {
    return new Error(
      `real-input: ${description} is ambiguous: ${String(count)} editable nodes ` +
        `each ${by} a node with that name.`
    );
  }

  async function resolveOne(): Promise<Locator> {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const found = await resolveNow();
      if (found.kind === 'one') return found.target;
      if (found.kind === 'ambiguous') throw ambiguity(found.count, found.by);
      chosen = null;
      if (Date.now() >= deadline) {
        throw new Error(
          `real-input: locator matched no nodes within ${String(waitMs)} ms for ` +
            `${description}: no editable node nests a node with that name, and ` +
            `none of ${String(found.editableCount)} holds the box of one of the ` +
            `${String(found.namedCount)} node(s) carrying it.`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }

  async function countNow(): Promise<number> {
    const found = await resolveNow();
    if (found.kind === 'one') return 1;
    return found.kind === 'ambiguous' ? found.count : 0;
  }

  const methods: Record<string, unknown> = {
    count: countNow,
    all: async () => ((await countNow()) > 0 ? [handle] : []),
    isVisible: async () => {
      const found = await resolveNow();
      if (found.kind === 'ambiguous') throw ambiguity(found.count, found.by);
      return found.kind === 'one' ? found.target.isVisible() : false;
    },
    isHidden: async () =>
      !(await (methods.isVisible as () => Promise<boolean>)()),
    waitFor: async (options?: Parameters<Locator['waitFor']>[0]) => {
      const state = options?.state ?? 'visible';
      if (state !== 'attached' && state !== 'visible') {
        throw new Error(
          `real-input: ${description} cannot wait for "${state}"; only for the field to appear.`
        );
      }
      return (await resolveOne()).waitFor(options);
    },
    toString: () => description,
  };
  for (const name of ONE_NODE_METHODS) {
    methods[name] = async (...args: unknown[]) => {
      const target =
        chosen != null && Date.now() - chosen.at < REUSE_MS
          ? chosen.target
          : await resolveOne();
      const method = target[name as OneNodeMethod] as (
        ...rest: unknown[]
      ) => Promise<unknown>;
      return method.apply(target, args);
    };
  }
  const handle = new Proxy(methods, {
    get(target, property) {
      if (typeof property !== 'string' || !CHAINING.test(property)) {
        return Reflect.get(target, property);
      }
      throw new Error(
        `real-input: ${description} has no "${property}": it acts and reads, and is ` +
          'not chained or handed to expect.'
      );
    },
  }) as unknown as Locator;
  return handle;
}
