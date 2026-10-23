import { useRef } from 'react';

import { nitroUiCore } from '../NitroUiCore';

/**
 * The id a measured size comes back to, for one mounted instance of a
 * self-sizing component.
 *
 * Every self-sizing component must use this hook - never a module-level counter
 * of its own. The sizing engine is process-global and keys its ledger by the id
 * alone, so a second component with its own counter would share entries with the
 * first and receive the other one's corrections. Ids come from native for the
 * same reason: they stay unique across components, across JS runtimes in one
 * app, and across a JS reload, while a JS counter restarts at one.
 *
 * Lazily, once per mounted instance: a render-time call would hand out a new id
 * on every render, which would make native treat the view as a different
 * instance. `useRef` also keeps StrictMode's double render from matter - it may
 * burn one unused id, and that is all an unused id costs.
 */
export function useSizingId(): number {
  const idRef = useRef<number>(0);
  if (idRef.current === 0) {
    idRef.current = nitroUiCore.nextSizingId();
  }
  return idRef.current;
}
