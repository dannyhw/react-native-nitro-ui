/**
 * Waits for `hybridRef` handles. A handle arrives on a React commit after its
 * view is laid out, so a box can be found before its handle exists.
 */

const HANDLE_TIMEOUT_MS = 5000;

const POLL_MS = 20;

/**
 * Polls `read` until it returns a handle, and throws naming `options.what` if
 * none arrives within the timeout.
 */
export async function waitForHandle<T>(
  read: () => T | null | undefined,
  options: { what: string; timeoutMs?: number } = { what: 'control' }
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? HANDLE_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const handle = read();
    if (handle != null) return handle;
    if (Date.now() > deadline) {
      throw new Error(
        `no hybridRef handle for ${options.what} within ${String(timeoutMs)}ms. ` +
          'A box can exist before its ref callback has run — the callback lands on ' +
          'a commit after the view is created — so this is the handle being late, ' +
          'not the control being broken; if it never arrives at all, the control ' +
          'has stopped handing back its state.'
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/** How to read each handle a fixture has promised, by the control's `testID`. */
const promisedHandles = new Map<string, () => unknown>();

/**
 * A `hybridRef` callback that files the handle under `key` in `map` and promises
 * it for `testId`, so {@link waitForPromisedHandle} waits for it. A test that
 * mounts the same id again must delete the old entry first.
 */
export function handleRef<T>(
  map: Record<string, T>,
  key: string,
  testId: string = key
): (view: T) => void {
  promisedHandles.set(testId, () => map[key]);
  return (view: T) => {
    map[key] = view;
  };
}

/**
 * Waits for the handle a fixture promised for `testId`; returns at once if it
 * promised none.
 */
export async function waitForPromisedHandle(
  testId: string,
  timeoutMs?: number
): Promise<void> {
  const read = promisedHandles.get(testId);
  if (read == null) return;
  await waitForHandle(read, { what: `"${testId}"`, timeoutMs });
}

/**
 * Waits for a control's handle and returns it. A test that mounts the same id
 * again must delete the old entry first, or this returns the dropped view's
 * handle at once.
 */
export function handleOf<T>(
  read: () => T | null | undefined,
  what: string
): Promise<T> {
  return waitForHandle(read, { what: `"${what}"` });
}

/**
 * Drops every promise, so a later case is not satisfied by a fixture an earlier
 * case rendered under the same `testID`. Call it in `afterEach`.
 */
export function forgetPromisedHandles(): void {
  promisedHandles.clear();
}
