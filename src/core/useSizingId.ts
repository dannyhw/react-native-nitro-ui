import { useState } from 'react';

import { nitroUiCore } from '../NitroUiCore';

/**
 * The sizing id of one mounted instance of a self-sizing component: the id its
 * measured size comes back to.
 *
 * Every self-sizing component must use this hook, never a counter of its own. The
 * sizing engine is process-global and keyed by the id alone, and ids minted
 * natively stay unique across components, JS runtimes and reloads.
 *
 * @param configuration The prop the component `key`s its native view on, if it
 *   has one, normalised the same way as the `key`. The id belongs to a native
 *   mount, not to a React element: when the view is replaced, dropping the old
 *   view forgets its id, which would erase the new mount's entry if the two
 *   shared one.
 *
 * The id is state adjusted during render, not a ref or a memo. An id must never
 * change under a view that is not remounting, because only that view's drop
 * frees its engine entry. A ref written during render keeps the write of a render
 * React discards, and React may drop a memo; either would mint a new id for a
 * live view and leak the old one. An id that is minted and never used costs
 * nothing.
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
