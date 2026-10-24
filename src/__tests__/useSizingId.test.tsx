import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import {
  createElement,
  Suspense,
  use,
  useEffect,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from 'react-test-renderer';

import { Progress } from '../components/Progress/Progress';
import { useSizingId } from '../core/useSizingId';

import {
  nitroUiHybridObjects,
  nitroUiHybridObjectsReset,
} from '../../__mocks__/react-native-nitro-modules';

/**
 * The host-side contract of `useSizingId(configuration)`.
 *
 * The sizing engine is process-global and keys its ledger by the id alone, so a
 * minted id costs nothing until a *view* files it - and after that, only that
 * view's `onDropView` may end it (`NitroUiSizing.forget`, called by both hosts).
 * A new id handed to a view that is not remounting is therefore a permanent
 * leak: the entry under the old id has no drop left to end it, and D17's
 * "instance already exact in the cache lays out exact" rule silently degrades.
 *
 * Here a host element (`'NitroUiProgress'`) stands for the Fabric node and a
 * mount/cleanup pair of the probe's effect for file/forget, so the two things
 * that must agree are both readable: the id the live view carries, and the id
 * lifetimes. Both are asserted as *deltas*, because a render React throws away
 * may legitimately burn an id that no view ever files.
 *
 * The discarded render is a `Suspense` update: React hides the mounted content,
 * keeps its fibers, and throws the in-flight render away. Hook *state* comes
 * back from the committed fiber on the next render; a ref mutated during the
 * discarded render does not - which is the difference these tests pin.
 */

/** Ids the fake native core handed out, in order - one entry per mint. */
let mints: number[] = [];

// Registered once, statically, and never reset: `nitroUiCore` creates its native
// object lazily (on the first mint), and the hook module has to be the same React
// module instance the renderer drives, so neither the hybrid-object registry nor
// jest's module registry may be reset between tests. The factory reads the
// current `mints` binding, so emptying that array per test is enough.
nitroUiHybridObjectsReset();
nitroUiHybridObjects.NitroUiCore = () => ({
  nextSizingId(): number {
    const id = mints.length + 1;
    mints.push(id);
    return id;
  },
});

/** Every tree a test created, so `afterEach` can tear them down inside `act`. */
const trees: ReactTestRenderer[] = [];

function track(tree: ReactTestRenderer): ReactTestRenderer {
  trees.push(tree);
  return tree;
}

beforeEach(() => {
  mints = [];
});

afterEach(async () => {
  while (trees.length > 0) {
    const tree = trees.pop() as ReactTestRenderer;
    await act(async () => {
      tree.unmount();
    });
  }
});

/** A promise with no settlement - what makes a render suspend and stay there. */
function pending(): Promise<null> {
  return new Promise<null>(() => {});
}

/** The probe: one hook call, fed to one host element, plus its id lifetimes. */
function Probe({
  configuration,
  gate,
  log,
}: {
  configuration: string | undefined;
  gate: Promise<null> | null;
  log: string[];
}): ReactNode {
  const sizingId = useSizingId(configuration);
  useEffect(() => {
    log.push(`file:${sizingId}`);
    return () => {
      log.push(`forget:${sizingId}`);
    };
    // `log` is the test's own array and never swapped, so naming it here keeps
    // the pair running exactly when the id changes.
  }, [sizingId, log]);
  if (gate !== null) {
    use(gate);
  }
  return createElement('NitroUiProgress', { sizingId });
}

function boundary(
  configuration: string | undefined,
  gate: Promise<null> | null,
  log: string[]
): ReactElement {
  return createElement(
    Suspense,
    { fallback: null },
    createElement(Probe, { configuration, gate, log })
  );
}

/**
 * `await act` throughout: an update that suspends must be flushed through an
 * awaited scope, or React leaves the render half-done and the next root in the
 * file inherits the mess (and says so with "unmounted test renderer").
 */
async function mount(
  configuration: string | undefined,
  log: string[]
): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(boundary(configuration, null, log));
  });
  return track(tree);
}

async function rerender(
  tree: ReactTestRenderer,
  configuration: string | undefined,
  gate: Promise<null> | null,
  log: string[]
): Promise<void> {
  await act(async () => {
    tree.update(boundary(configuration, gate, log));
  });
}

function hostInstances(
  tree: ReactTestRenderer,
  type: string
): ReactTestInstance[] {
  return tree.root.findAll((node) => (node.type as unknown) === type);
}

/** The one host element of `type` in the tree, or a test failure that says how many. */
function onlyHost(tree: ReactTestRenderer, type: string): ReactTestInstance {
  const found = hostInstances(tree, type);
  if (found.length !== 1) {
    throw new Error(`expected one mounted ${type}, found ${found.length}`);
  }
  return found[0] as ReactTestInstance;
}

function prop(instance: ReactTestInstance, name: string): unknown {
  return (instance.props as Record<string, unknown>)[name];
}

/** The id on the one `NitroUiProgress` in the tree. */
function idOnView(tree: ReactTestRenderer): number {
  return prop(onlyHost(tree, 'NitroUiProgress'), 'sizingId') as number;
}

/** How often an id was filed / forgotten, per the probe's effect lifetimes. */
function lifetimes(
  log: string[],
  id: number
): { filed: number; forgotten: number } {
  return {
    filed: log.filter((line) => line === `file:${id}`).length,
    forgotten: log.filter((line) => line === `forget:${id}`).length,
  };
}

