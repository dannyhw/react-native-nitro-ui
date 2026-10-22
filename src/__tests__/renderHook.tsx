import { createElement, type ReactElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

/**
 * Minimal `renderHook` for the library's own unit tests.
 *
 * A full testing library would give more, but the hooks under test only need a
 * component to run in, a way to re-run them with new arguments, and a render
 * count (an uncontrolled control must not re-render at all).
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
