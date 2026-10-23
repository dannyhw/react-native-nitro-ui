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
 *
 * @param configuration Pass the prop your component `key`s the *native view* on,
 *   when it has one. The id belongs to a native mount, not to a React element:
 *   when the view is replaced, Fabric orders Delete before Create
 *   (`Differentiator.cpp`), and the dropped view's `onDropView` ends in
 *   `NitroUiSizing.forget(id)` - which erases the ledger entry the new mount has
 *   just filed if the two share an id, leaving a configuration that is not already
 *   exact in the cache with nothing left to correct it. A new id per mount costs
 *   one unused entry; a shared id costs the correction. Components whose native
 *   view is never replaced omit it and get exactly the previous behaviour.
 */
export function useSizingId(configuration?: string): number {
  const idRef = useRef<{
    configuration: string | undefined;
    id: number;
  } | null>(null);
  let entry = idRef.current;
  if (entry === null || entry.configuration !== configuration) {
    entry = { configuration, id: nitroUiCore.nextSizingId() };
    idRef.current = entry;
  }
  return entry.id;
}
