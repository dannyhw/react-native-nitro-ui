import { useState } from 'react';

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
 * instance. The mint may run more than once for one instance (StrictMode's double
 * render, a render React discards) and burn an unused id; that is all an unused id
 * costs, because an id only becomes an engine entry when a view files it, and a
 * view files the id it was mounted with.
 *
 * @param configuration Pass the prop your component `key`s the *native view* on,
 *   when it has one - normalised to the same value the `key` uses, so the two can
 *   never disagree. The id belongs to a native mount, not to a React element:
 *   when the view is replaced, Fabric orders Delete before Create
 *   (`Differentiator.cpp`), and the dropped view's `onDropView` ends in
 *   `NitroUiSizing.forget(id)` - which erases the ledger entry the new mount has
 *   just filed if the two share an id, leaving a configuration that is not already
 *   exact in the cache with nothing left to correct it. A new id per mount costs
 *   one unused entry; a shared id costs the correction. Components whose native
 *   view is never replaced omit it and get exactly the previous behaviour.
 *
 * The one rule this hook exists to enforce: an id never changes under a view that
 * is not remounting. Only that view's drop can end an entry, so an id swapped in
 * place leaks one engine entry for the life of the process - and D17's "an
 * instance whose configuration is already exact lays out exact" rule quietly
 * stops holding for it. That is why the value is state, adjusted during render:
 *
 * - a `useRef` written during render cannot hold this. A render React throws away
 *   (a transition, or a `Suspense`-hidden variant change that gets flipped back)
 *   leaves the ref mutation behind - the ref object is shared by the working and
 *   committed fibers - while its hook state is rebuilt from the committed fiber.
 *   The next commit then sees the abandoned configuration, mints again, and hands
 *   a fresh id to a view that was never remounted; the id it carried has no drop
 *   coming and leaks.
 * - state has the ref's durability without the ref's bug: what a discarded render
 *   wrote is discarded with it, so the next render sees the committed
 *   configuration and keeps the id the mounted view already carries.
 * - and unlike `useMemo`, it cannot be *dropped*. React documents a memo as a
 *   hint it may throw away, and a memo dropped under a live view mints a fresh id
 *   - the exact leak this hook exists to prevent. A state value only changes when
 *   this hook changes it.
 *
 * A real configuration change mints during the same render (React's documented
 * "adjust state when a prop changes" pattern: the state update re-runs this
 * component before the commit), so the view created for the new configuration is
 * created with its own id.
 *
 * `src/__tests__/useSizingId.test.tsx` guards both halves of that, and is red
 * against the ref version.
 */
export function useSizingId(configuration?: string): number {
  const [entry, setEntry] = useState<{
    configuration: string | undefined;
    id: number;
  }>(() => ({ configuration, id: nitroUiCore.nextSizingId() }));
  if (entry.configuration !== configuration) {
    setEntry({ configuration, id: nitroUiCore.nextSizingId() });
  }
  return entry.id;
}
