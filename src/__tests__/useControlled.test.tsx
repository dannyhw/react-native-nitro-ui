import { describe, expect, it, jest } from '@jest/globals';

import { renderHook, run } from './renderHook';
import { useControlled } from '../core/useControlled';

type Change = (value: boolean, eventCount: number) => void;

const nativeChangeOf = (
  onNativeChange: { f: Change } | null | undefined
): Change => {
  const change = onNativeChange?.f;
  if (change == null) {
    throw new Error('useControlled must always wire a native callback.');
  }
  return change;
};

describe('useControlled - uncontrolled', () => {
  it('sends no value, and seeds native with defaultValue', () => {
    const { result } = renderHook(() => useControlled<boolean>(undefined, true, undefined));
    expect(result.current.value).toBeNull();
    expect(result.current.defaultValue).toBe(true);
    expect(result.current.mostRecentEventCount).toBe(0);
  });

  it('still tells the user, and re-renders nothing', () => {
    const onValueChange = jest.fn(() => {});
    const hook = renderHook(() =>
      useControlled<boolean>(undefined, false, onValueChange)
    );
    const rendersBefore = hook.renderCount();

    run(() => nativeChangeOf(hook.result.current.onNativeChange)(true, 1));

    expect(onValueChange).toHaveBeenCalledWith(true);
    // Native owns the displayed value, so a toggle costs no React render.
    expect(hook.renderCount()).toBe(rendersBefore);
    expect(hook.result.current.mostRecentEventCount).toBe(0);
  });
});

describe('useControlled - controlled', () => {
  it('sends the value through and echoes event counts', () => {
    const onValueChange = jest.fn(() => {});
    const hook = renderHook(() =>
      useControlled<boolean>(false, false, onValueChange)
    );
    expect(hook.result.current.value).toBe(false);

    run(() => nativeChangeOf(hook.result.current.onNativeChange)(true, 1));

    expect(onValueChange).toHaveBeenCalledWith(true);
    expect(hook.result.current.mostRecentEventCount).toBe(1);
  });

  it('still commits a rejected change (event count moves, value does not)', () => {
    // The user's handler refuses: state stays `false`, so the `value` prop's
    // identity never changes. The event count is what forces a commit, which is
    // what lets native revert the displayed value.
    let value = false;
    const hook = renderHook(() =>
      useControlled<boolean>(value, false, (next) => {
        // intentionally ignore `next`
        expect(next).toBe(true);
      })
    );

    run(() => nativeChangeOf(hook.result.current.onNativeChange)(true, 1));

    expect(value).toBe(false);
    expect(hook.result.current.value).toBe(false);
    expect(hook.result.current.mostRecentEventCount).toBe(1);
  });

  it('applies an accepted change when the parent updates the value', () => {
    let value = false;
    const hook = renderHook(() =>
      useControlled<boolean>(value, false, (next) => {
        value = next;
      })
    );

    run(() => nativeChangeOf(hook.result.current.onNativeChange)(true, 1));
    hook.rerender();

    expect(hook.result.current.value).toBe(true);
    expect(hook.result.current.mostRecentEventCount).toBe(1);
  });

  it('never lets a late event rewind the echo', () => {
    const hook = renderHook(() => useControlled<boolean>(false, false, undefined));
    const change = nativeChangeOf(hook.result.current.onNativeChange);

    run(() => change(true, 5));
    expect(hook.result.current.mostRecentEventCount).toBe(5);
    run(() => change(false, 4));
    expect(hook.result.current.mostRecentEventCount).toBe(5);
  });

  it('keeps one native callback identity, even without a user handler', () => {
    let onValueChange: ((value: boolean) => void) | undefined = () => {};
    const hook = renderHook(() =>
      useControlled<boolean>(false, false, onValueChange)
    );
    // Always wired: the echo is what lets native accept the next `value`.
    expect(hook.result.current.onNativeChange.f).toBeDefined();
    const identity = hook.result.current.onNativeChange;

    onValueChange = () => {};
    hook.rerender();
    expect(hook.result.current.onNativeChange).toBe(identity);

    onValueChange = undefined;
    hook.rerender();
    expect(hook.result.current.onNativeChange).toBe(identity);
  });

  it('runs the user handler of the latest render', () => {
    const seen: boolean[] = [];
    let onValueChange: ((value: boolean) => void) | undefined = () => {};
    const hook = renderHook(() =>
      useControlled<boolean>(false, false, onValueChange)
    );
    const change = nativeChangeOf(hook.result.current.onNativeChange);

    onValueChange = (next) => {
      seen.push(next);
    };
    hook.rerender();
    run(() => change(true, 1));

    expect(seen).toEqual([true]);
  });
});
