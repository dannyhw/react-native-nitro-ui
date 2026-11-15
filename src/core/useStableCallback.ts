import { callback } from 'react-native-nitro-modules';
import { useInsertionEffect, useMemo, useRef } from 'react';

type AnyFunction = (...args: any[]) => unknown;

/**
 * React Native turns a raw function prop into `true`, so Nitro needs it inside
 * `{ f: … }`. `null` means "no callback".
 */
export type NitroCallbackProp<Fn> = { f: Fn };

/** `callback()`'s return type does not reduce for a generic `Fn`, hence the cast. */
function wrapCallback<Fn extends AnyFunction>(fn: Fn): NitroCallbackProp<Fn> {
  return callback(fn) as unknown as NitroCallbackProp<Fn>;
}

/**
 * A callback prop whose identity changes only when a handler is added or
 * removed. Nitro diffs props by identity, so an inline `callback(…)` in JSX
 * would re-send and re-apply the prop on every render.
 *
 * Native never re-invokes a callback prop that is already installed, which is
 * why `hybridRef` fires once, at mount.
 */
export function useStableCallback<Fn extends AnyFunction>(
  fn: Fn | undefined | null
): NitroCallbackProp<Fn> | null {
  const ref = useRef<Fn | undefined | null>(fn);
  // Written in an insertion effect, not during render: it is concurrent-safe
  // and runs before any layout effect can call the handler.
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
