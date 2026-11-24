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

/** One editable node as a resolve reads it. */
export interface EditableReading {
  /** Whether the driver reports a node with the field's name inside this one. */
  nests: boolean;
  box: FieldBox | null;
}

/** Which editable node is the field: its index, none, or more than one. */
export type FieldChoice =
  | { kind: 'one'; index: number; by: 'nesting' | 'box' }
  | { kind: 'none' }
  | { kind: 'ambiguous'; indexes: number[]; by: 'nesting' | 'box' };

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
 * The editable node a name belongs to. Nesting decides when any editable node nests
 * the name; otherwise the node whose box holds a named node's box. Two candidates are
 * ambiguous rather than a guess.
 */
export function chooseField(
  editables: readonly EditableReading[],
  named: readonly (FieldBox | null)[]
): FieldChoice {
  const nesting = editables.flatMap((reading, index) =>
    reading.nests ? [index] : []
  );
  if (nesting.length > 1) {
    return { kind: 'ambiguous', indexes: nesting, by: 'nesting' };
  }
  const [nested] = nesting;
  if (nested != null) return { kind: 'one', index: nested, by: 'nesting' };
  const boxes = named.filter((box): box is FieldBox => box != null);
  const holding = editables.flatMap((reading, index) => {
    const outer = reading.box;
    return outer != null && boxes.some((inner) => holds(outer, inner))
      ? [index]
      : [];
  });
  if (holding.length > 1) {
    return { kind: 'ambiguous', indexes: holding, by: 'box' };
  }
  const [held] = holding;
  return held == null
    ? { kind: 'none' }
    : { kind: 'one', index: held, by: 'box' };
}

/** A box, or `null` for a node that left the tree between two reads. */
async function boxOrNull(locator: Locator): Promise<FieldBox | null> {
  if ((await locator.count()) === 0) return null;
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
 * A locator for the editable node of the field named `name`: `editables` are every
 * node that takes text, `named` every node carrying the name.
 *
 * Every call resolves the field again and then acts through `editables.nth(i)`, so a
 * field whose named node moves from inside it to beside it between two reads is still
 * the same field. A call that needs the node waits up to `waitMs` for it, as the
 * engine waits for any node, then fails with the engine's "matched no nodes" wording.
 * `count`, `all`, `isVisible` and `isHidden` read once, without waiting. It cannot be
 * chained (`filter`, `nth`, `getBy…`) or handed to `expect`.
 */
export function fieldLocator(
  editables: Locator,
  named: Locator,
  description: string,
  waitMs: number
): Locator {
  async function resolveNow(): Promise<{
    choice: FieldChoice;
    editableCount: number;
    namedCount: number;
  }> {
    const candidates = await editables.all();
    // One read answers the common shapes: no field nests the name, or the only one does.
    const nestingCount =
      candidates.length === 0
        ? 0
        : await editables.filter({ has: named }).count();
    const readings: EditableReading[] = [];
    for (const candidate of candidates) {
      const nests =
        nestingCount > 0 &&
        (candidates.length === 1 ||
          (await candidate.filter({ has: named }).count()) > 0);
      readings.push({ nests, box: nests ? null : await boxOrNull(candidate) });
    }
    const nesting = readings.some((reading) => reading.nests);
    const namedNodes =
      nesting || candidates.length === 0 ? [] : await named.all();
    const namedBoxes: (FieldBox | null)[] = [];
    for (const node of namedNodes) namedBoxes.push(await boxOrNull(node));
    return {
      choice: chooseField(readings, namedBoxes),
      editableCount: candidates.length,
      namedCount: namedNodes.length,
    };
  }

  function ambiguity(choice: FieldChoice & { kind: 'ambiguous' }): Error {
    return new Error(
      `real-input: ${description} is ambiguous: editable nodes ` +
        `${choice.indexes.join(', ')} each ${choice.by === 'nesting' ? 'nest' : 'hold the box of'} ` +
        'a node with that name.'
    );
  }

  async function resolveOne(): Promise<Locator> {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const { choice, editableCount, namedCount } = await resolveNow();
      if (choice.kind === 'one') return editables.nth(choice.index);
      if (choice.kind === 'ambiguous') throw ambiguity(choice);
      if (Date.now() >= deadline) {
        throw new Error(
          `real-input: locator matched no nodes within ${String(waitMs)} ms for ` +
            `${description}: ${String(editableCount)} editable node(s), and none of ` +
            `them nests a node with that name or holds the box of one ` +
            `(${String(namedCount)} named node(s) measured beside them).`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }

  async function countNow(): Promise<number> {
    const { choice } = await resolveNow();
    if (choice.kind === 'one') return 1;
    return choice.kind === 'ambiguous' ? choice.indexes.length : 0;
  }

  const methods: Record<string, unknown> = {
    count: countNow,
    all: async () => ((await countNow()) > 0 ? [handle] : []),
    isVisible: async () => {
      const { choice } = await resolveNow();
      if (choice.kind === 'ambiguous') throw ambiguity(choice);
      return choice.kind === 'one'
        ? editables.nth(choice.index).isVisible()
        : false;
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
      const target = await resolveOne();
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
