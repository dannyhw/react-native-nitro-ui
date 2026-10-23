import { describe, expect, it, jest } from '@jest/globals';

import { renderHook, run } from './renderHook';
import type { NitroCallbackProp } from '../core/useStableCallback';
import { useStableCallback } from '../core/useStableCallback';

type Handler = (value: boolean) => void;

describe('useStableCallback', () => {
  it('sends nothing for a missing handler', () => {
    const { result } = renderHook(() => useStableCallback<Handler>(undefined));
    expect(result.current).toBeNull();
  });

  it('wraps a handler the way Nitro expects ({ f: fn })', () => {
    const { result } = renderHook(() => useStableCallback<Handler>(() => {}));
    expect(result.current).not.toBeNull();
    expect(typeof result.current?.f).toBe('function');
  });

  it('keeps one identity across renders', () => {
    // The render body below creates a brand new function object every time, and
    // the native prop still does not change.
    const hook = renderHook(() => useStableCallback<Handler>(() => {}));
    const identity = hook.result.current as NitroCallbackProp<Handler>;
    expect(identity).not.toBeNull();

    hook.rerender();
    hook.rerender();
    expect(hook.result.current).toBe(identity);
  });

  it('runs the handler of the latest render through the same wrapper', () => {
    const seen: string[] = [];
    let handler: Handler = () => {
      seen.push('first');
    };
    const hook = renderHook(() => useStableCallback(handler));
    const wrapper = hook.result.current?.f;
    expect(wrapper).toBeDefined();

    run(() => wrapper?.(true));
    expect(seen).toEqual(['first']);

    // A re-render with a different closure must not need a new native prop.
    handler = () => {
      seen.push('second');
    };
    hook.rerender();
    run(() => wrapper?.(true));

    expect(seen).toEqual(['first', 'second']);
    expect(hook.result.current?.f).toBe(wrapper);
  });

  it('makes a new wrapper when a handler is added or removed', () => {
    let handler: Handler | undefined = () => {};
    const hook = renderHook(() => useStableCallback(handler));
    const withHandler = hook.result.current;
    expect(withHandler).not.toBeNull();

    handler = undefined;
    hook.rerender();
    expect(hook.result.current).toBeNull();

    handler = () => {};
    hook.rerender();
    expect(hook.result.current).not.toBeNull();
    expect(hook.result.current).not.toBe(withHandler);
  });

  it('passes every argument through unchanged', () => {
    const handler = jest.fn((_value: boolean, _count: number) => {});
    const { result } = renderHook(() =>
      useStableCallback<(value: boolean, count: number) => void>(handler)
    );
    run(() => result.current?.f(true, 7));
    expect(handler).toHaveBeenCalledWith(true, 7);
  });
});
