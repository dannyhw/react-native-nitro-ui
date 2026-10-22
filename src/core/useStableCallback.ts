import { callback } from 'react-native-nitro-modules';
import { useInsertionEffect, useMemo, useRef } from 'react';

/**
 * Any function that can be handed to a Nitro callback prop.
 */
type AnyFunction = (...args: any[]) => unknown;

/**
 * A Nitro-wrapped callback - exactly what a native callback prop expects.
 *
 * React Native turns raw functions in props into `true`, so Nitro requires the
 * function to travel inside a `{ f: … }` object. `null` (not this type) means
 * "no callback".
 */
export type NitroCallbackProp<Fn> = { f: Fn };

/**
 * Wrap `fn` for a native callback prop, keeping a precise `{ f: Fn }` type.
 *
 * `callback()` is the runtime helper of `react-native-nitro-modules` (so this
 * keeps working if RN ever stops mangling functions in props); its own return
 * type is a conditional that does not reduce for a generic `Fn`.
 */
function wrapCallback<Fn extends AnyFunction>(fn: Fn): NitroCallbackProp<Fn> {
  return callback(fn) as unknown as NitroCallbackProp<Fn>;
}

/**
 * A callback prop whose identity only changes when a handler is added or
 * removed - never because the user passed a new inline closure.
 *
 * Nitro diffs props by identity (both in JS and in C++), so an inline
 * `callback(…)` in JSX re-sends the callback on every render, which re-applies
 * the prop (`beforeUpdate`/`afterUpdate`) and - in the worst case - rebuilds the
 * hosted view. Keep one wrapper per mounted view and swap only the `ref` it
 * reads.
 *
 * The latest `fn` is written in `useInsertionEffect`, so it is up to date before
 * any child effect or layout effect can fire, and it is concurrent-safe (unlike
 * writing a ref during render).
 *
 * @returns `{ f: fn }` while a handler is set, `null` while it is not - pass it
 * straight to the native prop.
 */
export function useStableCallback<Fn extends AnyFunction>(
  fn: Fn | undefined | null
): NitroCallbackProp<Fn> | null {
  const ref = useRef<Fn | undefined | null>(fn);
  useInsertionEffect(() => {
    ref.current = fn;
  });
  const hasCallback = fn != null;
  return useMemo(() => {
    if (!hasCallback) {
      return null;
    }
    const latest = ((...args: Parameters<Fn>) =>
      ref.current?.(...(args as any))) as unknown as Fn;
    return wrapCallback(latest);
  }, [hasCallback]);
}