describe('useSizingId(configuration)', () => {
  it('mints once and keeps that id across re-renders', async () => {
    const log: string[] = [];
    const tree = await mount('circular', log);
    const first = idOnView(tree);

    await rerender(tree, 'circular', null, log);
    await rerender(tree, 'circular', null, log);

    expect(first).toBe(mints[0]);
    expect(idOnView(tree)).toBe(first);
    // One mint for three renders, and one id lifetime for the whole run.
    expect(mints).toHaveLength(1);
    expect(log).toEqual([`file:${first}`]);
  });

  it('mints a fresh id per configuration, and none per re-render', async () => {
    const log: string[] = [];
    const tree = await mount(undefined, log);
    const linearless = idOnView(tree);

    // `undefined` is one configuration, not a new one per render: Switch, Slider
    // and Button call the hook with no argument at all.
    await rerender(tree, undefined, null, log);
    expect(mints).toHaveLength(1);
    expect(idOnView(tree)).toBe(linearless);

    await rerender(tree, 'circular', null, log);
    expect(mints).toHaveLength(2);
    const circular = idOnView(tree);
    expect(circular).toBe(mints[1]);
    expect(circular).not.toBe(linearless);
    // The previous configuration's view is gone, so its entry was ended - once.
    expect(lifetimes(log, linearless)).toEqual({ filed: 1, forgotten: 1 });

    await rerender(tree, 'circular', null, log);
    expect(mints).toHaveLength(2);

    await rerender(tree, 'linear', null, log);
    expect(mints).toHaveLength(3);
    expect(idOnView(tree)).toBe(mints[2]);
    expect(lifetimes(log, circular)).toEqual({ filed: 1, forgotten: 1 });
  });

  it('hands a still-mounted view no new id when a configuration change is discarded', async () => {
    const log: string[] = [];
    const tree = await mount('linear', log);
    const mounted = idOnView(tree);

    // 1. The variant flips, and the render that would commit it suspends. React
    //    keeps the mounted view and throws this render away.
    await rerender(tree, 'circular', pending(), log);
    expect(idOnView(tree)).toBe(mounted);

    // 2. The flip is undone before the gate resolves (a transition or Suspense
    //    flipping the variant back). The view was never remounted, so it must not
    //    be re-id'd - and the discarded render must not have left its id in the
    //    hook either, because that is what makes the next commit re-id a live view.
    await rerender(tree, 'linear', null, log);

    const current = idOnView(tree);
    expect(current).toBe(mounted);
    expect(lifetimes(log, mounted)).toEqual({ filed: 1, forgotten: 0 });
    // Nothing else may have been filed: an id filed without a view that is really
    // mounting is an entry no `onDropView` will ever end.
    const filed = new Set(
      log
        .filter((line) => line.startsWith('file:'))
        .map((line) => Number(line.slice(5)))
    );
    expect([...filed]).toEqual([mounted]);
  });

  it('re-ids the view when a configuration change really commits', async () => {
    const log: string[] = [];
    const tree = await mount('linear', log);
    const mounted = idOnView(tree);

    // Suspend first, so this test proves the fix does not simply freeze the id:
    // the same path that discards a render must still re-id a real change.
    let resolveGate!: () => void;
    const gate = new Promise<null>((resolve) => {
      resolveGate = () => resolve(null);
    });
    await rerender(tree, 'circular', gate, log);
    expect(idOnView(tree)).toBe(mounted);

    await act(async () => {
      resolveGate();
    });

    const committed = idOnView(tree);
    expect(committed).not.toBe(mounted);
    expect(lifetimes(log, mounted)).toEqual({ filed: 1, forgotten: 1 });
    expect(lifetimes(log, committed)).toEqual({ filed: 1, forgotten: 0 });
  });
});

/**
 * The call-site half of the same contract: `Progress` keys its native view on the
 * *normalised* variant, so the value it hands `useSizingId` must be that same
 * normalised value. `variant` is a plain `string` on the native spec, so a JS
 * caller that bypasses the union (`variant={'round' as ProgressVariant}`) must not
 * be able to change the sizing configuration - or mint an id, or remount the view
 * - without also changing the key.
 */
describe('Progress · sizing id follows the key', () => {
  function progressProps(tree: ReactTestRenderer): Record<string, unknown> {
    return onlyHost(tree, 'NitroUiProgress').props as unknown as Record<
      string,
      unknown
    >;
  }

  it('normalises a variant outside the union to linear, on both the key and the sizing key', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        createElement(Progress, {
          testID: 'p',
          variant: 'round' as 'linear',
        })
      );
    });

    expect(progressProps(tree).variant).toBe('linear');
    expect(progressProps(tree).nuiSizingKey).toBe('');
    expect(typeof progressProps(tree).nuiSizingId).toBe('number');
  });

  it('neither remounts nor re-ids when only the unnormalised string changes', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(createElement(Progress, { variant: 'round' as 'linear' }));
    });
    const first = progressProps(tree);

    act(() => {
      tree.update(createElement(Progress, { variant: 'circle' as 'linear' }));
    });
    const second = progressProps(tree);

    expect(second.nuiSizingId).toBe(first.nuiSizingId);
    expect(second.nuiSizingKey).toBe(first.nuiSizingKey);
    expect(mints).toHaveLength(1);
  });

  it('re-ids for a real variant change, because that one remounts the view', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(createElement(Progress, { variant: 'linear' }));
    });
    const linear = progressProps(tree);

    act(() => {
      tree.update(createElement(Progress, { variant: 'circular' }));
    });
    const circular = progressProps(tree);

    expect(circular.nuiSizingKey).toBe('circular');
    expect(circular.nuiSizingId).not.toBe(linear.nuiSizingId);
    expect(mints).toHaveLength(2);
  });
});
