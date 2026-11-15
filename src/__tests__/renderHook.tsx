import { createElement, type ReactElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

/**
 * Minimal `renderHook` for unit tests: runs a hook in a component, re-runs
 * it on demand, and counts renders.
 */
export interface HookResult<Result> {
  result: { current: Result };
  renderCount: () => number;
  /** Re-render the harness, re-running the closure passed to `renderHook`. */
  rerender: () => void;
  unmount: () => void;
}

export function renderHook<Result>(
  getArguments: () => Result
): HookResult<Result> {
  const result = { current: undefined as unknown as Result };
  const counts = { renders: 0 };

  function Harness(): ReactNode {
    counts.renders += 1;
    result.current = getArguments();
    return null;
  }

  let tree: ReactTestRenderer;
  act(() => {
    tree = create(createElement(Harness));
  });

  return {
    result,
    renderCount: () => counts.renders,
    rerender: () => {
      act(() => {
        tree.update(createElement(Harness) as unknown as ReactElement);
      });
    },
    unmount: () => {
      act(() => {
        tree.unmount();
      });
    },
  };
}

/** Run a side effect (such as calling a captured native callback) through `act`. */
export function run(effect: () => void): void {
  act(effect);
}
